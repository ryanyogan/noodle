import { type DayKey, dayKeyAt, statementCheckDue } from "@noodle/domain";
import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import type { Db } from "./index";
import { accounts, balanceCheckAsks, households } from "./schema";

// The monthly Balance check's asking (issue 136): which statements of the Household's cards kept
// by hand are due one, whether their Nudge went out, and whether a Parent put the ask away. One
// row per card per statement, so the Nudge goes once and "Not now" holds on every device, and
// both start over when the next statement closes. Every query is scoped by household_id.

const handKept = (householdId: string) =>
	and(
		eq(accounts.householdId, householdId),
		eq(accounts.kind, "credit-card"),
		eq(accounts.purchases, "hand"),
		isNull(accounts.bankConnectionId),
		isNull(accounts.archivedAt),
	);

const askId = (accountId: string, day: DayKey) => `${accountId}:${day}`;

/** Whether an Account is one of the Household's cards kept by hand, in use. */
export async function isCardKeptByHand(
	db: Db,
	householdId: string,
	accountId: string,
): Promise<boolean> {
	const [row] = await db
		.select({ id: accounts.id })
		.from(accounts)
		.where(and(handKept(householdId), eq(accounts.id, accountId)));
	return row !== undefined;
}

/** A statement of a card kept by hand whose balance hasn't been typed yet. */
export type BalanceCheckDue = {
	accountId: string;
	name: string;
	/** The day the statement closed. */
	day: DayKey;
	/** Its Nudge went to the Parents already. */
	nudged: boolean;
	/** A Parent said "Not now" for this statement. */
	putAway: boolean;
};

/**
 * The Balance checks due in a Household on `today`: for each card kept by hand with a statement
 * day, its latest closed statement, unless a balance true on or after that day is recorded
 * (statementCheckDue).
 */
export async function loadBalanceChecksDue(
	db: Db,
	household: { id: string; timeZone: string },
	today: DayKey,
): Promise<BalanceCheckDue[]> {
	const latest = (column: string) =>
		sql.raw(`(select b.${column} from account_balances b where b.account_id = "accounts"."id"
			order by b.created_at desc, b.id desc limit 1)`);
	const cards = await db
		.select({
			id: accounts.id,
			name: accounts.name,
			statementDay: accounts.statementDay,
			balanceAsOf: sql<string | null>`${latest("as_of")}`,
			balanceAt: sql<number | null>`${latest("created_at")}`,
		})
		.from(accounts)
		.where(and(handKept(household.id), isNotNull(accounts.statementDay)))
		.orderBy(accounts.createdAt, accounts.id);
	const due = cards.flatMap((card) => {
		const lastBalanceDay =
			(card.balanceAsOf as DayKey | null) ??
			(card.balanceAt === null ? null : dayKeyAt(new Date(card.balanceAt), household.timeZone));
		const day = statementCheckDue({ statementDay: card.statementDay, today, lastBalanceDay });
		return day ? [{ accountId: card.id, name: card.name, day }] : [];
	});
	if (due.length === 0) return [];
	const asks = await db
		.select({
			id: balanceCheckAsks.id,
			nudgedAt: balanceCheckAsks.nudgedAt,
			putAwayAt: balanceCheckAsks.putAwayAt,
		})
		.from(balanceCheckAsks)
		.where(
			and(
				eq(balanceCheckAsks.householdId, household.id),
				inArray(
					balanceCheckAsks.id,
					// Well under the 100 bound parameters a query may have.
					due.slice(0, 80).map((check) => askId(check.accountId, check.day)),
				),
			),
		);
	const byId = new Map(asks.map((ask) => [ask.id, ask]));
	return due.map((check) => {
		const ask = byId.get(askId(check.accountId, check.day));
		return { ...check, nudged: ask?.nudgedAt != null, putAway: ask?.putAwayAt != null };
	});
}

/**
 * Records that these statements' Nudges are going out, and returns the ones this call took: a
 * statement already recorded as nudged (a retried or second run) isn't returned, so its Nudge
 * never goes twice.
 */
export async function markBalanceChecksNudged(
	db: Db,
	householdId: string,
	checks: readonly { accountId: string; day: DayKey }[],
	now: Date,
): Promise<{ accountId: string; day: DayKey }[]> {
	const taken: { accountId: string; day: DayKey }[] = [];
	for (const { accountId, day } of checks) {
		const rows = await db
			.insert(balanceCheckAsks)
			.values({
				id: askId(accountId, day),
				householdId,
				accountId,
				statementDay: day,
				nudgedAt: now,
			})
			.onConflictDoUpdate({
				target: balanceCheckAsks.id,
				set: { nudgedAt: now },
				setWhere: and(
					eq(balanceCheckAsks.householdId, householdId),
					isNull(balanceCheckAsks.nudgedAt),
				),
			})
			.returning({ id: balanceCheckAsks.id });
		if (rows.length > 0) taken.push({ accountId, day });
	}
	return taken;
}

/**
 * "Not now" on a statement's Balance check: it stays away for the whole Household, on every
 * device, until the card's next statement closes. Refused for anything but one of the
 * Household's cards kept by hand. Saying it twice changes nothing.
 */
export async function putAwayBalanceCheck(
	db: Db,
	input: { householdId: string; accountId: string; day: DayKey },
): Promise<{ ok: boolean }> {
	if (!(await isCardKeptByHand(db, input.householdId, input.accountId))) return { ok: false };
	await db
		.insert(balanceCheckAsks)
		.values({
			id: askId(input.accountId, input.day),
			householdId: input.householdId,
			accountId: input.accountId,
			statementDay: input.day,
			putAwayAt: sql`(unixepoch() * 1000)`,
		})
		.onConflictDoUpdate({
			target: balanceCheckAsks.id,
			set: { putAwayAt: sql`(unixepoch() * 1000)` },
			setWhere: and(
				eq(balanceCheckAsks.householdId, input.householdId),
				isNull(balanceCheckAsks.putAwayAt),
			),
		});
	return { ok: true };
}

/** The Balance checks the Household put away, each as `account:statement day`. */
export async function loadBalanceChecksPutAway(db: Db, householdId: string): Promise<string[]> {
	const rows = await db
		.select({ id: balanceCheckAsks.id })
		.from(balanceCheckAsks)
		.where(
			and(eq(balanceCheckAsks.householdId, householdId), isNotNull(balanceCheckAsks.putAwayAt)),
		);
	return rows.map((row) => row.id);
}

/** Every Household with a card kept by hand that has a statement day: the nightly run asks each. */
export async function listBalanceCheckHouseholds(
	db: Db,
): Promise<{ id: string; timeZone: string }[]> {
	return db
		.selectDistinct({ id: households.id, timeZone: households.timeZone })
		.from(households)
		.innerJoin(accounts, eq(accounts.householdId, households.id))
		.where(
			and(
				eq(accounts.kind, "credit-card"),
				eq(accounts.purchases, "hand"),
				isNull(accounts.bankConnectionId),
				isNull(accounts.archivedAt),
				isNotNull(accounts.statementDay),
			),
		);
}
