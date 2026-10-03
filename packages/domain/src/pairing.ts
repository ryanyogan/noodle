import type { BankAccount } from "./bank-connections";
import { type AccountKind, holdsMoney } from "./goals";
import type { Cents } from "./money";
import { type DayKey, daysBetween } from "./month";
import { normalizeDescription } from "./statements";

// Connecting a bank pairs each of the institution's accounts with an Account the Household
// already has, or adds it as a new one (ADR-0020). Two decisions, both pure: which Account to
// suggest for each bank account, and which of a bank's lines are lines already in the Account
// (from a statement, or an earlier Bank Connection), so they aren't brought in twice.

/** An Account the Household has, as pairing reads it. */
export type PairableAccount = {
	id: string;
	name: string;
	kind: AccountKind;
	/** Paired with a Bank Connection already: its ID and the bank's ID for the account. */
	bankConnectionId: string | null;
	externalId: string | null;
	/** The last four digits its latest statement file said it's for, when one did. */
	statementDigits?: string | null;
};

/**
 * Whether a bank account of `bankKind` can pair with an Account of `kind`: both hold money
 * (checking, savings) or both are owed (cards, loans). The Account keeps its own kind.
 */
export const canPair = (bankKind: AccountKind, kind: AccountKind) =>
	holdsMoney(bankKind) === holdsMoney(kind);

/**
 * The Accounts a bank account of a Bank Connection may pair with: of a compatible kind, and not
 * paired with any Bank Connection already, unless it's this very bank account's.
 */
export function pairableFor(
	bank: Pick<BankAccount, "externalId"> & { kind: AccountKind },
	connectionId: string,
	accounts: readonly PairableAccount[],
): PairableAccount[] {
	return accounts.filter(
		(account) =>
			canPair(bank.kind, account.kind) &&
			(account.bankConnectionId === null ||
				(account.bankConnectionId === connectionId && account.externalId === bank.externalId)),
	);
}

/** Words that say what kind of account it is, not which one. */
const GENERIC = new Set([
	"account",
	"accounts",
	"and",
	"bank",
	"by",
	"card",
	"cards",
	"checking",
	"credit",
	"debit",
	"for",
	"loan",
	"my",
	"of",
	"online",
	"our",
	"personal",
	"plaid",
	"saving",
	"savings",
	"the",
	"total",
]);

/** A name's distinctive words: lowercase letters and digits, no generic ones, no lone digits. */
const wordsOf = (text: string) =>
	new Set(
		normalizeDescription(text.replace(/[’']/g, ""))
			.split(" ")
			.filter((word) => word.length > 1 && !GENERIC.has(word) && !/^\d+$/.test(word)),
	);

/** The bank's last digits, standing alone in an Account's name ("Visa ••3333", "card x3333"). */
const hasDigits = (name: string, mask: string | null) =>
	mask !== null && /^\d{2,}$/.test(mask) && new RegExp(`(^|\\D)${mask}($|\\D)`).test(name);

/** How strongly an Account looks like a bank account: 0 means no reason to suggest it. */
export function pairingScore(
	bank: Pick<BankAccount, "name" | "mask"> & { kind: AccountKind },
	institution: string | null,
	account: Pick<PairableAccount, "name" | "kind" | "statementDigits">,
): number {
	if (!canPair(bank.kind, account.kind)) return 0;
	const theirs = new Set([...wordsOf(bank.name), ...wordsOf(institution ?? "")]);
	const shared = [...wordsOf(account.name)].filter((word) => theirs.has(word)).length;
	// Its last digits in the Account's name, or on the statements uploaded to it.
	const digits =
		hasDigits(account.name, bank.mask) ||
		(bank.mask !== null &&
			bank.mask.length >= 4 &&
			account.statementDigits === bank.mask.slice(-4));
	if (!digits && shared === 0) return 0;
	return (digits ? 10 : 0) + shared * 3 + (bank.kind === account.kind ? 1 : 0);
}

/**
 * The Account to suggest for each bank account (by its external ID), when there's a reason to
 * (pairingScore): best pairs first, each Account suggested at most once. A bank account already
 * paired keeps its Account.
 */
export function suggestPairings(
	banks: readonly (Pick<BankAccount, "externalId" | "name" | "mask"> & { kind: AccountKind })[],
	institution: string | null,
	connectionId: string,
	accounts: readonly PairableAccount[],
): Map<string, string> {
	const suggested = new Map<string, string>();
	const taken = new Set<string>();
	for (const bank of banks) {
		const paired = accounts.find(
			(a) => a.bankConnectionId === connectionId && a.externalId === bank.externalId,
		);
		if (paired) {
			suggested.set(bank.externalId, paired.id);
			taken.add(paired.id);
		}
	}
	const pairs = banks
		.filter((bank) => !suggested.has(bank.externalId))
		.flatMap((bank, b) =>
			pairableFor(bank, connectionId, accounts)
				.filter((account) => account.bankConnectionId === null)
				.map((account, a) => ({
					bank: bank.externalId,
					account: account.id,
					score: pairingScore(bank, institution, account),
					order: b * 1000 + a,
				})),
		)
		.filter((pair) => pair.score > 0)
		.sort((x, y) => y.score - x.score || x.order - y.order);
	for (const pair of pairs) {
		if (suggested.has(pair.bank) || taken.has(pair.account)) continue;
		suggested.set(pair.bank, pair.account);
		taken.add(pair.account);
	}
	return suggested;
}

/** How many days apart the same line may be dated by a statement and by the bank. */
export const SAME_LINE_DAYS = 3;

/** A line, in a statement's terms: money in positive, money out negative. */
export type LineToPair = { date: DayKey; amount: Cents; description: string | null };

/**
 * Which incoming lines are lines already in the Account from elsewhere (ADR-0020): the same
 * amount, dated at most SAME_LINE_DAYS apart. Each line on either side pairs at most once,
 * nearest day first, then the description sharing more words, then in order. Returns, for each
 * incoming line, the ID of the line already there, or null when it's new.
 */
export function pairSameLines(
	here: readonly (LineToPair & { id: string })[],
	incoming: readonly LineToPair[],
): (string | null)[] {
	const pairs: { i: number; h: number; days: number; words: number }[] = [];
	incoming.forEach((line, i) => {
		here.forEach((row, h) => {
			if (row.amount !== line.amount) return;
			const days = Math.abs(daysBetween(row.date, line.date));
			if (days > SAME_LINE_DAYS) return;
			const mine = wordsOf(line.description ?? "");
			const words = [...wordsOf(row.description ?? "")].filter((w) => mine.has(w)).length;
			pairs.push({ i, h, days, words });
		});
	});
	pairs.sort((x, y) => x.days - y.days || y.words - x.words || x.i - y.i || x.h - y.h);
	const result: (string | null)[] = incoming.map(() => null);
	const used = new Set<number>();
	for (const pair of pairs) {
		if (result[pair.i] !== null || used.has(pair.h)) continue;
		result[pair.i] = (here[pair.h] as { id: string }).id;
		used.add(pair.h);
	}
	return result;
}
