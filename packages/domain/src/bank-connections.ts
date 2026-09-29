import type { AccountKind } from "./goals";
import { type Cents, MAX_CENTS } from "./money";
import type { DayKey } from "./month";
import type { StatementLine } from "./statements";

// Bank Connections: what a financial institution reports, read into the app's terms. Each
// provider (Plaid today, SimpleFIN later) hands over its Accounts and their lines in its own
// shape; these turn them into Accounts to create and statement lines to import, so a Bank
// Connection's Import lands exactly as a statement's would, keyed by the bank's own ID for each
// line. A line may be pending (reported, not yet posted) until its posted copy replaces it
// (bank-sync.ts). Plaid reports amounts as decimal dollars, positive for money out (its /transactions/sync
// docs); a statement line is cents, positive for money in.

/** An account at the institution, as the app will hold it. `kind` null: not one the app tracks. */
export type BankAccount = {
	/** The provider's ID for it, stable for as long as the Bank Connection lasts. */
	externalId: string;
	name: string;
	kind: AccountKind | null;
	/**
	 * What's in it, or for a card or loan what's owed, as the institution reports it now; null when
	 * it doesn't say.
	 */
	balance: Cents | null;
};

/** A line for one of the Bank Connection's accounts. `bankId` is the provider's ID. */
export type BankLine = StatementLine & {
	accountExternalId: string;
	bankId: string;
	/** Reported but not yet posted: it may still change, or go. */
	pending?: boolean;
	/** For a posted line, the `bankId` of the pending line it posts, when the provider says. */
	replaces?: string | null;
};

/** An Account's name, at most this long (as a Parent's are). */
export const ACCOUNT_NAME_MAX = 40;

/**
 * The Account kind for an account type as Plaid names them (`type`, `subtype`): depository accounts
 * are checking or savings, credit is a credit card, a loan a loan. Investment and other accounts
 * aren't Accounts here.
 */
export function plaidAccountKind(type: string, subtype: string | null): AccountKind | null {
	switch (type) {
		case "depository":
			return subtype && SAVINGS_SUBTYPES.has(subtype) ? "savings" : "checking";
		case "credit":
			return "credit-card";
		case "loan":
			return "loan";
		default:
			return null;
	}
}

const SAVINGS_SUBTYPES = new Set(["savings", "money market", "cd", "hsa", "cash management"]);

/** A name for an account, with the last digits the institution shows, to tell two cards apart. */
export function bankAccountName(name: string, mask: string | null): string {
	const digits = mask ? ` ··${mask}` : "";
	const base = name.trim() || "Account";
	return base.length + digits.length <= ACCOUNT_NAME_MAX
		? `${base}${digits}`
		: `${base.slice(0, ACCOUNT_NAME_MAX - digits.length - 1).trimEnd()}…${digits}`;
}

/** A decimal dollar amount a provider reports, as cents; null past what the app holds. */
export function dollarsToCents(dollars: number): Cents | null {
	if (!Number.isFinite(dollars)) return null;
	const cents = Math.round(dollars * 100);
	return Math.abs(cents) <= MAX_CENTS ? cents : null;
}

/** An account as Plaid's /accounts/get reports it (the fields read here). */
export type PlaidAccount = {
	account_id: string;
	name: string;
	official_name?: string | null;
	mask: string | null;
	type: string;
	subtype: string | null;
	balances: { current: number | null; iso_currency_code: string | null };
};

/** A Plaid account as a BankAccount: named with its last digits, its balance in cents. */
export function plaidBankAccount(account: PlaidAccount): BankAccount {
	const usd = (account.balances.iso_currency_code ?? "USD") === "USD";
	const current = account.balances.current;
	return {
		externalId: account.account_id,
		name: bankAccountName(account.name, account.mask),
		kind: plaidAccountKind(account.type, account.subtype),
		balance: usd && current !== null ? dollarsToCents(current) : null,
	};
}

/** A transaction as Plaid's /transactions/sync reports it (the fields read here). */
export type PlaidTransaction = {
	transaction_id: string;
	account_id: string;
	amount: number;
	iso_currency_code: string | null;
	date: string;
	authorized_date?: string | null;
	name: string;
	merchant_name?: string | null;
	pending: boolean;
	/** For a posted transaction, the pending one it replaces, when Plaid could pair them. */
	pending_transaction_id?: string | null;
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A Plaid transaction as a line to import, or null for one that isn't one: not in US dollars, or
 * of nothing. A pending one is marked so; its posted copy comes later with an ID of its own, and
 * names it (`pending_transaction_id`). It's dated when the spending happened (authorized) where
 * Plaid knows it, as a Quick Add is, so the two Match, and described by its merchant where Plaid
 * has cleaned one up, else by the bank's words.
 */
export function plaidLine(transaction: PlaidTransaction): BankLine | null {
	if ((transaction.iso_currency_code ?? "USD") !== "USD") return null;
	const date = [transaction.authorized_date, transaction.date].find(
		(day): day is string => typeof day === "string" && DAY.test(day),
	);
	const cents = dollarsToCents(transaction.amount);
	if (!date || cents === null || cents === 0) return null;
	return {
		accountExternalId: transaction.account_id,
		bankId: transaction.transaction_id,
		date: date as DayKey,
		// Plaid's money out is positive; a statement line's money in is.
		amount: -cents,
		description: (transaction.merchant_name || transaction.name || "").trim(),
		pending: transaction.pending,
		replaces: transaction.pending ? null : (transaction.pending_transaction_id ?? null),
	};
}
