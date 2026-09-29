import {
	type BankLine,
	type PlaidAccount,
	type PlaidTransaction,
	plaidBankAccount,
	plaidLine,
} from "@noodle/domain";
import { type BankConnectionProvider, BankProviderError } from "./bank-connection";

// Plaid, as a Bank Connection provider. Every call is a JSON POST to Plaid's API with the client ID
// and secret in headers (Worker secrets: they never reach a browser). A Parent links their
// institution in Plaid Link with a link token made here; Link hands back a public token, which is
// exchanged for the Item's access token (the credential, sealed before it's stored) and its ID.
// Transactions come from /transactions/sync, cursor to cursor: only what was added since the last
// read. Pending ones are left for their posted copies (plaidLine); modified and removed ones are
// left for the daily sync (#17). The transport is a seam: tests and E2E use a fake (plaid-fake.ts).

/** One call to Plaid's API: the JSON it answered, or a BankProviderError with Plaid's code. */
export type PlaidTransport = (path: string, body: Record<string, unknown>) => Promise<unknown>;

export type PlaidEnvironment = "sandbox" | "production";

export type PlaidConfig = { clientId: string; secret: string; environment: PlaidEnvironment };

const PLAID_HOSTS: Record<PlaidEnvironment, string> = {
	sandbox: "https://sandbox.plaid.com",
	production: "https://production.plaid.com",
};

/** Plaid's API over fetch. An error answer carries Plaid's `error_code` and `error_message`. */
export function plaidTransport(config: PlaidConfig, fetcher: typeof fetch = fetch): PlaidTransport {
	return async (path, body) => {
		const response = await fetcher(`${PLAID_HOSTS[config.environment]}${path}`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"PLAID-CLIENT-ID": config.clientId,
				"PLAID-SECRET": config.secret,
			},
			body: JSON.stringify(body),
		});
		const json: unknown = await response.json().catch(() => null);
		if (!response.ok) {
			const error = (json ?? {}) as { error_code?: string; error_message?: string };
			throw new BankProviderError(
				`Plaid ${path}: ${error.error_message ?? `HTTP ${response.status}`}`,
				error.error_code ?? null,
			);
		}
		return json;
	};
}

/**
 * A link token for Plaid Link, for one Household: its ID is Plaid's `client_user_id`. It asks for
 * transactions, 90 days back (what Plaid gathers when the Item is made, so it's set here).
 */
export async function createLinkToken(
	transport: PlaidTransport,
	householdId: string,
): Promise<string> {
	const answer = (await transport("/link/token/create", {
		client_name: "Noodle",
		language: "en",
		country_codes: ["US"],
		user: { client_user_id: householdId },
		products: ["transactions"],
		transactions: { days_requested: 90 },
	})) as { link_token?: unknown };
	if (typeof answer.link_token !== "string") {
		throw new BankProviderError("Plaid /link/token/create: no link token");
	}
	return answer.link_token;
}

/** At most this many /transactions/sync pages in one read: 4,000 lines, well inside a step's 1 MiB. */
const SYNC_PAGES = 8;
const SYNC_COUNT = 500;
/** How many times a read restarts when the Item changed while it was paging. */
const SYNC_RESTARTS = 3;

type SyncPage = {
	added: PlaidTransaction[];
	next_cursor: string;
	has_more: boolean;
	transactions_update_status?: string;
};

export function plaidProvider(transport: PlaidTransport): BankConnectionProvider {
	return {
		provider: "plaid",
		async connect({ token, institution }) {
			const answer = (await transport("/item/public_token/exchange", {
				public_token: token,
			})) as { access_token?: unknown; item_id?: unknown };
			if (typeof answer.access_token !== "string" || typeof answer.item_id !== "string") {
				throw new BankProviderError("Plaid /item/public_token/exchange: no access token");
			}
			return { credential: answer.access_token, externalId: answer.item_id, institution };
		},
		async accounts(credential) {
			const answer = (await transport("/accounts/get", { access_token: credential })) as {
				accounts?: PlaidAccount[];
			};
			return (answer.accounts ?? []).map(plaidBankAccount);
		},
		async changes(credential, cursor) {
			for (let attempt = 0; ; attempt++) {
				try {
					return await syncFrom(transport, credential, cursor);
				} catch (error) {
					// Plaid's rule: a read the Item changed under restarts from its first cursor.
					const mutated =
						error instanceof BankProviderError &&
						error.code === "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION";
					if (!mutated || attempt >= SYNC_RESTARTS) throw error;
				}
			}
		},
	};
}

async function syncFrom(transport: PlaidTransport, credential: string, from: string | null) {
	const lines: BankLine[] = [];
	let cursor = from;
	let more = true;
	let status: string | undefined;
	for (let page = 0; more && page < SYNC_PAGES; page++) {
		const answer = (await transport("/transactions/sync", {
			access_token: credential,
			...(cursor ? { cursor } : {}),
			count: SYNC_COUNT,
		})) as SyncPage;
		for (const transaction of answer.added) {
			const line = plaidLine(transaction);
			if (line) lines.push(line);
		}
		// Empty while Plaid is still gathering the Item's first transactions.
		cursor = answer.next_cursor || null;
		more = answer.has_more;
		status = answer.transactions_update_status;
	}
	// Complete once every page is read and Plaid has all 90 days, not just the first 30.
	const complete = !more && (status === undefined || status === "HISTORICAL_UPDATE_COMPLETE");
	return { lines, cursor, complete };
}
