import { AUTO_FILE_CONFIDENCE } from "./categorize";
import { clearPairs, type MatchSide, merchantSimilarity, withinMatchWindow } from "./matching";
import { type Cents, MAX_CENTS, parseDollars } from "./money";
import { addDays, type DayKey } from "./month";

// Receipts: an itemized record of a purchase, used to fill in its Transaction's Splits. A model
// reads a Receipt's lines (what each says, its amount as printed, a Bucket and For for each item);
// everything about money happens here. The lines must add up to the Receipt's total to the cent,
// or nothing is proposed. Each item's discounts stay with it, and tax and fees are shared across
// the Buckets in proportion to what's bought in each, so the Splits add up to the total exactly.

/** What a line of a Receipt is: something bought, money off it, tax, or a fee (delivery, a deposit). */
export type ReceiptLineKind = "item" | "discount" | "tax" | "fee";

/**
 * One line of a Receipt: what it says, and what it adds to the total (negative for money off).
 * An item carries the Bucket (and who it's For) a model suggested, and how sure it was (0–1).
 */
export type ReceiptLine = {
	text: string;
	kind: ReceiptLineKind;
	amount: Cents;
	bucketId: string | null;
	confidence: number;
	for: string[];
};

/**
 * An amount as a Receipt prints it, in cents, negative for money off: "$12.99", "1,299.00",
 * "-4.00", "4.00-" (Costco's discounts), "(4.00)". Null for anything that isn't an amount.
 * Parsed from the digits, never through a float.
 */
export function parseReceiptAmount(printed: string): Cents | null {
	let text = printed.replace(/\s+/g, "");
	let negative = false;
	if (/^\(.*\)$/.test(text)) {
		negative = true;
		text = text.slice(1, -1);
	}
	text = text.replace(/^\$/, "");
	if (/^-|-$/.test(text)) {
		negative = true;
		text = text.replace(/^-|-$/g, "");
	}
	const cents = parseDollars(text.replace(/^\$/, ""));
	if (cents === null) return null;
	return negative ? -cents : cents;
}

/**
 * A line as a model read it, into a ReceiptLine: its printed amount parsed, a discount always
 * money off, a confidence kept within 0–1. Null for a line with no amount, or nothing on it.
 */
export function receiptLine(read: {
	text: string;
	kind: ReceiptLineKind;
	amount: string;
	bucketId: string | null;
	confidence: number;
	for: string[];
}): ReceiptLine | null {
	const parsed = parseReceiptAmount(read.amount);
	if (parsed === null || parsed === 0) return null;
	const amount = read.kind === "discount" ? -Math.abs(parsed) : parsed;
	const confidence = Number.isFinite(read.confidence)
		? Math.min(1, Math.max(0, read.confidence))
		: 0;
	return {
		text: read.text.replace(/\s+/g, " ").trim().slice(0, 80),
		kind: read.kind,
		amount,
		bucketId: read.kind === "item" ? read.bucketId : null,
		confidence: read.kind === "item" ? confidence : 0,
		for: read.kind === "item" ? [...new Set(read.for)].sort() : [],
	};
}

/** How far a Receipt's lines are from its total: zero when they add up to it. */
export function receiptDifference(total: Cents, lines: Pick<ReceiptLine, "amount">[]): Cents {
	return lines.reduce((left, line) => left - line.amount, total);
}

/** A Split a Receipt proposes: what's bought for one Bucket and For, with its share of tax. */
export type ReceiptPart = { bucketId: string | null; for: string[]; amount: Cents };

/**
 * What a Receipt proposes for its Transaction: Splits, whole or not, or nothing when its lines
 * don't add up to its total (or it has no items).
 */
export type ReceiptProposal =
	| {
			kind: "parts";
			parts: ReceiptPart[];
			/** Every item has a Bucket the model was sure of: the parts can be applied on their own. */
			confident: boolean;
	  }
	| { kind: "unreconciled"; difference: Cents };

/**
 * `amount` shared out in proportion to `weights` (each positive), adding up to it exactly: each
 * share rounded toward zero, then the leftover cents one each to the largest remainders (the
 * earliest first on a tie). In BigInt, so large amounts never lose a cent.
 */
export function shareOut(amount: Cents, weights: Cents[]): Cents[] {
	const whole = weights.reduce((sum, weight) => sum + BigInt(weight), 0n);
	if (weights.length === 0 || whole <= 0n) return weights.map(() => 0);
	const size = BigInt(Math.abs(amount));
	const exact = weights.map((weight) => size * BigInt(weight));
	const shares = exact.map((part) => part / whole);
	let left = size - shares.reduce((sum, share) => sum + share, 0n);
	const order = exact
		.map((part, i) => ({ i, remainder: part % whole }))
		.sort((a, b) => (a.remainder === b.remainder ? a.i - b.i : a.remainder > b.remainder ? -1 : 1));
	for (const { i } of order) {
		if (left === 0n) break;
		shares[i] = (shares[i] as bigint) + 1n;
		left -= 1n;
	}
	return shares.map((share) => Math.sign(amount) * Number(share));
}

const partKey = (bucketId: string | null, forIds: string[]) =>
	`${bucketId ?? ""}|${forIds.join(",")}`;

/**
 * The Splits a Receipt's lines make of its `total`: items grouped by Bucket and For, in the order
 * first bought; each discount taken off the item printed before it (as Costco and Target print
 * them); tax, fees, and any discount before the first item shared across the groups in proportion
 * to what's in each. Only when the lines add up to the total exactly; the parts then do too.
 * Confident when every item has a Bucket the model was sure of and every part is money spent.
 */
export function proposeSplits(total: Cents, lines: ReceiptLine[]): ReceiptProposal {
	const difference = receiptDifference(total, lines);
	if (difference !== 0 || total <= 0 || total > MAX_CENTS || !lines.some(isItem)) {
		return { kind: "unreconciled", difference };
	}
	const parts = new Map<string, ReceiptPart>();
	let shared: Cents = 0;
	let lastItem: ReceiptPart | null = null;
	for (const line of lines) {
		if (line.kind === "item") {
			const key = partKey(line.bucketId, line.for);
			const part = parts.get(key) ?? { bucketId: line.bucketId, for: line.for, amount: 0 };
			part.amount += line.amount;
			parts.set(key, part);
			lastItem = part;
		} else if (line.kind === "discount" && lastItem) {
			lastItem.amount += line.amount;
		} else {
			shared += line.amount;
		}
	}
	// A fully discounted item leaves nothing to split.
	const bought = [...parts.values()].filter((part) => part.amount !== 0);
	const spent = bought.every((part) => part.amount > 0);
	const shares = spent
		? shareOut(
				shared,
				bought.map((part) => part.amount),
			)
		: [];
	const proposed = spent
		? bought.map((part, i) => ({ ...part, amount: part.amount + (shares[i] ?? 0) }))
		: bought;
	// Money off shared out can still leave a part at nothing or less.
	const positive = spent && proposed.every((part) => part.amount > 0);
	const sure = lines
		.filter(isItem)
		.every((line) => line.bucketId !== null && line.confidence >= AUTO_FILE_CONFIDENCE);
	return { kind: "parts", parts: proposed, confident: positive && sure };
}

const isItem = (line: ReceiptLine) => line.kind === "item";

/**
 * Parts can be applied to a Transaction (by a Parent, or on their own when confident): each has a
 * Bucket and is money spent.
 */
export function canApply(parts: ReceiptPart[]): boolean {
	return parts.length > 0 && parts.every((part) => part.bucketId !== null && part.amount > 0);
}

/** How far back a Receipt's own date may be from when it arrived: older is misread. */
export const RECEIPT_DATE_WINDOW_DAYS = 90;

/**
 * The day a Receipt is for: the date it says, if it's a real day no later than `received` and
 * not long before; otherwise the day it arrived.
 */
export function receiptDate(said: string | null | undefined, received: DayKey): DayKey {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(said?.trim() ?? "");
	if (!match) return received;
	const day = said?.trim() as DayKey;
	const date = new Date(`${day}T00:00:00Z`);
	if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== day) return received;
	if (day > received || day < addDays(received, -RECEIPT_DATE_WINDOW_DAYS)) return received;
	return day;
}

/**
 * The Transaction a Receipt is for, among those that count (a Quick Add, or an imported
 * Transaction no Quick Add stands in for): the same amount to the cent, dated within the Match
 * window of the Receipt's day, and the one clear candidate, or the one its merchant picks out.
 * Null when there's none, or it isn't clear.
 */
export function receiptTransaction(
	receipt: { date: DayKey; amount: Cents; merchant: string },
	candidates: MatchSide[],
): string | null {
	const side: MatchSide = {
		id: "receipt",
		date: receipt.date,
		amount: receipt.amount,
		text: receipt.merchant,
	};
	const [pair] = clearPairs([side], candidates, (left, candidate) =>
		candidate.amount === left.amount && withinMatchWindow(left.date, candidate.date)
			? merchantSimilarity(left.text, candidate.text)
			: null,
	);
	return pair ? pair[1].id : null;
}
