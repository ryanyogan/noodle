import {
	type Cents,
	type Charge,
	checkPaidBack,
	cleanOwedBackName,
	type DayKey,
	defaultOwedBack,
	type MonthKey,
	type MonthlySpend,
	monthEnded,
	monthOfDay,
	type OwedBack,
	offerPaidBack,
	owedBackPersonIn,
	type PaidBackCheck,
	type PaidBackMatch,
	type PaidBackOffer,
} from "@noodle/domain";
import { and, eq, gte, lt, lte, type SQL, sql } from "drizzle-orm";
import { counts, incomeInTransfer } from "./counting";
import type { Db } from "./index";
import { loadMoneyInLine, type MoneyInLine } from "./money-in";
import { changeableBy, othersAllowance, privateTotalId, type Viewer, visibleTo } from "./privacy";
import {
	income,
	members,
	owedBack,
	paidBackMatches,
	splitFor,
	splits,
	transactionFor,
	transactions,
} from "./schema";
import type { BucketSpend } from "./transactions";

// Paid back and Owed back (ADR-0058). Owed back is said on a purchase (or one of its Splits): who,
// a name and not a Member, and how much, half unless said. Paid back is a money-in line of that
// kind (money-in.ts); a Parent confirms which Owed back items it settles, and each match then
// counts as spending in reverse on its `counts_on` day, restoring the purchase's Bucket or
// Commitment in the month the money arrived and never in a month that has ended. Every query is
// scoped by household_id, and a purchase is only read as its Viewer may see it (privacy.ts).

/** An Owed back item with its purchase. */
export type OwedBackItem = OwedBack & {
	transactionId: string;
	/** The Split it was said on; null for the whole purchase. */
	splitId: string | null;
	/** The Child who owes it, when one was chosen; `who` is then their name. */
	memberId: string | null;
	/** The purchase's note. */
	purchase: string | null;
	/** What the purchase (or the Split) came to. */
	purchaseAmount: Cents;
	/** Where the money goes back to: the purchase's (or the Split's) Bucket or Commitment. */
	bucketId: string | null;
	commitmentId: string | null;
};

/** The Split an item restores when its purchase is split: the one it names, else the largest. */
const restoredSplit = sql`(select q.id from splits q where q.transaction_id = ${transactions.id}
	order by coalesce(q.id = ${owedBack.splitId}, 0) desc, q.amount_cents desc, q.position limit 1)`;

const restored = (column: "bucket_id" | "commitment_id" | "goal_id", whole: SQL) =>
	sql<string | null>`(case when ${restoredSplit} is null then ${whole}
		else (select ${sql.raw(`q.${column}`)} from splits q where q.id = ${restoredSplit}) end)`;

const restoredBucket = () => restored("bucket_id", sql`${transactions.bucketId}`);
const restoredCommitment = () => restored("commitment_id", sql`${transactions.commitmentId}`);

/** What has been Paid back on the item of the enclosing query. */
const paidSql = sql<number>`(select coalesce(sum(pm.amount_cents), 0) from paid_back_matches pm
	where pm.owed_back_id = ${owedBack.id})`;

export type OwedBackFilter = {
	/** Only what's still owed. */
	open?: boolean;
	transactionId?: string;
	id?: string;
};

/**
 * The Household's Owed back items as `viewer` may see their purchases, oldest purchase first.
 * The "Owed back" list is these with `open`, grouped with owedBackByPerson (@noodle/domain).
 */
export async function loadOwedBack(
	db: Db,
	viewer: Viewer,
	filter: OwedBackFilter = {},
): Promise<OwedBackItem[]> {
	const bucket = restoredBucket();
	const rows = await db
		.select({
			id: owedBack.id,
			transactionId: owedBack.transactionId,
			splitId: owedBack.splitId,
			date: transactions.date,
			who: owedBack.who,
			memberId: owedBack.memberId,
			owed: owedBack.amountCents,
			paid: paidSql.as("paid"),
			purchase: transactions.note,
			purchaseAmount: sql<number>`coalesce((select q.amount_cents from splits q
				where q.id = ${owedBack.splitId} and q.transaction_id = ${transactions.id}),
				${transactions.amountCents})`.as("purchase_amount"),
			bucketId: bucket.as("restored_bucket_id"),
			commitmentId: restoredCommitment().as("restored_commitment_id"),
		})
		.from(owedBack)
		.innerJoin(transactions, eq(transactions.id, owedBack.transactionId))
		.where(
			and(
				eq(owedBack.householdId, viewer.householdId),
				visibleTo(viewer),
				sql`not ${othersAllowance(viewer.memberId, bucket as unknown as string)}`,
				filter.id ? eq(owedBack.id, filter.id) : undefined,
				filter.transactionId ? eq(owedBack.transactionId, filter.transactionId) : undefined,
				filter.open ? sql`${owedBack.amountCents} > ${paidSql}` : undefined,
			),
		)
		.orderBy(transactions.date, owedBack.id);
	// Dates are always written as DayKeys.
	return rows as OwedBackItem[];
}

export type OwedBackResult =
	| { ok: true; item: OwedBackItem }
	/**
	 * `refused`: not a purchase this Parent may change, or not a Child of the Household;
	 * `no-name`: nobody was named; `too-much`: nothing, or more than the purchase;
	 * `paid-back`: less than has already been Paid back on it.
	 */
	| { ok: false; reason: "refused" | "no-name" | "too-much" | "paid-back" };

/**
 * A Parent says someone's paying part of a purchase (or of one Split) back: who, a name or a
 * Child, and how much, half unless said. One per purchase or Split: saying it again changes who
 * and how much, under the ID it already has.
 */
export async function sayOwedBack(
	db: Db,
	viewer: Viewer,
	input: {
		owedBackId: string;
		transactionId: string;
		splitId?: string | null;
		who: string;
		/** A Child who owes it, instead of a name. */
		memberId?: string | null;
		amountCents?: Cents;
	},
): Promise<OwedBackResult> {
	const { householdId } = viewer;
	const splitId = input.splitId ?? null;
	let who = cleanOwedBackName(input.who);
	if (input.memberId) {
		const [child] = await db
			.select({ name: members.name })
			.from(members)
			.where(
				and(
					eq(members.id, input.memberId),
					eq(members.householdId, householdId),
					eq(members.kind, "child"),
				),
			);
		if (!child) return { ok: false, reason: "refused" };
		who = cleanOwedBackName(child.name);
	}
	if (!who) return { ok: false, reason: "no-name" };

	const thePurchase = and(
		eq(transactions.id, input.transactionId),
		changeableBy(viewer),
		sql`${transactions.amountCents} > 0`,
	) as SQL;
	const [purchase] = await db
		.select({
			amount: splitId
				? sql<number | null>`(select q.amount_cents from splits q where q.id = ${splitId}
						and q.transaction_id = ${transactions.id} and q.household_id = ${householdId})`
				: transactions.amountCents,
		})
		.from(transactions)
		.where(thePurchase);
	if (!purchase || purchase.amount === null) return { ok: false, reason: "refused" };
	const amount = input.amountCents ?? defaultOwedBack(purchase.amount as Cents);
	if (!Number.isInteger(amount) || amount <= 0 || amount > purchase.amount)
		return { ok: false, reason: "too-much" };

	const same = and(
		eq(owedBack.householdId, householdId),
		eq(owedBack.transactionId, input.transactionId),
		sql`coalesce(${owedBack.splitId}, '') = ${splitId ?? ""}`,
	);
	const [existing] = await db
		.select({ id: owedBack.id, paid: paidSql.as("paid") })
		.from(owedBack)
		.where(same);
	if (existing && amount < existing.paid) return { ok: false, reason: "paid-back" };
	const memberId = input.memberId ?? null;
	if (existing) {
		await db
			.update(owedBack)
			.set({ who, memberId, amountCents: amount })
			.where(and(same, sql`${amount} >= ${paidSql}`));
	} else {
		// Written only if the purchase is still one this Parent may change.
		await db.run(sql`insert into owed_back
			(id, household_id, transaction_id, split_id, who, member_id, amount_cents, created_by_member_id)
			select ${input.owedBackId}, ${householdId}, ${transactions.id}, ${splitId}, ${who}, ${memberId},
				${amount}, ${viewer.memberId}
			from ${transactions} where ${thePurchase}
			on conflict do nothing`);
	}
	const item = (await loadOwedBack(db, viewer, { transactionId: input.transactionId })).find(
		(row) => row.splitId === splitId,
	);
	return item ? { ok: true, item } : { ok: false, reason: "refused" };
}

/** The first day of the month `today` is in: a match counting before it is in an ended month. */
const runningFrom = (today: DayKey) => `${monthOfDay(today)}-01` as DayKey;

export type OwedBackRemoveResult =
	| { ok: true }
	/** `month-ended`: money Paid back on it already counted in a month that has ended. */
	| { ok: false; reason: "refused" | "month-ended" };

/**
 * A Parent takes the Owed back off a purchase. What was Paid back on it this month waits again as
 * "Paid back, not matched yet"; refused once some of it counted in a month that has ended.
 */
export async function removeOwedBack(
	db: Db,
	viewer: Viewer,
	input: { owedBackId: string; today: DayKey },
): Promise<OwedBackRemoveResult> {
	const [item] = await loadOwedBack(db, viewer, { id: input.owedBackId });
	if (!item) return { ok: false, reason: "refused" };
	const ofTheItem = and(
		eq(paidBackMatches.householdId, viewer.householdId),
		eq(paidBackMatches.owedBackId, input.owedBackId),
	);
	const ended = sql`exists (select 1 from paid_back_matches e where e.owed_back_id = ${input.owedBackId}
		and e.counts_on < ${runningFrom(input.today)})`;
	const [frozen] = await db
		.select({ id: paidBackMatches.id })
		.from(paidBackMatches)
		.where(and(ofTheItem, lt(paidBackMatches.countsOn, runningFrom(input.today))))
		.limit(1);
	if (frozen) return { ok: false, reason: "month-ended" };
	await db.batch([
		db.delete(paidBackMatches).where(and(ofTheItem, sql`not ${ended}`)),
		db
			.delete(owedBack)
			.where(
				and(
					eq(owedBack.id, input.owedBackId),
					eq(owedBack.householdId, viewer.householdId),
					sql`not exists (select 1 from paid_back_matches e where e.owed_back_id = ${owedBack.id})`,
				),
			),
	]);
	return { ok: true };
}

/** A confirmed match, as kept. */
export type StoredPaidBackMatch = PaidBackMatch & {
	id: string;
	/** The day it counts on: the month it restores its purchase's Bucket or Commitment in. */
	countsOn: DayKey;
};

/** A Paid back line with what it has settled; `unmatched` is "Paid back, not matched yet". */
export type PaidBackLine = { line: MoneyInLine; matches: StoredPaidBackMatch[]; unmatched: Cents };

/** A Paid back money-in line and its matches; null when the line isn't Paid back. */
export async function loadPaidBack(
	db: Db,
	householdId: string,
	incomeId: string,
): Promise<PaidBackLine | null> {
	const line = await loadMoneyInLine(db, householdId, incomeId);
	if (!line || line.kind !== "paid-back" || line.needsReview) return null;
	const matches = (await db
		.select({
			id: paidBackMatches.id,
			owedBackId: paidBackMatches.owedBackId,
			amount: paidBackMatches.amountCents,
			countsOn: paidBackMatches.countsOn,
		})
		.from(paidBackMatches)
		.where(
			and(eq(paidBackMatches.householdId, householdId), eq(paidBackMatches.incomeId, incomeId)),
		)
		.orderBy(paidBackMatches.countsOn, paidBackMatches.id)) as StoredPaidBackMatch[];
	const matched = matches.reduce((sum, match) => sum + match.amount, 0);
	return { line, matches, unmatched: Math.max(0, line.amount - matched) as Cents };
}

/** What a Paid back line is offered against. */
export type PaidBackOffered = PaidBackLine & {
	/** Whoever of the people who owe the line's wording names; the offer is then only theirs. */
	who: string | null;
	/** Everything still owed, by anyone, for a Parent to adjust the offer with. */
	open: OwedBackItem[];
	/** For what of the line isn't matched yet: oldest first that fit (offerPaidBack). */
	offer: PaidBackOffer;
};

/**
 * A Paid back line offered against what's still Owed back; null when the line isn't Paid back.
 * Nothing is applied: a Parent adjusts it and confirms with confirmPaidBack.
 */
export async function offerPaidBackFor(
	db: Db,
	viewer: Viewer,
	incomeId: string,
): Promise<PaidBackOffered | null> {
	const paid = await loadPaidBack(db, viewer.householdId, incomeId);
	if (!paid) return null;
	const open = await loadOwedBack(db, viewer, { open: true });
	const who = owedBackPersonIn(paid.line.note, [...new Set(open.map((item) => item.who))]);
	const theirs = who ? open.filter((item) => item.who.toLowerCase() === who.toLowerCase()) : open;
	return { ...paid, who, open, offer: offerPaidBack(paid.unmatched, theirs) };
}

export type PaidBackConfirmResult =
	/** `months`: the months whose totals moved. */
	| { ok: true; unmatched: Cents; months: MonthKey[] }
	| { ok: false; reason: "not-paid-back" | "changed-elsewhere" }
	| Extract<PaidBackCheck, { ok: false }>;

/**
 * A Parent confirms what a Paid back line settles. `matches` are the whole of what it settles in
 * months still running: they replace its earlier ones, while a match that counted in a month
 * that has ended stands as it is. Each counts on the day the money arrived, or from the first of
 * the running month when it arrived in a month that has ended. One payment may settle several
 * items, an item may stay partly owed, and what's left of the payment waits unmatched.
 */
export async function confirmPaidBack(
	db: Db,
	viewer: Viewer,
	input: {
		incomeId: string;
		matches: (PaidBackMatch & { id: string })[];
		today: DayKey;
	},
): Promise<PaidBackConfirmResult> {
	const { householdId } = viewer;
	const paid = await loadPaidBack(db, householdId, input.incomeId);
	if (!paid) return { ok: false, reason: "not-paid-back" };
	const from = runningFrom(input.today);
	const frozen = paid.matches.filter((match) => match.countsOn < from);
	const live = paid.matches.filter((match) => match.countsOn >= from);
	const available = (paid.line.amount -
		frozen.reduce((sum, match) => sum + match.amount, 0)) as Cents;
	// The items as they'd be without this line's own replaceable matches.
	const items = (await loadOwedBack(db, viewer)).map((item) => ({
		...item,
		paid: (item.paid -
			live
				.filter((match) => match.owedBackId === item.id)
				.reduce((sum, match) => sum + match.amount, 0)) as Cents,
	}));
	const check = checkPaidBack(available, items, input.matches);
	if (!check.ok) return check;

	const countsOn = monthEnded(monthOfDay(paid.line.date), input.today) ? from : paid.line.date;
	const field = (name: string) => sql`json_extract(j.value, ${`$.${name}`})`;
	// Guarded in the write: the line is still Paid back, and no item ends up Paid back more than
	// it owes (the other Parent may be matching another payment to it).
	await db.batch([
		db
			.delete(paidBackMatches)
			.where(
				and(
					eq(paidBackMatches.householdId, householdId),
					eq(paidBackMatches.incomeId, input.incomeId),
					gte(paidBackMatches.countsOn, from),
				),
			),
		db.run(sql`insert into paid_back_matches
			(id, household_id, income_id, owed_back_id, amount_cents, counts_on, created_by_member_id)
			select ${field("id")}, ${householdId}, ${input.incomeId}, o.id, ${field("amount")}, ${countsOn},
				${viewer.memberId}
			from json_each(${JSON.stringify(input.matches)}) j
			join owed_back o on o.id = ${field("owedBackId")} and o.household_id = ${householdId}
			where exists (select 1 from income i where i.id = ${input.incomeId}
				and i.household_id = ${householdId} and i.kind = 'paid-back')
			and (select coalesce(sum(x.amount_cents), 0) from paid_back_matches x
				where x.owed_back_id = o.id) + ${field("amount")} <= o.amount_cents
			on conflict do nothing`),
	]);
	const after = await loadPaidBack(db, householdId, input.incomeId);
	if (!after) return { ok: false, reason: "not-paid-back" };
	if (after.unmatched !== check.unmatched) return { ok: false, reason: "changed-elsewhere" };
	const moved = live.length > 0 || input.matches.length > 0;
	return { ok: true, unmatched: after.unmatched, months: moved ? [monthOfDay(countsOn)] : [] };
}

/** A Paid back line with money no Owed back item has taken: "Paid back, not matched yet". */
export type UnmatchedPaidBack = {
	id: string;
	amount: Cents;
	date: DayKey;
	note: string | null;
	unmatched: Cents;
};

/** The Household's Paid back lines with something not matched yet, newest first. Never Income. */
export async function loadUnmatchedPaidBack(
	db: Db,
	householdId: string,
): Promise<UnmatchedPaidBack[]> {
	const matched = sql<number>`(select coalesce(sum(pm.amount_cents), 0) from paid_back_matches pm
		where pm.income_id = ${income.id})`;
	const rows = await db
		.select({
			id: income.id,
			amount: income.amountCents,
			date: income.date,
			note: income.note,
			unmatched: sql<number>`${income.amountCents} - ${matched}`.as("unmatched"),
		})
		.from(income)
		.where(
			and(
				eq(income.householdId, householdId),
				eq(income.kind, "paid-back"),
				sql`not ${incomeInTransfer()}`,
				sql`${income.amountCents} > ${matched}`,
			),
		)
		.orderBy(sql`${income.date} desc`, sql`${income.id} desc`);
	return rows as UnmatchedPaidBack[];
}

// What Paid back restores, for the reads that total spending (counting.ts).

const matchRestores = (householdId: string) =>
	and(
		eq(paidBackMatches.householdId, householdId),
		eq(transactions.householdId, householdId),
		counts(),
	);

/**
 * What was Paid back into Buckets on days from `from` up to, not including, `until`, as spending
 * in reverse: one per match, with its purchase's ID and For. Into another Parent's Personal
 * Allowance it is only a total for the Bucket's month, as their spending is (ADR-0003).
 */
export async function loadPaidBackSpending(
	db: Db,
	viewer: Viewer,
	from: DayKey,
	until: DayKey,
): Promise<BucketSpend[]> {
	const bucket = restoredBucket();
	const rows = await db
		.select({
			id: owedBack.transactionId,
			splitId: sql<string | null>`${restoredSplit}`.as("restored_split_id"),
			bucketId: bucket.as("restored_bucket_id"),
			amount: paidBackMatches.amountCents,
			date: paidBackMatches.countsOn,
			hidden: sql<number>`${othersAllowance(viewer.memberId, bucket as unknown as string)}`.as(
				"hidden",
			),
		})
		.from(paidBackMatches)
		.innerJoin(owedBack, eq(owedBack.id, paidBackMatches.owedBackId))
		.innerJoin(transactions, eq(transactions.id, owedBack.transactionId))
		.where(
			and(
				matchRestores(viewer.householdId),
				gte(paidBackMatches.countsOn, from),
				lt(paidBackMatches.countsOn, until),
				sql`${bucket} is not null`,
			),
		)
		.orderBy(paidBackMatches.countsOn, paidBackMatches.id);
	if (rows.length === 0) return [];
	const seen = rows.filter((row) => !row.hidden);
	// One JSON parameter each: D1 allows 100 bound parameters a statement.
	const ids = (list: (string | null)[]) => JSON.stringify([...new Set(list.filter(Boolean))]);
	const [wholeFor, partFor] = await Promise.all([
		db
			.select({ id: transactionFor.transactionId, memberId: transactionFor.memberId })
			.from(transactionFor)
			.where(
				and(
					eq(transactionFor.householdId, viewer.householdId),
					sql`${transactionFor.transactionId} in (select value from json_each(${ids(
						seen.filter((row) => !row.splitId).map((row) => row.id),
					)}))`,
				),
			),
		db
			.select({ id: splitFor.splitId, memberId: splitFor.memberId })
			.from(splitFor)
			.where(
				and(
					eq(splitFor.householdId, viewer.householdId),
					sql`${splitFor.splitId} in (select value from json_each(${ids(
						seen.map((row) => row.splitId),
					)}))`,
				),
			),
	]);
	const forOf = (id: string, among: { id: string; memberId: string }[]) =>
		among
			.filter((row) => row.id === id)
			.map((row) => row.memberId)
			.sort();
	return rows.map((row) => {
		const bucketId = row.bucketId as string;
		const date = row.date as DayKey;
		const amount = -row.amount as Cents;
		if (row.hidden) {
			const month = monthOfDay(date);
			return {
				id: privateTotalId(bucketId, month),
				bucketId,
				amount,
				date: `${month}-01` as DayKey,
				for: [],
			};
		}
		return {
			id: row.id,
			bucketId,
			amount,
			date,
			for: row.splitId ? forOf(row.splitId, partFor) : forOf(row.id, wholeFor),
		};
	});
}

/**
 * What was Paid back into Commitments on days from `from` to `to` (inclusive), as charges in
 * reverse: one per match, with its purchase's ID.
 */
export async function loadPaidBackCharges(
	db: Db,
	viewer: Viewer,
	from: DayKey,
	to: DayKey,
): Promise<(Charge & { id: string })[]> {
	const commitment = restoredCommitment();
	const rows = await db
		.select({
			id: owedBack.transactionId,
			commitmentId: commitment.as("restored_commitment_id"),
			amount: sql<number>`-${paidBackMatches.amountCents}`.as("amount"),
			date: paidBackMatches.countsOn,
		})
		.from(paidBackMatches)
		.innerJoin(owedBack, eq(owedBack.id, paidBackMatches.owedBackId))
		.innerJoin(transactions, eq(transactions.id, owedBack.transactionId))
		.where(
			and(
				matchRestores(viewer.householdId),
				gte(paidBackMatches.countsOn, from),
				lte(paidBackMatches.countsOn, to),
				sql`${commitment} is not null`,
			),
		)
		.orderBy(paidBackMatches.countsOn, paidBackMatches.id);
	// Marked, so nothing reads one as a payment: not "paid this month", the payment history, or
	// an "about" average.
	return rows.map((row) => ({ ...row, paidBack: true })) as (Charge & { id: string })[];
}

/**
 * What was Paid back into each Bucket in each month from `since` up to, not including, `month`,
 * as spending in reverse, for what a Bucket carries over.
 */
export async function loadPaidBackByMonth(
	db: Db,
	householdId: string,
	since: MonthKey,
	month: MonthKey,
): Promise<MonthlySpend[]> {
	const bucket = restoredBucket();
	const monthOf = sql<string>`substr(${paidBackMatches.countsOn}, 1, 7)`;
	const rows = await db
		.select({
			bucketId: bucket.as("restored_bucket_id"),
			month: monthOf.as("month"),
			amount: sql<number>`-sum(${paidBackMatches.amountCents})`.as("amount"),
		})
		.from(paidBackMatches)
		.innerJoin(owedBack, eq(owedBack.id, paidBackMatches.owedBackId))
		.innerJoin(transactions, eq(transactions.id, owedBack.transactionId))
		.where(
			and(
				matchRestores(householdId),
				gte(paidBackMatches.countsOn, `${since}-01`),
				lt(paidBackMatches.countsOn, `${month}-01`),
				sql`${bucket} is not null`,
			),
		)
		.groupBy(bucket, monthOf);
	return rows as MonthlySpend[];
}
