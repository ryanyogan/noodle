import { type BankAccount, type BankLine, bankAccountName } from "./bank-connections";
import type { AccountKind } from "./goals";
import { type Cents, MAX_CENTS } from "./money";
import { dayKeyAt } from "./month";

// SimpleFIN, read into the app's terms. Its GET /accounts answer (an Account Set, per the
// SimpleFIN protocol at simplefin.org/protocol.html) lists accounts with their balances and
// transactions. Unlike Plaid it says nothing about what kind of account each is, so the kind is
// read from its name, with the balance's sign to fall back on. Amounts are numeric strings,
// positive for money deposited (as a statement line's are), and times are epoch seconds. Version 1
// of the protocol names each account's institution in `org` and lists errors as strings; version
// 2 has `connections` and a structured `errlist`. Both are read here.

/** An error the SimpleFIN server reported with an Account Set (protocol version 2). */
export type SimplefinError = {
	code: string;
	msg: string;
	conn_id?: string;
	account_id?: string;
};

export type SimplefinTransaction = {
	id: string;
	/** When it posted, in epoch seconds; 0 while pending. */
	posted: number;
	/** Numeric string, positive for money deposited. */
	amount: string;
	description: string;
	/** When it happened, in epoch seconds, where the institution says. */
	transacted_at?: number | null;
	pending?: boolean;
};

export type SimplefinAccount = {
	id: string;
	name: string;
	/** ISO 4217 code, or a URL for a custom currency (points, say). */
	currency: string;
	/** Numeric string: what's in it, negative for what's owed. */
	balance: string;
	"available-balance"?: string;
	"balance-date"?: number;
	transactions?: SimplefinTransaction[];
	/** Version 2: the Connection it's reached through. */
	conn_id?: string;
	/** Version 1: its institution. */
	org?: { name?: string | null; domain?: string | null } | null;
	extra?: Record<string, unknown> | null;
	/** Some servers list an investment account's holdings. */
	holdings?: unknown[] | null;
};

export type SimplefinAccountSet = {
	accounts: SimplefinAccount[];
	/** Version 2. */
	connections?:
		| {
				conn_id: string;
				name: string;
				org_id?: string;
				org_url?: string | null;
				sfin_url?: string;
		  }[]
		| null;
	errlist?: SimplefinError[] | null;
	/** Version 1: messages for the user. */
	errors?: string[] | null;
};

/** A SimpleFIN numeric string as cents; null for anything else, or past what the app holds. */
export function simplefinCents(amount: string): Cents | null {
	const match = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(typeof amount === "string" ? amount.trim() : "");
	if (!match) return null;
	const [, sign, whole = "", fraction = ""] = match;
	if (whole === "" && fraction === "") return null;
	// Read digit by digit, not through a float: "12.345" is half a cent over 12.34, not under.
	const thousandths = Number(whole || "0") * 1000 + Number(fraction.padEnd(3, "0").slice(0, 3));
	const cents = Math.round(thousandths / 10);
	if (!Number.isSafeInteger(thousandths) || cents > MAX_CENTS) return null;
	return sign === "-" ? -cents || 0 : cents;
}

const INVESTMENT =
	/brokerage|invest|\bira\b|roth|401\s?\(?k|403\s?\(?b|\b529\b|retire|pension|annuit|stock|crypto|bitcoin/i;
const SAVINGS = /saving|money market|\bmma\b|\bcds?\b|certificate|\bhsa\b/i;
const CHECKING = /checking|\bchk\b|spending|share draft/i;
const LOAN = /loan|mortgage|heloc|line of credit/i;
const CARD = /credit|card|visa|mastercard|amex|american express|discover/i;

/**
 * The Account kind for a SimpleFIN account, read from its name: savings and checking by name
 * first (a "Rewards Checking" is checking), then loans and cards; otherwise a balance owed is a
 * card's and one held is checking's. Investment accounts, and any not in US dollars, aren't
 * Accounts here.
 */
export function simplefinAccountKind(account: SimplefinAccount): AccountKind | null {
	if (account.currency !== "USD") return null;
	if ((account.holdings?.length ?? 0) > 0) return null;
	const name = account.name ?? "";
	if (INVESTMENT.test(name)) return null;
	if (SAVINGS.test(name)) return "savings";
	if (CHECKING.test(name)) return "checking";
	if (LOAN.test(name)) return "loan";
	if (CARD.test(name)) return "credit-card";
	const balance = simplefinCents(account.balance);
	return balance !== null && balance < 0 ? "credit-card" : "checking";
}

/** A SimpleFIN account as a BankAccount: for a card or loan, its balance is what's owed. */
export function simplefinBankAccount(account: SimplefinAccount): BankAccount {
	const kind = simplefinAccountKind(account);
	const balance = kind === null ? null : simplefinCents(account.balance);
	const owed = kind === "credit-card" || kind === "loan";
	return {
		externalId: account.id,
		name: bankAccountName(account.name ?? "", null),
		kind,
		// SimpleFIN's balance is negative for what's owed; an Account's for a card or loan is positive.
		balance: balance === null ? null : owed ? -balance || 0 : balance,
	};
}

/**
 * A SimpleFIN transaction as a line to import, or null for one that isn't one yet: pending (its
 * posted copy comes later), or with no amount. It's dated when the spending happened where the
 * institution says, else when it posted, as a Quick Add is, so the two Match. The day is UTC's:
 * SimpleFIN's times are instants, and institutions put a posting date at a UTC midnight or noon.
 */
export function simplefinLine(
	accountId: string,
	transaction: SimplefinTransaction,
): BankLine | null {
	if (transaction.pending || !transaction.posted) return null;
	const cents = simplefinCents(transaction.amount);
	if (cents === null || cents === 0) return null;
	const at = transaction.transacted_at || transaction.posted;
	const instant = new Date(at * 1000);
	if (!Number.isFinite(instant.getTime())) return null;
	return {
		accountExternalId: accountId,
		bankId: transaction.id,
		date: dayKeyAt(instant, "UTC"),
		amount: cents,
		description: (transaction.description ?? "").trim(),
	};
}

/**
 * The institutions an Account Set reaches, as a Bank Connection's name: one SimpleFIN Bridge
 * login can link several. Null when the server doesn't name any.
 */
export function simplefinInstitution(set: SimplefinAccountSet): string | null {
	const byConnection = new Map((set.connections ?? []).map((c) => [c.conn_id, c.name]));
	const names = [
		...new Set(
			set.accounts
				.map((account) =>
					(
						(account.conn_id ? byConnection.get(account.conn_id) : null) ??
						account.org?.name ??
						account.org?.domain ??
						""
					).trim(),
				)
				.filter((name) => name !== ""),
		),
	];
	const [first, second] = names;
	if (!first) return null;
	if (!second) return first;
	return names.length === 2 ? `${first} and ${second}` : `${first} and ${names.length - 1} others`;
}

/** The longest message kept from the server, so one can't fill the Parent's screen. */
const MESSAGE_LIMIT = 300;

const ENTITIES: Record<string, string> = {
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	apos: "'",
	nbsp: " ",
};

/** A server's message as plain text: its markup dropped, its entities read, its spacing tidied. */
function plainText(message: string): string {
	const text = message
		.replace(/<[^>]*>/g, " ")
		.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, name: string) => {
			if (name[0] !== "#") return ENTITIES[name.toLowerCase()] ?? entity;
			const code =
				name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : Number(name.slice(1));
			return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
		})
		.replace(/\s+/g, " ")
		.trim();
	return text.length > MESSAGE_LIMIT ? `${text.slice(0, MESSAGE_LIMIT - 1).trimEnd()}…` : text;
}

/**
 * The messages a SimpleFIN server sent with an Account Set, for the Parent to see (the Bridge asks
 * apps to show them), as plain text, each once.
 */
export function simplefinErrors(set: SimplefinAccountSet): string[] {
	const messages = [
		...(set.errlist ?? []).map((error) => error.msg || error.code),
		...(set.errors ?? []).filter((error) => typeof error === "string"),
	].map(plainText);
	return [...new Set(messages.filter((message) => message !== ""))];
}

/**
 * Whether the server said some account's transactions couldn't all be read (a connection or
 * account error, or any version 1 error, which doesn't say). General notices, such as a warning
 * about how often it's asked, don't mean anything is missing.
 */
export function simplefinMissedLines(set: SimplefinAccountSet): boolean {
	return (
		(set.errors ?? []).length > 0 ||
		(set.errlist ?? []).some((error) => /^(con|act)\./.test(error.code))
	);
}
