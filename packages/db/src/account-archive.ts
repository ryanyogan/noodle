import { type AccountKind, type DayKey, endedOrPaidOff } from "@noodle/domain";
import { and, asc, eq, gt, isNotNull, isNull, notInArray, or, type SQL, sql } from "drizzle-orm";
import { commitmentEnd } from "./commitments";
import type { Db } from "./index";
import { paidOffDays, paidOffQueries } from "./loan-paid-off";
import { accountArchivedEvent, accountRestoredEvent } from "./log-events";
import { accounts, commitments, goals } from "./schema";

// Archiving an Account (ADR-0046): a Parent puts an Account they no longer use out of the way.
// It leaves the Accounts list, the pickers and the totals, and nothing new is brought into it;
// its Transactions, statements, balances and history stay exactly as they are, so past months
// read as they did. Restore brings it back. An Account a Goal that isn't archived is kept in
// can't be archived: the Goal's money would be in an Account no screen shows. Nor can one a
// Commitment still in the Plan pays down (ADR-0050): its payments would bring down what's owed on
// a card or loan no screen shows. A loan that is paid off is the exception (issue 153): its
// Commitment is no longer planned from the month after, so archiving it ends that Commitment from
// that month, in the same batch, once the Parent has been told so. An Account still
// syncing with its bank is unlinked first (the web's unlinkBankAccount), so what the bank sends
// while it's archived is never half-read.

const ownAccount = (householdId: string, accountId: string) =>
	and(eq(accounts.id, accountId), eq(accounts.householdId, householdId));

/** The Goals that aren't archived and are kept in (or pay off) this Account. */
const goalsOn = (db: Db, accountId: string) =>
	db
		.select({ id: goals.id })
		.from(goals)
		.where(and(eq(goals.accountId, accountId), isNull(goals.archivedAt)));

/** A Commitment still in the Plan in `month` that pays this Account down (ADR-0050). */
const paysItDown = (accountId: string, month: string) =>
	and(
		eq(commitments.accountId, accountId),
		or(isNull(commitments.endedFromMonth), gt(commitments.endedFromMonth, month)),
	);

/** The month archiving judges "still in the Plan" by: the UTC one, close enough for a guard. */
const monthOf = (now: Date) => now.toISOString().slice(0, 7);

/** An Account as archiving and unlinking read it. */
export type AccountToArchive = {
	id: string;
	name: string;
	archived: boolean;
	/** The Bank Connection it syncs with; null when it's kept by hand. */
	bankConnectionId: string | null;
	/** How many other Accounts in use sync with that same Bank Connection. */
	siblings: number;
	/** The names of the Goals, not archived, that are kept in it or pay it off. */
	goals: string[];
	/** The names of the Commitments still in the Plan that pay it down, and so hold it. */
	commitments: string[];
	/** The day it was paid off, for a loan a Commitment pays down that owes nothing; else null. */
	paidOffOn: DayKey | null;
	/**
	 * The Commitments archiving it would end, from the month after it was paid off: the ones a
	 * paid-off loan would otherwise be held by. Empty for any other Account.
	 */
	ends: { id: string; name: string }[];
};

/** One of the Household's Accounts, for archiving or unlinking it; null when it isn't theirs. */
export async function loadAccountToArchive(
	db: Db,
	householdId: string,
	accountId: string,
	now: Date = new Date(),
): Promise<AccountToArchive | null> {
	const [rows, goalRows, commitmentRows] = await db.batch([
		db
			.select({
				id: accounts.id,
				name: accounts.name,
				archivedAt: accounts.archivedAt,
				kind: accounts.kind,
				bankConnectionId: accounts.bankConnectionId,
				// Spelled out: inside a select's fields Drizzle leaves column names unqualified.
				siblings: sql<number>`(select count(*) from accounts s
					where s.bank_connection_id = "accounts"."bank_connection_id"
					and s.household_id = "accounts"."household_id" and s.id <> "accounts"."id")`,
			})
			.from(accounts)
			.where(ownAccount(householdId, accountId)),
		db
			.select({ name: goals.name })
			.from(goals)
			.where(
				and(
					eq(goals.householdId, householdId),
					eq(goals.accountId, accountId),
					isNull(goals.archivedAt),
				),
			)
			.orderBy(asc(goals.createdAt), asc(goals.id)),
		db
			.select({ id: commitments.id, name: commitments.name })
			.from(commitments)
			.where(and(eq(commitments.householdId, householdId), paysItDown(accountId, monthOf(now))))
			.orderBy(asc(commitments.createdAt), asc(commitments.id)),
	]);
	const [row] = rows;
	if (!row) return null;
	// Paid off is worked out on read (ADR-0050), and only asked when it would change the answer.
	const paidOffOn =
		row.kind === "loan" && commitmentRows.length > 0
			? (paidOffDays(...(await db.batch(paidOffQueries(db, householdId)))).get(accountId) ?? null)
			: null;
	return {
		id: row.id,
		name: row.name,
		archived: row.archivedAt !== null,
		bankConnectionId: row.bankConnectionId,
		siblings: row.bankConnectionId === null ? 0 : Number(row.siblings),
		goals: goalRows.map((goal) => goal.name),
		commitments: paidOffOn ? [] : commitmentRows.map((commitment) => commitment.name),
		paidOffOn,
		ends: paidOffOn ? commitmentRows : [],
	};
}

export type ArchiveAccountResult =
	/** `ended`: the Commitments of a paid-off loan that were ended with it, when any were. */
	| { ok: true; ended?: string[] }
	/**
	 * "goals": a Goal that isn't archived is kept in it (named in `goals`). "connected": it still
	 * syncs with its bank, and is unlinked first. "not-found": not the Household's, or archived
	 * already.
	 */
	| { ok: false; reason: "not-found" | "connected" }
	| { ok: false; reason: "goals"; goals: string[] }
	/** A Commitment still in the Plan pays it down (named in `commitments`): ADR-0050. */
	| { ok: false; reason: "commitments"; commitments: string[] };

/**
 * Archives one of the Household's Accounts, under one guarded write: only while it isn't
 * archived, doesn't sync with a bank, no Goal that isn't archived is kept in it, and no
 * Commitment still in the Plan pays it down.
 *
 * `endPaidOff`: the Parent (`memberId`) was told that archiving a paid-off loan ends its
 * Commitment. Then each Commitment that pays it down is ended from the month after it was paid
 * off, as a Plan change of its own, in the batch that archives it and only if that did. The Plan
 * already read them as ended from that month, so no month that has ended changes. A loan that
 * still owes is refused as ever, and so is a paid-off one without `endPaidOff`.
 */
export async function archiveAccount(
	db: Db,
	input: {
		householdId: string;
		accountId: string;
		now?: Date;
		memberId?: string;
		endPaidOff?: boolean;
	},
): Promise<ArchiveAccountResult> {
	const now = input.now ?? new Date();
	const { memberId } = input;
	const before =
		input.endPaidOff && memberId
			? await loadAccountToArchive(db, input.householdId, input.accountId, now)
			: null;
	const endMonth = before?.paidOffOn ? endedOrPaidOff(null, before.paidOffOn) : null;
	const ends = endMonth && before ? before.ends : [];
	// Only once this batch has archived it, so a refused archive ends nothing.
	const archivedNow = sql`exists (select 1 from ${accounts} where ${and(
		ownAccount(input.householdId, input.accountId),
		eq(accounts.archivedAt, now),
	)})` as SQL;
	const [written] = await db.batch([
		db
			.update(accounts)
			.set({ archivedAt: now })
			.where(
				and(
					ownAccount(input.householdId, input.accountId),
					isNull(accounts.archivedAt),
					isNull(accounts.bankConnectionId),
					sql`not exists ${goalsOn(db, input.accountId)}`,
					sql`not exists ${db
						.select({ id: commitments.id })
						.from(commitments)
						.where(
							and(
								paysItDown(input.accountId, monthOf(now)),
								// The ones ended below, in this batch, don't hold it.
								ends.length > 0
									? notInArray(
											commitments.id,
											ends.map((c) => c.id),
										)
									: undefined,
							),
						)}`,
				),
			)
			.returning({ id: accounts.id }),
		accountArchivedEvent(db, { ...input, now }),
		...ends.flatMap((commitment) =>
			memberId && endMonth
				? commitmentEnd(
						db,
						{
							householdId: input.householdId,
							memberId,
							commitmentId: commitment.id,
							month: endMonth,
						},
						archivedNow,
					)
				: [],
		),
	]);
	if (written.length > 0) {
		return ends.length > 0 ? { ok: true, ended: ends.map((c) => c.name) } : { ok: true };
	}
	const account = await loadAccountToArchive(db, input.householdId, input.accountId, now);
	if (!account || account.archived) return { ok: false, reason: "not-found" };
	if (account.goals.length > 0) return { ok: false, reason: "goals", goals: account.goals };
	// A paid-off loan's Commitments hold it too, until the Parent has been told they end with it.
	const holding = [...account.commitments, ...account.ends.map((c) => c.name)];
	if (holding.length > 0) return { ok: false, reason: "commitments", commitments: holding };
	return { ok: false, reason: account.bankConnectionId ? "connected" : "not-found" };
}

/**
 * Brings an archived Account back, kept by hand, and says so in the Log (`memberId`: the Parent
 * who did). False when it isn't the Household's, or isn't archived.
 */
export async function restoreAccount(
	db: Db,
	input: { householdId: string; accountId: string; memberId?: string | null; now?: Date },
): Promise<boolean> {
	const [, written] = await db.batch([
		accountRestoredEvent(db, { ...input, now: input.now ?? new Date() }),
		db
			.update(accounts)
			.set({ archivedAt: null })
			.where(and(ownAccount(input.householdId, input.accountId), isNotNull(accounts.archivedAt)))
			.returning({ id: accounts.id }),
	]);
	return written.length > 0;
}

/** An archived Account, as the Archived fold on Accounts lists it. */
export type ArchivedAccount = {
	id: string;
	name: string;
	mask: string | null;
	kind: AccountKind;
	/** When it was archived (epoch ms). */
	archivedAt: number;
};

/** The Household's archived Accounts, the latest archived first. */
export async function loadArchivedAccounts(
	db: Db,
	householdId: string,
): Promise<ArchivedAccount[]> {
	const rows = await db
		.select({
			id: accounts.id,
			name: accounts.name,
			mask: accounts.mask,
			kind: accounts.kind,
			archivedAt: accounts.archivedAt,
		})
		.from(accounts)
		.where(and(eq(accounts.householdId, householdId), isNotNull(accounts.archivedAt)))
		.orderBy(sql`${accounts.archivedAt} desc`, asc(accounts.id));
	return rows.map((row) => ({ ...row, archivedAt: row.archivedAt?.getTime() ?? 0 }));
}
