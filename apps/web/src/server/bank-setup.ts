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
import { simplefinProvider, simplefinTransport } from "./simplefin";
import { fakeSimplefinTransport } from "./simplefin-fake";

// Whether Bank Connections are set up, and with which providers. Every one needs the Worker secret
// BANK_CONNECTION_KEY (`openssl rand -base64 32`), which seals each credential; with only that,
// a Parent can connect through SimpleFIN, which needs no app-level keys. Plaid needs two more:
// PLAID_CLIENT_ID and PLAID_SECRET (from the Plaid dashboard, for the environment PLAID_ENV names:
// "sandbox" or "production"). Without the key the app says Bank Connections aren't set up. With
// the fakes (AI_MODEL=stub, as E2E runs) a fake Plaid and a fake SimpleFIN stand in, with a fixed
// key.

type BankEnv = {
	PLAID_CLIENT_ID?: string;
	PLAID_SECRET?: string;
	PLAID_ENV?: string;
	BANK_CONNECTION_KEY?: string;
};

export type BankSetup = {
	/** "fake" with AI_MODEL=stub: E2E's stand-ins, which Plaid Link on the page fakes too. */
	mode: "live" | "fake";
	/** Plaid, with a Plaid Link token for a Household; null without Plaid's secrets. */
	plaid: {
		provider: BankConnectionProvider;
		/** A Plaid Link token for the Household: to link an institution, or log in to one again. */
		linkToken: (householdId: string, options?: LinkTokenOptions) => Promise<string>;
		/** The public key Plaid signed a webhook with, by its ID; null when Plaid doesn't know it. */
		webhookKey: (keyId: string) => Promise<JsonWebKey | null>;
	} | null;
	simplefin: BankConnectionProvider;
	/** The key each credential is sealed with. */
	key: () => Promise<CryptoKey>;
};

export function bankSetup(): BankSetup | null {
	if (__AI_STUB__) {
		const today = dayKeyAt(new Date(), "UTC");
		return {
			mode: "fake",
			plaid: plaidSetup(fakePlaidTransport(today)),
			simplefin: simplefinProvider(fakeSimplefinTransport(today)),
			key: () => credentialKey(TEST_CREDENTIAL_KEY),
		};
	}
	const { PLAID_CLIENT_ID, PLAID_SECRET, PLAID_ENV, BANK_CONNECTION_KEY } =
		env as unknown as BankEnv;
	if (!BANK_CONNECTION_KEY) return null;
	return {
		mode: "live",
		plaid:
			PLAID_CLIENT_ID && PLAID_SECRET
				? plaidSetup(
						plaidTransport({
							clientId: PLAID_CLIENT_ID,
							secret: PLAID_SECRET,
							environment: PLAID_ENV === "production" ? "production" : "sandbox",
						}),
					)
				: null,
		simplefin: simplefinProvider(simplefinTransport()),
		key: () => credentialKey(BANK_CONNECTION_KEY),
	};
}

const plaidSetup = (transport: PlaidTransport): NonNullable<BankSetup["plaid"]> => ({
	provider: plaidProvider(transport),
	linkToken: (householdId, options) => createLinkToken(transport, householdId, options),
	webhookKey: (keyId) => webhookVerificationKey(transport, keyId),
});

/** The providers a Parent can connect through here. */
export const setUpProviders = (setup: BankSetup): BankProvider[] =>
	setup.plaid ? ["plaid", "simplefin"] : ["simplefin"];

/** The provider a Bank Connection reads through; null when it isn't set up here any more. */
export const providerFor = (
	setup: BankSetup,
	provider: BankProvider,
): BankConnectionProvider | null =>
	provider === "plaid" ? (setup.plaid?.provider ?? null) : setup.simplefin;
