import { LOG_PAIR_DETAIL, type LogEventKind } from "@noodle/domain";
import { and, asc, eq, isNotNull, isNull, or, type SQL, sql } from "drizzle-orm";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import type { Db } from "./index";
import type { Viewer } from "./privacy";
import {
	accounts,
	bankConnections,
	buckets,
	cardPaymentRules,
	commitments,
	logEvents,
	members,
	moneyInPairs,
	moneyInRules,
	rules,
} from "./schema";

// The Log's own record (issue 141): one statement for each thing removed, to go in the same
// batch as the removal, BEFORE the row is deleted or changed. Each copies what the Log needs from
// the row as it is (its name, who made it and when), so nothing is written when the removal
// finds no row, and a repeated removal writes nothing twice.

type EventFields = {
	id: SQL;
	kind: LogEventKind;
	name: SQL;
	detail?: SQL;
	memberId: SQL;
	ownerMemberId?: SQL;
	at: SQL;
};

/** `insert into log_events select … from table where …`: the fields in the table's own order. */
function eventFrom(db: Db, table: SQLiteTable, householdId: SQL, where: SQL, e: EventFields) {
	return db
		.insert(logEvents)
		.select(
			db
				.select({
					id: e.id.as("id"),
					householdId: householdId.as("household_id"),
					kind: sql`${e.kind}`.as("kind"),
					name: e.name.as("name"),
					detail: (e.detail ?? sql`null`).as("detail"),
					memberId: e.memberId.as("member_id"),
					ownerMemberId: (e.ownerMemberId ?? sql`null`).as("owner_member_id"),
					createdAt: e.at.as("created_at"),
				})
				.from(table)
				.where(where),
		)
		.onConflictDoNothing();
}

const idOf = (id: SQL, suffix: string): SQL => sql`${id} || ${suffix}`;
const by = (memberId: string | null | undefined): SQL => sql`${memberId ?? null}`;
const at = (now: Date): SQL => sql`${now.getTime()}`;

/**
 * A Rule is about to be removed: the Rule as it was made (by whom, when, into what) and its
 * removal. `theRule` is the removal's own condition, so only a Rule the remover may see is
 * recorded; one into a Personal Allowance keeps its owner, and only they read it (ADR-0003).
 */
export function ruleRemovedEvents(db: Db, theRule: SQL, viewer: Viewer, now = new Date()) {
	const target = sql`coalesce((select ${buckets.name} from ${buckets} where ${buckets.id} = ${rules.bucketId}), (select ${commitments.name} from ${commitments} where ${commitments.id} = ${rules.commitmentId}))`;
	const shared = {
		name: sql`${rules.pattern}`,
		detail: target,
		ownerMemberId: sql`${rules.ownerMemberId}`,
	};
	const household = sql`${rules.householdId}`;
	return [
		eventFrom(db, rules, household, theRule, {
			...shared,
			id: idOf(sql`${rules.id}`, ":made"),
			kind: "rule-made",
			memberId: sql`${rules.createdByMemberId}`,
			at: sql`${rules.createdAt}`,
		}),
		eventFrom(db, rules, household, theRule, {
			...shared,
			id: idOf(sql`${rules.id}`, ":removed"),
			kind: "rule-removed",
			memberId: by(viewer.memberId),
			at: at(now),
		}),
	] as const;
}

/** A Rule for money in is about to be removed: as it was made, and its removal. */
export function moneyInRuleRemovedEvents(
	db: Db,
	householdId: string,
	ruleId: string,
	memberId?: string | null,
	now = new Date(),
) {
	const theRule = and(
		eq(moneyInRules.id, ruleId),
		eq(moneyInRules.householdId, householdId),
	) as SQL;
	const shared = {
		name: sql`${moneyInRules.pattern}`,
		detail: sql`case when ${moneyInRules.intoAccountId} is null then ${moneyInRules.kind} else ${LOG_PAIR_DETAIL} end`,
	};
	const household = sql`${moneyInRules.householdId}`;
	return [
		eventFrom(db, moneyInRules, household, theRule, {
			...shared,
			id: idOf(sql`${moneyInRules.id}`, ":made"),
			kind: "money-in-rule-made",
			memberId: sql`${moneyInRules.createdByMemberId}`,
			at: sql`${moneyInRules.createdAt}`,
		}),
		eventFrom(db, moneyInRules, household, theRule, {
			...shared,
			id: idOf(sql`${moneyInRules.id}`, ":removed"),
			kind: "money-in-rule-removed",
			memberId: by(memberId),
			at: at(now),
		}),
	] as const;
}

/**
 * Remembered pairs of Accounts are about to be removed from their own table: each as it was made,
 * and its removal. `thePairs` is the removal's own condition (one pair, or every pair a wording
 * has). They read in the Log as a money-in Rule that remembered a pair does.
 */
export function moneyInPairRemovedEvents(
	db: Db,
	thePairs: SQL,
	memberId?: string | null,
	now = new Date(),
) {
	const shared = { name: sql`${moneyInPairs.pattern}`, detail: sql`${LOG_PAIR_DETAIL}` };
	const household = sql`${moneyInPairs.householdId}`;
	return [
		eventFrom(db, moneyInPairs, household, thePairs, {
			...shared,
			id: idOf(sql`${moneyInPairs.id}`, ":made"),
			kind: "money-in-rule-made",
			memberId: sql`${moneyInPairs.createdByMemberId}`,
			at: sql`${moneyInPairs.createdAt}`,
		}),
		eventFrom(db, moneyInPairs, household, thePairs, {
			...shared,
			id: idOf(sql`${moneyInPairs.id}`, ":removed"),
			kind: "money-in-rule-removed",
			memberId: by(memberId),
			at: at(now),
		}),
	] as const;
}

/**
 * A wording is about to be stated plainly, which forgets a pair of Accounts kept the old way (on
 * the money-in Rule itself): the pair as it was made, and its going. The Rule's row stays as the
 * plain Rule, so these have IDs of their own and its later removal is still recorded.
 */
export function moneyInRulePairForgottenEvents(
	db: Db,
	householdId: string,
	pattern: string,
	memberId?: string | null,
	now = new Date(),
) {
	const thePair = and(
		eq(moneyInRules.householdId, householdId),
		eq(moneyInRules.pattern, pattern),
		isNotNull(moneyInRules.intoAccountId),
	) as SQL;
	const shared = { name: sql`${moneyInRules.pattern}`, detail: sql`${LOG_PAIR_DETAIL}` };
	const household = sql`${moneyInRules.householdId}`;
	return [
		eventFrom(db, moneyInRules, household, thePair, {
			...shared,
			id: idOf(sql`${moneyInRules.id}`, ":pair-made"),
			kind: "money-in-rule-made",
			memberId: sql`${moneyInRules.createdByMemberId}`,
			at: sql`${moneyInRules.createdAt}`,
		}),
		eventFrom(db, moneyInRules, household, thePair, {
			...shared,
			id: idOf(sql`${moneyInRules.id}`, `:pair-removed:${now.getTime()}`),
			kind: "money-in-rule-removed",
			memberId: by(memberId),
			at: at(now),
		}),
	] as const;
}

/** A card payment's wording is about to be forgotten: as it was remembered, and its removal. */
export function cardPaymentForgottenEvents(
	db: Db,
	householdId: string,
	pattern: string,
	memberId?: string | null,
	now = new Date(),
) {
	const theRule = and(
		eq(cardPaymentRules.householdId, householdId),
		eq(cardPaymentRules.pattern, pattern),
	) as SQL;
	const shared = {
		name: sql`${cardPaymentRules.pattern}`,
		detail: sql`(select ${accounts.name} from ${accounts} where ${accounts.id} = ${cardPaymentRules.accountId})`,
	};
	const household = sql`${cardPaymentRules.householdId}`;
	return [
		eventFrom(db, cardPaymentRules, household, theRule, {
			...shared,
			id: idOf(sql`${cardPaymentRules.id}`, ":made"),
			kind: "card-payment-rule-made",
			memberId: sql`${cardPaymentRules.createdByMemberId}`,
			at: sql`${cardPaymentRules.createdAt}`,
		}),
		eventFrom(db, cardPaymentRules, household, theRule, {
			...shared,
			id: idOf(sql`${cardPaymentRules.id}`, ":removed"),
			kind: "card-payment-rule-removed",
			memberId: by(memberId),
			at: at(now),
		}),
	] as const;
}

/**
 * A Bank Connection is about to be disconnected: by a Parent in Noodle ("removed") or because
 * access was taken away at the bank ("disconnected"). `theConnection` is the write's own
 * condition. Its row stays, so "Connected" needs no record of its own.
 */
export function bankConnectionEvent(
	db: Db,
	theConnection: SQL,
	kind: "bank-connection-removed" | "bank-connection-disconnected",
	memberId?: string | null,
	now = new Date(),
) {
	return eventFrom(db, bankConnections, sql`${bankConnections.householdId}`, theConnection, {
		id: idOf(sql`${bankConnections.id}`, `:${kind}:${now.getTime()}`),
		kind,
		name: sql`${bankConnections.institution}`,
		memberId: by(memberId),
		at: at(now),
	});
}

/** An Account was archived at `now` (to run AFTER the write that archives it, in its batch). */
export function accountArchivedEvent(
	db: Db,
	input: { householdId: string; accountId: string; memberId?: string | null; now: Date },
) {
	const archivedNow = and(
		eq(accounts.id, input.accountId),
		eq(accounts.householdId, input.householdId),
		eq(accounts.archivedAt, input.now),
	) as SQL;
	return eventFrom(db, accounts, sql`${accounts.householdId}`, archivedNow, {
		id: idOf(sql`${accounts.id}`, `:archived:${input.now.getTime()}`),
		kind: "account-archived",
		name: sql`${accounts.name}`,
		memberId: by(input.memberId),
		at: at(input.now),
	});
}

/** The Log's own record as `viewer` may read it: never the other Parent's private Rules. */
export const visibleLogEvent = (viewer: Viewer): SQL =>
	and(
		eq(logEvents.householdId, viewer.householdId),
		or(isNull(logEvents.ownerMemberId), eq(logEvents.ownerMemberId, viewer.memberId)),
	) as SQL;

/** One of the Log's own records, as an export lists it. */
export type LogEventRow = {
	at: number;
	memberName: string | null;
	kind: LogEventKind;
	name: string | null;
	detail: string | null;
};

/** Everything the Log keeps a record of itself, oldest first, as `viewer` may read it. */
export async function listLogEvents(db: Db, viewer: Viewer): Promise<LogEventRow[]> {
	const rows = await db
		.select({
			at: logEvents.createdAt,
			memberName: members.name,
			kind: logEvents.kind,
			name: logEvents.name,
			detail: logEvents.detail,
		})
		.from(logEvents)
		.leftJoin(members, eq(members.id, logEvents.memberId))
		.where(visibleLogEvent(viewer))
		.orderBy(asc(logEvents.createdAt), asc(logEvents.id));
	return rows.map((row) => ({ ...row, at: row.at.getTime() }));
}
