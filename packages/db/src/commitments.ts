import {
	addDays,
	addMonths,
	type Cadence,
	type Cents,
	type Charge,
	type DayKey,
	type MonthKey,
	type PlanScope,
	restoreAfterJust,
} from "@noodle/domain";
import { and, eq, gt, gte, inArray, isNotNull, isNull, lte, or, type SQL, sql } from "drizzle-orm";
import { counts } from "./counting";
import type { Db } from "./index";
import { loadPaidBackCharges } from "./owed-back";
import { type Author, inForce, logChange } from "./plan-log";
import { type Viewer, visibleTo } from "./privacy";
import { accounts, commitments, commitmentTerms, households, splits, transactions } from "./schema";

// A Household's Commitments and the payments recorded against them. Every query is scoped by
// household_id; Commitment IDs from the client are only ever used together with it. Writes are
// idempotent (ADR-0004), so a retried save lands once.

type Terms = { amountCents: Cents; cadence: Cadence; dueDate: DayKey };

/** Guards a write to only land if the Commitment belongs to the Household. */
export const ownCommitment = (householdId: string, commitmentId: string) =>
	and(eq(commitments.id, commitmentId), eq(commitments.householdId, householdId));

/** Guards a write to only land if the Commitment is in the Plan for `month`. */
export const inPlanFor = (month: string) =>
	and(
		lte(commitments.fromMonth, month),
		or(isNull(commitments.endedFromMonth), gt(commitments.endedFromMonth, month)),
	);

/** insert into commitment_terms select … from commitments where <it's the Household's> */
const termsFor = (
	db: Db,
	input: { householdId: string; commitmentId: string; month: MonthKey } & Terms,
) =>
	db.insert(commitmentTerms).select(
		db
			.select({
				householdId: commitments.householdId,
				commitmentId: commitments.id,
				month: sql<string>`${input.month}`.as("month"),
				amountCents: sql<number>`${input.amountCents}`.as("amount_cents"),
				cadence: sql<Cadence>`${input.cadence}`.as("cadence"),
				dueDate: sql<string>`${input.dueDate}`.as("due_date"),
			})
			.from(commitments)
			.where(ownCommitment(input.householdId, input.commitmentId)),
	);

/**
 * The Plan change for setting a Commitment's terms from `month`, written before them: only if
 * it's the Household's (and matches `where`) and they differ from the terms in force at `month`.
 */
export const termsLog = (
	db: Db,
	input: Author & {
		householdId: string;
		commitmentId: string;
		month: MonthKey;
		scope?: PlanScope;
		until?: MonthKey | null;
	} & Terms,
	where?: SQL,
) => {
	const termsInForce = (column: SQL) =>
		inForce(
			commitmentTerms,
			column,
			commitmentTerms.month,
			eq(commitmentTerms.commitmentId, commitments.id),
			input.month,
		);
	const same = termsInForce(
		sql`${commitmentTerms.amountCents} = ${input.amountCents} and ${commitmentTerms.cadence} = ${input.cadence} and ${commitmentTerms.dueDate} = ${input.dueDate}`,
	);
	return logChange(
		db,
		commitments,
		and(ownCommitment(input.householdId, input.commitmentId), where, sql`${same} is not 1`),
		{
			...input,
			kind: "commitment-terms",
			targetId: input.commitmentId,
			before: termsInForce(
				sql`json_object('amount', ${commitmentTerms.amountCents}, 'cadence', ${commitmentTerms.cadence}, 'dueDate', ${commitmentTerms.dueDate})`,
			),
			after: {
				amount: input.amountCents,
				cadence: input.cadence,
				dueDate: input.dueDate,
				...(input.until ? { until: input.until } : {}),
			},
		},
	);
};

/**
 * Adds a Commitment to the Plan from `month` onward on its first terms. Idempotent per
 * `commitmentId`: a retry leaves the first attempt's Commitment as it was.
 */
export async function addCommitment(
	db: Db,
	input: Author & {
		householdId: string;
		commitmentId: string;
		name: string;
		month: MonthKey;
		about?: boolean | undefined;
	} & Terms,
): Promise<void> {
	await db.batch(commitmentAdd(db, input));
}

/**
 * addCommitment as statements, for writing them in a batch with others; `endedFromMonth` also
 * sets when it ends (a loan's last month + 1), null for good.
 */
export const commitmentAdd = (
	db: Db,
	input: Author & {
		householdId: string;
		commitmentId: string;
		name: string;
		month: MonthKey;
		endedFromMonth?: MonthKey | null;
		/** Its amount is "about" (it varies); the same each time when left out. */
		about?: boolean | undefined;
	} & Terms,
) =>
	[
		logChange(
			db,
			households,
			and(
				eq(households.id, input.householdId),
				sql`not exists (select 1 from ${commitments} where ${commitments.id} = ${input.commitmentId})`,
			),
			{
				...input,
				kind: "commitment-add",
				targetId: input.commitmentId,
				before: null,
				after: {
					name: input.name,
					amount: input.amountCents,
					cadence: input.cadence,
					dueDate: input.dueDate,
					...(input.endedFromMonth ? { until: input.endedFromMonth } : {}),
					...(input.about ? { about: true } : {}),
				},
			},
		),
		db
			.insert(commitments)
			.values({
				id: input.commitmentId,
				householdId: input.householdId,
				name: input.name,
				fromMonth: input.month,
				endedFromMonth: input.endedFromMonth ?? null,
				about: input.about ?? false,
			})
			.onConflictDoNothing({ target: commitments.id }),
		termsFor(db, input).onConflictDoNothing({
			target: [commitmentTerms.commitmentId, commitmentTerms.month],
		}),
	] as const;

/**
 * Renames a Commitment (in every month) and sets its terms from `month` onward, or for `scope`
 * "just" that month only: the next month goes back to the terms in force before, unless it has
 * its own. Setting them again for the same month replaces them. `about` says whether its amount is
 * "about" or the same each time, in every month like its name; left out, that stays as it is.
 */
export async function updateCommitment(
	db: Db,
	input: Author & {
		householdId: string;
		commitmentId: string;
		name: string;
		month: MonthKey;
		scope?: PlanScope;
		about?: boolean | undefined;
	} & Terms,
): Promise<void> {
	const own = ownCommitment(input.householdId, input.commitmentId);
	const renameLog = logChange(
		db,
		commitments,
		and(own, sql`${commitments.name} is not ${input.name}`),
		{
			...input,
			kind: "commitment-rename",
			targetId: input.commitmentId,
			before: sql`json_object('name', ${commitments.name})`,
			after: { name: input.name },
		},
	);
	// Switched to or from "about": said in the Plan's history, only when it really changes.
	const aboutLog =
		input.about === undefined
			? []
			: [
					logChange(
						db,
						commitments,
						and(own, sql`${commitments.about} is not ${input.about ? 1 : 0}`),
						{
							...input,
							// It holds for every month, whatever the terms' own reach.
							scope: "from-on",
							kind: "commitment-terms",
							targetId: input.commitmentId,
							before: sql`json_object('about', json(case when ${commitments.about} then 'true' else 'false' end))`,
							after: { about: input.about },
						},
					),
				];
	const rename = db
		.update(commitments)
		.set({ name: input.name, ...(input.about === undefined ? {} : { about: input.about }) })
		.where(own);
	const log = termsLog(db, input);
	const write = termsFor(db, input).onConflictDoUpdate({
		target: [commitmentTerms.commitmentId, commitmentTerms.month],
		set: { amountCents: input.amountCents, cadence: input.cadence, dueDate: input.dueDate },
	});
	const series =
		input.scope === "just"
			? await db
					.select({
						month: commitmentTerms.month,
						amountCents: commitmentTerms.amountCents,
						cadence: commitmentTerms.cadence,
						dueDate: commitmentTerms.dueDate,
					})
					.from(commitmentTerms)
					.where(
						and(
							eq(commitmentTerms.householdId, input.householdId),
							eq(commitmentTerms.commitmentId, input.commitmentId),
							lte(commitmentTerms.month, addMonths(input.month, 1)),
						),
					)
			: [];
	const restore = restoreAfterJust(series as ({ month: MonthKey } & Terms)[], input.month);
	if (!restore) {
		await db.batch([renameLog, ...aboutLog, rename, log, write]);
		return;
	}
	await db.batch([
		renameLog,
		...aboutLog,
		rename,
		log,
		// Guarded like the change itself; the next month's own terms always win, even ones
		// written since the read above.
		termsFor(db, { ...input, ...restore }).onConflictDoNothing({
			target: [commitmentTerms.commitmentId, commitmentTerms.month],
		}),
		write,
	]);
}

/**
 * Takes a Commitment out of the Plan from `month` onward; earlier months keep it. Ending it
 * from a later month than it already was is a no-op.
 */
export async function endCommitment(db: Db, input: EndCommitmentInput): Promise<void> {
	await db.batch(commitmentEnd(db, input));
}

type EndCommitmentInput = Author & { householdId: string; commitmentId: string; month: MonthKey };

/** endCommitment as statements (its Plan change, then itself), for a batch with others. */
export const commitmentEnd = (db: Db, input: EndCommitmentInput) => {
	const endable = and(
		ownCommitment(input.householdId, input.commitmentId),
		or(isNull(commitments.endedFromMonth), gt(commitments.endedFromMonth, input.month)),
	);
	return [
		logChange(db, commitments, endable, {
			...input,
			kind: "commitment-end",
			targetId: input.commitmentId,
			before: null,
			after: null,
		}),
		db.update(commitments).set({ endedFromMonth: input.month }).where(endable),
	] as const;
};

// --- What a Commitment pays down (issue 93, ADR-0050) ------------------------------------------

/** An imported purchase this recent makes a card one Noodle follows. */
export const FOLLOWED_WITHIN_DAYS = 60;

/**
 * Over a row of `accounts`: Noodle follows it, so what's bought on it is already counted in
 * Buckets. It syncs with its bank, or a purchase was imported into it in the last 60 days.
 */
const followedSql = (today: DayKey) =>
	sql`(${accounts.bankConnectionId} is not null or exists (select 1 from transactions ft
		where ft.account_id = ${accounts.id} and ft.source = 'import' and ft.amount_cents > 0
		and ft.date >= ${addDays(today, -FOLLOWED_WITHIN_DAYS)}))`;

/** The Household's credit cards in use that Noodle follows (followedSql), by ID. */
export async function followedCards(db: Db, householdId: string, today: DayKey): Promise<string[]> {
	const rows = await db
		.select({ id: accounts.id })
		.from(accounts)
		.where(
			and(
				eq(accounts.householdId, householdId),
				eq(accounts.kind, "credit-card"),
				isNull(accounts.archivedAt),
				followedSql(today),
			),
		);
	return rows.map((row) => row.id);
}

/** Money out over a stretch of days, and the Household's cards and loans in use (loadPaymentHistory). */
export type PaymentHistory = {
	lines: { text: string | null; amountCents: Cents; date: DayKey; from: string | null }[];
	accounts: { id: string; name: string; kind: "credit-card" | "loan"; connected: boolean }[];
};

/**
 * What the amount a Commitment might pay a card or loan down by is worked out from (suggestPayment
 * in @noodle/domain): every line of money out `viewer` may read from `from` up to, not including,
 * `until`, as its bank worded it and with the Account it left, as Review reads a line; and the
 * Household's credit cards and loans in use. A Transfer's side is among them: a payment already
 * marked as one is still a payment to the card.
 */
export async function loadPaymentHistory(
	db: Db,
	viewer: Viewer,
	from: DayKey,
	until: DayKey,
): Promise<PaymentHistory> {
	const [lineRows, accountRows] = await Promise.all([
		db
			.select({
				note: transactions.note,
				merchant: transactions.merchant,
				amountCents: transactions.amountCents,
				date: transactions.date,
				source: transactions.source,
				accountId: transactions.accountId,
			})
			.from(transactions)
			.where(
				and(
					visibleTo(viewer),
					gt(transactions.amountCents, 0),
					gte(transactions.date, from),
					sql`${transactions.date} < ${until}`,
				),
			),
		db
			.select({
				id: accounts.id,
				name: accounts.name,
				kind: accounts.kind,
				bankConnectionId: accounts.bankConnectionId,
				archivedAt: accounts.archivedAt,
			})
			.from(accounts)
			.where(eq(accounts.householdId, viewer.householdId)),
	]);
	const names = new Map(accountRows.map((account) => [account.id, account.name]));
	return {
		lines: lineRows.map((row) => ({
			text: row.note || row.merchant,
			amountCents: row.amountCents,
			date: row.date as DayKey,
			from: row.source === "import" && row.accountId ? (names.get(row.accountId) ?? null) : null,
		})),
		accounts: accountRows.flatMap((account) =>
			account.archivedAt === null && (account.kind === "credit-card" || account.kind === "loan")
				? [
						{
							id: account.id,
							name: account.name,
							kind: account.kind,
							connected: account.bankConnectionId !== null,
						},
					]
				: [],
		),
	};
}

export type CommitmentLinkInput = Author & {
	householdId: string;
	commitmentId: string;
	/** The credit card or loan it pays down; null for none. */
	accountId: string | null;
	/** "This is a set payment on a balance I'm carrying": needed for a card Noodle follows. */
	carriedBalance: boolean;
	/** The Household's current month, for the Plan change. */
	month: MonthKey;
	/** Today in the Household's time zone. */
	today: DayKey;
};

export type CommitmentLinkResult =
	| { ok: true }
	/**
	 * "not-found": the Commitment or the Account isn't the Household's. "wrong-kind": the Account
	 * holds money. "archived": the Account is archived. "followed": it's a card Noodle follows, and
	 * `carriedBalance` wasn't given.
	 */
	| { ok: false; reason: "not-found" | "wrong-kind" | "archived" | "followed" };

/**
 * linkCommitment as statements (its Plan change, then itself), for a batch with others. The
 * write lands only while the Account is the Household's credit card or loan and isn't archived,
 * and, for a card Noodle follows, only with `carriedBalance`: paying such a card is a Transfer,
 * so a Commitment for it would count its purchases twice unless it's a balance being carried.
 */
export const commitmentLink = (db: Db, input: CommitmentLinkInput) => {
	const own = ownCommitment(input.householdId, input.commitmentId);
	const entry = { ...input, kind: "commitment-account" as const, targetId: input.commitmentId };
	// Spelled out: inside a select's fields Drizzle leaves column names unqualified.
	const before = sql`json_object('paysDown',
		(select pa.name from accounts pa where pa.id = "commitments"."account_id"))`;
	if (input.accountId === null) {
		return [
			logChange(db, commitments, and(own, isNotNull(commitments.accountId)), {
				...entry,
				before,
				after: { paysDown: null },
			}),
			db.update(commitments).set({ accountId: null, carriedBalance: false }).where(own),
		] as const;
	}
	const allowed = sql`exists (select 1 from ${accounts} where ${and(
		eq(accounts.id, input.accountId),
		eq(accounts.householdId, input.householdId),
		inArray(accounts.kind, ["credit-card", "loan"]),
		isNull(accounts.archivedAt),
		input.carriedBalance
			? undefined
			: sql`(${accounts.kind} = 'loan' or not ${followedSql(input.today)})`,
	)})`;
	return [
		logChange(
			db,
			commitments,
			and(own, allowed, sql`${commitments.accountId} is not ${input.accountId}`),
			{
				...entry,
				before,
				after: sql`json_object('paysDown',
					(select pa.name from accounts pa where pa.id = ${input.accountId}))`,
			},
		),
		db
			.update(commitments)
			.set({ accountId: input.accountId, carriedBalance: input.carriedBalance })
			.where(and(own, allowed)),
	] as const;
};

/**
 * Sets the credit card or loan a Commitment's payments pay down, or none (ADR-0050). Nothing
 * else is written: what's owed on an Account kept by hand is derived from the payments filed in
 * the Commitment (owedOn in @noodle/domain). Refused, with why, by commitmentLink's guard.
 */
export async function linkCommitment(
	db: Db,
	input: CommitmentLinkInput,
): Promise<CommitmentLinkResult> {
	await db.batch(commitmentLink(db, input));
	const [row] = await db
		.select({ accountId: commitments.accountId, carried: commitments.carriedBalance })
		.from(commitments)
		.where(ownCommitment(input.householdId, input.commitmentId));
	if (!row) return { ok: false, reason: "not-found" };
	if (input.accountId === null) return { ok: true };
	if (row.accountId === input.accountId && row.carried === input.carriedBalance)
		return { ok: true };
	const [account] = await db
		.select({ kind: accounts.kind, archivedAt: accounts.archivedAt })
		.from(accounts)
		.where(and(eq(accounts.id, input.accountId), eq(accounts.householdId, input.householdId)));
	if (!account) return { ok: false, reason: "not-found" };
	if (account.kind !== "credit-card" && account.kind !== "loan") {
		return { ok: false, reason: "wrong-kind" };
	}
	return { ok: false, reason: account.archivedAt === null ? "followed" : "archived" };
}

/** A payment recorded against a Commitment, with the Transaction's ID. */
export type CommitmentCharge = Charge & { id: string };

/**
 * The month's Transactions assigned to Commitments, whole or through Splits, as `viewer` may see
 * them. A split Transaction's Splits paying the same Commitment are one charge of it (see
 * assignedParts in @noodle/domain).
 */
export const loadCharges = (db: Db, viewer: Viewer, month: MonthKey) =>
	loadChargesBetween(db, viewer, `${month}-01` as DayKey, `${month}-31` as DayKey);

/** Like loadCharges, for the days from `from` to `to` (inclusive), by date. */
export async function loadChargesBetween(
	db: Db,
	viewer: Viewer,
	from: DayKey,
	to: DayKey,
): Promise<CommitmentCharge[]> {
	const inRange = and(
		visibleTo(viewer),
		counts(),
		gte(transactions.date, from),
		lte(transactions.date, to),
	);
	const [whole, split] = await db.batch([
		db
			.select({
				id: transactions.id,
				commitmentId: transactions.commitmentId,
				amount: transactions.amountCents,
				date: transactions.date,
			})
			.from(transactions)
			.where(and(inRange, isNotNull(transactions.commitmentId))),
		db
			.select({
				id: splits.transactionId,
				commitmentId: splits.commitmentId,
				amount: sql<number>`sum(${splits.amountCents})`,
				date: transactions.date,
			})
			.from(splits)
			.innerJoin(transactions, eq(transactions.id, splits.transactionId))
			.where(
				and(inRange, eq(splits.householdId, viewer.householdId), isNotNull(splits.commitmentId)),
			)
			.groupBy(splits.transactionId, splits.commitmentId),
	]);
	// commitment_id is filtered to non-null, and dates are always written as DayKeys.
	// Paid back gives a Commitment its money back on the day it arrived (ADR-0058).
	const paidBack = await loadPaidBackCharges(db, viewer, from, to);
	return ([...whole, ...split, ...paidBack] as CommitmentCharge[]).sort((a, b) =>
		a.date < b.date ? -1 : a.date > b.date ? 1 : 0,
	);
}

export type CommitmentPaymentResult = { ok: true } | { ok: false; reason: "not-in-plan" };

/**
 * Records a payment of a Commitment as a Quick Add: a Transaction of `amountCents` on `date`,
 * assigned to the Commitment. Idempotent per `transactionId`. It is only written if, at write
 * time, the Commitment belongs to the Household and is in the Plan for `date`'s month.
 */
export async function addCommitmentPayment(
	db: Db,
	input: {
		householdId: string;
		transactionId: string;
		commitmentId: string;
		date: DayKey;
		amountCents: Cents;
		createdByMemberId: string;
	},
): Promise<CommitmentPaymentResult> {
	await db
		.insert(transactions)
		.select(
			db
				.select({
					id: sql<string>`${input.transactionId}`.as("id"),
					householdId: commitments.householdId,
					source: sql<"quick-add">`'quick-add'`.as("source"),
					date: sql<string>`${input.date}`.as("date"),
					amountCents: sql<number>`${input.amountCents}`.as("amount_cents"),
					bucketId: sql<string | null>`null`.as("bucket_id"),
					note: sql<string | null>`null`.as("note"),
					createdByMemberId: sql<string>`${input.createdByMemberId}`.as("created_by_member_id"),
					createdAt: sql<Date>`(unixepoch() * 1000)`.as("created_at"),
					// Selected in the table's column order: insert … select is positional.
					commitmentId: commitments.id,
					accountId: sql<string | null>`null`.as("account_id"),
					goalId: sql<string | null>`null`.as("goal_id"),
					importId: sql<string | null>`null`.as("import_id"),
					externalId: sql<string | null>`null`.as("external_id"),
					capturedVia: sql<string | null>`null`.as("captured_via"),
					pending: sql<boolean>`0`.as("pending"),
					merchant: sql<string | null>`null`.as("merchant"),
					version: sql<number>`0`.as("version"),
				})
				.from(commitments)
				.where(
					and(
						ownCommitment(input.householdId, input.commitmentId),
						inPlanFor(input.date.slice(0, 7)),
					),
				),
		)
		.onConflictDoNothing({ target: transactions.id });
	// Either this call or an earlier attempt with the same ID wrote it, or it was refused.
	const [written] = await db
		.select({ id: transactions.id })
		.from(transactions)
		.where(
			and(
				eq(transactions.id, input.transactionId),
				eq(transactions.householdId, input.householdId),
			),
		);
	return written ? { ok: true } : { ok: false, reason: "not-in-plan" };
}
