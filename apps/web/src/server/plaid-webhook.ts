import { env } from "cloudflare:workers";
import {
	type BankConnectionToSync,
	findBankConnectionsByExternal,
	markBankConnectionReconnect,
	markBankConnectionReconnected,
} from "@noodle/db";
import { ulid } from "ulid";
import type { HouseholdChange } from "../household-changes";
import type { BankImportMessage } from "./bank-import-workflow";
import { bankSetup } from "./bank-setup";
import { getDb } from "./db";
import { notifyHousehold } from "./notify";

// Plaid's webhooks, at PLAID_WEBHOOK_PATH: each link token names it, so Plaid posts here when an
// Item has news. Every one is signed: its Plaid-Verification header is a JWT (ES256) whose key
// Plaid hands out by ID, and which carries the SHA-256 of the body; one that doesn't verify, or is
// over five minutes old, is refused. New transactions put each of the Item's Bank Connections on
// the ingest Queue for the Import Workflow; a lapsed or lapsing login marks them for a reconnect,
// and a repaired one makes them ready and syncs them. Anything else is acknowledged and ignored.

export const PLAID_WEBHOOK_PATH = "/webhooks/plaid";

/** How old a webhook's signature may be. */
const MAX_AGE_MS = 5 * 60 * 1000;

/** Item webhooks that mean a Parent must log in again (now, or within days). */
const RECONNECT_CODES = new Set(["PENDING_EXPIRATION", "PENDING_DISCONNECT"]);

export type PlaidWebhookDeps = {
	/** Plaid's public key by its ID (/webhook_verification_key/get); null when unknown. */
	webhookKey: (keyId: string) => Promise<JsonWebKey | null>;
	findConnections: (itemId: string) => Promise<BankConnectionToSync[]>;
	sync: (message: BankImportMessage) => Promise<void>;
	markReconnect: (connection: BankConnectionToSync) => Promise<boolean>;
	markReconnected: (connection: BankConnectionToSync) => Promise<boolean>;
	notify: (householdId: string, changes: HouseholdChange[]) => Promise<void>;
	now: Date;
};

type PlaidWebhook = {
	webhook_type?: unknown;
	webhook_code?: unknown;
	item_id?: unknown;
	error?: { error_code?: unknown } | null;
};

/** Verifies a webhook from Plaid and acts on it. */
export async function receivePlaidWebhook(
	request: Request,
	deps: PlaidWebhookDeps,
): Promise<Response> {
	if (request.method !== "POST") return new Response(null, { status: 405 });
	const body = await request.text();
	const verified = await verifyPlaidWebhook(
		body,
		request.headers.get("Plaid-Verification"),
		deps.webhookKey,
		deps.now,
	);
	if (!verified) return new Response(null, { status: 401 });

	let webhook: PlaidWebhook;
	try {
		webhook = JSON.parse(body) as PlaidWebhook;
	} catch {
		return new Response(null, { status: 400 });
	}
	if (typeof webhook.item_id !== "string") return new Response(null, { status: 200 });
	const connections = await deps.findConnections(webhook.item_id);
	const sync = (connection: BankConnectionToSync) =>
		deps.sync({
			kind: "bank-import",
			householdId: connection.householdId,
			connectionId: connection.connectionId,
			timeZone: connection.timeZone,
			runId: ulid(),
		});

	const event = `${webhook.webhook_type}/${webhook.webhook_code}`;
	for (const connection of connections) {
		if (event === "TRANSACTIONS/SYNC_UPDATES_AVAILABLE") {
			await sync(connection);
		} else if (
			(event === "ITEM/ERROR" && webhook.error?.error_code === "ITEM_LOGIN_REQUIRED") ||
			(webhook.webhook_type === "ITEM" && RECONNECT_CODES.has(String(webhook.webhook_code)))
		) {
			if (await deps.markReconnect(connection)) {
				await deps.notify(connection.householdId, ["bank-connections"]);
			}
		} else if (event === "ITEM/LOGIN_REPAIRED") {
			if (await deps.markReconnected(connection)) {
				await deps.notify(connection.householdId, ["bank-connections"]);
			}
			await sync(connection);
		}
	}
	return new Response(null, { status: 200 });
}

/**
 * Whether `body` is what Plaid signed: the JWT in `token` is ES256, signed by the key Plaid names,
 * at most five minutes old, and carries the SHA-256 of exactly this body.
 */
export async function verifyPlaidWebhook(
	body: string,
	token: string | null,
	webhookKey: PlaidWebhookDeps["webhookKey"],
	now: Date,
): Promise<boolean> {
	const parts = token?.split(".") ?? [];
	if (parts.length !== 3) return false;
	const [header, payload, signature] = parts as [string, string, string];
	const head = decodeJson(header) as { alg?: unknown; kid?: unknown } | null;
	if (head?.alg !== "ES256" || typeof head.kid !== "string") return false;
	const claims = decodeJson(payload) as { iat?: unknown; request_body_sha256?: unknown } | null;
	if (typeof claims?.iat !== "number" || typeof claims.request_body_sha256 !== "string") {
		return false;
	}
	if (now.getTime() - claims.iat * 1000 > MAX_AGE_MS) return false;

	const jwk = await webhookKey(head.kid);
	if (!jwk) return false;
	const signed = await crypto.subtle
		.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"])
		.then((key) =>
			crypto.subtle.verify(
				{ name: "ECDSA", hash: "SHA-256" },
				key,
				decodeBase64Url(signature) ?? new Uint8Array(),
				new TextEncoder().encode(`${header}.${payload}`),
			),
		)
		.catch(() => false);
	if (!signed) return false;
	return sameText(await sha256Hex(body), claims.request_body_sha256);
}

/** The Worker's side: Plaid's key from Plaid, and the Bank Connections from the database. */
export function handlePlaidWebhook(request: Request): Promise<Response> {
	const plaid = bankSetup()?.plaid;
	if (!plaid) return Promise.resolve(new Response(null, { status: 404 }));
	const db = getDb();
	return receivePlaidWebhook(request, {
		webhookKey: plaid.webhookKey,
		findConnections: (itemId) => findBankConnectionsByExternal(db, "plaid", itemId),
		sync: async (message) => {
			await env.INGEST_QUEUE.send(message);
		},
		markReconnect: ({ householdId, connectionId }) =>
			markBankConnectionReconnect(db, householdId, connectionId),
		markReconnected: ({ householdId, connectionId }) =>
			markBankConnectionReconnected(db, householdId, connectionId),
		notify: notifyHousehold,
		now: new Date(),
	});
}

function decodeBase64Url(text: string): Uint8Array<ArrayBuffer> | null {
	try {
		const binary = atob(text.replaceAll("-", "+").replaceAll("_", "/"));
		return Uint8Array.from(binary, (char) => char.charCodeAt(0));
	} catch {
		return null;
	}
}

function decodeJson(text: string): unknown {
	const bytes = decodeBase64Url(text);
	if (!bytes) return null;
	try {
		return JSON.parse(new TextDecoder().decode(bytes));
	} catch {
		return null;
	}
}

async function sha256Hex(text: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
	return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Whether two strings are the same, in time that doesn't depend on where they differ. */
function sameText(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let difference = 0;
	for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return difference === 0;
}
