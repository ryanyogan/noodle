import { env } from "cloudflare:workers";
import { addCapture, findCaptureToken } from "@noodle/db";
import { type DayKey, dayKeyAt, parseCapturedAmount } from "@noodle/domain";
import { ulid } from "ulid";
import { z } from "zod";
import { queueAi } from "./ai-queue";
import { type BankImportMessage, startBankImport } from "./bank-import-workflow";
import { getDb } from "./db";
import { notifyHousehold } from "./notify";
import type { ReceiptMessage } from "./receipt-email";
import { consumeReceipt } from "./receipt-worker";
import { idFor } from "./stable-id";

// Tap to capture: the iPhone Shortcut a Parent sets up runs when they pay with Wallet and POSTs
// the payment's merchant and amount to CAPTURE_PATH (/api/capture) with their capture token. The Worker checks
// the token and what was sent, puts the capture on the ingest Queue, and answers 202 at once; the
// Queue's consumer writes it as that Parent's Quick Add (addCapture), files it the way an Import's
// lines are (by background AI, ADR-0027), and tells the Household.

/** A capture waiting on the ingest Queue, checked and ready to write. */
export type CaptureMessage = {
	kind: "capture";
	tokenId: string;
	householdId: string;
	memberId: string;
	/** Derived from what was sent, so the same capture sent again is the same Transaction. */
	transactionId: string;
	date: DayKey;
	amountCents: number;
	merchant: string;
};

/** A capture token's SHA-256, as hex: all that's stored of it. */
export async function hashCaptureToken(token: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
	return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** A new capture token: 32 random bytes, base64url, with a prefix that says what it is. */
export function newCaptureToken(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(32));
	const base64 = btoa(String.fromCharCode(...bytes));
	return `noodle_${base64.replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "")}`;
}

const captureSchema = z.object({
	// Wallet's merchant name; a long one is cut to fit a note.
	merchant: z
		.string()
		.trim()
		.min(1)
		.transform((merchant) => merchant.slice(0, 80)),
	amount: z.union([z.number(), z.string()]),
	/** When the Shortcut ran (its Current Date), in any format: it tells retries apart. */
	at: z.string().trim().max(100).optional(),
	/** Any ID the Shortcut sends for the payment instead; the same ID is the same capture. */
	id: z.string().trim().min(1).max(100).optional(),
});

/** How far `at` may be from when a capture arrives and still date it; else it's dated on arrival. */
const AT_TOLERANCE_MS = 2 * 86_400_000;

/** What receiving a capture needs; the Worker passes the real ones, tests fakes. */
export type CaptureDeps = {
	findToken: (tokenHash: string) => ReturnType<typeof findCaptureToken>;
	enqueue: (message: CaptureMessage) => Promise<void>;
	now: Date;
};

const json = (status: number, body: unknown, headers: HeadersInit = {}) =>
	Response.json(body, { status, headers });

/**
 * Receives one capture from the Shortcut: 202 once it's on the ingest Queue, 401 without a live
 * capture token, 400 when what was sent isn't a merchant and an amount spent.
 */
export async function receiveCapture(request: Request, deps: CaptureDeps): Promise<Response> {
	if (request.method !== "POST") return json(405, { error: "Use POST." }, { Allow: "POST" });
	const token = /^Bearer\s+(\S+)$/i.exec(request.headers.get("Authorization") ?? "")?.[1];
	const found = token ? await deps.findToken(await hashCaptureToken(token)) : null;
	if (!found) {
		return json(
			401,
			{ error: "That capture token isn’t valid. Make a new one in Noodle, in Household settings." },
			{ "WWW-Authenticate": "Bearer" },
		);
	}
	const parsed = captureSchema.safeParse(await request.json().catch(() => null));
	const amountCents = parsed.success ? parseCapturedAmount(parsed.data.amount) : null;
	if (!parsed.success || amountCents === null) {
		return json(400, { error: "Send JSON with a merchant and an amount spent." });
	}
	const { merchant, at, id } = parsed.data;
	const sentAt = at ? new Date(at) : null;
	const when =
		sentAt && Math.abs(sentAt.getTime() - deps.now.getTime()) <= AT_TOLERANCE_MS
			? sentAt
			: deps.now;
	// Without an ID or a time, a retry within the same minute is still the same capture.
	const sameCapture =
		id ?? `${at ?? Math.floor(deps.now.getTime() / 60_000)}|${merchant}|${amountCents}`;
	await deps.enqueue({
		kind: "capture",
		tokenId: found.tokenId,
		householdId: found.householdId,
		memberId: found.memberId,
		transactionId: await idFor(`${found.tokenId}|${sameCapture}`),
		date: dayKeyAt(when, found.timeZone),
		amountCents,
		merchant,
	});
	return json(202, { ok: true });
}

/** The Worker's capture endpoint, with its D1 and ingest Queue. */
export function handleCapture(request: Request): Promise<Response> {
	const db = getDb();
	return receiveCapture(request, {
		findToken: (tokenHash) => findCaptureToken(db, tokenHash),
		enqueue: async (message) => {
			await env.INGEST_QUEUE.send(message);
		},
		now: new Date(),
	});
}

/**
 * What waits on the ingest Queue: a capture, a forwarded Receipt (receipt-email.ts), or a Bank
 * Connection to read (bank-import-workflow.ts).
 */
export type IngestMessage = CaptureMessage | ReceiptMessage | BankImportMessage;

/**
 * The ingest Queue's consumer: writes each capture as its Parent's Quick Add, files each
 * forwarded Receipt, and starts the Import Workflow for each Bank Connection to read, retrying
 * (with backoff) only what failed. A capture whose token was revoked in the meantime is dropped.
 */
export async function consumeIngest(batch: MessageBatch<IngestMessage>): Promise<void> {
	const db = getDb();
	for (const message of batch.messages) {
		if (message.body.kind === "receipt") {
			try {
				await consumeReceipt(message.body);
				message.ack();
			} catch (error) {
				console.error("Couldn’t file a forwarded Receipt", error);
				message.retry({ delaySeconds: 30 });
			}
			continue;
		}
		if (message.body.kind === "bank-import") {
			try {
				await startBankImport(message.body);
				message.ack();
			} catch (error) {
				console.error("Couldn’t start a Bank Connection’s Import", error);
				message.retry({ delaySeconds: 30 });
			}
			continue;
		}
		try {
			const { householdId, memberId, transactionId } = message.body;
			const result = await addCapture(db, { ...message.body, newId: ulid });
			if (result.ok) {
				// Filed like an Import's lines by background AI shortly: Rule, else a similar merchant,
				// else the model when it's sure; otherwise flagged for Review.
				await queueAi({ householdId, memberId, kind: "captured", ids: [transactionId] });
				if (result.added || result.matchedMonths.length > 0) {
					// Every month: what's left can roll into later ones.
					await notifyHousehold(
						householdId,
						["months", "for-earlier", "bucket-uses"],
						result.added ? [{ type: "quick-add", transactionId }] : [],
					);
				}
			}
			message.ack();
		} catch (error) {
			console.error("Couldn’t record a captured Quick Add", error);
			message.retry({ delaySeconds: 10 });
		}
	}
}
