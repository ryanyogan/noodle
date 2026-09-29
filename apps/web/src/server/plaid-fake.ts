import { addDays, type DayKey, type PlaidAccount, type PlaidTransaction } from "@noodle/domain";
import { BankProviderError } from "./bank-connection";
import type { PlaidTransport } from "./plaid";

// A stand-in for Plaid's API, for tests and E2E (AI_MODEL=stub): answers the calls plaid.ts makes,
// the same way every time. Its Item has a checking, savings, credit card and loan account, plus an
// investment account the app doesn't track. Its transactions come in two pages (has_more), dated
// back from `today` so they land in recent months, with a pending one Plaid would later post; a
// read from the last cursor finds nothing new. The browser's side of Link is faked too
// (bank-connections.tsx): a fake link token turns straight into its public token.

const FAKE_LINK_TOKEN_PREFIX = "link-fake-";

const FIRST_CURSOR = "fake-cursor-1";
const LAST_CURSOR = "fake-cursor-2";

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
	account("fake-savings", "Plaid Saving", "1111", "depository", "savings", 8_200),
	account("fake-card", "Plaid Credit Card", "3333", "credit", "credit card", 410.25),
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

/** The fake Plaid API, dated from `today`. */
export function fakePlaidTransport(today: DayKey): PlaidTransport {
	const [firstPage, lastPage] = fakeTransactions(today);
	return async (path, body) => {
		switch (path) {
			case "/link/token/create": {
				const user = body.user as { client_user_id: string };
				return { link_token: `${FAKE_LINK_TOKEN_PREFIX}${user.client_user_id}`, expiration: "" };
			}
			case "/item/public_token/exchange": {
				const token = String(body.public_token);
				if (!token.startsWith("public-fake-")) {
					throw new BankProviderError("Plaid: invalid public token", "INVALID_PUBLIC_TOKEN");
				}
				// The same login again is the same Item.
				const login = token.slice("public-fake-".length);
				return { access_token: `access-fake-${login}`, item_id: `item-fake-${login}` };
			}
			case "/accounts/get":
				return { accounts: FAKE_ACCOUNTS };
			case "/transactions/sync": {
				const cursor = body.cursor ?? null;
				const page =
					cursor === null
						? { added: firstPage, next_cursor: FIRST_CURSOR, has_more: true }
						: cursor === FIRST_CURSOR
							? { added: lastPage, next_cursor: LAST_CURSOR, has_more: false }
							: { added: [], next_cursor: LAST_CURSOR, has_more: false };
				return {
					...page,
					modified: [],
					removed: [],
					transactions_update_status: "HISTORICAL_UPDATE_COMPLETE",
				};
			}
			default:
				throw new BankProviderError(`Plaid: no fake for ${path}`);
		}
	};
}
