import { addDays, type DayKey, type PlaidAccount, type PlaidTransaction } from "@noodle/domain";
import { BankProviderError } from "./bank-connection";
import type { PlaidTransport } from "./plaid";
import { FAKE_WEBHOOK_KEY_ID, FAKE_WEBHOOK_PRIVATE_KEY } from "./plaid-fake-webhook-key";

// A stand-in for Plaid's API, for tests and E2E (AI_MODEL=stub): answers the calls plaid.ts makes,
// the same way every time. Its Item has a checking, savings, credit card and loan account, plus an
// investment account the app doesn't track. The savings and the card are named as `busy`'s Kids'
// Savings and Costco card are, so connecting there offers to pair them (ADR-0020). Its transactions come in two pages (has_more), dated
// back from `today` so they land in recent months, with a pending one. A read on from there finds
// what a later sync would (fakeLaterChanges): that charge posted, one changed, one dropped and a
// new pending one; a read after that finds nothing new. The browser's side of Link is faked too
// (bank-connections.tsx): a fake link token turns straight into its public token. Its webhook key
// is plaid-fake-webhook-key.ts's. A new link's `days_requested` rides on its tokens ("~d90" after the
// login), and a read with such a token honours it: older lines (fakeOlderTransactions) come only
// when they're inside the span, bar one far older that comes regardless, as a bank that ignores
// the span would send it. A token without the mark reads as the fake always has.

const FAKE_LINK_TOKEN_PREFIX = "link-fake-";

const FIRST_CURSOR = "fake-cursor-1";
const SECOND_CURSOR = "fake-cursor-2";
const LAST_CURSOR = "fake-cursor-3";

const account = (
	id: string,
	name: string,
	mask: string,
	type: string,
	subtype: string,
	current: number,
): PlaidAccount => ({
	account_id: id,
	name,
	mask,
	type,
	subtype,
	balances: { current, iso_currency_code: "USD" },
});

export const FAKE_ACCOUNTS: PlaidAccount[] = [
	account("fake-checking", "Plaid Checking", "0000", "depository", "checking", 1_250.4),
	account("fake-savings", "Kids Savings", "1111", "depository", "savings", 8_200),
	account("fake-card", "Costco Anywhere Visa", "3333", "credit", "credit card", 410.25),
	account("fake-loan", "Plaid Auto Loan", "4444", "loan", "auto", 12_480),
	account("fake-brokerage", "Plaid Brokerage", "5555", "investment", "brokerage", 23_631.98),
];

const transaction = (
	id: string,
	accountId: string,
	daysAgo: number,
	today: DayKey,
	amount: number,
	name: string,
	pending = false,
	pendingId: string | null = null,
): PlaidTransaction => ({
	transaction_id: id,
	account_id: accountId,
	amount,
	iso_currency_code: "USD",
	date: addDays(today, -daysAgo),
	authorized_date: addDays(today, -daysAgo),
	name,
	merchant_name: name,
	pending,
	pending_transaction_id: pendingId,
});

/** The fake Item's transactions, as two /transactions/sync pages. Plaid's money out is positive. */
export function fakeTransactions(today: DayKey): [PlaidTransaction[], PlaidTransaction[]] {
	const t = (id: string, accountId: string, daysAgo: number, amount: number, name: string) =>
		transaction(id, accountId, daysAgo, today, amount, name);
	return [
		[
			t("fake-t1", "fake-checking", 1, 64.12, "Kroger"),
			t("fake-t2", "fake-checking", 3, -2_400, "Acme Payroll"),
			t("fake-t3", "fake-card", 2, 38.5, "Shell"),
			t("fake-t4", "fake-card", 5, 112.3, "Costco"),
			transaction("fake-t5", "fake-card", 0, today, 9.99, "Netflix", true),
			t("fake-t6", "fake-brokerage", 4, 500, "Brokerage Transfer"),
		],
		[
			t("fake-t7", "fake-checking", 8, 1_450, "Evergreen Property Rent"),
			t("fake-t8", "fake-savings", 10, -2.14, "Interest Paid"),
			t("fake-t9", "fake-card", 12, 23.4, "Chipotle"),
			t("fake-t10", "fake-loan", 15, -310, "Auto Loan Payment"),
		],
	];
}

/**
 * Older lines, for a link that asked for a span of days: 45 and 100 days back, which come when the
 * span reaches them, and one 400 days back that comes whatever was asked.
 */
export function fakeOlderTransactions(today: DayKey): {
	asked: PlaidTransaction[];
	regardless: PlaidTransaction[];
} {
	return {
		asked: [
			transaction("fake-old1", "fake-checking", 45, today, 82.17, "Safeway"),
			transaction("fake-old2", "fake-card", 100, today, 54.2, "REI"),
		],
		regardless: [transaction("fake-old3", "fake-checking", 400, today, 19.99, "Blockbuster")],
	};
}

const DAYS_MARK = /^(.*)~d(\d+)$/;

/** A fake token's login, and the days its link asked for (null on a token that doesn't say). */
function fakeLogin(rest: string): { login: string; days: number | null } {
	const marked = DAYS_MARK.exec(rest);
	return marked ? { login: marked[1] ?? "", days: Number(marked[2]) } : { login: rest, days: null };
}

/**
 * What a later sync finds: Netflix (fake-t5) posted, for a little more; Kroger (fake-t1) changed;
 * Chipotle (fake-t9) dropped; and a new pending charge.
 */
export function fakeLaterChanges(today: DayKey) {
	return {
		added: [
			transaction("fake-t11", "fake-card", 0, today, 10.49, "Netflix", false, "fake-t5"),
			transaction("fake-t12", "fake-card", 0, today, 45, "Target", true),
		],
		modified: [transaction("fake-t1", "fake-checking", 1, today, 68.4, "Kroger")],
		removed: [
			{ transaction_id: "fake-t5", account_id: "fake-card" },
			{ transaction_id: "fake-t9", account_id: "fake-card" },
		],
	};
}

/** The fake Plaid API, dated from `today`. */
export function fakePlaidTransport(today: DayKey): PlaidTransport {
	const [firstPage, lastPage] = fakeTransactions(today);
	const later = fakeLaterChanges(today);
	const older = fakeOlderTransactions(today);
	return async (path, body) => {
		switch (path) {
			case "/link/token/create": {
				const user = body.user as { client_user_id: string };
				// Update mode (a reconnect) names the Item's access token.
				const mode = body.access_token ? "update-" : "";
				const asked = (body.transactions as { days_requested?: number } | undefined)
					?.days_requested;
				const days = !body.access_token && asked ? `~d${asked}` : "";
				return {
					link_token: `${FAKE_LINK_TOKEN_PREFIX}${mode}${user.client_user_id}${days}`,
					expiration: "",
				};
			}
			case "/item/public_token/exchange": {
				const token = String(body.public_token);
				if (!token.startsWith("public-fake-")) {
					throw new BankProviderError("Plaid: invalid public token", "INVALID_PUBLIC_TOKEN");
				}
				// The same login again is the same Item, whatever span its link asked for.
				const { login, days } = fakeLogin(token.slice("public-fake-".length));
				return {
					access_token: `access-fake-${login}${days === null ? "" : `~d${days}`}`,
					item_id: `item-fake-${login}`,
				};
			}
			case "/accounts/get":
				return { accounts: FAKE_ACCOUNTS };
			case "/transactions/sync": {
				const cursor = body.cursor ?? null;
				const none = { added: [], modified: [], removed: [] };
				// The span the Item's link asked for, when its access token says.
				const { days } = fakeLogin(String(body.access_token ?? ""));
				const from = days === null ? null : addDays(today, -days);
				const asked = (lines: PlaidTransaction[]) =>
					from === null ? lines : lines.filter((line) => line.date >= from);
				const last =
					days === null ? lastPage : [...asked([...lastPage, ...older.asked]), ...older.regardless];
				const page =
					cursor === null
						? { ...none, added: asked(firstPage), next_cursor: FIRST_CURSOR, has_more: true }
						: cursor === FIRST_CURSOR
							? { ...none, added: last, next_cursor: SECOND_CURSOR, has_more: false }
							: cursor === SECOND_CURSOR
								? { ...later, next_cursor: LAST_CURSOR, has_more: false }
								: { ...none, next_cursor: LAST_CURSOR, has_more: false };
				return { ...page, transactions_update_status: "HISTORICAL_UPDATE_COMPLETE" };
			}
			case "/item/remove":
				return { request_id: "fake-remove" };
			case "/item/webhook/update":
				return { item: { webhook: body.webhook } };
			case "/webhook_verification_key/get": {
				if (body.key_id !== FAKE_WEBHOOK_KEY_ID) {
					throw new BankProviderError("Plaid: no such key", "INVALID_WEBHOOK_VERIFICATION_KEY_ID");
				}
				const { d: _, ...key } = FAKE_WEBHOOK_PRIVATE_KEY;
				return {
					key: { ...key, alg: "ES256", use: "sig", kid: FAKE_WEBHOOK_KEY_ID, expired_at: null },
				};
			}
			default:
				throw new BankProviderError(`Plaid: no fake for ${path}`);
		}
	};
}
