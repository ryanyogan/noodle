import {
	type DayKey,
	ruleFor as matchingRule,
	merchantKey,
	type Rule,
	ruleKeys,
} from "@noodle/domain";
import { and, asc, eq, gt, isNull, ne, or, type SQL, sql } from "drizzle-orm";
import { type CategorizationDecision, fileCategorizations } from "./categorize";
import { counts } from "./counting";
import type { Db } from "./index";
import { assignableBy, type Viewer, visibleTo } from "./privacy";
import {
	buckets,
	categorizations,
	commitments,
	members,
	ruleFor,
	rules,
	splits,
	transactions,
} from "./schema";

// Rules: a Parent's stated "always file this merchant in this Bucket, For these Members". A Rule
// into a Parent's own Personal Allowance is private to them (ADR-0003): it's kept with them as its
// owner, only ever read for them, and only their Imports use it. Everything else is the
// Household's, for either Parent to see, change, or delete. A Rule may file into a Commitment
// instead of a Bucket (ADR-0030): Commitments are the Household's, so such a Rule always is too.

/** A Rule as categorization uses it. */
export type StoredRule = Rule & {
	id: string;
	commitmentId: string | null;
	for: string[];
	private: boolean;
};

/** A Rule as the Rules screen lists it. */
export type RuleRow = StoredRule & {
	/** Its Bucket's (or Commitment's) name, even once that has left the Plan. */
	bucketName: string;
	/** The name of the Parent who last stated it. */
	createdBy: string | null;
	/** How many Transactions it has filed. */
	matched: number;
};

/** The Rules `viewer` may read: the Household's, and their own private ones. */
const visibleRule = (viewer: Viewer) =>
	and(
		eq(rules.householdId, viewer.householdId),
		or(isNull(rules.ownerMemberId), eq(rules.ownerMemberId, viewer.memberId)),
	) as SQL;

/** Whose a Rule into `bucketId` is: its owner's when it's a Personal Allowance, else nobody's. A
 * Rule into a Commitment (no Bucket) is nobody's. */
const ownerOf = (bucketId: string | null) =>
	sql`(select ${buckets.ownerMemberId} from ${buckets} where ${buckets.id} = ${bucketId})`;

/** What a Rule files into: exactly one of a Bucket and a Commitment. */
export type RuleTarget = { bucketId?: string | null; commitmentId?: string | null };

/** `target` made exactly one of the two, the Bucket winning; null when it names neither. */
function targetOf(
	target: RuleTarget,
): { bucketId: string | null; commitmentId: string | null } | null {
	if (target.bucketId) return { bucketId: target.bucketId, commitmentId: null };
	if (target.commitmentId) return { bucketId: null, commitmentId: target.commitmentId };
	return null;
}

/** `memberId` may file into it: a Bucket they may assign, or one of the Household's Commitments still going. */
const assignableTarget = (
	householdId: string,
	memberId: string,
	target: { bucketId: string | null; commitmentId: string | null },
) =>
	target.bucketId
		? assignable(householdId, memberId, target.bucketId)
		: sql`exists (select 1 from ${commitments} where ${and(
				eq(commitments.id, target.commitmentId as string),
				eq(commitments.householdId, householdId),
				isNull(commitments.endedFromMonth),
			)})`;

/** A Rule row files into exactly `target`. */
const filesInto = (target: { bucketId: string | null; commitmentId: string | null }) =>
	sql`${rules.bucketId} is ${target.bucketId} and ${rules.commitmentId} is ${target.commitmentId}`;

/** `bucketId` is one of the Household's Buckets `memberId` may assign to. */
const assignable = (householdId: string, memberId: string, bucketId: string) =>
	sql`exists (select 1 from ${buckets} where ${and(
		eq(buckets.id, bucketId),
		eq(buckets.householdId, householdId),
		assignableBy(memberId),
	)})`;

/** Each Rule's For, by Rule. */
async function forOf(db: Db, householdId: string, ids: string[]): Promise<Map<string, string[]>> {
	if (ids.length === 0) return new Map();
	const rows = await db
		.select({ ruleId: ruleFor.ruleId, memberId: ruleFor.memberId })
		.from(ruleFor)
		.where(
			and(
				eq(ruleFor.householdId, householdId),
				sql`${ruleFor.ruleId} in (select value from json_each(${JSON.stringify(ids)}))`,
			),
		)
		.orderBy(asc(ruleFor.memberId));
	const grouped = new Map<string, string[]>();
	for (const { ruleId, memberId } of rows) {
		grouped.set(ruleId, [...(grouped.get(ruleId) ?? []), memberId]);
	}
	return grouped;
}

/** The Rules categorization uses for `viewer`: the Household's and their own, never the other Parent's. */
export async function loadRules(db: Db, viewer: Viewer): Promise<StoredRule[]> {
	const rows = await db
		.select({
			id: rules.id,
			pattern: rules.pattern,
			bucketId: rules.bucketId,
			commitmentId: rules.commitmentId,
			owner: rules.ownerMemberId,
		})
		.from(rules)
		.where(visibleRule(viewer));
	const forRows = await forOf(
		db,
		viewer.householdId,
		rows.map((row) => row.id),
	);
	return rows.map(({ owner, ...rule }) => ({
		...rule,
		for: forRows.get(rule.id) ?? [],
		private: owner !== null,
	}));
}

/** The Rules `viewer` may see and change, by pattern. */
export async function listRules(db: Db, viewer: Viewer): Promise<RuleRow[]> {
	const rows = await db
		.select({
			id: rules.id,
			pattern: rules.pattern,
			bucketId: rules.bucketId,
			commitmentId: rules.commitmentId,
			bucketName: sql<string>`coalesce(${buckets.name}, ${commitments.name}, '')`,
			owner: rules.ownerMemberId,
			createdBy: members.name,
			matched: rules.matchedCount,
		})
		.from(rules)
		.leftJoin(buckets, eq(buckets.id, rules.bucketId))
		.leftJoin(commitments, eq(commitments.id, rules.commitmentId))
		.leftJoin(members, eq(members.id, rules.createdByMemberId))
		.where(visibleRule(viewer))
		.orderBy(asc(rules.pattern), asc(rules.id));
	const forRows = await forOf(
		db,
		viewer.householdId,
		rows.map((row) => row.id),
	);
	return rows.map(({ owner, ...rule }) => ({
		...rule,
		for: forRows.get(rule.id) ?? [],
		private: owner !== null,
	}));
}

/** Replaces a Rule's For with `forMemberIds` (the Household's Members only), if it's `ruleId`'s. */
function replaceFor(db: Db, householdId: string, ruleId: SQL, forMemberIds: string[], landed: SQL) {
	return [
		db.delete(ruleFor).where(and(sql`${ruleFor.ruleId} = ${ruleId}`, landed)),
		db
			.insert(ruleFor)
			.select(
				db
					.select({
						ruleId: sql<string>`${ruleId}`.as("rule_id"),
						memberId: sql<string>`value`.as("member_id"),
						householdId: sql<string>`${householdId}`.as("household_id"),
					})
					.from(sql`json_each(${JSON.stringify(forMemberIds)})`)
					.where(
						and(
							landed,
							sql`exists (select 1 from ${members} where ${members.id} = value
								and ${members.householdId} = ${householdId})`,
						),
					),
			)
			.onConflictDoNothing(),
	] as const;
}

/**
 * States a Rule: statement lines whose merchant contains `pattern` (made a merchantKey) go to
 * `bucketId`, a Bucket of the Household `memberId` may assign to, For `forMemberIds` (none: the
 * whole Household). Into `memberId`'s own Personal Allowance it's private to them. Replaces the
 * Rule for the same pattern that's theirs (or the Household's), so saving it twice is harmless.
 * Returns the Rule's ID, which is `id` unless it replaced one.
 */
export async function saveRule(
	db: Db,
	input: {
		id: string;
		householdId: string;
		memberId: string;
		pattern: string;
		forMemberIds?: string[];
	} & RuleTarget,
): Promise<{ ok: true; ruleId: string; private: boolean } | { ok: false }> {
	const { householdId, memberId } = input;
	const target = targetOf(input);
	if (!target) return { ok: false };
	const { bucketId, commitmentId } = target;
	const pattern = merchantKey(input.pattern);
	const sameKey = sql`${rules.householdId} = ${householdId} and ${rules.pattern} = ${pattern}
		and ${rules.ownerMemberId} is ${ownerOf(bucketId)}`;
	const canAssign = assignableTarget(householdId, memberId, target);
	const ruleId = sql`(select ${rules.id} from ${rules} where ${sameKey})`;
	const landed = sql`exists (select 1 from ${rules} where ${sameKey} and ${filesInto(target)})`;
	await db.batch([
		db
			.update(rules)
			.set({ bucketId, commitmentId, createdByMemberId: memberId })
			.where(and(sameKey, canAssign)),
		db.insert(rules).select(
			db
				.select({
					// Selected in the table's column order: insert … select is positional.
					id: sql<string>`${input.id}`.as("id"),
					householdId: sql<string>`${householdId}`.as("household_id"),
					pattern: sql<string>`${pattern}`.as("pattern"),
					bucketId: sql<string | null>`${bucketId}`.as("bucket_id"),
					createdByMemberId: sql<string>`${memberId}`.as("created_by_member_id"),
					createdAt: sql<Date>`(unixepoch() * 1000)`.as("created_at"),
					ownerMemberId: sql<string | null>`${ownerOf(bucketId)}`.as("owner_member_id"),
					matchedCount: sql<number>`0`.as("matched_count"),
					commitmentId: sql<string | null>`${commitmentId}`.as("commitment_id"),
				})
				.from(sql`(select 1)`)
				.where(and(canAssign, sql`not exists (select 1 from ${rules} where ${sameKey})`)),
		),
		...replaceFor(db, householdId, ruleId, input.forMemberIds ?? [], landed),
	]);
	const [saved] = await db
		.select({
			id: rules.id,
			bucketId: rules.bucketId,
			commitmentId: rules.commitmentId,
			owner: rules.ownerMemberId,
		})
		.from(rules)
		.where(sameKey);
	return saved && saved.bucketId === bucketId && saved.commitmentId === commitmentId
		? { ok: true, ruleId: saved.id, private: saved.owner !== null }
		: { ok: false };
}

export type RuleEditResult =
	| { ok: true; private: boolean }
	| { ok: false; reason: "not-found" | "duplicate" };

/**
 * Changes a Rule `viewer` may see: its pattern, Bucket (one they may assign to), and For. Moving
 * it into their own Personal Allowance makes it private to them; out of it, the Household's.
 * Refused when that would make it a second Rule for the same pattern.
 */
export async function editRule(
	db: Db,
	viewer: Viewer,
	input: { ruleId: string; pattern: string; forMemberIds: string[] } & RuleTarget,
): Promise<RuleEditResult> {
	const { householdId, memberId } = viewer;
	const { ruleId } = input;
	const target = targetOf(input);
	if (!target) return { ok: false, reason: "not-found" };
	const { bucketId, commitmentId } = target;
	const pattern = merchantKey(input.pattern);
	const duplicate = sql`exists (select 1 from ${rules} other where other.household_id = ${householdId}
		and other.pattern = ${pattern} and other.owner_member_id is ${ownerOf(bucketId)}
		and other.id <> ${ruleId})`;
	const landed = sql`exists (select 1 from ${rules} where ${and(
		eq(rules.id, ruleId),
		visibleRule(viewer),
		eq(rules.pattern, pattern),
		filesInto(target),
	)})`;
	await db.batch([
		db
			.update(rules)
			.set({
				pattern,
				bucketId,
				commitmentId,
				ownerMemberId: sql`${ownerOf(bucketId)}`,
				createdByMemberId: memberId,
			})
			.where(
				and(
					eq(rules.id, ruleId),
					visibleRule(viewer),
					assignableTarget(householdId, memberId, target),
					sql`not ${duplicate}`,
				),
			),
		...replaceFor(db, householdId, sql`${ruleId}`, input.forMemberIds, landed),
	]);
	const [saved] = await db
		.select({
			pattern: rules.pattern,
			bucketId: rules.bucketId,
			commitmentId: rules.commitmentId,
			owner: rules.ownerMemberId,
		})
		.from(rules)
		.where(and(eq(rules.id, ruleId), visibleRule(viewer)));
	if (
		saved?.pattern === pattern &&
		saved.bucketId === bucketId &&
		saved.commitmentId === commitmentId
	) {
		return { ok: true, private: saved.owner !== null };
	}
	const [clash] = await db
		.select({ id: rules.id })
		.from(rules)
		.where(
			and(
				visibleRule(viewer),
				eq(rules.pattern, pattern),
				ne(rules.id, ruleId),
				sql`${rules.ownerMemberId} is ${ownerOf(bucketId)}`,
			),
		);
	return { ok: false, reason: saved && clash ? "duplicate" : "not-found" };
}

/** Deletes a Rule `viewer` may see. What it already filed stays where it is. Idempotent. */
export async function deleteRule(db: Db, viewer: Viewer, ruleId: string): Promise<void> {
	const theirs = sql`exists (select 1 from ${rules} where ${and(eq(rules.id, ruleId), visibleRule(viewer))})`;
	await db.batch([
		db.delete(ruleFor).where(and(eq(ruleFor.ruleId, ruleId), theirs)),
		db.delete(rules).where(and(eq(rules.id, ruleId), visibleRule(viewer))),
	]);
}

/**
 * Files what's still unassigned by a Rule `viewer` may see: every Transaction of money spent,
 * counted, unsplit and in no Bucket, Commitment or Goal, whose merchant it matches (as
 * categorized, else from its note), whether waiting in Review or never categorized. Done for
 * `viewer`, so only into a Bucket they may assign, in each Transaction's own month's Plan.
 * Returns how many it filed and their months.
 */
export async function applyRule(
	db: Db,
	viewer: Viewer,
	ruleId: string,
	/**
	 * `beforeFiling` is called once with how many Transactions are about to be filed, before any
	 * is (never with 0). If it throws, nothing is filed: the snapshot taken before a bulk apply
	 * (ADR-0035) hangs off it.
	 */
	options: { beforeFiling?: (matched: number) => Promise<void> } = {},
): Promise<{ filed: number; months: string[] }> {
	const rule = (await loadRules(db, viewer)).find((r) => r.id === ruleId);
	if (!rule) return { filed: 0, months: [] };
	const rows = await db
		.select({
			id: transactions.id,
			date: transactions.date,
			note: transactions.note,
			merchant: categorizations.merchant,
		})
		.from(transactions)
		.leftJoin(categorizations, eq(categorizations.transactionId, transactions.id))
		.where(
			and(
				visibleTo(viewer),
				isNull(transactions.bucketId),
				isNull(transactions.commitmentId),
				isNull(transactions.goalId),
				gt(transactions.amountCents, 0),
				counts(),
				sql`not exists (select 1 from ${splits} where ${splits.transactionId} = ${transactions.id})`,
				or(isNull(categorizations.transactionId), eq(categorizations.outcome, "review")),
			),
		);
	const decisions: (CategorizationDecision & { date: DayKey })[] = [];
	for (const row of rows) {
		const merchant = row.merchant ?? (row.note ? merchantKey(row.note) : null);
		// A Rule stated for the raw text ("costco whse") still matches once the line is named
		// "Costco", and one stated for "Costco" still matches once a Parent calls it something else.
		const raws = row.note ? ruleKeys({ note: row.note }) : [];
		if (
			!merchant ||
			!(matchingRule([rule], merchant) || raws.some((raw) => matchingRule([rule], raw)))
		)
			continue;
		decisions.push({
			transactionId: row.id,
			date: row.date as DayKey,
			merchant,
			ruleId,
			categorization: {
				outcome: "filed",
				method: "rule",
				bucketId: rule.bucketId,
				commitmentId: rule.commitmentId,
				confidence: 1,
				for: rule.for,
			},
		});
	}
	if (decisions.length === 0) return { filed: 0, months: [] };
	await options.beforeFiling?.(decisions.length);
	await fileCategorizations(db, viewer, decisions);
	const filed = await db
		.select({ date: transactions.date })
		.from(transactions)
		.where(
			and(
				eq(transactions.householdId, viewer.householdId),
				// One JSON parameter for all of them: D1 caps a statement's bound parameters at 100.
				sql`${transactions.id} in (select value from json_each(${JSON.stringify(
					decisions.map((d) => d.transactionId),
				)}))`,
				rule.bucketId
					? eq(transactions.bucketId, rule.bucketId)
					: eq(transactions.commitmentId, rule.commitmentId as string),
			),
		);
	return {
		filed: filed.length,
		months: [...new Set(filed.map((row) => row.date.slice(0, 7)))].sort(),
	};
}
