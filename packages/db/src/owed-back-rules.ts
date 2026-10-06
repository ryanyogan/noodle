import { type Cents, ruleFor as matchingRule, merchantKey, ruleKeys } from "@noodle/domain";
import { and, eq, sql } from "drizzle-orm";
import type { Db } from "./index";
import { loadOwedBack } from "./owed-back";
import { type Viewer, visibleTo } from "./privacy";
import { loadRules } from "./rules";
import { categorizations, rules, transactions } from "./schema";

// A Rule remembers Owed back (issue 132, ADR-0058): "Tuition: Casey pays back half". It is kept
// on the Rule that files the purchase (rules.owed_back_*), offered once a Parent has said it on
// one purchase, and said again on every purchase the Rule files afterwards (on Import, from the
// bank, a captured Quick Add, or the Rule applied to what's unassigned).

/** What a Rule remembers: who pays part of what it files back, and what part, in percent. */
export type OwedBackRemembered = { who: string; memberId: string | null; percent: number };

/** The Rule a purchase goes by, and what it remembers about Owed back (null: nothing yet). */
export type OwedBackRule = {
	ruleId: string;
	pattern: string;
	remembered: OwedBackRemembered | null;
};

/** The part of `purchase` that `owed` is, in whole percent, 1 to 100. */
export const owedBackPercent = (owed: Cents, purchase: Cents) =>
	Math.min(100, Math.max(1, Math.round((owed * 100) / purchase)));

/**
 * The Rule that matches a purchase's merchant, as `viewer` may see Rules (the Household's and
 * their own), with what it remembers. Null when no Rule matches, or the purchase isn't theirs to
 * see.
 */
export async function owedBackRuleFor(
	db: Db,
	viewer: Viewer,
	transactionId: string,
): Promise<OwedBackRule | null> {
	const [row] = await db
		.select({ note: transactions.note, merchant: categorizations.merchant })
		.from(transactions)
		.leftJoin(categorizations, eq(categorizations.transactionId, transactions.id))
		.where(and(eq(transactions.id, transactionId), visibleTo(viewer)));
	if (!row) return null;
	const all = await loadRules(db, viewer);
	const merchant = row.merchant ?? (row.note ? merchantKey(row.note) : null);
	const keys = [...(merchant ? [merchant] : []), ...(row.note ? ruleKeys({ note: row.note }) : [])];
	const rule = keys.map((key) => matchingRule(all, key)).find((found) => found);
	if (!rule) return null;
	const [kept] = await db
		.select({
			who: rules.owedBackWho,
			memberId: rules.owedBackMemberId,
			percent: rules.owedBackPercent,
		})
		.from(rules)
		.where(and(eq(rules.id, rule.id), eq(rules.householdId, viewer.householdId)));
	return {
		ruleId: rule.id,
		pattern: rule.pattern,
		remembered:
			kept?.who && kept.percent
				? { who: kept.who, memberId: kept.memberId, percent: kept.percent }
				: null,
	};
}

/**
 * The Rule a purchase goes by remembers what was said on it: who pays it back, and the part of the
 * purchase that is. Only for Owed back said on a whole purchase. Saying it again replaces what the
 * Rule remembered.
 */
export async function rememberOwedBack(
	db: Db,
	viewer: Viewer,
	input: { owedBackId: string },
): Promise<{ ok: true; rule: OwedBackRule } | { ok: false }> {
	const [item] = await loadOwedBack(db, viewer, { id: input.owedBackId });
	if (!item || item.splitId) return { ok: false };
	const rule = await owedBackRuleFor(db, viewer, item.transactionId);
	if (!rule) return { ok: false };
	const remembered = {
		who: item.who,
		memberId: item.memberId,
		percent: owedBackPercent(item.owed, item.purchaseAmount),
	};
	await db
		.update(rules)
		.set({
			owedBackWho: remembered.who,
			owedBackMemberId: remembered.memberId,
			owedBackPercent: remembered.percent,
		})
		.where(and(eq(rules.id, rule.ruleId), eq(rules.householdId, viewer.householdId)));
	return { ok: true, rule: { ...rule, remembered } };
}

/** A Rule stops remembering Owed back. What it already said on purchases stays. */
export async function forgetOwedBack(db: Db, viewer: Viewer, ruleId: string): Promise<void> {
	if (!(await loadRules(db, viewer)).some((rule) => rule.id === ruleId)) return;
	await db
		.update(rules)
		.set({ owedBackWho: null, owedBackMemberId: null, owedBackPercent: null })
		.where(and(eq(rules.id, ruleId), eq(rules.householdId, viewer.householdId)));
}

/**
 * Says Owed back on the purchases these Rules just filed, for each Rule that remembers it: the
 * Rule's person, and its part of the purchase. Only on a purchase that sits where its Rule files
 * (so it was filed, not sent to Review), isn't split, and has no Owed back said on it. One
 * statement with one JSON parameter, whatever the number of purchases.
 */
export async function applyOwedBackRules(
	db: Db,
	viewer: Viewer,
	filed: readonly { transactionId: string; ruleId?: string | undefined }[],
): Promise<void> {
	const byRule = filed
		.filter((one) => one.ruleId)
		.map((one) => ({ id: one.transactionId, rule: one.ruleId }));
	if (byRule.length === 0) return;
	const { householdId } = viewer;
	// The ID is 26 characters of 0-9 and A-F: it reads as a ULID wherever one is asked for.
	await db.run(sql`insert into owed_back
		(id, household_id, transaction_id, split_id, who, member_id, amount_cents, created_by_member_id)
		select upper(substr(hex(randomblob(16)), 1, 26)), ${householdId}, t.id, null, r.owed_back_who,
			r.owed_back_member_id,
			max(1, cast(round(t.amount_cents * r.owed_back_percent / 100.0) as integer)),
			${viewer.memberId}
		from json_each(${JSON.stringify(byRule)}) d
		join transactions t on t.id = json_extract(d.value, '$.id') and t.household_id = ${householdId}
		join rules r on r.id = json_extract(d.value, '$.rule') and r.household_id = ${householdId}
		where r.owed_back_who is not null and r.owed_back_percent is not null
			and t.amount_cents > 0
			and ((r.bucket_id is not null and t.bucket_id = r.bucket_id)
				or (r.commitment_id is not null and t.commitment_id = r.commitment_id))
			and not exists (select 1 from splits s where s.transaction_id = t.id)
			and not exists (select 1 from owed_back o where o.transaction_id = t.id)`);
}
