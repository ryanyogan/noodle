import {
	addDays,
	type Cents,
	type DayKey,
	likelyOriginals,
	type MonthKey,
	REFUND_WINDOW_DAYS,
	type RefundSide,
	TRANSFER_WINDOW_DAYS,
	type TransferSide,
	transferPairs,
} from "@noodle/domain";
import {
	and,
	desc,
	eq,
	gte,
	inArray,
	isNotNull,
	isNull,
	lte,
	or,
	type SQL,
	sql,
} from "drizzle-orm";
import { counts, incomeCounts, inTransfer } from "./counting";
import type { Db } from "./index";
import { bucketInPlan } from "./moves";
import { changeableBy, type Viewer, visibleTo } from "./privacy";
import {
	accounts,
	buckets,
	income,
	members,
	refunds,
	splitFor,
	splits,
	transactionFor,
	transactions,
	transfers,
} from "./schema";

// Transfers and Refunds (see the `transfers` and `refunds` tables, and counting.ts for how they
// count). Transfers are marked automatically after an Import (detectTransfers) where the pairing
// is clear (transferPairs in @noodle/domain), or by a Parent from an imported Transaction's
// detail; a Parent unmarks them. Refunds are linked by a Parent from money back's detail. Every
// write re-checks in SQL what the read decided (ADR-0004), and the partial unique indexes keep
// each Transaction or income row in one Transfer, and money back in one Refund, at a time.

/** The other side of a Transfer, or a purchase money back may be a Refund for. */
export type MoneyPeer = {
	id: string;
	date: DayKey;
	/** Positive for money out or income; negative for money back onto a card. */
	amountCents: Cents;
	note: string | null;
	/** Its merchant's clean name, for an imported line once named (ADR-0027). */
	merchantName: string | null;
	/** The Account it was imported into; null for a Quick Add. */
	account: string | null;
};

/** A Transaction's Transfer, or whether a Parent may mark it as one. */
export type TransferView =
	| {
			kind: "transfer";
			transferId: string;
			automatic: boolean;
			/** The Account the money left, and the one it arrived in; null when not imported. */
			from: string | null;
			to: string | null;
			peer: MoneyPeer | null;
	  }
	| { kind: "none"; markable: boolean };

/** Money back's Refund link, or the purchases it might be a Refund for. */
export type RefundView =
	| { kind: "refund"; refundId: string; original: MoneyPeer }
	| { kind: "unlinked"; likely: MoneyPeer[] }
	| { kind: "none" };

export type MoneyResult = { ok: true; months: string[] } | { ok: false; reason: "refused" };

/** Money back (the enclosing query's Transaction) is linked to a purchase as its Refund. */
const inRefund = () =>
	sql`exists (select 1 from ${refunds} where ${refunds.refundTransactionId} = ${transactions.id} and ${refunds.removedAt} is null)`;

/**
 * An imported Transaction that could be a side of a Transfer: not already one, not a Refund, and
 * nothing a Parent has assigned or split.
 */
const transferable = and(
	eq(transactions.source, "import"),
	sql`not ${inTransfer()}`,
	sql`not ${inRefund()}`,
	isNull(transactions.bucketId),
	isNull(transactions.commitmentId),
	isNull(transactions.goalId),
	sql`not exists (select 1 from ${splits} where ${splits.transactionId} = ${transactions.id})`,
) as SQL;

/** Income that could be the arriving side of a Transfer: imported, and not already one. */
const transferableIncome = and(isNotNull(income.accountId), incomeCounts()) as SQL;

type Side = TransferSide & { income: boolean };

/** Transferable Transactions (money out, or money back as a positive amount) and income. */
async function loadSides(
	db: Db,
	householdId: string,
	from: DayKey,
	to: DayKey,
	which: { out: boolean; into: boolean },
): Promise<{ outs: Side[]; ins: Side[] }> {
	const inWindow = (date: typeof transactions.date | typeof income.date) =>
		and(gte(date, from), lte(date, to));
	const side = (amount: SQL<number>) => ({
		id: transactions.id,
		date: transactions.date,
		amount,
		accountId: transactions.accountId,
	});
	const [outs, backs, received] = await db.batch([
		db
			.select(side(sql<number>`${transactions.amountCents}`))
			.from(transactions)
			.where(
				and(
					eq(transactions.householdId, householdId),
					which.out ? undefined : sql`0`,
					transferable,
					sql`${transactions.amountCents} > 0`,
					inWindow(transactions.date),
				),
			),
		db
			.select(side(sql<number>`-${transactions.amountCents}`))
			.from(transactions)
			.where(
				and(
					eq(transactions.householdId, householdId),
					which.into ? undefined : sql`0`,
					transferable,
					sql`${transactions.amountCents} < 0`,
					inWindow(transactions.date),
				),
			),
		db
			.select({
				id: income.id,
				date: income.date,
				amount: income.amountCents,
				accountId: income.accountId,
			})
			.from(income)
			.where(
				and(
					eq(income.householdId, householdId),
					which.into ? undefined : sql`0`,
					transferableIncome,
					inWindow(income.date),
				),
			),
	]);
	// Imported rows always have an Account, and dates are always written as DayKeys.
	return {
		outs: outs.map((row) => ({ ...row, income: false }) as Side),
		ins: [
			...backs.map((row) => ({ ...row, income: false }) as Side),
			...received.map((row) => ({ ...row, income: true }) as Side),
		],
	};
}

/** Selected in the `transfers` table's column order: insert … select is positional. */
const transferRow = (row: {
	id: SQL | string;
	householdId: string;
	outId: SQL | string | null;
	inTransactionId: SQL | string | null;
	inIncomeId: SQL | string | null;
	createdBy: string | null;
}) => ({
	id: sql<string>`${row.id}`.as("id"),
	householdId: sql<string>`${row.householdId}`.as("household_id"),
	outTransactionId: sql<string | null>`${row.outId}`.as("out_transaction_id"),
	inTransactionId: sql<string | null>`${row.inTransactionId}`.as("in_transaction_id"),
	inIncomeId: sql<string | null>`${row.inIncomeId}`.as("in_income_id"),
	createdByMemberId: sql<string | null>`${row.createdBy}`.as("created_by_member_id"),
	createdAt: sql<Date>`(unixepoch() * 1000)`.as("created_at"),
	removedAt: sql<Date | null>`null`.as("removed_at"),
	removedByMemberId: sql<string | null>`null`.as("removed_by_member_id"),
});

/** Raw SQL: the Transaction `id` is still a transferable side of the Household's. */
const stillTransferable = (householdId: string, id: SQL | string, sign: ">" | "<") =>
	sql`exists (select 1 from transactions s where s.id = ${id} and s.household_id = ${householdId}
		and s.source = 'import' and s.amount_cents ${sql.raw(sign)} 0
		and s.bucket_id is null and s.commitment_id is null and s.goal_id is null
		and not exists (select 1 from splits p where p.transaction_id = s.id)
		and not exists (select 1 from refunds r where r.refund_transaction_id = s.id and r.removed_at is null))`;

/** Raw SQL: the Transfer's two sides (out, and in or income) move the same amount. */
const sameAmount = (householdId: string, outId: SQL, inTransactionId: SQL, inIncomeId: SQL) =>
	sql`exists (select 1 from transactions o where o.id = ${outId} and o.household_id = ${householdId}
		and o.amount_cents = coalesce(
			(select -n.amount_cents from transactions n where n.id = ${inTransactionId} and n.household_id = ${householdId}),
			(select i.amount_cents from income i where i.id = ${inIncomeId} and i.household_id = ${householdId})))`;

/**
 * Marks the clear Transfers among the Household's imported Transactions and income dated `from` to
 * `to` (and the few days either side). Runs after every Import, after Matching; idempotent. Returns
 * how many it marked and the months of their sides.
 */
export async function detectTransfers(
	db: Db,
	householdId: string,
	from: DayKey,
	to: DayKey,
	newId: () => string,
): Promise<{ marked: number; months: string[] }> {
	const [{ outs, ins }, refusedRows] = await Promise.all([
		loadSides(
			db,
			householdId,
			addDays(from, -TRANSFER_WINDOW_DAYS),
			addDays(to, TRANSFER_WINDOW_DAYS),
			{ out: true, into: true },
		),
		db
			.select({
				outId: transfers.outTransactionId,
				inId: sql<string | null>`coalesce(${transfers.inTransactionId}, ${transfers.inIncomeId})`,
			})
			.from(transfers)
			.where(and(eq(transfers.householdId, householdId), isNotNull(transfers.removedAt))),
	]);
	if (outs.length === 0 || ins.length === 0) return { marked: 0, months: [] };
	const refused = new Set(refusedRows.map((row) => `${row.outId}|${row.inId}`));
	const pairs = transferPairs(outs, ins, (o, i) => refused.has(`${o}|${i}`));
	if (pairs.length === 0) return { marked: 0, months: [] };
	const byId = new Map([...outs, ...ins].map((side) => [side.id, side]));
	const rows = pairs.map(({ outId, inId }) => ({
		id: newId(),
		outId,
		inTransactionId: byId.get(inId)?.income ? null : inId,
		inIncomeId: byId.get(inId)?.income ? inId : null,
	}));
	const field = (name: string) => sql.raw(`json_extract(value, '$.${name}')`);
	await db
		.insert(transfers)
		.select(
			db
				.select(
					transferRow({
						id: field("id"),
						householdId,
						outId: field("outId"),
						inTransactionId: field("inTransactionId"),
						inIncomeId: field("inIncomeId"),
						createdBy: null,
					}),
				)
				.from(sql`json_each(${JSON.stringify(rows)})`)
				.where(
					and(
						stillTransferable(householdId, field("outId"), ">"),
						sql`(${field("inTransactionId")} is null or ${stillTransferable(householdId, field("inTransactionId"), "<")})`,
						sameAmount(householdId, field("outId"), field("inTransactionId"), field("inIncomeId")),
					),
				),
		)
		.onConflictDoNothing();
	const months = pairs.flatMap(({ outId, inId }) =>
		[byId.get(outId), byId.get(inId)].map((side) => side?.date.slice(0, 7) ?? ""),
	);
	return { marked: pairs.length, months: [...new Set(months.filter(Boolean))] };
}

/** Transactions (or income) of the Household's, as MoneyPeers. */
async function loadPeers(
	db: Db,
	householdId: string,
	ids: string[],
	fromIncome = false,
): Promise<MoneyPeer[]> {
	if (ids.length === 0) return [];
	const rows = fromIncome
		? await db
				.select({
					id: income.id,
					date: income.date,
					amountCents: income.amountCents,
					note: income.note,
					merchantName: sql<string | null>`null`,
					account: accounts.name,
				})
				.from(income)
				.leftJoin(accounts, eq(accounts.id, income.accountId))
				.where(and(eq(income.householdId, householdId), inArray(income.id, ids)))
		: await db
				.select({
					id: transactions.id,
					date: transactions.date,
					amountCents: transactions.amountCents,
					note: transactions.note,
					merchantName: transactions.merchant,
					account: sql<
						string | null
					>`case when ${transactions.source} = 'import' then ${accounts.name} end`,
				})
				.from(transactions)
				.leftJoin(accounts, eq(accounts.id, transactions.accountId))
				.where(and(eq(transactions.householdId, householdId), inArray(transactions.id, ids)));
	// Dates are always written as DayKeys.
	return (rows as MoneyPeer[]).sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
}

/** A Transaction `viewer` may read, with what Transfer and Refund decisions need of it. */
async function loadSelf(db: Db, viewer: Viewer, transactionId: string) {
	const [self] = await db
		.select({
			id: transactions.id,
			date: transactions.date,
			amount: transactions.amountCents,
			note: transactions.note,
			source: transactions.source,
			accountId: transactions.accountId,
			account: accounts.name,
			changeable: sql<boolean>`${changeableBy(viewer)}`.mapWith(Boolean),
			transferable: sql<boolean>`${transferable}`.mapWith(Boolean),
		})
		.from(transactions)
		.leftJoin(accounts, eq(accounts.id, transactions.accountId))
		.where(and(eq(transactions.id, transactionId), visibleTo(viewer)));
	return self ? { ...self, date: self.date as DayKey } : null;
}

/**
 * A Transaction's Transfer as `viewer` sees it: the Accounts the money moved between and the other
 * side. Not in one, whether they may mark it: an imported Transaction nobody has assigned.
 */
export async function loadTransfer(
	db: Db,
	viewer: Viewer,
	transactionId: string,
): Promise<TransferView> {
	const self = await loadSelf(db, viewer, transactionId);
	if (!self) return { kind: "none", markable: false };
	const [transfer] = await db
		.select()
		.from(transfers)
		.where(
			and(
				eq(transfers.householdId, viewer.householdId),
				isNull(transfers.removedAt),
				or(eq(transfers.outTransactionId, self.id), eq(transfers.inTransactionId, self.id)),
			),
		);
	if (!transfer) return { kind: "none", markable: self.transferable && self.changeable };
	const isOut = transfer.outTransactionId === self.id;
	const peerId = isOut
		? (transfer.inTransactionId ?? transfer.inIncomeId)
		: transfer.outTransactionId;
	const [peer] = peerId
		? await loadPeers(db, viewer.householdId, [peerId], isOut && transfer.inIncomeId !== null)
		: [];
	return {
		kind: "transfer",
		transferId: transfer.id,
		automatic: transfer.createdByMemberId === null,
		from: isOut ? self.account : (peer?.account ?? null),
		to: isOut ? (peer?.account ?? null) : self.account,
		peer: peer ?? null,
	};
}

/**
 * A Parent marks an imported Transaction as a Transfer: money out as the side leaving an Account,
 * money back as the side arriving. It's paired with its other side when exactly one fits
 * (transferPairs); otherwise it's marked alone. Idempotent per `transferId`.
 */
export async function markTransfer(
	db: Db,
	viewer: Viewer,
	input: { transferId: string; transactionId: string },
): Promise<MoneyResult> {
	const self = await loadSelf(db, viewer, input.transactionId);
	if (!self?.transferable || !self.changeable || self.amount === 0) {
		return transferOutcome(db, viewer, input.transferId, false);
	}
	const isOut = self.amount > 0;
	const { outs, ins } = await loadSides(
		db,
		viewer.householdId,
		addDays(self.date, -TRANSFER_WINDOW_DAYS),
		addDays(self.date, TRANSFER_WINDOW_DAYS),
		{ out: !isOut, into: isOut },
	);
	const me: Side = {
		id: self.id,
		date: self.date,
		amount: Math.abs(self.amount),
		accountId: self.accountId ?? "",
		income: false,
	};
	const [pair] = isOut ? transferPairs([me], ins) : transferPairs(outs, [me]);
	const peer =
		pair && [...outs, ...ins].find((side) => side.id === (isOut ? pair.inId : pair.outId));
	const outId = isOut ? self.id : (peer?.id ?? null);
	const inTransactionId = isOut ? (peer && !peer.income ? peer.id : null) : self.id;
	const inIncomeId = isOut && peer?.income ? peer.id : null;
	const householdId = viewer.householdId;
	await db
		.insert(transfers)
		.select(
			db
				.select(
					transferRow({
						id: input.transferId,
						householdId,
						outId,
						inTransactionId,
						inIncomeId,
						createdBy: viewer.memberId,
					}),
				)
				.from(transactions)
				.where(
					and(
						eq(transactions.id, self.id),
						changeableBy(viewer),
						transferable,
						outId ? stillTransferable(householdId, outId, ">") : undefined,
						inTransactionId ? stillTransferable(householdId, inTransactionId, "<") : undefined,
						inIncomeId
							? sql`exists (select 1 from income i where i.id = ${inIncomeId} and i.household_id = ${householdId}
								and i.account_id is not null
								and not exists (select 1 from transfers x where x.in_income_id = i.id and x.removed_at is null))`
							: undefined,
					),
				),
		)
		.onConflictDoNothing();
	return transferOutcome(db, viewer, input.transferId, false);
}

/** A Parent unmarks a Transfer with a side they may change: both sides count again. */
export async function unmarkTransfer(
	db: Db,
	viewer: Viewer,
	transferId: string,
): Promise<MoneyResult> {
	await db
		.update(transfers)
		.set({ removedAt: sql`(unixepoch() * 1000)`, removedByMemberId: viewer.memberId })
		.where(
			and(
				eq(transfers.id, transferId),
				eq(transfers.householdId, viewer.householdId),
				isNull(transfers.removedAt),
				sql`exists (select 1 from ${transactions} where (${transactions.id} = ${transfers.outTransactionId}
					or ${transactions.id} = ${transfers.inTransactionId}) and ${changeableBy(viewer)})`,
			),
		);
	return transferOutcome(db, viewer, transferId, true);
}

/** The months a Transfer's sides are in, once it's written (or `removed`); refused if it isn't. */
async function transferOutcome(
	db: Db,
	viewer: Viewer,
	transferId: string,
	removed: boolean,
): Promise<MoneyResult> {
	const [row] = await db
		.select({
			dates: sql<string>`(select group_concat(d) from (
				select t.date as d from transactions t
					where t.id in (${transfers.outTransactionId}, ${transfers.inTransactionId})
				union select i.date from income i where i.id = ${transfers.inIncomeId}))`,
		})
		.from(transfers)
		.where(
			and(
				eq(transfers.id, transferId),
				eq(transfers.householdId, viewer.householdId),
				removed ? isNotNull(transfers.removedAt) : isNull(transfers.removedAt),
			),
		);
	if (!row) return { ok: false, reason: "refused" };
	const dates = (row.dates ?? "").split(",").filter(Boolean);
	return { ok: true, months: [...new Set(dates.map((date) => date.slice(0, 7)))] };
}

/** A Transaction's assignment as a whole, or its largest Split's, with that part's For. */
type RefundAssignment = {
	bucketId: string | null;
	commitmentId: string | null;
	goalId: string | null;
	/** The Split it comes from, when the purchase is split. */
	splitId: string | null;
	forMemberIds: string[];
};

/**
 * What a Refund of the purchase restores: the purchase's assignment and For, or when it's split,
 * its largest Split's (the earliest entered of equal ones); null while it's unassigned.
 */
async function refundAssignment(
	db: Db,
	householdId: string,
	originalId: string,
): Promise<RefundAssignment | null> {
	const [[whole], [largest]] = await db.batch([
		db
			.select({
				bucketId: transactions.bucketId,
				commitmentId: transactions.commitmentId,
				goalId: transactions.goalId,
			})
			.from(transactions)
			.where(and(eq(transactions.id, originalId), eq(transactions.householdId, householdId))),
		db
			.select({
				splitId: splits.id,
				bucketId: splits.bucketId,
				commitmentId: splits.commitmentId,
				goalId: splits.goalId,
			})
			.from(splits)
			.where(and(eq(splits.transactionId, originalId), eq(splits.householdId, householdId)))
			.orderBy(desc(splits.amountCents), splits.position)
			.limit(1),
	]);
	const part = largest ?? (whole ? { ...whole, splitId: null } : null);
	if (!part || (!part.bucketId && !part.commitmentId && !part.goalId)) return null;
	const forRows = part.splitId
		? await db
				.select({ memberId: splitFor.memberId })
				.from(splitFor)
				.where(and(eq(splitFor.splitId, part.splitId), eq(splitFor.householdId, householdId)))
		: await db
				.select({ memberId: transactionFor.memberId })
				.from(transactionFor)
				.where(
					and(
						eq(transactionFor.transactionId, originalId),
						eq(transactionFor.householdId, householdId),
					),
				);
	return { ...part, forMemberIds: forRows.map((row) => row.memberId) };
}

/**
 * Money back's Refund as `viewer` sees it: the purchase it's linked to, or those it might be for
 * (likelyOriginals): assigned purchases that count and that `viewer` may change, so never the other
 * Parent's Personal Allowance. Nothing for a Transfer's side or anything but money back.
 */
export async function loadRefund(
	db: Db,
	viewer: Viewer,
	transactionId: string,
): Promise<RefundView> {
	const self = await loadSelf(db, viewer, transactionId);
	if (!self || self.amount >= 0) return { kind: "none" };
	const [[refund], [transfer]] = await db.batch([
		db
			.select({ id: refunds.id, originalId: refunds.originalTransactionId })
			.from(refunds)
			.where(
				and(
					eq(refunds.householdId, viewer.householdId),
					eq(refunds.refundTransactionId, self.id),
					isNull(refunds.removedAt),
				),
			),
		db
			.select({ id: transfers.id })
			.from(transfers)
			.where(and(eq(transfers.inTransactionId, self.id), isNull(transfers.removedAt))),
	]);
	if (refund) {
		const [original] = await loadPeers(db, viewer.householdId, [refund.originalId]);
		return original ? { kind: "refund", refundId: refund.id, original } : { kind: "none" };
	}
	if (transfer || !self.changeable) return { kind: "none" };
	const purchases = await db
		.select({
			id: transactions.id,
			date: transactions.date,
			amount: transactions.amountCents,
			text: transactions.note,
		})
		.from(transactions)
		.where(
			and(
				changeableBy(viewer),
				counts(),
				gte(transactions.amountCents, -self.amount),
				gte(transactions.date, addDays(self.date, -REFUND_WINDOW_DAYS)),
				lte(transactions.date, self.date),
				or(
					isNotNull(transactions.bucketId),
					isNotNull(transactions.commitmentId),
					isNotNull(transactions.goalId),
					sql`exists (select 1 from ${splits} where ${splits.transactionId} = ${transactions.id})`,
				),
			),
		);
	const likely = likelyOriginals(
		{ id: self.id, date: self.date, amount: -self.amount, text: self.note },
		purchases as RefundSide[],
	);
	return {
		kind: "unlinked",
		likely: await loadPeers(
			db,
			viewer.householdId,
			likely.map((purchase) => purchase.id),
		),
	};
}

/**
 * A Parent links money back to the purchase it refunds: the money back takes the purchase's
 * assignment and For (its largest Split's, when it's split), so it restores that Bucket in the
 * month it lands. Refused unless the purchase counts, is theirs to change, is at least as much,
 * came first, and its Bucket is in the Plan for the refund's month. Idempotent per `refundId`.
 */
export async function linkRefund(
	db: Db,
	viewer: Viewer,
	input: { refundId: string; refundTransactionId: string; originalTransactionId: string },
): Promise<MoneyResult> {
	const { householdId } = viewer;
	const [self, assignment] = await Promise.all([
		loadSelf(db, viewer, input.refundTransactionId),
		refundAssignment(db, householdId, input.originalTransactionId),
	]);
	if (!self || !assignment) return refundOutcome(db, viewer, input.refundId, false);
	const month = self.date.slice(0, 7) as MonthKey;
	const theRefund = sql`exists (select 1 from ${refunds} where ${refunds.id} = ${input.refundId}
		and ${refunds.refundTransactionId} = ${self.id} and ${refunds.removedAt} is null)`;
	// The purchase still has the assignment read above.
	const sameAssignment = assignment.splitId
		? sql`exists (select 1 from splits p where p.id = ${assignment.splitId}
			and p.transaction_id = ${input.originalTransactionId}
			and p.bucket_id is ${assignment.bucketId} and p.commitment_id is ${assignment.commitmentId}
			and p.goal_id is ${assignment.goalId})`
		: and(
				sql`${transactions.bucketId} is ${assignment.bucketId}`,
				sql`${transactions.commitmentId} is ${assignment.commitmentId}`,
				sql`${transactions.goalId} is ${assignment.goalId}`,
			);
	await db.batch([
		db
			.insert(refunds)
			.select(
				db
					.select({
						// Selected in the table's column order: insert … select is positional.
						id: sql<string>`${input.refundId}`.as("id"),
						householdId: sql<string>`${householdId}`.as("household_id"),
						refundTransactionId: sql<string>`${self.id}`.as("refund_transaction_id"),
						originalTransactionId: sql<string>`${input.originalTransactionId}`.as(
							"original_transaction_id",
						),
						createdByMemberId: sql<string>`${viewer.memberId}`.as("created_by_member_id"),
						createdAt: sql<Date>`(unixepoch() * 1000)`.as("created_at"),
						removedAt: sql<Date | null>`null`.as("removed_at"),
						removedByMemberId: sql<string | null>`null`.as("removed_by_member_id"),
					})
					.from(transactions)
					.where(
						and(
							// The purchase:
							eq(transactions.id, input.originalTransactionId),
							changeableBy(viewer),
							counts(),
							sameAssignment,
							assignment.bucketId
								? sql`exists (select 1 from ${buckets} where ${bucketInPlan(householdId, assignment.bucketId, month)})`
								: undefined,
							// The money back: unassigned, in no Transfer, and no more than the purchase.
							sql`exists (select 1 from transactions r where r.id = ${self.id}
								and r.household_id = ${householdId} and r.amount_cents < 0
								and r.amount_cents + ${transactions.amountCents} >= 0
								and r.date >= ${transactions.date}
								and r.bucket_id is null and r.commitment_id is null and r.goal_id is null
								and not exists (select 1 from transfers x where (x.in_transaction_id = r.id
									or x.out_transaction_id = r.id) and x.removed_at is null))`,
						),
					),
			)
			.onConflictDoNothing(),
		db
			.update(transactions)
			.set({
				bucketId: assignment.bucketId,
				commitmentId: assignment.commitmentId,
				goalId: assignment.goalId,
			})
			.where(
				and(eq(transactions.id, self.id), eq(transactions.householdId, householdId), theRefund),
			),
		db
			.delete(transactionFor)
			.where(
				and(
					eq(transactionFor.transactionId, self.id),
					eq(transactionFor.householdId, householdId),
					theRefund,
				),
			),
		...(assignment.forMemberIds.length > 0
			? [
					db
						.insert(transactionFor)
						.select(
							db
								.select({
									transactionId: sql<string>`${self.id}`.as("transaction_id"),
									memberId: members.id,
									householdId: members.householdId,
								})
								.from(members)
								.where(
									and(
										inArray(members.id, assignment.forMemberIds),
										eq(members.householdId, householdId),
										theRefund,
									),
								),
						)
						.onConflictDoNothing(),
				]
			: []),
	]);
	return refundOutcome(db, viewer, input.refundId, false);
}

/** A Parent unlinks a Refund: the money back is unassigned again, and counts nowhere. */
export async function unlinkRefund(db: Db, viewer: Viewer, refundId: string): Promise<MoneyResult> {
	const { householdId } = viewer;
	const unlinked = sql`exists (select 1 from ${refunds} where ${refunds.id} = ${refundId}
		and ${refunds.refundTransactionId} = ${transactions.id} and ${refunds.removedAt} is not null)
		and not exists (select 1 from ${refunds} where ${refunds.refundTransactionId} = ${transactions.id}
		and ${refunds.removedAt} is null)`;
	await db.batch([
		db
			.update(refunds)
			.set({ removedAt: sql`(unixepoch() * 1000)`, removedByMemberId: viewer.memberId })
			.where(
				and(
					eq(refunds.id, refundId),
					eq(refunds.householdId, householdId),
					isNull(refunds.removedAt),
					sql`exists (select 1 from ${transactions} where ${transactions.id} = ${refunds.refundTransactionId} and ${changeableBy(viewer)})`,
				),
			),
		db
			.delete(transactionFor)
			.where(
				and(
					eq(transactionFor.householdId, householdId),
					sql`exists (select 1 from ${transactions} where ${transactions.id} = ${transactionFor.transactionId} and ${unlinked})`,
				),
			),
		db
			.update(transactions)
			.set({ bucketId: null, commitmentId: null, goalId: null })
			.where(and(eq(transactions.householdId, householdId), unlinked)),
	]);
	return refundOutcome(db, viewer, refundId, true);
}

/** The months a Refund's two sides are in, once it's written (or `removed`); refused if it isn't. */
async function refundOutcome(
	db: Db,
	viewer: Viewer,
	refundId: string,
	removed: boolean,
): Promise<MoneyResult> {
	const rows = await db
		.select({ date: transactions.date })
		.from(refunds)
		.innerJoin(
			transactions,
			or(
				eq(transactions.id, refunds.refundTransactionId),
				eq(transactions.id, refunds.originalTransactionId),
			),
		)
		.where(
			and(
				eq(refunds.id, refundId),
				eq(refunds.householdId, viewer.householdId),
				removed ? isNotNull(refunds.removedAt) : isNull(refunds.removedAt),
			),
		);
	if (rows.length === 0) return { ok: false, reason: "refused" };
	return { ok: true, months: [...new Set(rows.map((row) => row.date.slice(0, 7)))] };
}
