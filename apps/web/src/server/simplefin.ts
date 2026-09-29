import {
	type SimplefinAccountSet,
	simplefinBankAccount,
	simplefinErrors,
	simplefinInstitution,
	simplefinLine,
	simplefinMissedLines,
} from "@noodle/domain";
import { type BankConnectionProvider, BankProviderError } from "./bank-connection";

// SimpleFIN, as a Bank Connection provider, per the SimpleFIN protocol (simplefin.org/protocol.html)
// and SimpleFIN Bridge's developer guide (beta-bridge.simplefin.org/info/developers). A Parent
// makes a setup token at their SimpleFIN Bridge and pastes it here: the token is the base64 of a
// claim URL, which is POSTed to once for the Access URL, a URL with Basic Auth credentials in it.
// That URL is the credential (sealed before it's stored), and a token claimed once is spent: a
// second claim answers 403. GET {access}/accounts?start-date=… lists the accounts, their balances
// and their posted transactions (pending ones are left out unless asked for). There's no cursor,
// so the cursor here is the time a read covered up to, in epoch seconds, and each read starts a few
// days before it, as the Bridge asks: lines are keyed by SimpleFIN's IDs, so the overlap brings in
// nothing twice. The Bridge serves at most 90 days a request, and about 24 requests a day, so a
// read spans no more than that, and the Import Workflow reads the next span a minute later. No
// app-level keys: the transport is a seam, and tests and E2E use a fake (simplefin-fake.ts).

export type SimplefinTransport = {
	/** POSTs to a claim URL; the Access URL it answers with. */
	claim: (claimUrl: string) => Promise<string>;
	/** GET {accessUrl}/accounts with the query; the Account Set. */
	accounts: (accessUrl: string, query: URLSearchParams) => Promise<SimplefinAccountSet>;
};

/** The setup token wasn't one. */
export const INVALID_SETUP_TOKEN = "INVALID_SETUP_TOKEN";
/** The claim was refused: the token was claimed already, or never existed. */
export const SETUP_TOKEN_CLAIMED = "SETUP_TOKEN_CLAIMED";

const DAY = 24 * 60 * 60;
/** How far back a Bank Connection's first read goes: inside the Bridge's 90-day span. */
const HISTORY = 89 * DAY;
/** The most a read spans. */
const SPAN = 89 * DAY;
/** How far before the last read's end the next one starts, for lines the bank posts late. */
const OVERLAP = 5 * DAY;

/** The claim URL in a setup token; throws INVALID_SETUP_TOKEN for anything else. */
export function claimUrlOf(setupToken: string): string {
	let decoded: string;
	try {
		decoded = atob(setupToken.trim());
	} catch {
		throw new BankProviderError("SimpleFIN: the setup token isn’t base64", INVALID_SETUP_TOKEN);
	}
	const url = parseUrl(decoded.trim());
	if (url?.protocol !== "https:" || url.username || url.password) {
		throw new BankProviderError(
			"SimpleFIN: the setup token isn’t a claim URL",
			INVALID_SETUP_TOKEN,
		);
	}
	return url.href;
}

function parseUrl(text: string): URL | null {
	try {
		return new URL(text);
	} catch {
		return null;
	}
}

/** An Access URL without its credentials, and the Basic Auth header they make. */
function accessOf(accessUrl: string): { base: string; authorization: string } {
	const url = parseUrl(accessUrl);
	if (url?.protocol !== "https:" || !url.username) {
		throw new BankProviderError("SimpleFIN: not an Access URL");
	}
	const credentials = `${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`;
	url.username = "";
	url.password = "";
	// fetch refuses a URL with credentials in it, so they go in the header.
	return { base: url.href.replace(/\/$/, ""), authorization: `Basic ${btoa(credentials)}` };
}

/** SimpleFIN over fetch. */
export function simplefinTransport(fetcher: typeof fetch = fetch): SimplefinTransport {
	return {
		async claim(claimUrl) {
			const response = await fetcher(claimUrl, { method: "POST" });
			if (response.status === 403) {
				throw new BankProviderError(
					"SimpleFIN: the setup token was claimed already, or doesn’t exist",
					SETUP_TOKEN_CLAIMED,
				);
			}
			if (!response.ok) throw new BankProviderError(`SimpleFIN claim: HTTP ${response.status}`);
			const accessUrl = (await response.text()).trim();
			accessOf(accessUrl);
			return accessUrl;
		},
		async accounts(accessUrl, query) {
			const { base, authorization } = accessOf(accessUrl);
			const response = await fetcher(`${base}/accounts?${query}`, {
				headers: { Authorization: authorization, Accept: "application/json" },
			});
			if (!response.ok) {
				// 403: the Parent revoked Noodle's access at the Bridge; 402: its subscription lapsed.
				throw new BankProviderError(
					`SimpleFIN /accounts: HTTP ${response.status}`,
					String(response.status),
				);
			}
			const set = (await response.json()) as SimplefinAccountSet;
			if (!Array.isArray(set?.accounts)) {
				throw new BankProviderError("SimpleFIN /accounts: no accounts list");
			}
			return set;
		},
	};
}

/** The Bank Connection's ID for an Access URL: a digest, so the credential isn't stored in the clear. */
async function accessId(accessUrl: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(accessUrl));
	return [...new Uint8Array(digest).slice(0, 16)]
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
}

/** The server's messages with an Account Set, one to a line, for the Parent to read. */
function noticeOf(set: SimplefinAccountSet): string | null {
	const errors = simplefinErrors(set);
	return errors.length > 0 ? errors.join("\n") : null;
}

/** An Account Set the server sent with nothing in it but errors: the read failed. */
function failedRead(set: SimplefinAccountSet): void {
	const notice = noticeOf(set);
	if (set.accounts.length === 0 && notice !== null) {
		throw new BankProviderError(`SimpleFIN: ${notice.replaceAll("\n", "; ")}`, null, notice);
	}
}

export function simplefinProvider(
	transport: SimplefinTransport,
	now: () => Date = () => new Date(),
): BankConnectionProvider {
	// Connecting lists the accounts once, to name the institution, and hands them on: the Bridge
	// counts every request.
	let listed: { credential: string; set: SimplefinAccountSet } | null = null;
	const balances = async (credential: string) => {
		if (listed?.credential === credential) return listed.set;
		const set = await transport.accounts(credential, new URLSearchParams({ "balances-only": "1" }));
		failedRead(set);
		listed = { credential, set };
		return set;
	};
	return {
		provider: "simplefin",
		async connect({ token }) {
			const credential = await transport.claim(claimUrlOf(token));
			const set = await balances(credential);
			return {
				credential,
				externalId: await accessId(credential),
				institution: simplefinInstitution(set),
			};
		},
		async accounts(credential) {
			return (await balances(credential)).accounts.map(simplefinBankAccount);
		},
		async changes(credential, cursor) {
			const until = Math.floor(now().getTime() / 1000);
			const last = cursor !== null && /^\d+$/.test(cursor) ? Number(cursor) : null;
			const start = last === null ? until - HISTORY : Math.min(last, until) - OVERLAP;
			// Past the Bridge's span, a read covers the first of it, and the next read the rest.
			const end = start + SPAN < until ? start + SPAN : null;
			const query = new URLSearchParams({ "start-date": String(start) });
			if (end !== null) query.set("end-date", String(end));
			const set = await transport.accounts(credential, query);
			failedRead(set);
			const lines = set.accounts.flatMap(({ id, transactions }) =>
				(transactions ?? []).flatMap((transaction) => {
					const line = simplefinLine(id, transaction);
					return line ? [line] : [];
				}),
			);
			const notice = noticeOf(set);
			// Some account's lines didn't all come: the cursor stays, so the next read covers them.
			if (simplefinMissedLines(set)) return { lines, cursor, complete: true, notice };
			return { lines, cursor: String(end ?? until), complete: end === null, notice };
		},
	};
}
