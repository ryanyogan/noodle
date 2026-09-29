import { type AddBankConnectionResult, addBankConnection, type Db } from "@noodle/db";
import type { BankConnectionProvider, BankHandoff } from "./bank-connection";
import { sealCredential } from "./bank-credential";

// Connecting a Bank Connection, apart from the request so tests can run it: the provider turns
// what the Parent's browser handed back into a credential, lists the accounts there, and the
// ones the app tracks become Accounts, with the credential sealed, in one batch.

export type ConnectInstitutionResult =
	| AddBankConnectionResult
	| { ok: false; reason: "no-accounts" };

export async function connectInstitution(
	deps: { db: Db; provider: BankConnectionProvider; key: CryptoKey; newId: () => string },
	input: { householdId: string; memberId: string; connectionId: string; handoff: BankHandoff },
): Promise<ConnectInstitutionResult> {
	const { householdId, connectionId } = input;
	const link = await deps.provider.connect(input.handoff);
	const tracked = (await deps.provider.accounts(link.credential)).flatMap((account) =>
		account.kind ? [{ ...account, kind: account.kind }] : [],
	);
	if (tracked.length === 0) return { ok: false, reason: "no-accounts" };
	return addBankConnection(deps.db, {
		householdId,
		connectionId,
		provider: deps.provider.provider,
		externalId: link.externalId,
		institution: link.institution,
		credential: await sealCredential(deps.key, link.credential, { householdId, connectionId }),
		createdByMemberId: input.memberId,
		// Ordered IDs (newId is monotonic): Accounts made together list in the institution's order.
		accounts: tracked.map((account) => ({
			accountId: deps.newId(),
			balanceId: deps.newId(),
			account,
		})),
	});
}
