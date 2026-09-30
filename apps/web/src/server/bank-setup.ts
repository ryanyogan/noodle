import { env } from "cloudflare:workers";
import type { BankProvider } from "@noodle/db";
import { dayKeyAt } from "@noodle/domain";
import type { BankConnectionProvider } from "./bank-connection";
import { credentialKey, TEST_CREDENTIAL_KEY } from "./bank-credential";
import {
	createLinkToken,
	type LinkTokenOptions,
	type PlaidTransport,
	plaidProvider,
	plaidTransport,
	webhookVerificationKey,
} from "./plaid";
import { fakePlaidTransport } from "./plaid-fake";

// Whether Bank Connections are set up. Plaid is the only provider (ADR-0017), and it needs three
// Worker secrets: BANK_CONNECTION_KEY (`openssl rand -base64 32`), which seals each credential,
// and PLAID_CLIENT_ID and PLAID_SECRET (from the Plaid dashboard, for the environment PLAID_ENV
// names: "sandbox" or "production"). Without all three the app says Plaid isn't set up. With the
// fakes (AI_MODEL=stub, as E2E runs) a fake Plaid stands in, with a fixed key.

type BankEnv = {
	PLAID_CLIENT_ID?: string;
	PLAID_SECRET?: string;
	PLAID_ENV?: string;
	BANK_CONNECTION_KEY?: string;
};

export type BankSetup = {
	/** "fake" with AI_MODEL=stub: E2E's stand-ins, which Plaid Link on the page fakes too. */
	mode: "live" | "fake";
	/** Plaid, with a Plaid Link token for a Household. */
	plaid: {
		provider: BankConnectionProvider;
		/** A Plaid Link token for the Household: to link an institution, or log in to one again. */
		linkToken: (householdId: string, options?: LinkTokenOptions) => Promise<string>;
		/** The public key Plaid signed a webhook with, by its ID; null when Plaid doesn't know it. */
		webhookKey: (keyId: string) => Promise<JsonWebKey | null>;
	};
	/** The key each credential is sealed with. */
	key: () => Promise<CryptoKey>;
};

export function bankSetup(): BankSetup | null {
	if (__AI_STUB__) {
		const today = dayKeyAt(new Date(), "UTC");
		return {
			mode: "fake",
			plaid: plaidSetup(fakePlaidTransport(today)),
			key: () => credentialKey(TEST_CREDENTIAL_KEY),
		};
	}
	const { PLAID_CLIENT_ID, PLAID_SECRET, PLAID_ENV, BANK_CONNECTION_KEY } =
		env as unknown as BankEnv;
	if (!BANK_CONNECTION_KEY || !PLAID_CLIENT_ID || !PLAID_SECRET) return null;
	return {
		mode: "live",
		plaid: plaidSetup(
			plaidTransport({
				clientId: PLAID_CLIENT_ID,
				secret: PLAID_SECRET,
				environment: PLAID_ENV === "production" ? "production" : "sandbox",
			}),
		),
		key: () => credentialKey(BANK_CONNECTION_KEY),
	};
}

const plaidSetup = (transport: PlaidTransport): BankSetup["plaid"] => ({
	provider: plaidProvider(transport),
	linkToken: (householdId, options) => createLinkToken(transport, householdId, options),
	webhookKey: (keyId) => webhookVerificationKey(transport, keyId),
});

/** The providers a Parent can connect through here. */
export const setUpProviders = (_setup: BankSetup): BankProvider[] => ["plaid"];

/** The provider a Bank Connection reads through; null when it isn't set up here any more. */
export const providerFor = (
	setup: BankSetup,
	provider: BankProvider,
): BankConnectionProvider | null => ({ plaid: setup.plaid.provider })[provider] ?? null;
