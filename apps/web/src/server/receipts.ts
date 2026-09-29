import { env } from "cloudflare:workers";
import { loadReceipt, loadReceiptAddress, setReceiptAddress } from "@noodle/db";
import type { Cents, DayKey, ReceiptLine, ReceiptProposal } from "@noodle/domain";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getDb } from "./db";
import { householdMiddleware, viewerOf } from "./household";
import { notifyHousehold } from "./notify";
import { receiptProposal } from "./receipt-ingest";
import { base64 } from "./receipt-model";
import { ulidSchema } from "./schemas";

// The Household's Receipt address, on the Household page, and a Transaction's Receipt, in its
// detail. Receipts themselves arrive by email (receipt-email.ts).

/**
 * The domain Receipt addresses are on, once Email Routing sends it to this Worker (ADR-0016):
 * the RECEIPTS_EMAIL_DOMAIN var. E2E and local dev with the fake model use a stand-in.
 */
function receiptsDomain(): string | null {
	const domain = (env as unknown as { RECEIPTS_EMAIL_DOMAIN?: string }).RECEIPTS_EMAIL_DOMAIN;
	return domain || (__AI_STUB__ ? "receipts.test" : null);
}

export type ReceiptAddress = {
	/** Whether forwarding is set up at all; without it there's no address to show. */
	available: boolean;
	address: string | null;
};

const addressOf = (key: string | null): ReceiptAddress => {
	const domain = receiptsDomain();
	return { available: domain !== null, address: domain && key && `receipts+${key}@${domain}` };
};

/** The Household's Receipt address, or null while it has none. */
export const getReceiptAddress = createServerFn({ method: "GET" })
	.middleware([householdMiddleware])
	.handler(async ({ context }) =>
		addressOf(await loadReceiptAddress(getDb(), context.household.id)),
	);

/** A new Receipt address key: 20 random characters, lowercase letters and digits (100 bits). */
function newAddressKey(): string {
	const alphabet = "0123456789abcdefghjkmnpqrstvwxyz";
	return [...crypto.getRandomValues(new Uint8Array(20))]
		.map((byte) => alphabet[byte % 32])
		.join("");
}

/**
 * Makes the Household a Receipt address, or with `replace` a new one in place of the old, which
 * stops working at once. Without `replace`, one the other Parent made first is kept.
 */
export const makeReceiptAddress = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(z.object({ replace: z.boolean() }))
	.handler(async ({ data, context }) => {
		const key = await setReceiptAddress(getDb(), {
			householdId: context.household.id,
			key: newAddressKey(),
			replace: data.replace,
		});
		await notifyHousehold(context.household.id, ["receipt-address"]);
		return addressOf(key);
	});

/** A Transaction's Receipt as its detail shows it. */
export type ReceiptDetail = {
	merchant: string | null;
	date: DayKey | null;
	totalCents: Cents | null;
	lines: ReceiptLine[];
	/** The Splits its lines make; null when no total was read. */
	proposal: ReceiptProposal | null;
	/** A small picture of a photographed Receipt, as a data URL. */
	thumbnail: string | null;
};

/** The Receipt of a Transaction the viewer may change, or null. */
export const getTransactionReceipt = createServerFn({ method: "GET" })
	.middleware([householdMiddleware])
	.validator(z.object({ transactionId: ulidSchema }))
	.handler(async ({ data, context }): Promise<{ receipt: ReceiptDetail | null }> => {
		// Wrapped: a server function answering a bare null has no body to read.
		const receipt = await loadReceipt(getDb(), viewerOf(context), data.transactionId);
		if (!receipt) return { receipt: null };
		const picture = receipt.thumbnailKey && (await env.STATEMENTS.get(receipt.thumbnailKey));
		const thumbnail = picture
			? `data:image/webp;base64,${base64(new Uint8Array(await picture.arrayBuffer()))}`
			: null;
		const { merchant, date, totalCents, lines } = receipt;
		return {
			receipt: {
				merchant,
				date,
				totalCents,
				lines,
				proposal: receiptProposal(totalCents, lines),
				thumbnail,
			},
		};
	});
