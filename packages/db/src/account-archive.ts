import type { AccountKind } from "@noodle/domain";
import { and, asc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import type { Db } from "./index";
import { accounts, goals } from "./schema";

// Archiving an Account (ADR-0046): a Parent puts an Account they no longer use out of the way.
// It leaves the Accounts list, the pickers and the totals, and nothing new is brought into it;
// its Transactions, statements, balances and history stay exactly as they are, so past months
// read as they did. Restore brings it back. An Account a Goal that isn't archived is kept in
// can't be archived: the Goal's money would be in an Account no screen shows. An Account still
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
};

/** One of the Household's Accounts, for archiving or unlinking it; null when it isn't theirs. */
export async function loadAccountToArchive(
	db: Db,
	householdId: string,
	accountId: string,
): Promise<AccountToArchive | null> {
	const [rows, goalRows] = await db.batch([
		db
			.select({
				id: accounts.id,
				name: accounts.name,
				archivedAt: accounts.archivedAt,
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
	]);
	const [row] = rows;
	if (!row) return null;
	return {
		id: row.id,
		name: row.name,
		archived: row.archivedAt !== null,
		bankConnectionId: row.bankConnectionId,
		siblings: row.bankConnectionId === null ? 0 : Number(row.siblings),
		goals: goalRows.map((goal) => goal.name),
	};
}

export type ArchiveAccountResult =
	| { ok: true }
	/**
	 * "goals": a Goal that isn't archived is kept in it (named in `goals`). "connected": it still
	 * syncs with its bank, and is unlinked first. "not-found": not the Household's, or archived
	 * already.
	 */
	| { ok: false; reason: "not-found" | "connected" }
	| { ok: false; reason: "goals"; goals: string[] };

/**
 * Archives one of the Household's Accounts, under one guarded write: only while it isn't
 * archived, doesn't sync with a bank, and no Goal that isn't archived is kept in it.
 */
export async function archiveAccount(
	db: Db,
	input: { householdId: string; accountId: string; now?: Date },
): Promise<ArchiveAccountResult> {
	const written = await db
		.update(accounts)
		.set({ archivedAt: input.now ?? new Date() })
		.where(
			and(
				ownAccount(input.householdId, input.accountId),
				isNull(accounts.archivedAt),
				isNull(accounts.bankConnectionId),
				sql`not exists ${goalsOn(db, input.accountId)}`,
			),
		)
		.returning({ id: accounts.id });
	if (written.length > 0) return { ok: true };
	const account = await loadAccountToArchive(db, input.householdId, input.accountId);
	if (!account || account.archived) return { ok: false, reason: "not-found" };
	if (account.goals.length > 0) return { ok: false, reason: "goals", goals: account.goals };
	return { ok: false, reason: account.bankConnectionId ? "connected" : "not-found" };
}

/** Brings an archived Account back, kept by hand. False when it isn't the Household's, or isn't archived. */
export async function restoreAccount(
	db: Db,
	input: { householdId: string; accountId: string },
): Promise<boolean> {
	const written = await db
		.update(accounts)
		.set({ archivedAt: null })
		.where(and(ownAccount(input.householdId, input.accountId), isNotNull(accounts.archivedAt)))
		.returning({ id: accounts.id });
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
