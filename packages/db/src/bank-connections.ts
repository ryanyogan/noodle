import {
	type AccountKind,
	accountMask,
	type BankAccount,
	type Cents,
	holdsMoney,
	type PairableAccount,
} from "@noodle/domain";
import {
	and,
	asc,
	eq,
	inArray,
	isNotNull,
	isNull,
	lt,
	ne,
	notInArray,
	or,
	type SQL,
	sql,
} from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { Db } from "./index";
import { bankConnectionEvent } from "./log-events";
import {
	accountBalances,
	accounts,
	bankConnections,
	bankLinkSessions,
	households,
	imports,
	transactions,
} from "./schema";

// Bank Connections: a Household's authorized links to its financial institutions (through
// Plaid). Connecting one records it, "choosing" until a Parent says which of the Household's
// Accounts each of its accounts is, or adds it as a new one (ADR-0020); that choice is written,
// with the balance the institution reports for each, in one atomic batch. Its Imports are then read by the Import Workflow, which keeps the provider's
// cursor here so each read picks up where the last left off, and records each Account's balance
// anew when the institution's has changed. The credential stays in the Worker: nothing here that
// a screen reads includes it.

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
	/** When the provider last sent a webhook about it. */
	lastWebhookAt: Date | null;
	/** Whether its login has an account the Parent hasn't been asked about. */
	newAccounts: boolean;
	accounts: { id: string; name: string; kind: AccountKind }[];
	/**
	 * What it has brought in so far: Transactions, how many of those are Matched to Quick Adds,
	 * and how many wait in Review.
	 */
	brought: { transactions: number; matched: number; inReview: number };
};

/** A Bank Connection as the Import Workflow reads it: with its credential, still encrypted. */
export type BankConnectionToImport = {
	id: string;
	householdId: string;
	provider: BankProvider;
	credential: string;
	cursor: string | null;
	/** The first day its Imports keep (YYYY-MM-DD); null keeps everything. */
	historyStart: string | null;
	/** The Parent who connected it: Imports are theirs, as a statement's is its uploader's. */
	createdByMemberId: string;
	status: BankConnectionStatus;
	/** Its Accounts, by the provider's ID for each. */
	accounts: { id: string; externalId: string }[];
};

export type AddBankConnectionResult =
	| { ok: true }
	/** The same link at the institution is already one of the Household's Bank Connections. */
	| { ok: false; reason: "connected-already" };

/**
 * Records a Bank Connection, "choosing" until a Parent says which Accounts its accounts are
 * (chooseBankAccounts, ADR-0020): nothing is read from it meanwhile. Idempotent per
 * `connectionId`.
 */
export async function addBankConnection(
	db: Db,
	input: {
		householdId: string;
		connectionId: string;
		provider: BankProvider;
		externalId: string;
		institution: string | null;
		/** The provider's ID for the institution, when the Parent's browser said. */
		institutionId?: string | null;
		credential: string;
		createdByMemberId: string;
		/** The first day its Imports keep (YYYY-MM-DD), as the Parent chose; none keeps everything. */
		historyStart?: string | null;
	},
): Promise<AddBankConnectionResult> {
	const { householdId, connectionId } = input;
	await db
		.insert(bankConnections)
		.values({
			id: connectionId,
			householdId,
			provider: input.provider,
			externalId: input.externalId,
			institution: input.institution,
			institutionId: input.institutionId ?? null,
			credential: input.credential,
			historyStart: input.historyStart ?? null,
			createdByMemberId: input.createdByMemberId,
			status: "choosing",
		})
		// Its ID, or the same link already connected.
		.onConflictDoNothing();
	const [written] = await db
		.select({ id: bankConnections.id })
		.from(bankConnections)
		.where(and(eq(bankConnections.id, connectionId), eq(bankConnections.householdId, householdId)));
	return written ? { ok: true } : { ok: false, reason: "connected-already" };
}

/** What a Parent chose for one of a Bank Connection's accounts (ADR-0020). */
export type BankAccountChoice = {
	/** The account as the institution reports it now. */
	account: BankAccount & { kind: AccountKind };
	/** The ID for the balance written with it. */
	balanceId: string;
	choice:
		| { kind: "pair"; accountId: string }
		| { kind: "add"; accountId: string }
		| { kind: "leave-out" };
};

export type ChooseBankAccountsResult =
	| {
			ok: true;
			/** How many Accounts the Bank Connection brings in for now. */
			accounts: number;
			/** Whether this was its first choice, so its first Import starts now. */
			first: boolean;
			/** Bank accounts whose pairing didn't take: the Account was paired meanwhile, or gone. */
			refused: string[];
	  }
	| { ok: false; reason: "not-found" };

/**
 * Pairs each of a Bank Connection's accounts with the Account a Parent chose, adds it as a new
 * Account, or leaves it out, in one batch, with the balance the institution reports. A pairing
 * only takes while the Account is of a compatible kind and paired with no Bank Connection; an
 * Account keeps its name, kind and everything on it. A Bank Connection still choosing is then
 * ready for its first Import. Bank accounts paired already are left as they are.
 */
export async function chooseBankAccounts(
	db: Db,
	input: {
		householdId: string;
		connectionId: string;
		createdByMemberId: string;
		choices: BankAccountChoice[];
	},
): Promise<ChooseBankAccountsResult> {
	const { householdId, connectionId } = input;
	const theConnection = and(
		eq(bankConnections.id, connectionId),
		eq(bankConnections.householdId, householdId),
	);
	const [connection] = await db
		.select({ status: bankConnections.status })
		.from(bankConnections)
		.where(theConnection);
	if (!connection) return { ok: false, reason: "not-found" };
	const writes: BatchItem<"sqlite">[] = [];
	for (const { account, balanceId, choice } of input.choices) {
		// A bank account paired already (by an earlier choice, or another Parent's) stays as it is.
		const notYetPaired = sql`not exists (select 1 from ${accounts} as already
			where already.bank_connection_id = ${connectionId} and already.external_id = ${account.externalId})`;
		if (choice.kind === "add") {
			writes.push(
				db
					.insert(accounts)
					.select(
						db
							.select({
								// Selected in the table's column order: insert … select is positional.
								id: sql<string>`${choice.accountId}`.as("id"),
								householdId: bankConnections.householdId,
								name: sql<string>`${account.name}`.as("name"),
								kind: sql<AccountKind>`${account.kind}`.as("kind"),
								createdAt: sql<Date>`(unixepoch() * 1000)`.as("created_at"),
								bankConnectionId: bankConnections.id,
								externalId: sql<string>`${account.externalId}`.as("external_id"),
								mask: sql<string | null>`${accountMask(account.mask)}`.as("mask"),
								archivedAt: sql<Date | null>`null`.as("archived_at"),
								// Its bank brings its purchases in: never asked, no Wallet name, no statement day.
								purchases: sql<null>`null`.as("purchases"),
								walletName: sql<string | null>`null`.as("wallet_name"),
								statementDay: sql<number | null>`null`.as("statement_day"),
							})
							.from(bankConnections)
							.where(and(theConnection, notYetPaired)),
					)
					.onConflictDoNothing(),
			);
		} else if (choice.kind === "pair") {
			const sameSide = holdsMoney(account.kind)
				? inArray(accounts.kind, ["checking", "savings"])
				: inArray(accounts.kind, ["credit-card", "loan"]);
			writes.push(
				db
					.update(accounts)
					.set({
						bankConnectionId: connectionId,
						externalId: account.externalId,
						mask: sql`coalesce(${accountMask(account.mask)}, ${accounts.mask})`,
					})
					.where(
						and(
							eq(accounts.id, choice.accountId),
							eq(accounts.householdId, householdId),
							isNull(accounts.bankConnectionId),
							// Not an archived Account: it's restored first (ADR-0046).
							isNull(accounts.archivedAt),
							sameSide,
							notYetPaired,
							sql`exists (select 1 from ${bankConnections} where ${theConnection})`,
						),
					),
			);
		} else continue;
		if (account.balance !== null) {
			writes.push(
				insertBalance(
					db,
					{ householdId, connectionId, createdByMemberId: input.createdByMemberId },
					choice.accountId,
					balanceId,
					account.balance,
					account.externalId,
				),
			);
		}
	}
	writes.push(
		db
			.update(bankConnections)
			.set({ status: "importing" })
			.where(and(theConnection, eq(bankConnections.status, "choosing"))),
	);
	await db.batch(writes as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
	const now = await db
		.select({ id: accounts.id, externalId: accounts.externalId })
		.from(accounts)
		.where(and(eq(accounts.bankConnectionId, connectionId), eq(accounts.householdId, householdId)));
	const refused = input.choices
		.filter(
			({ account, choice }) =>
				choice.kind !== "leave-out" &&
				!now.some((row) => row.id === choice.accountId && row.externalId === account.externalId),
		)
		.map(({ account }) => account.externalId);
	return { ok: true, accounts: now.length, first: connection.status === "choosing", refused };
}

/**
 * Stops bringing an Account in from its Bank Connection (ADR-0020): the Account and everything on
 * it stay, kept by hand or by statements again. False when it wasn't connected.
 */
export async function unpairAccount(
	db: Db,
	householdId: string,
	accountId: string,
): Promise<boolean> {
	const written = await db
		.update(accounts)
		.set({ bankConnectionId: null, externalId: null })
		.where(
			and(
				eq(accounts.id, accountId),
				eq(accounts.householdId, householdId),
				isNotNull(accounts.bankConnectionId),
			),
		)
		.returning({ id: accounts.id });
	return written.length > 0;
}

/** The Household's Accounts as pairing reads them, oldest first. */
export async function loadPairableAccounts(
	db: Db,
	householdId: string,
): Promise<PairableAccount[]> {
	return (
		db
			.select({
				id: accounts.id,
				name: accounts.name,
				kind: accounts.kind,
				bankConnectionId: accounts.bankConnectionId,
				externalId: accounts.externalId,
				// Spelled out: inside a select's fields Drizzle leaves column names unqualified.
				statementDigits: sql<string | null>`(select i.account_digits from imports i
				where i.account_id = "accounts"."id" and i.account_digits is not null
				order by i.created_at desc, i.id desc limit 1)`,
			})
			.from(accounts)
			// An archived Account isn't offered: restore it first to sync it again (ADR-0046).
			.where(and(eq(accounts.householdId, householdId), isNull(accounts.archivedAt)))
			.orderBy(asc(accounts.createdAt), asc(accounts.id))
	);
}

/** A chosen Account's balance, as its Bank Connection reported it; only once it's paired with it. */
const insertBalance = (
	db: Db,
	input: { householdId: string; connectionId: string; createdByMemberId: string },
	accountId: string,
	balanceId: string,
	amountCents: Cents,
	externalId: string,
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
					// To the millisecond, as a Parent's balances are: it's newer than one entered a moment ago.
					createdAt: sql<Date>`${Date.now()}`.as("created_at"),
					// Last, as the table has it. A bank's balance has no day of its own (issue 93).
					asOf: sql<string | null>`null`.as("as_of"),
				})
				.from(accounts)
				.where(
					and(
						eq(accounts.id, accountId),
						eq(accounts.householdId, input.householdId),
						eq(accounts.bankConnectionId, input.connectionId),
						eq(accounts.externalId, externalId),
					),
				),
		)
		.onConflictDoNothing();

/** The Household's Bank Connections, oldest first, with their Accounts. */
export async function loadBankConnections(
	db: Db,
	householdId: string,
): Promise<BankConnectionSummary[]> {
	const [rows, accountRows, broughtRows] = await db.batch([
		db
			.select({
				id: bankConnections.id,
				provider: bankConnections.provider,
				institution: bankConnections.institution,
				status: bankConnections.status,
				lastImportedAt: bankConnections.lastImportedAt,
				notice: bankConnections.notice,
				lastWebhookAt: bankConnections.lastWebhookAt,
				newAccounts: bankConnections.newAccounts,
			})
			.from(bankConnections)
			// Not one a Parent disconnected: its Accounts are kept by hand now, and it has no more to show.
			.where(
				and(
					eq(bankConnections.householdId, householdId),
					ne(bankConnections.credential, REMOVED_CREDENTIAL),
				),
			)
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
		// Spelled out: inside a select's fields Drizzle leaves column names unqualified.
		db
			.select({
				connectionId: imports.bankConnectionId,
				transactions: sql<number>`count(*)`,
				matched: sql<number>`coalesce(sum(exists (select 1 from matches m
					where m.imported_id = "transactions"."id" and m.removed_at is null)), 0)`,
				inReview: sql<number>`coalesce(sum("transactions"."bucket_id" is null
					and "transactions"."commitment_id" is null and "transactions"."goal_id" is null
					and exists (select 1 from categorizations c where c.transaction_id = "transactions"."id"
						and c.outcome = 'review')
					and not exists (select 1 from matches m where m.imported_id = "transactions"."id"
						and m.removed_at is null)), 0)`,
			})
			.from(imports)
			.innerJoin(transactions, eq(transactions.importId, imports.id))
			.where(and(eq(imports.householdId, householdId), isNotNull(imports.bankConnectionId)))
			.groupBy(imports.bankConnectionId),
	]);
	return rows.map((row) => {
		const brought = broughtRows.find((b) => b.connectionId === row.id);
		return {
			...row,
			accounts: accountRows
				.filter((account) => account.bankConnectionId === row.id)
				.map(({ id, name, kind }) => ({ id, name, kind })),
			brought: {
				transactions: Number(brought?.transactions ?? 0),
				matched: Number(brought?.matched ?? 0),
				inReview: Number(brought?.inReview ?? 0),
			},
		};
	});
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
				historyStart: bankConnections.historyStart,
				createdByMemberId: bankConnections.createdByMemberId,
				status: bankConnections.status,
			})
			.from(bankConnections)
			.where(
				and(eq(bankConnections.id, connectionId), eq(bankConnections.householdId, householdId)),
			),
		db
			.select({ id: accounts.id, externalId: accounts.externalId })
			.from(accounts)
			.where(
				and(
					eq(accounts.bankConnectionId, connectionId),
					eq(accounts.householdId, householdId),
					// Nothing is read for an archived Account (ADR-0046).
					isNull(accounts.archivedAt),
				),
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

/**
 * Records each Account's balance as its Bank Connection now reports it, only where that differs
 * from the latest one (or there's none yet), and only for the Bank Connection's own Accounts. A
 * balance from the bank is no one's: it has no creator.
 */
export async function refreshBankBalances(
	db: Db,
	input: {
		householdId: string;
		connectionId: string;
		balances: { accountId: string; balanceId: string; amountCents: Cents }[];
	},
): Promise<void> {
	const writes: BatchItem<"sqlite">[] = input.balances.map(
		({ accountId, balanceId, amountCents }) =>
			db
				.insert(accountBalances)
				.select(
					db
						.select({
							id: sql<string>`${balanceId}`.as("id"),
							householdId: accounts.householdId,
							accountId: accounts.id,
							amountCents: sql<number>`${amountCents}`.as("amount_cents"),
							createdByMemberId: sql<string | null>`null`.as("created_by_member_id"),
							createdAt: sql<Date>`${Date.now()}`.as("created_at"),
							// Last, as the table has it. A bank's balance has no day of its own (issue 93).
							asOf: sql<string | null>`null`.as("as_of"),
						})
						.from(accounts)
						.where(
							and(
								eq(accounts.id, accountId),
								eq(accounts.householdId, input.householdId),
								eq(accounts.bankConnectionId, input.connectionId),
								isNull(accounts.archivedAt),
								// The latest balance, if any, isn't this one already.
								sql`(select ${accountBalances.amountCents} from ${accountBalances}
								where ${accountBalances.accountId} = ${accounts.id}
								order by ${accountBalances.createdAt} desc, ${accountBalances.id} desc
								limit 1) is not ${amountCents}`,
							),
						),
				)
				.onConflictDoNothing(),
	);
	if (writes.length === 0) return;
	await db.batch(writes as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
}

/** A Bank Connection to sync, with its Household's time zone. */
export type BankConnectionToSync = {
	householdId: string;
	connectionId: string;
	timeZone: string;
	status: BankConnectionStatus;
};

const toSync = {
	householdId: bankConnections.householdId,
	connectionId: bankConnections.id,
	timeZone: households.timeZone,
	status: bankConnections.status,
};

/**
 * Every Household's Bank Connections the daily sync reads: not those waiting on a reconnect, or
 * on a Parent choosing their Accounts.
 */
export async function loadBankConnectionsToSync(db: Db): Promise<BankConnectionToSync[]> {
	return db
		.select(toSync)
		.from(bankConnections)
		.innerJoin(households, eq(households.id, bankConnections.householdId))
		.where(notInArray(bankConnections.status, ["reconnect", "choosing", "disconnected"]))
		.orderBy(asc(bankConnections.createdAt), asc(bankConnections.id));
}

/** The Bank Connections for a provider's link (a Plaid Item), as its webhooks name it. */
export async function findBankConnectionsByExternal(
	db: Db,
	provider: BankProvider,
	externalId: string,
): Promise<BankConnectionToSync[]> {
	return db
		.select(toSync)
		.from(bankConnections)
		.innerJoin(households, eq(households.id, bankConnections.householdId))
		.where(and(eq(bankConnections.provider, provider), eq(bankConnections.externalId, externalId)));
}

/**
 * Records that a Bank Connection's credential no longer works: the institution wants the Parent
 * to log in again. Syncs skip it until they do. False when it's gone, or waiting already.
 */
export async function markBankConnectionReconnect(
	db: Db,
	householdId: string,
	connectionId: string,
): Promise<boolean> {
	const written = await db
		.update(bankConnections)
		.set({ status: "reconnect" })
		.where(
			and(
				eq(bankConnections.id, connectionId),
				eq(bankConnections.householdId, householdId),
				// One still choosing hasn't read anything yet: its choice comes first.
				notInArray(bankConnections.status, ["reconnect", "choosing", "disconnected"]),
			),
		)
		.returning({ id: bankConnections.id });
	return written.length > 0;
}

/** Records that a Parent logged in again: a Bank Connection waiting on it is ready to sync. */
export async function markBankConnectionReconnected(
	db: Db,
	householdId: string,
	connectionId: string,
): Promise<boolean> {
	const written = await db
		.update(bankConnections)
		.set({ status: "ready" })
		.where(
			and(
				eq(bankConnections.id, connectionId),
				eq(bankConnections.householdId, householdId),
				eq(bankConnections.status, "reconnect"),
			),
		)
		.returning({ id: bankConnections.id });
	return written.length > 0;
}

/** A Bank Connection as the duplicate check reads it: which institution, and how to list its accounts. */
export type BankConnectionToCompare = {
	id: string;
	provider: BankProvider;
	institution: string | null;
	institutionId: string | null;
	credential: string;
};

/** The Household's Bank Connections, to tell whether a bank a Parent just linked is one of them. */
export async function loadBankConnectionsToCompare(
	db: Db,
	householdId: string,
): Promise<BankConnectionToCompare[]> {
	return (
		db
			.select({
				id: bankConnections.id,
				provider: bankConnections.provider,
				institution: bankConnections.institution,
				institutionId: bankConnections.institutionId,
				credential: bankConnections.credential,
			})
			.from(bankConnections)
			// Not a disconnected one: its link is dead, so there's nothing to reconnect.
			.where(
				and(
					eq(bankConnections.householdId, householdId),
					ne(bankConnections.status, "disconnected"),
				),
			)
			.orderBy(asc(bankConnections.createdAt), asc(bankConnections.id))
	);
}

/** A Parent's Plaid Link in progress: its link token, and the page to go back to. */
export type BankLinkSession = {
	linkToken: string;
	returnTo: string;
	/** The Bank Connection being logged in to again; null when it's a new one. */
	connectionId: string | null;
	/** For a new one, the first day its Imports will keep, as the Parent chose before Link opened. */
	historyStart?: string | null;
};

/** Plaid's link tokens last 4 hours, and 30 minutes in update mode. */
const LINK_TOKEN_MS = 4 * 60 * 60 * 1000;
const UPDATE_LINK_TOKEN_MS = 30 * 60 * 1000;

/** Keeps the Parent's Link in progress, in place of any earlier one of theirs. */
export async function saveBankLinkSession(
	db: Db,
	input: BankLinkSession & { householdId: string; memberId: string; now: Date },
): Promise<void> {
	const values = {
		householdId: input.householdId,
		linkToken: input.linkToken,
		returnTo: input.returnTo,
		connectionId: input.connectionId,
		historyStart: input.historyStart ?? null,
		createdAt: input.now,
	};
	await db
		.insert(bankLinkSessions)
		.values({ memberId: input.memberId, ...values })
		.onConflictDoUpdate({ target: bankLinkSessions.memberId, set: values });
}

/** The Parent's Link in progress; null when there's none, or its link token has expired. */
export async function loadBankLinkSession(
	db: Db,
	householdId: string,
	memberId: string,
	now: Date,
): Promise<BankLinkSession | null> {
	const [row] = await db
		.select()
		.from(bankLinkSessions)
		.where(
			and(eq(bankLinkSessions.memberId, memberId), eq(bankLinkSessions.householdId, householdId)),
		);
	if (!row) return null;
	const age = now.getTime() - row.createdAt.getTime();
	if (age > (row.connectionId ? UPDATE_LINK_TOKEN_MS : LINK_TOKEN_MS)) return null;
	return {
		linkToken: row.linkToken,
		returnTo: row.returnTo,
		connectionId: row.connectionId,
		historyStart: row.historyStart,
	};
}

/** Forgets the Parent's Link in progress, once it's finished. */
export async function clearBankLinkSession(db: Db, memberId: string): Promise<void> {
	await db.delete(bankLinkSessions).where(eq(bankLinkSessions.memberId, memberId));
}

/**
 * Records that a Parent took the app's access away at the institution: the link is dead, and
 * only a new one brings the bank back. Its Accounts and Transactions stay. False when it's gone,
 * or marked already.
 */
export async function markBankConnectionDisconnected(
	db: Db,
	householdId: string,
	connectionId: string,
): Promise<boolean> {
	const theConnection = and(
		eq(bankConnections.id, connectionId),
		eq(bankConnections.householdId, householdId),
		ne(bankConnections.status, "disconnected"),
	) as SQL;
	const [, written] = await db.batch([
		bankConnectionEvent(db, theConnection, "bank-connection-disconnected"),
		db
			.update(bankConnections)
			.set({ status: "disconnected", notice: null, newAccounts: false })
			.where(theConnection)
			.returning({ id: bankConnections.id }),
	]);
	return written.length > 0;
}

/**
 * What a Bank Connection a Parent disconnected keeps as its credential: nothing. The access token
 * is deleted, not kept sealed.
 */
export const REMOVED_CREDENTIAL = "";

/**
 * A Parent disconnected a Bank Connection (#61), after the provider was told to remove the link:
 * its access token is deleted, it's marked disconnected (so the Import Workflow, the daily sync
 * and webhooks all skip it), and its Accounts are unpaired, ADR-0020's pairing in reverse. Each
 * Account and everything on it stays, kept by hand or by statements again, and can be paired
 * again when the bank is connected anew. The provider's ID for the link is set aside too: a link
 * once removed is never used again, so a webhook naming it finds nothing, and connecting the same
 * bank later is a new Bank Connection. The row itself stays, for the Imports that name it, but
 * isn't shown. False when it's gone or disconnected by a Parent already.
 */
export async function removeBankConnection(
	db: Db,
	householdId: string,
	connectionId: string,
	memberId?: string,
): Promise<boolean> {
	const theConnection = and(
		eq(bankConnections.id, connectionId),
		eq(bankConnections.householdId, householdId),
		ne(bankConnections.credential, REMOVED_CREDENTIAL),
	) as SQL;
	const [found] = await db
		.select({ id: bankConnections.id })
		.from(bankConnections)
		.where(theConnection);
	if (!found) return false;
	await db.batch([
		bankConnectionEvent(db, theConnection, "bank-connection-removed", memberId),
		db
			.update(accounts)
			.set({ bankConnectionId: null, externalId: null })
			.where(
				and(eq(accounts.householdId, householdId), eq(accounts.bankConnectionId, connectionId)),
			),
		db
			.update(bankConnections)
			.set({
				status: "disconnected",
				credential: REMOVED_CREDENTIAL,
				externalId: `removed:${connectionId}`,
				cursor: null,
				notice: null,
				newAccounts: false,
				syncStartedAt: null,
				syncPending: false,
			})
			.where(theConnection),
	]);
	return true;
}

/**
 * Records whether a Bank Connection's login has an account its Parent hasn't been asked about.
 * False when it's gone, disconnected, or says so already.
 */
export async function markBankNewAccounts(
	db: Db,
	householdId: string,
	connectionId: string,
	newAccounts: boolean,
): Promise<boolean> {
	const written = await db
		.update(bankConnections)
		.set({ newAccounts })
		.where(
			and(
				eq(bankConnections.id, connectionId),
				eq(bankConnections.householdId, householdId),
				ne(bankConnections.newAccounts, newAccounts),
				ne(bankConnections.status, "disconnected"),
			),
		)
		.returning({ id: bankConnections.id });
	return written.length > 0;
}

/**
 * Records that the provider sent a webhook for a Bank Connection at `at`; with `webhookUrl`, that
 * it now sends them to that address.
 */
export async function recordBankWebhook(
	db: Db,
	householdId: string,
	connectionId: string,
	at: Date,
	webhookUrl?: string | null,
): Promise<void> {
	await db
		.update(bankConnections)
		.set({ lastWebhookAt: at, ...(webhookUrl ? { webhookUrl } : {}) })
		.where(and(eq(bankConnections.id, connectionId), eq(bankConnections.householdId, householdId)));
}

/** A Bank Connection whose webhooks go, as far as is recorded, somewhere other than they should. */
export type BankConnectionToMove = { householdId: string; id: string; credential: string };

/**
 * The Bank Connections not recorded as sending webhooks to `webhookUrl`: those sending them
 * elsewhere, and those made before the address was kept. Not disconnected ones, whose link is dead.
 */
export async function loadBankConnectionsToMoveWebhook(
	db: Db,
	provider: BankProvider,
	webhookUrl: string,
): Promise<BankConnectionToMove[]> {
	return db
		.select({
			householdId: bankConnections.householdId,
			id: bankConnections.id,
			credential: bankConnections.credential,
		})
		.from(bankConnections)
		.where(
			and(
				eq(bankConnections.provider, provider),
				ne(bankConnections.status, "disconnected"),
				or(isNull(bankConnections.webhookUrl), ne(bankConnections.webhookUrl, webhookUrl)),
			),
		)
		.orderBy(asc(bankConnections.createdAt), asc(bankConnections.id));
}

/** Records the address the provider was told to send a Bank Connection's webhooks to. */
export async function saveBankWebhookUrl(
	db: Db,
	householdId: string,
	connectionId: string,
	webhookUrl: string,
): Promise<void> {
	await db
		.update(bankConnections)
		.set({ webhookUrl })
		.where(and(eq(bankConnections.id, connectionId), eq(bankConnections.householdId, householdId)));
}

/** How long a sync holds its Bank Connection before it's taken to have died: well past a run's longest. */
export const BANK_SYNC_STALE_MS = 30 * 60 * 1000;

/**
 * Takes a Bank Connection for one sync. True when it's this sync's to run; false when another is
 * running, which is then told to run once more when it ends (releaseBankSync), so news that came
 * meanwhile isn't missed and no two syncs overlap. A sync that began over half an hour ago is
 * taken to have died.
 */
export async function claimBankSync(
	db: Db,
	householdId: string,
	connectionId: string,
	now: Date,
): Promise<boolean> {
	const mine = and(
		eq(bankConnections.id, connectionId),
		eq(bankConnections.householdId, householdId),
	);
	const claimed = await db
		.update(bankConnections)
		.set({ syncStartedAt: now, syncPending: false })
		.where(
			and(
				mine,
				or(
					isNull(bankConnections.syncStartedAt),
					lt(bankConnections.syncStartedAt, new Date(now.getTime() - BANK_SYNC_STALE_MS)),
				),
			),
		)
		.returning({ id: bankConnections.id });
	if (claimed.length > 0) return true;
	await db.update(bankConnections).set({ syncPending: true }).where(mine);
	return false;
}

/**
 * Lets a Bank Connection go when its sync ends. True when another sync was asked for meanwhile:
 * the caller starts it (its claim clears the mark).
 */
export async function releaseBankSync(
	db: Db,
	householdId: string,
	connectionId: string,
): Promise<boolean> {
	const [released] = await db
		.update(bankConnections)
		.set({ syncStartedAt: null })
		.where(and(eq(bankConnections.id, connectionId), eq(bankConnections.householdId, householdId)))
		.returning({ pending: bankConnections.syncPending });
	return released?.pending ?? false;
}
