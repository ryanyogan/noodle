import {
	addDays,
	type Cents,
	type DayKey,
	daysBetween,
	type MonthKey,
	merchantSimilarity,
	monthEnded,
	monthOfDay,
	REFUND_WINDOW_DAYS,
} from "@noodle/domain";
import { and, eq, gte, isNotNull, lt, lte, or, type SQL, sql } from "drizzle-orm";
import { counts } from "./counting";
import { runningFrom } from "./ended-months";
import type { Db } from "./index";
import { loadMoneyInLine, type MoneyInLine } from "./money-in";
import { changeableBy, othersAllowance, type Viewer, visibleTo } from "./privacy";
import { income, refundLinks, splits, transactions } from "./schema";

// A Refund that lands in checking, linked to its purchase (issue 131, ADR-0057). The money is a
// row in `income` of kind Refund; the link says which purchase it is money back for. Like a
// Paid back match (owed-back.ts) it counts as spending in reverse on its `counts_on` day: the
// purchase's Bucket, Commitment or Goal (its largest Split's when it is split, as a Refund on a
// card takes) gets the money back in the month it landed, never in a month that has ended, and
// once only: a line has one link. Every query is scoped by household_id.

/** A purchase a Refund may be for. */
export type RefundPurchase = { id: string; date: DayKey; amount: Cents; note: string | null };

export type MoneyInRefund = {
	line: MoneyInLine;
	/**
	 * The purchase it is linked to (null when the viewer may not see it), the day it counts on,
	 * and whether that day's month has ended, when the link can no longer be taken off.
	 */
	link: { purchase: RefundPurchase | null; countsOn: DayKey; ended: boolean } | null;
	/** While it isn't linked: the purchases it is most likely money back for, likeliest first. */
	likely: RefundPurchase[];
	/** The other purchases it could be for, in the same order, behind "Show more". */
	more: RefundPurchase[];
};

/** How many purchases a Refund is offered at first, and at most behind "Show more". */
export const REFUND_PURCHASES_SHOWN = 5;
export const REFUND_PURCHASES_MORE = 45;

/**
 * The purchases a Refund might be for, likeliest first: those whose wording the Refund's names,
 * then the nearest in amount (a $42.10 Refund is for the $45 skates before the $1,850 Mortgage),
 * then the most recent.
 */
export function rankRefundPurchases(
	refund: { date: DayKey; amount: Cents; note: string | null },
	purchases: RefundPurchase[],
): RefundPurchase[] {
	return purchases
		.map((purchase) => ({
			purchase,
			similarity: merchantSimilarity(purchase.note, refund.note),
			over: purchase.amount - refund.amount,
			days: daysBetween(purchase.date, refund.date),
		}))
		.sort(
			(a, b) =>
				b.similarity - a.similarity ||
				a.over - b.over ||
				a.days - b.days ||
				a.purchase.id.localeCompare(b.purchase.id),
		)
		.map(({ purchase }) => purchase);
}

/** What the Refunds already linked to a purchase have given it back, together. */
const givenBack = sql`(select coalesce(sum(oi.amount_cents), 0) from refund_links ol
	join income oi on oi.id = ol.income_id where ol.transaction_id = ${transactions.id})`;

const assigned = () =>
	or(
		isNotNull(transactions.bucketId),
		isNotNull(transactions.commitmentId),
		isNotNull(transactions.goalId),
		sql`exists (select 1 from ${splits} where ${splits.transactionId} = ${transactions.id})`,
	) as SQL;

/** The link of the money-in line `incomeId`, with its purchase as the viewer may see it. */
async function loadLink(db: Db, viewer: Viewer, incomeId: string) {
	const [row] = await db
		.select({
			transactionId: refundLinks.transactionId,
			countsOn: refundLinks.countsOn,
			date: transactions.date,
			amount: transactions.amountCents,
			note: transactions.note,
			visible: sql<number>`${visibleTo(viewer)}`.as("visible"),
		})
		.from(refundLinks)
		.innerJoin(transactions, eq(transactions.id, refundLinks.transactionId))
		.where(
			and(eq(refundLinks.householdId, viewer.householdId), eq(refundLinks.incomeId, incomeId)),
		);
	return row ?? null;
}

/**
 * A Refund money-in line with the purchase it is linked to, or the purchases to pick from: ones
 * the viewer may change that count, are filed, were bought in the 90 days up to the day the money
 * landed, and cost at least as much as this Refund and the Refunds already linked to them
 * together. The five likeliest come first, the rest behind "Show more". Null when the line isn't
 * a Refund.
 */
export async function loadMoneyInRefund(
	db: Db,
	viewer: Viewer,
	incomeId: string,
	today: DayKey,
): Promise<MoneyInRefund | null> {
	const line = await loadMoneyInLine(db, viewer.householdId, incomeId);
	if (line?.kind !== "refund") return null;
	const link = await loadLink(db, viewer, incomeId);
	if (link) {
		const countsOn = link.countsOn as DayKey;
		return {
			line,
			link: {
				purchase: link.visible
					? {
							id: link.transactionId,
							date: link.date as DayKey,
							amount: link.amount as Cents,
							note: link.note,
						}
					: null,
				countsOn,
				ended: countsOn < runningFrom(today),
			},
			likely: [],
			more: [],
		};
	}
	const purchases = (await db
		.select({
			id: transactions.id,
			date: transactions.date,
			amount: transactions.amountCents,
			note: transactions.note,
		})
		.from(transactions)
		.where(
			and(
				changeableBy(viewer),
				counts(),
				sql`${transactions.amountCents} >= ${givenBack} + ${line.amount}`,
				gte(transactions.date, addDays(line.date, -REFUND_WINDOW_DAYS)),
				lte(transactions.date, line.date),
				assigned(),
			),
		)) as RefundPurchase[];
	const ranked = rankRefundPurchases(line, purchases);
	return {
		line,
		link: null,
		likely: ranked.slice(0, REFUND_PURCHASES_SHOWN),
		more: ranked.slice(REFUND_PURCHASES_SHOWN, REFUND_PURCHASES_SHOWN + REFUND_PURCHASES_MORE),
	};
}

export type RefundLinkResult =
	/** `months`: the months whose totals moved. */
	| { ok: true; months: MonthKey[] }
	/**
	 * `not-refund`: the line isn't a Refund (any more); `already-linked`: it is linked to another
	 * purchase; `month-ended`: the link counted in a month that has ended; `refused`: the purchase
	 * isn't one this Refund can be for.
	 */
	| { ok: false; reason: "not-refund" | "already-linked" | "month-ended" | "refused" };

/**
 * A Parent links a Refund that landed in checking to the purchase it is money back for. It counts
 * on the day the money landed, or from the first of the running month when that month has ended.
 * Refused unless the purchase is theirs to change, counts, is filed, came first within 90 days,
 * and is at least as much as every Refund linked to it together. Saying it again changes nothing.
 */
export async function linkMoneyInRefund(
	db: Db,
	viewer: Viewer,
	input: { incomeId: string; transactionId: string; today: DayKey },
): Promise<RefundLinkResult> {
	const { householdId } = viewer;
	const line = await loadMoneyInLine(db, householdId, input.incomeId);
	if (line?.kind !== "refund") return { ok: false, reason: "not-refund" };
	const countsOn = monthEnded(monthOfDay(line.date), input.today)
		? runningFrom(input.today)
		: line.date;
	const others = sql`(select coalesce(sum(oi.amount_cents), 0) from refund_links ol
		join income oi on oi.id = ol.income_id where ol.transaction_id = ${input.transactionId})`;
	// Guarded in the write: the line is still a Refund, and the purchase is never given back more
	// than it cost (the other Parent may be linking another Refund to it).
	await db
		.insert(refundLinks)
		.select(
			db
				.select({
					// Selected in the table's column order: insert … select is positional.
					incomeId: sql<string>`${income.id}`.as("income_id"),
					householdId: sql<string>`${householdId}`.as("household_id"),
					transactionId: sql<string>`${transactions.id}`.as("transaction_id"),
					countsOn: sql<string>`${countsOn}`.as("counts_on"),
					createdByMemberId: sql<string | null>`${viewer.memberId}`.as("created_by_member_id"),
					createdAt: sql<Date>`(unixepoch() * 1000)`.as("created_at"),
				})
				.from(income)
				.innerJoin(transactions, eq(transactions.id, input.transactionId))
				.where(
					and(
						eq(income.id, input.incomeId),
						eq(income.householdId, householdId),
						eq(income.kind, "refund"),
						changeableBy(viewer),
						counts(),
						assigned(),
						lte(transactions.date, income.date),
						gte(transactions.date, addDays(line.date, -REFUND_WINDOW_DAYS)),
						sql`${transactions.amountCents} >= ${others} + ${income.amountCents}`,
					),
				),
		)
		.onConflictDoNothing();
	const link = await loadLink(db, viewer, input.incomeId);
	if (!link) return { ok: false, reason: "refused" };
	if (link.transactionId !== input.transactionId) return { ok: false, reason: "already-linked" };
	return { ok: true, months: [monthOfDay(link.countsOn as DayKey)] };
}

/**
 * A Parent takes the link off: the purchase's Bucket or Commitment loses the money again. Refused
 * once the month it counted in has ended. With no link there is nothing to do.
 */
export async function unlinkMoneyInRefund(
	db: Db,
	viewer: Viewer,
	input: { incomeId: string; today: DayKey },
): Promise<RefundLinkResult> {
	const before = await loadLink(db, viewer, input.incomeId);
	if (!before) return { ok: true, months: [] };
	await db
		.delete(refundLinks)
		.where(
			and(
				eq(refundLinks.householdId, viewer.householdId),
				eq(refundLinks.incomeId, input.incomeId),
				gte(refundLinks.countsOn, runningFrom(input.today)),
			),
		);
	if (await loadLink(db, viewer, input.incomeId)) return { ok: false, reason: "month-ended" };
	return { ok: true, months: [monthOfDay(before.countsOn as DayKey)] };
}

/** Every link on purchases the viewer may see, for Download your data. */
export const loadRefundLinksForExport = (db: Db, viewer: Viewer) =>
	db
		.select({
			incomeId: refundLinks.incomeId,
			transactionId: refundLinks.transactionId,
			amountCents: income.amountCents,
			countsOn: refundLinks.countsOn,
		})
		.from(refundLinks)
		.innerJoin(income, eq(income.id, refundLinks.incomeId))
		.innerJoin(transactions, eq(transactions.id, refundLinks.transactionId))
		.where(and(eq(refundLinks.householdId, viewer.householdId), visibleTo(viewer)))
		.orderBy(refundLinks.countsOn, refundLinks.incomeId);

// What a linked Refund restores, for the reads that total spending. They are the rows of the
// Paid back reads in owed-back.ts, which add them to their own; counting.ts has the same in raw
// SQL (PAID_BACK_RESTORES_FROM).

/** The Split a linked Refund restores when its purchase is split: the largest. */
const largestSplit = sql`(select q.id from splits q where q.transaction_id = ${transactions.id}
	order by q.amount_cents desc, q.position limit 1)`;

const restored = (column: "bucket_id" | "commitment_id", whole: SQL) =>
	sql<string | null>`(case when ${largestSplit} is null then ${whole}
		else (select ${sql.raw(`q.${column}`)} from splits q where q.id = ${largestSplit}) end)`;

const linkRestores = (householdId: string) =>
	and(
		eq(refundLinks.householdId, householdId),
		eq(transactions.householdId, householdId),
		counts(),
	);

/** Linked Refunds into Buckets on days from `from` up to, not including, `until`. */
export async function refundSpendingRows(db: Db, viewer: Viewer, from: DayKey, until: DayKey) {
	const bucket = restored("bucket_id", sql`${transactions.bucketId}`);
	const rows = await db
		.select({
			id: refundLinks.transactionId,
			splitId: sql<string | null>`${largestSplit}`.as("restored_split_id"),
			bucketId: bucket.as("restored_bucket_id"),
			amount: income.amountCents,
			date: refundLinks.countsOn,
			hidden: sql<number>`${othersAllowance(viewer.memberId, bucket as unknown as string)}`.as(
				"hidden",
			),
		})
		.from(refundLinks)
		.innerJoin(income, eq(income.id, refundLinks.incomeId))
		.innerJoin(transactions, eq(transactions.id, refundLinks.transactionId))
		.where(
			and(
				linkRestores(viewer.householdId),
				gte(refundLinks.countsOn, from),
				lt(refundLinks.countsOn, until),
				sql`${bucket} is not null`,
			),
		)
		.orderBy(refundLinks.countsOn, refundLinks.incomeId);
	// Marked, so the month can say "refunded" and not "Paid back", which is Owed back's word.
	return rows.map((row) => ({ ...row, refund: true as const }));
}

/** Linked Refunds into Commitments on days from `from` to `to` (inclusive), as negative charges. */
export async function refundChargeRows(db: Db, viewer: Viewer, from: DayKey, to: DayKey) {
	const commitment = restored("commitment_id", sql`${transactions.commitmentId}`);
	const rows = await db
		.select({
			id: refundLinks.transactionId,
			commitmentId: commitment.as("restored_commitment_id"),
			amount: sql<number>`-${income.amountCents}`.as("amount"),
			date: refundLinks.countsOn,
		})
		.from(refundLinks)
		.innerJoin(income, eq(income.id, refundLinks.incomeId))
		.innerJoin(transactions, eq(transactions.id, refundLinks.transactionId))
		.where(
			and(
				linkRestores(viewer.householdId),
				gte(refundLinks.countsOn, from),
				lte(refundLinks.countsOn, to),
				sql`${commitment} is not null`,
			),
		)
		.orderBy(refundLinks.countsOn, refundLinks.incomeId);
	return rows.map((row) => ({ ...row, refund: true as const }));
}

/** Linked Refunds into each Bucket in each month from `since` up to, not including, `month`. */
export async function refundRowsByMonth(
	db: Db,
	householdId: string,
	since: MonthKey,
	month: MonthKey,
) {
	const bucket = restored("bucket_id", sql`${transactions.bucketId}`);
	const monthOf = sql<string>`substr(${refundLinks.countsOn}, 1, 7)`;
	return db
		.select({
			bucketId: bucket.as("restored_bucket_id"),
			month: monthOf.as("month"),
			amount: sql<number>`-sum(${income.amountCents})`.as("amount"),
		})
		.from(refundLinks)
		.innerJoin(income, eq(income.id, refundLinks.incomeId))
		.innerJoin(transactions, eq(transactions.id, refundLinks.transactionId))
		.where(
			and(
				linkRestores(householdId),
				gte(refundLinks.countsOn, `${since}-01`),
				lt(refundLinks.countsOn, `${month}-01`),
				sql`${bucket} is not null`,
			),
		)
		.groupBy(bucket, monthOf);
}
