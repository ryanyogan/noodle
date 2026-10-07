import type { Cents } from "./money";
import { type DayKey, daysInMonth, type MonthKey, monthOfDay } from "./month";

// A card Account says how its purchases get into Noodle (issue 136, spec 130 items 7 and 8), and
// what follows for one kept by hand (an Apple Card, which no bank connection reaches): the Wallet
// card a capture names, and the monthly check of its statement balance.

/** What a Parent can answer to "How do its purchases get into Noodle?". */
export const PURCHASES_GET_IN = ["statements", "hand", "none"] as const;
export type PurchasesGetIn = (typeof PURCHASES_GET_IN)[number];

/** How a card's purchases get in: by its bank, or as the Parent answered; null until they do. */
export type CardKept = "bank" | PurchasesGetIn;

/**
 * How a card's purchases get into Noodle. One that syncs with its bank is "bank" whatever was
 * answered; else the Parent's answer; else "statements" when a statement's purchases came in
 * lately (`followed`, ADR-0050); else null: not asked yet.
 */
export function cardKept(account: {
	bankConnectionId: string | null;
	purchases: PurchasesGetIn | null;
	followed?: boolean;
}): CardKept | null {
	if (account.bankConnectionId !== null) return "bank";
	return account.purchases ?? (account.followed ? "statements" : null);
}

/**
 * Whether a payment to a card is itself the spending, so "It's a card payment" files it in the
 * Commitment that pays the card down. It is when there is such a Commitment and the card's
 * purchases aren't in Noodle one by one from its bank or its statements: a card kept by hand, one
 * whose purchases never come in, and one not asked yet (a Household from before the question).
 * Otherwise the payment is a Transfer naming the card: the purchases are the spending.
 */
export function cardPaymentIsSpending(kept: CardKept | null, paidDownByCommitment: boolean) {
	return paidDownByCommitment && kept !== "bank" && kept !== "statements";
}

/** Lower case, letters and digits only, single spaces: how two card names are compared. */
const cardWords = (name: string) =>
	name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, " ")
		.trim();

/**
 * The Account a Wallet capture's card name says ("Apple Card", "Chase Freedom Unlimited"): the one
 * a Parent said that name is (`walletName`), else the only card Account whose name is that name,
 * or holds it or is held by it as whole words. Null when none or more than one could be meant: a
 * Parent is asked once.
 */
export function accountForWalletCard(
	card: string,
	accounts: readonly { id: string; name: string; kind: string; walletName: string | null }[],
): string | null {
	const wanted = cardWords(card);
	if (!wanted) return null;
	const remembered = accounts.find((a) => a.walletName && cardWords(a.walletName) === wanted);
	if (remembered) return remembered.id;
	const cards = accounts.filter((a) => a.kind === "credit-card");
	const exact = cards.filter((a) => cardWords(a.name) === wanted);
	if (exact.length === 1) return exact[0]?.id ?? null;
	if (exact.length > 1) return null;
	const holds = cards.filter((a) => {
		const name = cardWords(a.name);
		return (
			name !== "" && (` ${wanted} `.includes(` ${name} `) || ` ${name} `.includes(` ${wanted} `))
		);
	});
	return holds.length === 1 ? (holds[0]?.id ?? null) : null;
}

/** What a typed statement balance says against what Noodle has recorded as owed. */
export type BalanceCheck =
	| { kind: "matches" }
	/** The statement is higher: purchases are missing from Noodle. */
	| { kind: "higher"; byCents: Cents }
	/** The statement is lower: a payment or money back is missing, or something was added twice. */
	| { kind: "lower"; byCents: Cents };

/** Compares the statement's balance a Parent typed with what's recorded as owed (null: nothing yet). */
export function balanceCheck(statementCents: Cents, recordedCents: Cents | null): BalanceCheck {
	const difference = statementCents - (recordedCents ?? 0);
	if (difference === 0) return { kind: "matches" };
	return difference > 0
		? { kind: "higher", byCents: difference }
		: { kind: "lower", byCents: -difference };
}

const dayIn = (month: MonthKey, day: number): DayKey =>
	`${month}-${String(Math.min(day, daysInMonth(month))).padStart(2, "0")}` as DayKey;

const monthBefore = (month: MonthKey): MonthKey => {
	const [year, m] = month.split("-").map(Number) as [number, number];
	return (m === 1 ? `${year - 1}-12` : `${year}-${String(m - 1).padStart(2, "0")}`) as MonthKey;
};

/**
 * The statement a card kept by hand is due a balance check for: the latest day its statement
 * closed on or before `today` (`statementDay` of the month, the month's last day when it's
 * shorter), unless a balance true on or after that day is already recorded. Null when no check is
 * due, or the card has no statement day.
 */
export function statementCheckDue(input: {
	statementDay: number | null;
	today: DayKey;
	/** The day the card's latest balance was true; null when it has none. */
	lastBalanceDay: DayKey | null;
}): DayKey | null {
	const { statementDay, today, lastBalanceDay } = input;
	if (statementDay === null) return null;
	const thisMonth = dayIn(monthOfDay(today), statementDay);
	const closed =
		thisMonth <= today ? thisMonth : dayIn(monthBefore(monthOfDay(today)), statementDay);
	return lastBalanceDay !== null && lastBalanceDay >= closed ? null : closed;
}
