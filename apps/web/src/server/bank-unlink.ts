import {
	type ArchiveAccountResult,
	archiveAccount,
	type Db,
	loadAccountToArchive,
	unpairAccount,
} from "@noodle/db";
import type { BankConnectionProvider } from "./bank-connection";
import { disconnectBankConnection } from "./bank-disconnect";

// Unlinking one Account from its bank, and archiving an Account (ADR-0046).
//
// Unlinked is stored as the Account's bank link cleared (`bank_connection_id` and `external_id`
// null): that pairing is the one thing the Import Workflow keys on, so nothing reads for the
// Account again, while the Bank Connection's other Accounts go on as before. The Account's
// Transactions keep the bank's own IDs, so linking it again later brings in only what isn't
// there (ADR-0020). When it was the Bank Connection's last linked Account, the Bank Connection
// is disconnected the way a Parent's "Disconnect" does it (disconnectBankConnection: removed at
// the bank, its access token deleted): a link Noodle reads nothing from isn't kept open.
//
// Archiving unlinks first, for the same reason sync skips an archived Account: what the bank
// sent while it was archived would otherwise be passed over and never read.

type Deps = {
	db: Db;
	/** Null when Plaid isn't set up here: only needed when the Bank Connection itself goes. */
	bank: {
		providerFor: (provider: "plaid") => BankConnectionProvider | null;
		openCredential: (connection: { id: string; credential: string }) => Promise<string>;
	} | null;
};

export type UnlinkBankAccountResult =
	/** `disconnected`: it was the last linked Account, so its Bank Connection was removed too. */
	{ ok: true; disconnected: boolean } | { ok: false; reason: "not-found" | "bank" | "not-set-up" };

export async function unlinkBankAccount(
	deps: Deps,
	input: { householdId: string; accountId: string },
): Promise<UnlinkBankAccountResult> {
	const { db } = deps;
	const { householdId, accountId } = input;
	const account = await loadAccountToArchive(db, householdId, accountId);
	if (!account?.bankConnectionId) return { ok: false, reason: "not-found" };
	if (account.siblings === 0) {
		if (!deps.bank) return { ok: false, reason: "not-set-up" };
		const result = await disconnectBankConnection(
			{ db, ...deps.bank },
			{ householdId, connectionId: account.bankConnectionId },
		);
		if (result.ok) return { ok: true, disconnected: true };
		if (result.reason === "bank") return result;
		// Its token is gone already (disconnected a moment ago): only the pairing is left to clear.
	}
	const done = await unpairAccount(db, householdId, accountId);
	return done ? { ok: true, disconnected: false } : { ok: false, reason: "not-found" };
}

export type ArchiveAccountFnResult =
	| ArchiveAccountResult
	| { ok: false; reason: "bank" | "not-set-up" };

/** Archives an Account, unlinking it from its bank first when it still syncs. */
export async function archiveAccountAndUnlink(
	deps: Deps,
	input: { householdId: string; accountId: string; memberId?: string },
): Promise<ArchiveAccountFnResult> {
	const account = await loadAccountToArchive(deps.db, input.householdId, input.accountId);
	if (!account || account.archived) return { ok: false, reason: "not-found" };
	// Said before anything is unlinked: a refused archive changes nothing.
	if (account.goals.length > 0) return { ok: false, reason: "goals", goals: account.goals };
	if (account.bankConnectionId) {
		const unlinked = await unlinkBankAccount(deps, input);
		if (!unlinked.ok && unlinked.reason !== "not-found") {
			return { ok: false, reason: unlinked.reason };
		}
	}
	return archiveAccount(deps.db, input);
}
