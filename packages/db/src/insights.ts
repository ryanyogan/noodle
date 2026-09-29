import type { DayKey, InsightKind, InsightSpend } from "@noodle/domain";
import { and, desc, eq, gt, gte, inArray, isNull, ne, or, type SQL, sql } from "drizzle-orm";
import { counts } from "./counting";
import type { Db } from "./index";
import { partlyPrivate, type Viewer, visibleTo } from "./privacy";
import { commitments, insights, transactions } from "./schema";

// Insights in D1. What they rest on is read for one Parent as the Viewer (ADR-0003), so another
// Parent's Personal Allowance never reaches the detectors or the model in a run made for them;
// an Insight resting on the Viewer's own Personal Allowance is stored as theirs alone. Stored
// Insights are keyed by fingerprint: finding one again adds nothing, so a dismissed one stays gone.

/** The Transaction (of the enclosing query) is in `memberId`'s own Personal Allowance, whole or through a Split. */
const ownAllowance = (memberId: string) =>
	sql<number>`(exists (select 1 from buckets b where b.id = "transactions"."bucket_id" and b.owner_member_id = ${memberId})
		or exists (select 1 from splits s inner join buckets b on b.id = s.bucket_id
			where s.transaction_id = "transactions"."id" and b.owner_member_id = ${memberId}))`;

/**
 * Spending from `from` on that `viewer` may read whole, for the detectors: nothing in the other
 * Parent's Personal Allowance, not even a Transaction partly split into it; only what counts as
 * spending (no Transfers, no Match copies); no money back.
 */
export async function loadInsightSpends(
	db: Db,
	viewer: Viewer,
	from: DayKey,
): Promise<InsightSpend[]> {
	const rows = await db
		.select({
			id: transactions.id,
			date: transactions.date,
			amount: transactions.amountCents,
			note: sql<string>`coalesce(${transactions.note}, '')`,
			commitmentId: transactions.commitmentId,
			private: ownAllowance(viewer.memberId),
		})
		.from(transactions)
		.where(
			and(
				visibleTo(viewer),
				counts(),
				sql`not ${partlyPrivate(viewer)}`,
				gte(transactions.date, from),
				gt(transactions.amountCents, 0),
			),
		);
	return rows.map((row) => ({ ...row, date: row.date as DayKey, private: Boolean(row.private) }));
}

/** An Insight to store. `ownerMemberId` is set for one resting on that Parent's own Personal Allowance. */
export type NewInsight = {
	id: string;
	householdId: string;
	ownerMemberId: string | null;
	kind: InsightKind;
	title: string;
	body: string;
	yearlyImpactCents: number;
	transactionIds: string[];
	commitmentIds: string[];
	/** The finding's fingerprint (from @noodle/domain); stored with its owner, see insightFingerprint. */
	fingerprint: string;
};

/** A private Insight's fingerprint is its owner's: the other Parent's findings never collide with it. */
export const insightFingerprint = (ownerMemberId: string | null, fingerprint: string) =>
	`${ownerMemberId ?? "household"}|${fingerprint}`;

/** Of these stored fingerprints (see insightFingerprint), the ones the Household already has, whatever their status. */
export async function knownFingerprints(
	db: Db,
	householdId: string,
	fingerprints: string[],
): Promise<Set<string>> {
	if (fingerprints.length === 0) return new Set();
	const rows = await db
		.select({ fingerprint: insights.fingerprint })
		.from(insights)
		.where(and(eq(insights.householdId, householdId), inArray(insights.fingerprint, fingerprints)));
	return new Set(rows.map((row) => row.fingerprint));
}

/**
 * Stores Insights the Household doesn't have yet, by fingerprint: one found again, new,
 * accepted, or dismissed, is left as it is. Returns how many were added.
 */
export async function recordInsights(db: Db, found: NewInsight[]): Promise<number> {
	if (found.length === 0) return 0;
	const rows = found.map(({ fingerprint, ...insight }) => ({
		...insight,
		fingerprint: insightFingerprint(insight.ownerMemberId, fingerprint),
	}));
	const [first, ...rest] = rows.map((row) =>
		db
			.insert(insights)
			.values(row)
			.onConflictDoNothing({ target: [insights.householdId, insights.fingerprint] })
			.returning({ id: insights.id }),
	);
	const results = await db.batch([first as NonNullable<typeof first>, ...rest]);
	return results.reduce((sum, added) => sum + added.length, 0);
}

/** The Insights `viewer` may read: the Household's and their own. */
const readableBy = (viewer: Viewer) =>
	and(
		eq(insights.householdId, viewer.householdId),
		or(isNull(insights.ownerMemberId), eq(insights.ownerMemberId, viewer.memberId)),
	) as SQL;

export type InsightItem = {
	id: string;
	kind: InsightKind;
	title: string;
	body: string;
	yearlyImpact: number;
	status: "new" | "accepted";
	/** Rests on the Viewer's own Personal Allowance: nobody else sees it. */
	private: boolean;
	createdAt: number;
	/** Its Transactions, as `viewer` sees them, newest first. */
	transactions: { id: string; date: DayKey; amount: number; note: string | null }[];
	/** Its Commitments, `ended` when no longer in the Plan. */
	commitments: { id: string; name: string; endedFromMonth: string | null }[];
};

/**
 * The Insights `viewer` may read that weren't dismissed, new ones first, then by yearly impact.
 * One naming a Transaction `viewer` can't read (moved into the other Parent's Personal Allowance
 * since, or deleted) is left out whole.
 */
export async function loadInsights(db: Db, viewer: Viewer): Promise<InsightItem[]> {
	const rows = await db
		.select()
		.from(insights)
		.where(and(readableBy(viewer), ne(insights.status, "dismissed")))
		.orderBy(
			sql`case when ${insights.status} = 'new' then 0 else 1 end`,
			desc(insights.yearlyImpactCents),
			desc(insights.createdAt),
		);
	const transactionIds = [...new Set(rows.flatMap((row) => row.transactionIds))];
	const commitmentIds = [...new Set(rows.flatMap((row) => row.commitmentIds))];
	const [spends, named] = await Promise.all([
		transactionIds.length === 0
			? []
			: db
					.select({
						id: transactions.id,
						date: transactions.date,
						amount: transactions.amountCents,
						note: transactions.note,
					})
					.from(transactions)
					.where(
						and(
							visibleTo(viewer),
							sql`not ${partlyPrivate(viewer)}`,
							inArray(transactions.id, transactionIds),
						),
					),
		commitmentIds.length === 0
			? []
			: db
					.select({
						id: commitments.id,
						name: commitments.name,
						endedFromMonth: commitments.endedFromMonth,
					})
					.from(commitments)
					.where(
						and(
							eq(commitments.householdId, viewer.householdId),
							inArray(commitments.id, commitmentIds),
						),
					),
	]);
	const spendById = new Map(spends.map((s) => [s.id, { ...s, date: s.date as DayKey }]));
	const commitmentById = new Map(named.map((c) => [c.id, c]));
	return rows.flatMap((row): InsightItem[] => {
		const own = row.transactionIds.map((id) => spendById.get(id));
		if (own.some((s) => s === undefined)) return [];
		return [
			{
				id: row.id,
				kind: row.kind,
				title: row.title,
				body: row.body,
				yearlyImpact: row.yearlyImpactCents,
				status: row.status as InsightItem["status"],
				private: row.ownerMemberId !== null,
				createdAt: row.createdAt.getTime(),
				transactions: (own as InsightItem["transactions"]).sort((a, b) =>
					a.date < b.date ? 1 : a.date > b.date ? -1 : 0,
				),
				commitments: row.commitmentIds.flatMap((id) => {
					const commitment = commitmentById.get(id);
					return commitment ? [commitment] : [];
				}),
			},
		];
	});
}

/**
 * A Parent accepts or dismisses an Insight they may read. Accepting only records it (the Parent
 * then acts, if at all, through the usual screens); an accepted one may still be dismissed, and a
 * dismissed one is final. Idempotent. Returns whether it changed.
 */
export async function decideInsight(
	db: Db,
	viewer: Viewer,
	input: { id: string; status: "accepted" | "dismissed" },
): Promise<boolean> {
	const from = input.status === "accepted" ? ["new"] : ["new", "accepted"];
	const changed = await db
		.update(insights)
		.set({ status: input.status, decidedByMemberId: viewer.memberId })
		.where(
			and(
				readableBy(viewer),
				eq(insights.id, input.id),
				inArray(insights.status, from as ("new" | "accepted")[]),
			),
		)
		.returning({ id: insights.id });
	return changed.length > 0;
}
