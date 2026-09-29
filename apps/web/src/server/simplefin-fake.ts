import {
	addDays,
	type DayKey,
	type SimplefinAccount,
	type SimplefinAccountSet,
	type SimplefinTransaction,
} from "@noodle/domain";
import { BankProviderError } from "./bank-connection";
import { SETUP_TOKEN_CLAIMED, type SimplefinTransport } from "./simplefin";

// A stand-in for a SimpleFIN Bridge, for tests and E2E (AI_MODEL=stub): answers the requests
// simplefin.ts makes, as the Bridge's version 2 does, the same way every time. Its setup tokens
// are the base64 of https://bridge.simplefin.fake/simplefin/claim/<code>; a code starting "USED"
// is one claimed already (403), and one starting "NOTICE" a login whose reads come with a message
// for the Parent, marked up as the Bridge's can be. Its login reaches one credit union with a checking, savings,
// credit card and loan account, plus a brokerage account the app doesn't track. Its transactions
// are dated back from `today` so they land in recent months, with a pending one (sent only when
// asked for with pending=1), and honour start-date and end-date.

const HOST = "bridge.simplefin.fake";

/** A fake setup token, for the code; the same code again is the same Bridge login. */
export const fakeSetupToken = (code: string) => btoa(`https://${HOST}/simplefin/claim/${code}`);

const at = (day: DayKey) => Date.parse(`${day}T12:00:00Z`) / 1000;

const CONNECTION = {
	conn_id: "CON-8d1f2a",
	name: "Prairie State Credit Union",
	org_id: "prairiestatecu",
	org_url: "prairiestatecu.example",
	sfin_url: `https://${HOST}/simplefin`,
};

/** The fake login's Account Set, dated from `today`, with every transaction and the pending one. */
export function fakeAccountSet(today: DayKey): SimplefinAccountSet {
	const t = (
		id: string,
		daysAgo: number,
		amount: string,
		description: string,
		pending = false,
	): SimplefinTransaction => {
		const day = addDays(today, -daysAgo);
		return {
			id,
			posted: pending ? 0 : at(day),
			amount,
			description,
			transacted_at: at(addDays(day, -1)),
			pending,
		};
	};
	const account = (
		id: string,
		name: string,
		balance: string,
		transactions: SimplefinTransaction[],
		extra: Partial<SimplefinAccount> = {},
	): SimplefinAccount => ({
		id,
		name,
		conn_id: CONNECTION.conn_id,
		currency: "USD",
		balance,
		"available-balance": balance,
		"balance-date": at(today),
		transactions,
		...extra,
	});
	return {
		errlist: [],
		connections: [CONNECTION],
		accounts: [
			account("ACT-0a41c7", "Share Draft Checking", "3184.22", [
				t("TRN-c1", 2, "-86.41", "HY-VEE #1124 DES MOINES IA"),
				t("TRN-c2", 4, "2650.00", "ACME CORP PAYROLL PPD"),
				t("TRN-c3", 9, "-1450.00", "EVERGREEN PROPERTY RENT"),
				t("TRN-c4", 0, "-18.75", "CASEYS #3301", true),
			]),
			account("ACT-0a41c8", "Regular Savings", "8200.00", [
				t("TRN-s1", 11, "1.87", "DIVIDEND EARNED"),
			]),
			account("ACT-77e3b0", "Visa Signature Rewards", "-612.40", [
				t("TRN-v1", 3, "-42.18", "SHELL OIL 57442"),
				t("TRN-v2", 6, "-129.64", "COSTCO WHSE #0367"),
				t("TRN-v3", 13, "250.00", "PAYMENT THANK YOU"),
			]),
			account("ACT-2f9e61", "Auto Loan", "-11820.55", [
				t("TRN-l1", 15, "310.00", "PAYMENT RECEIVED"),
			]),
			account("ACT-9b0c14", "Brokerage", "23631.98", [t("TRN-b1", 5, "-500.00", "TRANSFER")], {
				holdings: [{ id: "HOL-1", symbol: "VTI", shares: "100" }],
			}),
		],
	};
}

/** The fake Bridge, dated from `today`. */
export function fakeSimplefinTransport(today: DayKey): SimplefinTransport {
	return {
		async claim(claimUrl) {
			const url = new URL(claimUrl);
			const code = url.pathname.split("/claim/")[1] ?? "";
			if (url.host !== HOST || code === "" || code.startsWith("USED")) {
				throw new BankProviderError("SimpleFIN: claim refused", SETUP_TOKEN_CLAIMED);
			}
			return `https://user-${code}:secret-${code}@${HOST}/simplefin`;
		},
		async accounts(accessUrl, query) {
			if (new URL(accessUrl).host !== HOST)
				throw new BankProviderError("SimpleFIN: HTTP 403", "403");
			const set = fakeAccountSet(today);
			if (new URL(accessUrl).username.startsWith("user-NOTICE")) {
				set.errlist = [
					{ code: "gen.notice", msg: "Your bank asks you to <b>sign in again</b> at the Bridge." },
				];
			}
			const start = Number(query.get("start-date") ?? 0);
			const end = Number(query.get("end-date") ?? Number.POSITIVE_INFINITY);
			const pending = query.get("pending") === "1";
			return {
				...set,
				accounts: set.accounts.map(({ transactions, ...account }) =>
					query.get("balances-only") === "1"
						? account
						: {
								...account,
								transactions: (transactions ?? []).filter((transaction) =>
									transaction.pending
										? pending
										: transaction.posted >= start && transaction.posted < end,
								),
							},
				),
			};
		},
	};
}
