import { env } from "cloudflare:workers";
import { dayKeyAt, monthKeyAt } from "@noodle/domain";
import { createServerFn } from "@tanstack/react-start";
import { ulid } from "ulid";
import { z } from "zod";
import { getDb } from "./db";
import { householdMiddleware, viewerOf } from "./household";
import { notifyHousehold } from "./notify";
import { MAX_PHRASE, stubPhraseReader, workersAiPhraseReader } from "./phrase-model";
import { stubReceiptReader, workersAiReceiptReader } from "./receipt-model";
import { receiptThumbnail } from "./receipt-worker";
import { ulidSchema } from "./schemas";
import {
	type CaptureDraft,
	PHOTO_TYPES,
	readPhrase,
	type SnapResult,
	snapReceipt,
} from "./snap-run";

// Snap and speak in Quick Add, with the Worker's D1, R2, Images and model (snap-run.ts has the
// logic). Both answer with what was read; nothing becomes a Quick Add until the Parent saves it.

/** The largest photo taken: the app sends a phone photo scaled down well under this. */
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

const photoSchema = z.object({
	// A client ULID: sending the same photo again keeps one Receipt.
	receiptId: ulidSchema,
	photo: z
		.instanceof(File)
		.refine((file) => file.size > 0 && file.size <= MAX_PHOTO_BYTES, "Too large a photo")
		.refine((file) => PHOTO_TYPES.includes(file.type), "Not a photo"),
});

/**
 * Keeps and reads a photo of a Receipt, sent as form data (`receiptId`, `photo`): attached to the
 * Transaction it's for, if there's one already, else what it says, for Quick Add to fill in.
 */
export const snapReceiptPhoto = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator((data: FormData) => {
		if (!(data instanceof FormData)) throw new Error("Expected form data");
		return photoSchema.parse({ receiptId: data.get("receiptId"), photo: data.get("photo") });
	})
	.handler(async ({ data, context }): Promise<SnapResult> => {
		const viewer = viewerOf(context);
		const result = await snapReceipt(
			{
				db: getDb(),
				reader: __AI_STUB__ ? stubReceiptReader : workersAiReceiptReader(env.AI, env.AI_GATEWAY_ID),
				store: async (key, bytes, contentType) => {
					await env.STATEMENTS.put(key, bytes, { httpMetadata: { contentType } });
				},
				thumbnail: receiptThumbnail,
				newId: ulid,
			},
			viewer,
			{
				receiptId: data.receiptId,
				bytes: new Uint8Array(await data.photo.arrayBuffer()),
				mimeType: data.photo.type,
			},
			dayKeyAt(new Date(), context.household.timeZone),
		);
		if (result.kind === "attached") {
			// Its Transaction has a Receipt now, and maybe Splits: every month, as rollover can reach.
			await notifyHousehold(context.household.id, ["months", "for-earlier", "bucket-uses"]);
		}
		return result;
	});

/** Reads what a Parent said or typed about something they spent today, for Quick Add to fill in. */
export const readSpokenPhrase = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(
		z.object({
			phrase: z
				.string()
				.trim()
				.min(1)
				.max(MAX_PHRASE * 2),
		}),
	)
	.handler(
		async ({ data, context }): Promise<CaptureDraft> =>
			readPhrase(
				{
					db: getDb(),
					reader: __AI_STUB__ ? stubPhraseReader : workersAiPhraseReader(env.AI, env.AI_GATEWAY_ID),
				},
				viewerOf(context),
				data.phrase,
				monthKeyAt(new Date(), context.household.timeZone),
			),
	);
