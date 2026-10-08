import {
	type DayKey,
	ruleFor as matchingRule,
	merchantKey,
	type Rule,
	ruledLoanPayment,
	ruleKeys,
} from "@noodle/domain";
import { and, asc, eq, gt, isNull, lt, ne, or, type SQL, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { type CategorizationDecision, fileCategorizations } from "./categorize";
import { countingTwice } from "./commitments";
import { counts } from "./counting";
import { purchaseMayMove } from "./ended-months";
import type { Db } from "./index";
import { loadLoansPaidDown, loansPaidDownIn } from "./lender-payments";
import { ruleRemovedEvents } from "./log-events";
import { assignableBy, type Viewer, visibleTo } from "./privacy";
import {
	buckets,
	categorizations,
	commitments,
	members,
	ruleFor,
	ruleStatements,
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
	/** Who pays back part of what it files, and what part in percent, when it remembers (ADR-0058). */
	owedBack?: { who: string; percent: number };
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
			owedBackWho: rules.owedBackWho,
			owedBackPercent: rules.owedBackPercent,
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
	return rows.map(({ owner, owedBackWho, owedBackPercent, ...rule }) => ({
		...rule,
		for: forRows.get(rule.id) ?? [],
		private: owner !== null,
		...(owedBackWho && owedBackPercent
			? { owedBack: { who: owedBackWho, percent: owedBackPercent } }
			: {}),
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
 *
 * As statements for a batch with others, and `saved` to read afterwards what they did; null when
 * the Rule names no target. saveRule runs them on their own.
 */
export function ruleSaving(
	db: Db,
	input: {
		id: string;
		householdId: string;
		memberId: string;
		pattern: string;
		forMemberIds?: string[];
	} & RuleTarget,
	/** Given, it is stated only while this holds: what else in the batch needs, so all land or none. */
	onlyIf?: SQL,
) {
	const { householdId, memberId } = input;
	const target = targetOf(input);
	if (!target) return null;
	const { bucketId, commitmentId } = target;
	const pattern = merchantKey(input.pattern);
	const sameKey = sql`${rules.householdId} = ${householdId} and ${rules.pattern} = ${pattern}
		and ${rules.ownerMemberId} is ${ownerOf(bucketId)}`;
	const canAssign = and(assignableTarget(householdId, memberId, target), onlyIf) as SQL;
	const ruleId = sql`(select ${rules.id} from ${rules} where ${sameKey})`;
	const landed = and(
		sql`exists (select 1 from ${rules} where ${sameKey} and ${filesInto(target)})`,
		onlyIf,
	) as SQL;
	const statements = [
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
					// A new Rule remembers nothing about Owed back until a Parent says so (ADR-0058).
					owedBackWho: sql<string | null>`null`.as("owed_back_who"),
					owedBackMemberId: sql<string | null>`null`.as("owed_back_member_id"),
					owedBackPercent: sql<number | null>`null`.as("owed_back_percent"),
				})
				.from(sql`(select 1)`)
				.where(and(canAssign, sql`not exists (select 1 from ${rules} where ${sameKey})`)),
		),
		...replaceFor(db, householdId, ruleId, input.forMemberIds ?? [], landed),
	] as const;
	const saved = async (): Promise<RuleSaved> => {
		const [row] = await db
			.select({
				id: rules.id,
				bucketId: rules.bucketId,
				commitmentId: rules.commitmentId,
				owner: rules.ownerMemberId,
			})
			.from(rules)
			.where(sameKey);
		return row && row.bucketId === bucketId && row.commitmentId === commitmentId
			? { ok: true, ruleId: row.id, private: row.owner !== null }
			: { ok: false };
	};
	return { statements, saved };
}

export type RuleSaved = { ok: true; ruleId: string; private: boolean } | { ok: false };

export async function saveRule(
	db: Db,
	input: Parameters<typeof ruleSaving>[1],
): Promise<RuleSaved> {
	const saving = ruleSaving(db, input);
	if (!saving) return { ok: false };
	await db.batch(saving.statements);
	return saving.saved();
}

/** How long a statement is remembered: well past the week a device keeps one to send again. */
const STATEMENT_KEPT_MS = 30 * 24 * 60 * 60 * 1000;

export type RuleStated =
	/** It is the merchant's Rule now: `ruleId` is the one it replaced, else its own ID. */
	| { status: "stated"; ruleId: string; private: boolean }
	/** This very statement landed before: nothing was changed, and this is what it did then. */
	| { status: "repeat"; filed: number; snapshot: boolean }
	/** Sent again, never landed, and the merchant has a Rule made since: that one was left alone. */
	| { status: "other-rule" }
	/** Not a Bucket or Commitment this Parent may file into. */
	| { status: "refused" };

/**
 * States a Rule from a Review card (see `saveRule`), once for the ID the card made for it: the
 * same `id` sent again by the same Parent changes nothing and answers what the first one did
 * (`noteRuleStated`), though the Rule was since removed or pointed at another Bucket (ADR-0056).
 *
 * `again` says it was left by an earlier page and is sent days later perhaps. One that never
 * landed is then stated only where the merchant has no Rule yet: a Rule made for it since, by
 * either Parent, is the newer choice and is left as it is ("other-rule"), or kept untouched when
 * it already files where this one would.
 */
export async function stateRule(
	db: Db,
	input: Parameters<typeof saveRule>[1] & { again?: boolean },
	now: Date = new Date(),
): Promise<RuleStated> {
	const { householdId, memberId } = input;
	const [before] = await db
		.select({ filed: ruleStatements.filed, snapshot: ruleStatements.snapshot })
		.from(ruleStatements)
		.where(
			and(
				eq(ruleStatements.id, input.id),
				eq(ruleStatements.householdId, householdId),
				eq(ruleStatements.memberId, memberId),
			),
		);
	if (before) return { status: "repeat", filed: before.filed, snapshot: before.snapshot };

	const target = targetOf(input);
	if (!target) return { status: "refused" };
	let stated: { ruleId: string; private: boolean } | null = null;
	if (input.again) {
		const [there] = await db
			.select({
				id: rules.id,
				bucketId: rules.bucketId,
				commitmentId: rules.commitmentId,
				owner: rules.ownerMemberId,
			})
			.from(rules)
			.where(
				sql`${rules.householdId} = ${householdId}
					and ${rules.pattern} = ${merchantKey(input.pattern)}
					and ${rules.ownerMemberId} is ${ownerOf(target.bucketId)}`,
			);
		if (there) {
			if (there.bucketId !== target.bucketId || there.commitmentId !== target.commitmentId)
				return { status: "other-rule" };
			// Another Parent's private Rule is never theirs to state.
			if (there.owner !== null && there.owner !== memberId) return { status: "refused" };
			stated = { ruleId: there.id, private: there.owner !== null };
		}
	}
	if (!stated) {
		const saved = await saveRule(db, input);
		if (!saved.ok) return { status: "refused" };
		stated = { ruleId: saved.ruleId, private: saved.private };
	}
	await db.batch([
		db
			.delete(ruleStatements)
			.where(
				and(
					eq(ruleStatements.householdId, householdId),
					lt(ruleStatements.createdAt, new Date(now.getTime() - STATEMENT_KEPT_MS)),
				),
			),
		db
			.insert(ruleStatements)
			.values({ id: input.id, householdId, memberId, ruleId: stated.ruleId, createdAt: now })
			.onConflictDoNothing(),
	]);
	return { status: "stated", ...stated };
}

/** Notes what a statement did once it was applied, so its repeat answers the same. */
export async function noteRuleStated(
	db: Db,
	viewer: Viewer,
	id: string,
	did: { filed: number; snapshot: boolean },
): Promise<void> {
	await db
		.update(ruleStatements)
		.set(did)
		.where(
			and(
				eq(ruleStatements.id, id),
				eq(ruleStatements.householdId, viewer.householdId),
				eq(ruleStatements.memberId, viewer.memberId),
			),
		);
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

/**
 * deleteRule's statements, for a batch with others. With `unless`, the Rule is deleted only while
 * it doesn't file there: what a write earlier in the same batch was to make it do.
 */
export function ruleDeleting(
	db: Db,
	viewer: Viewer,
	ruleId: string,
	unless?: { bucketId: string | null; commitmentId: string | null },
): BatchItem<"sqlite">[] {
	const which = and(
		eq(rules.id, ruleId),
		visibleRule(viewer),
		unless ? sql`not (${filesInto(unless)})` : undefined,
	) as SQL;
	const theirs = sql`exists (select 1 from ${rules} where ${which})`;
	return [
		...ruleRemovedEvents(db, which, viewer),
		db.delete(ruleFor).where(and(eq(ruleFor.ruleId, ruleId), theirs)),
		db.delete(rules).where(which),
	];
}

/** Deletes a Rule `viewer` may see. What it already filed stays where it is. Idempotent. */
export async function deleteRule(db: Db, viewer: Viewer, ruleId: string): Promise<void> {
	await db.batch(
		ruleDeleting(db, viewer, ruleId) as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]],
	);
}

/**
 * Files what's still unassigned by a Rule `viewer` may see: every Transaction of money spent,
 * counted, unsplit and in no Bucket, Commitment or Goal, whose merchant it matches (as
 * categorized, else from its note), whether waiting in Review or never categorized. Done for
 * `viewer`, so only into a Bucket they may assign, in each Transaction's own month's Plan.
 * Returns how many it filed and their months, and how many it left (`kept`) because money back
 * on them counted in a month that has ended (ADR-0058).
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
	options: {
		beforeFiling?: (matched: number) => Promise<void>;
		/** The Household's day; UTC's when left out. */
		today?: DayKey;
	} = {},
): Promise<{ filed: number; months: string[]; kept: number }> {
	const rule = (await loadRules(db, viewer)).find((r) => r.id === ruleId);
	if (!rule) return { filed: 0, months: [], kept: 0 };
	// A Rule into a Commitment that pays down a card whose purchases are already in Buckets files
	// nothing: each payment would count them twice (issue 151). Its lines wait in Review.
	if (rule.commitmentId) {
		const today = options.today ?? (new Date().toISOString().slice(0, 10) as DayKey);
		if ((await countingTwice(db, viewer.householdId, today)).includes(rule.commitmentId)) {
			return { filed: 0, months: [], kept: 0 };
		}
	}
	const rows = await db
		.select({
			id: transactions.id,
			date: transactions.date,
			note: transactions.note,
			amountCents: transactions.amountCents,
			name: transactions.merchant,
			merchant: categorizations.merchant,
			ended: sql<boolean>`(not ${purchaseMayMove(options.today)})`.mapWith(Boolean),
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
	// A Rule into a loan's Commitment is a Rule for its lender (issue 153): with several loans
	// there, each payment goes to the loan whose payment it is, and any other stays in Review.
	const loans = rule.commitmentId ? await loadLoansPaidDown(db, viewer.householdId) : [];
	const decisions: (CategorizationDecision & { date: DayKey })[] = [];
	let kept = 0;
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
		const sent = rule.commitmentId
			? ruledLoanPayment(
					rule.commitmentId,
					{ text: row.note, merchant: row.name, amountCents: row.amountCents },
					loansPaidDownIn(loans, row.date.slice(0, 7)),
				)
			: null;
		if (sent === "ask") continue;
		// It matches, and stays unassigned: filing it would move the ended month.
		if (row.ended) {
			kept++;
			continue;
		}
		decisions.push({
			transactionId: row.id,
			date: row.date as DayKey,
			merchant,
			ruleId,
			categorization: {
				outcome: "filed",
				method: "rule",
				bucketId: rule.bucketId,
				commitmentId: sent?.commitmentId ?? rule.commitmentId,
				confidence: 1,
				for: rule.for,
			},
		});
	}
	if (decisions.length === 0) return { filed: 0, months: [], kept };
	await options.beforeFiling?.(decisions.length);
	await fileCategorizations(db, viewer, decisions, options.today);
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
				// In the Rule's own Commitment, or the one of the loan its payment fits.
				rule.bucketId
					? eq(transactions.bucketId, rule.bucketId)
					: sql`${transactions.commitmentId} is not null`,
			),
		);
	return {
		filed: filed.length,
		months: [...new Set(filed.map((row) => row.date.slice(0, 7)))].sort(),
		kept,
	};
}
