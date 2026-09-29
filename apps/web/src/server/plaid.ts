import {
	type BankLine,
	type PlaidAccount,
	type PlaidTransaction,
	plaidBankAccount,
	plaidLine,
} from "@noodle/domain";
import {
	type BankChanges,
	type BankConnectionProvider,
	BankProviderError,
} from "./bank-connection";

// Plaid, as a Bank Connection provider. Every call is a JSON POST to Plaid's API with the client ID
// and secret in headers (Worker secrets: they never reach a browser). A Parent links their
// institution in Plaid Link with a link token made here; Link hands back a public token, which is
// exchanged for the Item's access token (the credential, sealed before it's stored) and its ID.
// Transactions come from /transactions/sync, cursor to cursor: what was added, modified or removed
// since the last read, pending ones included (a posted one names the pending one it replaces).
// Link tokens carry the webhook URL, so Plaid says when an Item has news (plaid-webhook.ts); a
// credential Plaid says has lapsed (ITEM_LOGIN_REQUIRED) is marked for a reconnect, which is Link
// again in update mode for the same Item. The transport is a seam: tests and E2E use a fake
// (plaid-fake.ts).

/** One call to Plaid's API: the JSON it answered, or a BankProviderError with Plaid's code. */
export type PlaidTransport = (path: string, body: Record<string, unknown>) => Promise<unknown>;

export type PlaidEnvironment = "sandbox" | "production";

export type PlaidConfig = { clientId: string; secret: string; environment: PlaidEnvironment };

const PLAID_HOSTS: Record<PlaidEnvironment, string> = {
	sandbox: "https://sandbox.plaid.com",
	production: "https://production.plaid.com",
};

/** Plaid's error codes that mean a Parent must log in at the institution again (Link update mode). */
const RECONNECT_CODES = new Set(["ITEM_LOGIN_REQUIRED"]);

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
				null,
				RECONNECT_CODES.has(error.error_code ?? ""),
			);
		}
		return json;
	};
}

/** What a link token is for, besides its Household. */
export type LinkTokenOptions = {
	/** Where Plaid sends the Item's webhooks; none where it can't reach the app. */
	webhook?: string | null;
	/** The Item's access token, to log in to it again (update mode) rather than link a new one. */
	accessToken?: string;
};

/**
 * A link token for Plaid Link, for one Household: its ID is Plaid's `client_user_id`. A new link
 * asks for transactions, 90 days back (what Plaid gathers when the Item is made, so it's set
 * here); update mode names the Item instead, whose products are set already.
 */
export async function createLinkToken(
	transport: PlaidTransport,
	householdId: string,
	options: LinkTokenOptions = {},
): Promise<string> {
	const answer = (await transport("/link/token/create", {
		client_name: "Noodle",
		language: "en",
		country_codes: ["US"],
		user: { client_user_id: householdId },
		...(options.webhook ? { webhook: options.webhook } : {}),
		...(options.accessToken
			? { access_token: options.accessToken }
			: { products: ["transactions"], transactions: { days_requested: 90 } }),
	})) as { link_token?: unknown };
	if (typeof answer.link_token !== "string") {
		throw new BankProviderError("Plaid /link/token/create: no link token");
	}
	return answer.link_token;
}

/**
 * The public key (a P-256 JWK) Plaid signs webhooks with, by the key ID a webhook's JWT names;
 * null when Plaid doesn't know that ID, or the key has expired.
 */
export async function webhookVerificationKey(
	transport: PlaidTransport,
	keyId: string,
): Promise<JsonWebKey | null> {
	let answer: { key?: (JsonWebKey & { expired_at?: unknown }) | null };
	try {
		answer = (await transport("/webhook_verification_key/get", { key_id: keyId })) as typeof answer;
	} catch (error) {
		if (error instanceof BankProviderError && error.code !== null) return null;
		throw error;
	}
	const key = answer.key;
	if (key?.kty !== "EC" || key.crv !== "P-256" || key.expired_at) return null;
	return { kty: key.kty, crv: key.crv, x: key.x, y: key.y };
}

/** At most this many /transactions/sync pages in one read: 4,000 lines, well inside a step's 1 MiB. */
const SYNC_PAGES = 8;
const SYNC_COUNT = 500;
/** How many times a read restarts when the Item changed while it was paging. */
const SYNC_RESTARTS = 3;

type SyncPage = {
	added: PlaidTransaction[];
	modified?: PlaidTransaction[];
	removed?: { transaction_id: string; account_id?: string | null }[];
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

async function syncFrom(
	transport: PlaidTransport,
	credential: string,
	from: string | null,
): Promise<BankChanges> {
	// By Plaid's ID for each: a later page's word on a line is the last.
	const lines = new Map<string, BankLine>();
	const removed = new Map<string, { accountExternalId: string; bankId: string }>();
	let cursor = from;
	let more = true;
	let status: string | undefined;
	for (let page = 0; more && page < SYNC_PAGES; page++) {
		const answer = (await transport("/transactions/sync", {
			access_token: credential,
			...(cursor ? { cursor } : {}),
			count: SYNC_COUNT,
		})) as SyncPage;
		for (const transaction of [...answer.added, ...(answer.modified ?? [])]) {
			const line = plaidLine(transaction);
			if (!line) continue;
			lines.set(line.bankId, line);
			removed.delete(line.bankId);
		}
		for (const { transaction_id, account_id } of answer.removed ?? []) {
			lines.delete(transaction_id);
			removed.set(transaction_id, { accountExternalId: account_id ?? "", bankId: transaction_id });
		}
		// Empty while Plaid is still gathering the Item's first transactions.
		cursor = answer.next_cursor || null;
		more = answer.has_more;
		status = answer.transactions_update_status;
	}
	// Complete once every page is read and Plaid has all 90 days, not just the first 30.
	const complete = !more && (status === undefined || status === "HISTORICAL_UPDATE_COMPLETE");
	return { lines: [...lines.values()], removed: [...removed.values()], cursor, complete };
}
