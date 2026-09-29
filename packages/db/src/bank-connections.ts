import type { AccountKind, BankAccount, Cents } from "@noodle/domain";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "./index";
import { accountBalances, accounts, bankConnections } from "./schema";

// Bank Connections: a Household's authorized links to its financial institutions (through Plaid
// or SimpleFIN). Connecting one creates its Accounts, each with the balance the institution reports, in
// one atomic batch; its Imports are then read by the Import Workflow, which keeps the provider's
// cursor here so each read picks up where the last left off. The credential stays in the Worker:
// nothing here that a screen reads includes it.

export type BankProvider = (typeof bankConnections.$inferSelect)["provider"];
export type BankConnectionStatus = (typeof bankConnections.$inferSelect)["status"];

/** A Bank Connection as the Household's screens show it. */
export type BankConnectionSummary = {
	id: string;
	provider: BankProvider;
	institution: string | null;
	status: BankConnectionStatus;
	lastImportedAt: Date | null;
	/** What the provider last asked the Parent to read about the link, as plain text. */
	notice: string | null;
	accounts: { id: string; name: string; kind: AccountKind }[];
};

/** A Bank Connection as the Import Workflow reads it: with its credential, still encrypted. */
export type BankConnectionToImport = {
	id: string;
	householdId: string;
	provider: BankProvider;
	credential: string;
	cursor: string | null;
	/** The Parent who connected it: Imports are theirs, as a statement's is its uploader's. */
	createdByMemberId: string;
	/** Its Accounts, by the provider's ID for each. */
	accounts: { id: string; externalId: string }[];
};

export type AddBankConnectionResult =
	| { ok: true; accounts: number }
	/** The same link at the institution is already one of the Household's Bank Connections. */
	| { ok: false; reason: "connected-already" };

/**
 * Records a Bank Connection and creates an Account for each of its accounts the app tracks, with
 * the balance the institution reports (what's owed, for a card or loan). Idempotent per
 * `connectionId`; each Account and balance is written only if the connection is.
 */
export async function addBankConnection(
	db: Db,
	input: {
		householdId: string;
		connectionId: string;
		provider: BankProvider;
		externalId: string;
		institution: string | null;
		credential: string;
		createdByMemberId: string;
		accounts: {
			accountId: string;
			balanceId: string;
			account: BankAccount & { kind: AccountKind };
		}[];
	},
): Promise<AddBankConnectionResult> {
	const { householdId, connectionId } = input;
	const theConnection = and(
		eq(bankConnections.id, connectionId),
		eq(bankConnections.householdId, householdId),
	);
	const writes = input.accounts.flatMap(({ accountId, balanceId, account }) => {
		const insertAccount = db
			.insert(accounts)
			.select(
				db
					.select({
						// Selected in the table's column order: insert … select is positional.
						id: sql<string>`${accountId}`.as("id"),
						householdId: bankConnections.householdId,
						name: sql<string>`${account.name}`.as("name"),
						kind: sql<AccountKind>`${account.kind}`.as("kind"),
						createdAt: sql<Date>`(unixepoch() * 1000)`.as("created_at"),
						bankConnectionId: bankConnections.id,
						externalId: sql<string>`${account.externalId}`.as("external_id"),
					})
					.from(bankConnections)
					.where(theConnection),
			)
			.onConflictDoNothing();
		if (account.balance === null) return [insertAccount];
		return [insertAccount, insertBalance(db, input, accountId, balanceId, account.balance)];
	});
	await db.batch([
		db
			.insert(bankConnections)
			.values({
				id: connectionId,
				householdId,
				provider: input.provider,
				externalId: input.externalId,
				institution: input.institution,
				credential: input.credential,
				createdByMemberId: input.createdByMemberId,
			})
			// Its ID, or the same link already connected.
			.onConflictDoNothing(),
		...writes,
	]);
	const [written] = await db
		.select({ id: bankConnections.id })
		.from(bankConnections)
		.where(theConnection);
	if (!written) return { ok: false, reason: "connected-already" };
	const [{ count } = { count: 0 }] = await db
		.select({ count: sql<number>`count(*)` })
		.from(accounts)
		.where(and(eq(accounts.bankConnectionId, connectionId), eq(accounts.householdId, householdId)));
	return { ok: true, accounts: count };
}

/** A new Account's first balance, as its Bank Connection reported it; only for that Account. */
const insertBalance = (
	db: Db,
	input: { householdId: string; connectionId: string; createdByMemberId: string },
	accountId: string,
	balanceId: string,
	amountCents: Cents,
) =>
	db
		.insert(accountBalances)
		.select(
			db
				.select({
					id: sql<string>`${balanceId}`.as("id"),
					householdId: accounts.householdId,
					accountId: accounts.id,
					amountCents: sql<number>`${amountCents}`.as("amount_cents"),
					createdByMemberId: sql<string>`${input.createdByMemberId}`.as("created_by_member_id"),
					createdAt: sql<Date>`(unixepoch() * 1000)`.as("created_at"),
				})
				.from(accounts)
				.where(
					and(
						eq(accounts.id, accountId),
						eq(accounts.householdId, input.householdId),
						eq(accounts.bankConnectionId, input.connectionId),
					),
				),
		)
		.onConflictDoNothing();

/** The Household's Bank Connections, oldest first, with their Accounts. */
export async function loadBankConnections(
	db: Db,
	householdId: string,
): Promise<BankConnectionSummary[]> {
	const [rows, accountRows] = await db.batch([
		db
			.select({
				id: bankConnections.id,
				provider: bankConnections.provider,
				institution: bankConnections.institution,
				status: bankConnections.status,
				lastImportedAt: bankConnections.lastImportedAt,
				notice: bankConnections.notice,
			})
			.from(bankConnections)
			.where(eq(bankConnections.householdId, householdId))
			.orderBy(asc(bankConnections.createdAt), asc(bankConnections.id)),
		db
			.select({
				id: accounts.id,
				name: accounts.name,
				kind: accounts.kind,
				bankConnectionId: accounts.bankConnectionId,
			})
			.from(accounts)
			.where(eq(accounts.householdId, householdId))
			.orderBy(asc(accounts.createdAt), asc(accounts.id)),
	]);
	return rows.map((row) => ({
		...row,
		accounts: accountRows
			.filter((account) => account.bankConnectionId === row.id)
			.map(({ id, name, kind }) => ({ id, name, kind })),
	}));
}

/** One of the Household's Bank Connections, for the Import Workflow; null once it's gone. */
export async function loadBankConnectionToImport(
	db: Db,
	householdId: string,
	connectionId: string,
): Promise<BankConnectionToImport | null> {
	const [rows, accountRows] = await db.batch([
		db
			.select({
				id: bankConnections.id,
				householdId: bankConnections.householdId,
				provider: bankConnections.provider,
				credential: bankConnections.credential,
				cursor: bankConnections.cursor,
				createdByMemberId: bankConnections.createdByMemberId,
			})
			.from(bankConnections)
			.where(
				and(eq(bankConnections.id, connectionId), eq(bankConnections.householdId, householdId)),
			),
		db
			.select({ id: accounts.id, externalId: accounts.externalId })
			.from(accounts)
			.where(
				and(eq(accounts.bankConnectionId, connectionId), eq(accounts.householdId, householdId)),
			),
	]);
	const [row] = rows;
	if (!row) return null;
	return {
		...row,
		accounts: accountRows.flatMap(({ id, externalId }) => (externalId ? [{ id, externalId }] : [])),
	};
}

/**
 * Moves a Bank Connection's cursor on, from where this read began, and records how it stands and
 * what the provider said with the read. False when another read moved it first: that read's lines are in too (each only once), so this
 * one's cursor is simply dropped.
 */
export async function saveBankImport(
	db: Db,
	input: {
		householdId: string;
		connectionId: string;
		from: string | null;
		to: string | null;
		status: BankConnectionStatus;
		notice: string | null;
	},
): Promise<boolean> {
	const written = await db
		.update(bankConnections)
		.set({
			cursor: input.to,
			status: input.status,
			notice: input.notice,
			lastImportedAt: sql`(unixepoch() * 1000)`,
		})
		.where(
			and(
				eq(bankConnections.id, input.connectionId),
				eq(bankConnections.householdId, input.householdId),
				input.from === null
					? isNull(bankConnections.cursor)
					: eq(bankConnections.cursor, input.from),
			),
		)
		.returning({ id: bankConnections.id });
	return written.length > 0;
}

/** Records what the provider said when it refused a read, for the Parent to see. */
export async function saveBankNotice(
	db: Db,
	householdId: string,
	connectionId: string,
	notice: string,
): Promise<void> {
	await db
		.update(bankConnections)
		.set({ notice })
		.where(and(eq(bankConnections.id, connectionId), eq(bankConnections.householdId, householdId)));
}

/** Records that a Bank Connection's Import gave up; the next read tries again. */
export async function markBankImportFailed(
	db: Db,
	householdId: string,
	connectionId: string,
): Promise<void> {
	await db
		.update(bankConnections)
		.set({ status: "failed" })
		.where(and(eq(bankConnections.id, connectionId), eq(bankConnections.householdId, householdId)));
}
