import {
	type AddBankConnectionResult,
	addBankConnection,
	type BankAccountChoice,
	type ChooseBankAccountsResult,
	chooseBankAccounts,
	type Db,
	loadBankConnectionToImport,
	loadPairableAccounts,
} from "@noodle/db";
import {
	type AccountKind,
	type BankAccount,
	type Cents,
	pairableFor,
	suggestPairings,
} from "@noodle/domain";
import type { BankConnectionProvider, BankHandoff } from "./bank-connection";
import { openCredential, sealCredential } from "./bank-credential";

// Connecting a Bank Connection, apart from the request so tests can run it. The provider turns
// what the Parent's browser handed back into a credential, which is sealed and kept; the Bank
// Connection then waits, "choosing", while the Parent says which Accounts its accounts are
// (ADR-0020): each is paired with an Account the Household already has, added as a new one, or
// left out. Noodle suggests the Account it can tell is the same (suggestPairings).

export type ConnectInstitutionResult =
	| { ok: true; connectionId: string }
	| Extract<AddBankConnectionResult, { ok: false }>
	| { ok: false; reason: "no-accounts" };

type Deps = { db: Db; provider: BankConnectionProvider; key: CryptoKey };

/** The accounts at the institution the app tracks: checking, savings, cards and loans. */
const tracked = (accounts: BankAccount[]) =>
	accounts.flatMap((account) => (account.kind ? [{ ...account, kind: account.kind }] : []));

export async function connectInstitution(
	deps: Deps,
	input: {
		householdId: string;
		memberId: string;
		connectionId: string;
		handoff: BankHandoff;
		/** The provider's ID for the institution, kept to spot the same bank linked again. */
		institutionId?: string | null;
	},
): Promise<ConnectInstitutionResult> {
	const { householdId, connectionId } = input;
	const link = await deps.provider.connect(input.handoff);
	if (tracked(await deps.provider.accounts(link.credential)).length === 0) {
		return { ok: false, reason: "no-accounts" };
	}
	const added = await addBankConnection(deps.db, {
		householdId,
		connectionId,
		provider: deps.provider.provider,
		externalId: link.externalId,
		institution: link.institution,
		institutionId: input.institutionId ?? null,
		credential: await sealCredential(deps.key, link.credential, { householdId, connectionId }),
		createdByMemberId: input.memberId,
	});
	return added.ok ? { ok: true, connectionId } : added;
}

/** One of a Bank Connection's accounts, with what a Parent may choose for it. */
export type BankChoice = {
	externalId: string;
	name: string;
	mask: string | null;
	kind: AccountKind;
	balance: Cents | null;
	/** The Account it's paired with now, if any. */
	pairedWith: string | null;
	/** The Account Noodle suggests; null to add it as a new one. */
	suggested: string | null;
	/** The Accounts it may pair with. */
	options: { id: string; name: string; kind: AccountKind }[];
};

export type BankChoices = {
	connectionId: string;
	status: string;
	accounts: BankChoice[];
	/** Accounts paired with this Bank Connection whose bank account it no longer lists. */
	gone: { id: string; name: string }[];
};

/** The Bank Connection's accounts, as Choose Accounts offers them; null once it's gone. */
export async function bankChoices(
	deps: Deps,
	input: { householdId: string; connectionId: string; institution: string | null },
): Promise<BankChoices | null> {
	const { householdId, connectionId } = input;
	const connection = await loadBankConnectionToImport(deps.db, householdId, connectionId);
	if (!connection) return null;
	const credential = await openCredential(deps.key, connection.credential, {
		householdId,
		connectionId,
	});
	const [banks, accounts] = await Promise.all([
		deps.provider.accounts(credential).then(tracked),
		loadPairableAccounts(deps.db, householdId),
	]);
	const suggested = suggestPairings(banks, input.institution, connectionId, accounts);
	return {
		connectionId,
		status: connection.status,
		accounts: banks.map((bank) => ({
			externalId: bank.externalId,
			name: bank.name,
			mask: bank.mask,
			kind: bank.kind,
			balance: bank.balance,
			pairedWith:
				accounts.find(
					(a) => a.bankConnectionId === connectionId && a.externalId === bank.externalId,
				)?.id ?? null,
			suggested: suggested.get(bank.externalId) ?? null,
			options: pairableFor(bank, connectionId, accounts).map(({ id, name, kind }) => ({
				id,
				name,
				kind,
			})),
		})),
		gone: accounts
			.filter(
				(a) =>
					a.bankConnectionId === connectionId && !banks.some((b) => b.externalId === a.externalId),
			)
			.map(({ id, name }) => ({ id, name })),
	};
}

/** A Parent's choice for one bank account: an Account's ID, a new Account, or left out. */
export type ChoiceInput = { externalId: string; choice: "new" | "leave-out" | { pair: string } };

/**
 * Writes a Parent's choices (chooseBankAccounts), for the accounts the institution lists now; a
 * bank account paired already, or no longer listed, is left as it is.
 */
export async function applyBankChoices(
	deps: Deps & { newId: () => string },
	input: { householdId: string; memberId: string; connectionId: string; choices: ChoiceInput[] },
): Promise<ChooseBankAccountsResult> {
	const { householdId, connectionId } = input;
	const connection = await loadBankConnectionToImport(deps.db, householdId, connectionId);
	if (!connection) return { ok: false, reason: "not-found" };
	const credential = await openCredential(deps.key, connection.credential, {
		householdId,
		connectionId,
	});
	const banks = tracked(await deps.provider.accounts(credential));
	const paired = new Set(connection.accounts.map((a) => a.externalId));
	// Ordered IDs (newId is monotonic): Accounts made together list in the institution's order.
	const choices = banks.flatMap((account): BankAccountChoice[] => {
		const chosen = input.choices.find((c) => c.externalId === account.externalId);
		if (!chosen || paired.has(account.externalId)) return [];
		const balanceId = deps.newId();
		if (chosen.choice === "leave-out")
			return [{ account, balanceId, choice: { kind: "leave-out" } }];
		if (chosen.choice === "new") {
			return [{ account, balanceId, choice: { kind: "add", accountId: deps.newId() } }];
		}
		return [{ account, balanceId, choice: { kind: "pair", accountId: chosen.choice.pair } }];
	});
	return chooseBankAccounts(deps.db, {
		householdId,
		connectionId,
		createdByMemberId: input.memberId,
		choices,
	});
}
