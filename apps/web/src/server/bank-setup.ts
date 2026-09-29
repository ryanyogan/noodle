import { env } from "cloudflare:workers";
import { dayKeyAt } from "@noodle/domain";
import type { BankConnectionProvider } from "./bank-connection";
import { credentialKey, TEST_CREDENTIAL_KEY } from "./bank-credential";
import { createLinkToken, type PlaidTransport, plaidProvider, plaidTransport } from "./plaid";
import { fakePlaidTransport } from "./plaid-fake";

// Whether Bank Connections are set up, and with what. They need three Worker secrets:
// PLAID_CLIENT_ID and PLAID_SECRET (from the Plaid dashboard, for the environment PLAID_ENV names:
// "sandbox" or "production"), and BANK_CONNECTION_KEY (`openssl rand -base64 32`), which seals
// each credential. Without them the app says Bank Connections aren't set up. With the fakes
// (AI_MODEL=stub, as E2E runs) a fake Plaid stands in, with a fixed key.

type BankEnv = {
	PLAID_CLIENT_ID?: string;
	PLAID_SECRET?: string;
	PLAID_ENV?: string;
	BANK_CONNECTION_KEY?: string;
};

export type BankSetup = {
	/** "fake" with AI_MODEL=stub: E2E's stand-in, which Link on the page fakes too. */
	mode: "plaid" | "fake";
	provider: BankConnectionProvider;
	/** A Plaid Link token for the Household. */
	linkToken: (householdId: string) => Promise<string>;
	/** The key each credential is sealed with. */
	key: () => Promise<CryptoKey>;
};

export function bankSetup(): BankSetup | null {
	if (__AI_STUB__) {
		return withTransport(
			"fake",
			fakePlaidTransport(dayKeyAt(new Date(), "UTC")),
			TEST_CREDENTIAL_KEY,
		);
	}
	const { PLAID_CLIENT_ID, PLAID_SECRET, PLAID_ENV, BANK_CONNECTION_KEY } =
		env as unknown as BankEnv;
	if (!PLAID_CLIENT_ID || !PLAID_SECRET || !BANK_CONNECTION_KEY) return null;
	const transport = plaidTransport({
		clientId: PLAID_CLIENT_ID,
		secret: PLAID_SECRET,
		environment: PLAID_ENV === "production" ? "production" : "sandbox",
	});
	return withTransport("plaid", transport, BANK_CONNECTION_KEY);
}

function withTransport(mode: BankSetup["mode"], transport: PlaidTransport, key: string): BankSetup {
	return {
		mode,
		provider: plaidProvider(transport),
		linkToken: (householdId) => createLinkToken(transport, householdId),
		key: () => credentialKey(key),
	};
}
