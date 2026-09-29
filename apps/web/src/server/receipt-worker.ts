import { env } from "cloudflare:workers";
import { findReceiptAddress, listParents } from "@noodle/db";
import { ulid } from "ulid";
import { verifiedEmails } from "./auth";
import { categorizeCaptured } from "./categorize";
import { getDb } from "./db";
import { notifyHousehold } from "./notify";
import { fileReceiptEmail, type ReceiptMessage, receiveReceiptEmail } from "./receipt-email";
import { stubReceiptReader, workersAiReceiptReader } from "./receipt-model";

// Forwarded Receipts on the Worker: its email handler, and the ingest Queue's consumer for what
// that queued, with their D1, R2, Queue, Images, and model (receipt-email.ts has the logic).

/** Receives an email sent to a Receipt address (the Worker's email handler). */
export async function handleReceiptEmail(message: ForwardableEmailMessage): Promise<void> {
	const db = getDb();
	await receiveReceiptEmail(message, {
		findAddress: (key) => findReceiptAddress(db, key),
		parentWithEmail: async (householdId, email) => {
			for (const parent of await listParents(db, householdId)) {
				if (!parent.clerkUserId) continue;
				const emails = await verifiedEmails(parent.clerkUserId);
				if (emails.some((address) => address.toLowerCase() === email)) return parent.id;
			}
			return null;
		},
		store: async (key, bytes) => {
			await env.STATEMENTS.put(key, bytes, { httpMetadata: { contentType: "message/rfc822" } });
		},
		enqueue: async (queued) => {
			await env.INGEST_QUEUE.send(queued);
		},
		now: new Date(),
	});
}

/** Files one queued Receipt and tells the Household. Throws for the Queue to retry. */
export async function consumeReceipt(message: ReceiptMessage): Promise<void> {
	const filed = await fileReceiptEmail(
		{
			db: getDb(),
			reader: __AI_STUB__ ? stubReceiptReader : workersAiReceiptReader(env.AI, env.AI_GATEWAY_ID),
			load: async (key) => {
				const object = await env.STATEMENTS.get(key);
				return object ? new Uint8Array(await object.arrayBuffer()) : null;
			},
			store: async (key, bytes) => {
				await env.STATEMENTS.put(key, bytes, { httpMetadata: { contentType: "image/webp" } });
			},
			thumbnail: async ({ bytes }) => {
				const picture = new Response(bytes as Uint8Array<ArrayBuffer>).body;
				if (!picture) return null;
				const result = await env.IMAGES.input(picture)
					.transform({ width: 320 })
					.output({ format: "image/webp" });
				return new Uint8Array(await result.response().arrayBuffer());
			},
			newId: ulid,
			categorize: categorizeCaptured,
		},
		message,
	);
	if (filed && (filed.added || filed.applied || filed.matchedMonths.length > 0)) {
		// Every month: what's left can roll into later ones.
		await notifyHousehold(message.householdId, ["months", "for-earlier", "bucket-uses"]);
	}
}
