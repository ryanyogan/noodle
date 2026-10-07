import { type Db, loadBankConnectionToImport, removeBankConnection } from "@noodle/db";
import { type BankConnectionProvider, BankProviderError } from "./bank-connection";

// Disconnecting a bank (#61): a Parent stops sharing their bank with Noodle. The provider is told
// to remove the link first (Plaid's /item/remove), so the access token stops working there; then
// the token is deleted here, the Bank Connection is marked disconnected and its Accounts are
// unpaired (removeBankConnection). Each Account keeps its Transactions, statements, balances and
// Goals, kept by hand or by statements from now on. An Import Workflow already running for it
// reads the Bank Connection before each round, finds it disconnected and stops; and webhooks for
// the link find nothing. Connecting the same bank later pairs with the same Accounts (ADR-0020).

export type DisconnectBankResult = { ok: true } | { ok: false; reason: "not-found" | "bank" };

/** Plaid's answers that mean the link is gone at the bank already: nothing more to remove there. */
const GONE_CODES = new Set(["ITEM_NOT_FOUND", "INVALID_ACCESS_TOKEN"]);

export async function disconnectBankConnection(
	deps: {
		db: Db;
		providerFor: (provider: "plaid") => BankConnectionProvider | null;
		openCredential: (connection: { id: string; credential: string }) => Promise<string>;
	},
	// `memberId`: the Parent who asked, for the Log; left out when nobody did (a Fresh start).
	input: { householdId: string; connectionId: string; memberId?: string },
): Promise<DisconnectBankResult> {
	const { db } = deps;
	const { householdId, connectionId } = input;
	const connection = await loadBankConnectionToImport(db, householdId, connectionId);
	// Another Household's, or one disconnected already (its token is deleted).
	if (!connection || connection.credential === "") return { ok: false, reason: "not-found" };
	const provider = deps.providerFor(connection.provider);
	if (!provider) return { ok: false, reason: "bank" };
	try {
		await provider.remove(await deps.openCredential(connection));
	} catch (error) {
		// The bank has dropped the link already (the Parent turned access off there): nothing to
		// remove. Anything else, and the link might still work at the bank, so the token is kept
		// and the Parent asked to try again.
		const gone =
			error instanceof BankProviderError &&
			(GONE_CODES.has(error.code ?? "") || connection.status === "disconnected");
		if (!gone) {
			console.warn(
				JSON.stringify({
					log: "bank-disconnect",
					household_id: householdId,
					connection_id: connectionId,
					error: error instanceof BankProviderError ? (error.code ?? error.name) : "Error",
				}),
			);
			return { ok: false, reason: "bank" };
		}
	}
	await removeBankConnection(db, householdId, connectionId, input.memberId);
	return { ok: true };
}
