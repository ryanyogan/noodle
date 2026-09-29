import type { BankProvider } from "@noodle/db";
import type { BankAccount, BankLine } from "@noodle/domain";

// The Bank Connection seam: what the app needs from any provider that links a Household to its
// financial institution (Plaid today; SimpleFIN next). Connecting turns what the Parent's browser
// handed back into a credential kept in the Worker; after that the Import Workflow only ever asks
// for the accounts and for the posted lines since its last cursor. Everything past this seam is
// in the app's terms (@noodle/domain's BankAccount and BankLine), so an Import from any provider
// lands exactly as a statement's would.

/** What the Parent's browser hands back once they've linked their institution. */
export type BankHandoff = {
	/** The provider's one-time token for the link (Plaid's public token). */
	token: string;
	/** The institution's name, as the provider's screen showed it, when it said. */
	institution: string | null;
};

/** A link at the institution, ready to store: the credential is still in the clear here. */
export type BankLink = {
	credential: string;
	/** The provider's ID for the link: the same institution login again has the same one. */
	externalId: string;
	institution: string | null;
};

/** Posted lines since `cursor`, and the cursor to read from next. */
export type BankChanges = {
	lines: BankLine[];
	cursor: string | null;
	/** False while the provider is still gathering history, or has more to hand over. */
	complete: boolean;
};

export interface BankConnectionProvider {
	readonly provider: BankProvider;
	connect(handoff: BankHandoff): Promise<BankLink>;
	accounts(credential: string): Promise<BankAccount[]>;
	changes(credential: string, cursor: string | null): Promise<BankChanges>;
}

/** A provider's answer that isn't one: an error it reported, or a response it shouldn't send. */
export class BankProviderError extends Error {
	constructor(
		message: string,
		/** The provider's code for it, when it gave one (Plaid's `error_code`). */
		readonly code: string | null = null,
	) {
		super(message);
		this.name = "BankProviderError";
	}
}
