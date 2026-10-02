import { env } from "cloudflare:workers";
import {
	type BankConnectionToSync,
	findBankConnectionsByExternal,
	markBankConnectionDisconnected,
	markBankConnectionReconnect,
	markBankConnectionReconnected,
	markBankNewAccounts,
	recordBankWebhook,
	saveBankNotice,
} from "@noodle/db";
import { ulid } from "ulid";
import type { HouseholdChange } from "../household-changes";
import type { BankImportMessage } from "./bank-import-workflow";
import { bankSetup } from "./bank-setup";
import { getDb } from "./db";
import { notifyHousehold } from "./notify";

// Plaid's webhooks, at PLAID_WEBHOOK_PATH: each link token names it, so Plaid posts here when an
// Item has news. Every one is signed, and checked as Plaid's docs say: its Plaid-Verification
// header is a JWT that must be ES256, signed by the key Plaid hands out for its `kid` (kept by ID,
// fetched when the ID is new), issued within five minutes, and carrying the SHA-256 of the raw
// body, compared in constant time. One that fails any of those is refused (401).
//
// The request only records and queues: a sync goes on the ingest Queue for the Import Workflow, so
// Plaid has its answer well inside its 10 seconds. Plaid retries anything but a 200 for a day, so
// a webhook for an Item the app doesn't know, or an event it doesn't act on, is a 200 too; a 5xx
// is for when the app itself failed (the database, the Queue, or Plaid's key endpoint) and a
// retry would help. Plaid may send one webhook twice: every action here is safe to repeat, and
// two syncs for one Bank Connection never overlap (startOneSync in bank-import-workflow.ts).
//
// What each event does:
// - TRANSACTIONS/SYNC_UPDATES_AVAILABLE: sync.
// - TRANSACTIONS/INITIAL_UPDATE, HISTORICAL_UPDATE (and DEFAULT_UPDATE, TRANSACTIONS_REMOVED):
//   nothing. Plaid still sends these beside SYNC_UPDATES_AVAILABLE for Items that use
//   /transactions/sync; they belong to the older /transactions/get, and the sync webhook already
//   covers what they announce (the run's own rounds wait for history to finish).
// - ITEM/ERROR with ITEM_LOGIN_REQUIRED, ITEM/PENDING_EXPIRATION, ITEM/PENDING_DISCONNECT: the
//   Parent must log in again (reconnect). ITEM/LOGIN_REPAIRED: ready again, and synced.
// - ITEM/ERROR with any other code (the bank is down, or has no accounts): a notice on the Bank
//   Connection in plain words, with nothing asked of the Parent; the next sync that works clears it.
// - ITEM/USER_PERMISSION_REVOKED, ITEM/USER_ACCOUNT_REVOKED: the Parent took access away at the
//   bank. The Item is dead: the Bank Connection is disconnected, its Accounts and Transactions kept.
// - ITEM/NEW_ACCOUNTS_AVAILABLE: the Bank Connection offers to add the new account.
// - ITEM/WEBHOOK_UPDATE_ACKNOWLEDGED: the new address is recorded.
// Every webhook writes one log line: its type, code, Item and what was done. Never anything from
// an Account or a Transaction.

export const PLAID_WEBHOOK_PATH = "/webhooks/plaid";

/** How far a webhook's signature may be from now. */
const MAX_AGE_MS = 5 * 60 * 1000;

/** Item webhooks that mean a Parent must log in again (now, or within days). */
const RECONNECT_CODES = new Set(["PENDING_EXPIRATION", "PENDING_DISCONNECT"]);

/** Item webhooks that mean the Parent took the app's access away at the institution. */
const REVOKED_CODES = new Set(["USER_PERMISSION_REVOKED", "USER_ACCOUNT_REVOKED"]);

/** Transactions webhooks of the older /transactions/get, which the sync webhook already covers. */
const LEGACY_TRANSACTIONS_CODES = new Set([
	"INITIAL_UPDATE",
	"HISTORICAL_UPDATE",
	"DEFAULT_UPDATE",
	"TRANSACTIONS_REMOVED",
]);

/** What the Bank Connection says for an Item error that isn't the Parent's to fix (ADR-0018). */
const BANK_DOWN =
	"Your bank isn’t answering right now. Noodle will keep trying, and there’s nothing you need to do.";
const BANK_PROBLEMS: Record<string, string> = {
	INSTITUTION_DOWN: BANK_DOWN,
	INSTITUTION_NOT_RESPONDING: BANK_DOWN,
	INSTITUTION_NOT_AVAILABLE: BANK_DOWN,
	NO_ACCOUNTS:
		"Your bank says this login has no accounts any more. If you closed them, there’s nothing you need to do.",
};
const BANK_PROBLEM =
	"Your bank had a problem sending Transactions. Noodle will try again, and there’s nothing you need to do.";

/** The notice for an Item error by Plaid's code. */
export const bankProblemNotice = (errorCode: unknown): string =>
	BANK_PROBLEMS[String(errorCode)] ?? BANK_PROBLEM;

/** What was done about a webhook, as its log line says. */
export type PlaidWebhookOutcome = "synced" | "marked" | "ignored" | "rejected" | "failed";

/** One webhook's log line: which event, for which Item, and what was done. Nothing else. */
export type PlaidWebhookLog = {
	log: "plaid-webhook";
	type: string | null;
	code: string | null;
	item_id: string | null;
	error_code: string | null;
	outcome: PlaidWebhookOutcome;
};

export type PlaidWebhookDeps = {
	/** Plaid's public key by its ID (/webhook_verification_key/get); null when unknown. */
	webhookKey: (keyId: string) => Promise<JsonWebKey | null>;
	findConnections: (itemId: string) => Promise<BankConnectionToSync[]>;
	sync: (message: BankImportMessage) => Promise<void>;
	markReconnect: (connection: BankConnectionToSync) => Promise<boolean>;
	markReconnected: (connection: BankConnectionToSync) => Promise<boolean>;
	markDisconnected: (connection: BankConnectionToSync) => Promise<boolean>;
	markNewAccounts: (connection: BankConnectionToSync) => Promise<boolean>;
	saveNotice: (connection: BankConnectionToSync, notice: string) => Promise<void>;
	/** A webhook came for the Bank Connection; with an address, Plaid now sends them there. */
	recordWebhook: (
		connection: BankConnectionToSync,
		at: Date,
		webhookUrl: string | null,
	) => Promise<void>;
	notify: (householdId: string, changes: HouseholdChange[]) => Promise<void>;
	log: (line: PlaidWebhookLog) => void;
	now: Date;
};

type PlaidWebhook = {
	webhook_type?: unknown;
	webhook_code?: unknown;
	item_id?: unknown;
	error?: { error_code?: unknown } | null;
	new_webhook_url?: unknown;
};

/** A field for the log: a short string, or nothing. */
const logged = (value: unknown): string | null =>
	typeof value === "string" ? value.slice(0, 80) : null;

/** Verifies a webhook from Plaid and acts on it. */
export async function receivePlaidWebhook(
	request: Request,
	deps: PlaidWebhookDeps,
): Promise<Response> {
	if (request.method !== "POST") return new Response(null, { status: 405 });
	const line: PlaidWebhookLog = {
		log: "plaid-webhook",
		type: null,
		code: null,
		item_id: null,
		error_code: null,
		outcome: "rejected",
	};
	const answer = (status: number, outcome: PlaidWebhookOutcome) => {
		deps.log({ ...line, outcome });
		return new Response(null, { status });
	};

	// The bytes as they came: the signature is over exactly these.
	const body = new Uint8Array(await request.arrayBuffer());
	let verified: boolean;
	try {
		verified = await verifyPlaidWebhook(
			body,
			request.headers.get("Plaid-Verification"),
			deps.webhookKey,
			deps.now,
		);
	} catch (error) {
		// Plaid's key couldn't be fetched: not the webhook's fault, so Plaid should send it again.
		console.error("Couldn’t fetch Plaid’s webhook key", error);
		return answer(500, "failed");
	}
	if (!verified) return answer(401, "rejected");

	let webhook: PlaidWebhook;
	try {
		webhook = JSON.parse(new TextDecoder().decode(body)) as PlaidWebhook;
	} catch {
		return answer(400, "rejected");
	}
	line.type = logged(webhook.webhook_type);
	line.code = logged(webhook.webhook_code);
	line.item_id = logged(webhook.item_id);
	line.error_code = logged(webhook.error?.error_code);
	if (typeof webhook.item_id !== "string") return answer(200, "ignored");

	try {
		let outcome: PlaidWebhookOutcome = "ignored";
		for (const connection of await deps.findConnections(webhook.item_id)) {
			const did = await actOn(webhook, connection, deps);
			if (did === "synced" || outcome === "ignored") outcome = did;
		}
		return answer(200, outcome);
	} catch (error) {
		console.error("Couldn’t act on a Plaid webhook", error);
		return answer(500, "failed");
	}
}

/** Does what one webhook asks for one Bank Connection. Everything here is safe to do twice. */
async function actOn(
	webhook: PlaidWebhook,
	connection: BankConnectionToSync,
	deps: PlaidWebhookDeps,
): Promise<"synced" | "marked" | "ignored"> {
	const type = webhook.webhook_type;
	const code = String(webhook.webhook_code);
	const acknowledged = type === "ITEM" && code === "WEBHOOK_UPDATE_ACKNOWLEDGED";
	await deps.recordWebhook(
		connection,
		deps.now,
		acknowledged && typeof webhook.new_webhook_url === "string" ? webhook.new_webhook_url : null,
	);
	const changed = () => deps.notify(connection.householdId, ["bank-connections"]);
	const sync = async () => {
		// A disconnected one's Item is dead: there's nothing to read.
		if (connection.status === "disconnected") return "ignored" as const;
		await deps.sync({
			kind: "bank-import",
			householdId: connection.householdId,
			connectionId: connection.connectionId,
			timeZone: connection.timeZone,
			runId: ulid(),
		});
		return "synced" as const;
	};

	if (type === "TRANSACTIONS") {
		if (code === "SYNC_UPDATES_AVAILABLE") return sync();
		// The older webhooks Plaid sends beside it: acknowledged, nothing to do (see above).
		if (LEGACY_TRANSACTIONS_CODES.has(code)) return "ignored";
		return "ignored";
	}
	if (type !== "ITEM") return "ignored";
	if (acknowledged) return "marked";
	if (
		(code === "ERROR" && webhook.error?.error_code === "ITEM_LOGIN_REQUIRED") ||
		RECONNECT_CODES.has(code)
	) {
		if (await deps.markReconnect(connection)) await changed();
		return "marked";
	}
	if (code === "ERROR") {
		if (connection.status === "disconnected") return "ignored";
		await deps.saveNotice(connection, bankProblemNotice(webhook.error?.error_code));
		await changed();
		return "marked";
	}
	if (code === "LOGIN_REPAIRED") {
		if (await deps.markReconnected(connection)) await changed();
		return sync();
	}
	if (REVOKED_CODES.has(code)) {
		if (await deps.markDisconnected(connection)) await changed();
		return "marked";
	}
	if (code === "NEW_ACCOUNTS_AVAILABLE") {
		if (await deps.markNewAccounts(connection)) await changed();
		return "marked";
	}
	return "ignored";
}

/**
 * Whether `body` is what Plaid signed: the JWT in `token` is ES256, signed by the key Plaid names,
 * issued within five minutes of now, and carries the SHA-256 of exactly these bytes. Throws only
 * when the key couldn't be asked for.
 */
export async function verifyPlaidWebhook(
	body: string | Uint8Array<ArrayBuffer>,
	token: string | null,
	webhookKey: PlaidWebhookDeps["webhookKey"],
	now: Date,
): Promise<boolean> {
	const parts = token?.split(".") ?? [];
	if (parts.length !== 3) return false;
	const [header, payload, signature] = parts as [string, string, string];
	const head = decodeJson(header) as { alg?: unknown; kid?: unknown } | null;
	// Before anything is fetched: only ES256, so a token can't pick a weaker way to be checked.
	if (head?.alg !== "ES256" || typeof head.kid !== "string") return false;
	const claims = decodeJson(payload) as { iat?: unknown; request_body_sha256?: unknown } | null;
	if (typeof claims?.iat !== "number" || typeof claims.request_body_sha256 !== "string") {
		return false;
	}
	if (Math.abs(now.getTime() - claims.iat * 1000) > MAX_AGE_MS) return false;

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
	const bytes = typeof body === "string" ? new TextEncoder().encode(body) : body;
	return sameText(await sha256Hex(bytes), claims.request_body_sha256.toLowerCase());
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
		markDisconnected: ({ householdId, connectionId }) =>
			markBankConnectionDisconnected(db, householdId, connectionId),
		markNewAccounts: ({ householdId, connectionId }) =>
			markBankNewAccounts(db, householdId, connectionId, true),
		saveNotice: async ({ householdId, connectionId }, notice) => {
			await saveBankNotice(db, householdId, connectionId, notice);
		},
		recordWebhook: ({ householdId, connectionId }, at, webhookUrl) =>
			recordBankWebhook(db, householdId, connectionId, at, webhookUrl),
		notify: notifyHousehold,
		log: (line) => console.log(JSON.stringify(line)),
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

async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", bytes);
	return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Whether two strings are the same, in time that doesn't depend on where they differ. */
export function sameText(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let difference = 0;
	for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return difference === 0;
}
