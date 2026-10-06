import type { Cents } from "./money";
import type { DayKey } from "./month";

// Paid back and Owed back (ADR-0058). Owed back is the part of a purchase someone outside the
// Household's pool of money has said they'll pay back, and who: a name, not a Member. Paid back is
// money in of that kind; it is offered against what's open, oldest first, and nothing is applied
// until a Parent confirms. Pure: no I/O.

/** One Owed back item: what was said on a purchase, and how much of it has been Paid back. */
export type OwedBack = {
	id: string;
	/** The purchase's day; the oldest is offered first. */
	date: DayKey;
	who: string;
	owed: Cents;
	paid: Cents;
};

/** Part of a Paid back line put against one Owed back item. */
export type PaidBackMatch = { owedBackId: string; amount: Cents };

/** What a payment is offered against, and what of it is "Paid back, not matched yet". */
export type PaidBackOffer = { matches: PaidBackMatch[]; unmatched: Cents };

export const OWED_BACK_NAME_MAX = 40;

/** A person's name as kept: trimmed, single spaces, at most OWED_BACK_NAME_MAX; "" when nothing. */
export function cleanOwedBackName(name: string): string {
	return name.trim().replace(/\s+/g, " ").slice(0, OWED_BACK_NAME_MAX).trim();
}

/** How much is Owed back unless a Parent or a Rule says: half the purchase. */
export function defaultOwedBack(amount: Cents): Cents {
	return Math.round(amount / 2) as Cents;
}

/** What is still owed on an item. */
export function owedBackLeft(item: Pick<OwedBack, "owed" | "paid">): Cents {
	return Math.max(0, item.owed - item.paid) as Cents;
}

const oldestFirst = (a: OwedBack, b: OwedBack) =>
	a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

/**
 * A payment offered against open items: oldest first, each item the money still covers in full;
 * then what's left goes on the oldest items still open, which stay partly owed. Money beyond
 * everything owed is `unmatched`. An offer only: a Parent adjusts and confirms it.
 */
export function offerPaidBack(payment: Cents, items: readonly OwedBack[]): PaidBackOffer {
	const open = items.filter((item) => owedBackLeft(item) > 0).sort(oldestFirst);
	const given = new Map<string, number>();
	let left = Math.max(0, payment);
	for (const item of open) {
		const owed = owedBackLeft(item);
		if (owed > left) continue;
		given.set(item.id, owed);
		left -= owed;
	}
	for (const item of open) {
		if (left === 0) break;
		if (given.has(item.id)) continue;
		const part = Math.min(left, owedBackLeft(item));
		given.set(item.id, part);
		left -= part;
	}
	return {
		matches: open
			.filter((item) => given.has(item.id))
			.map((item) => ({ owedBackId: item.id, amount: (given.get(item.id) ?? 0) as Cents })),
		unmatched: left as Cents,
	};
}

export type PaidBackCheck =
	| { ok: true; unmatched: Cents }
	/**
	 * `not-owed`: an item that isn't open, named twice, or given nothing; `more-than-owed`: more
	 * than the item still owes; `more-than-paid`: together more than the payment.
	 */
	| { ok: false; reason: "not-owed" | "more-than-owed" | "more-than-paid" };

/** Whether the matches a Parent settled on fit the open items and the payment. */
export function checkPaidBack(
	payment: Cents,
	items: readonly OwedBack[],
	matches: readonly PaidBackMatch[],
): PaidBackCheck {
	const byId = new Map(items.map((item) => [item.id, item]));
	const seen = new Set<string>();
	let total = 0;
	for (const match of matches) {
		const item = byId.get(match.owedBackId);
		if (!item || seen.has(match.owedBackId)) return { ok: false, reason: "not-owed" };
		if (!Number.isInteger(match.amount) || match.amount <= 0)
			return { ok: false, reason: "not-owed" };
		if (match.amount > owedBackLeft(item)) return { ok: false, reason: "more-than-owed" };
		seen.add(match.owedBackId);
		total += match.amount;
	}
	if (total > payment) return { ok: false, reason: "more-than-paid" };
	return { ok: true, unmatched: (payment - total) as Cents };
}

/** The items as they'd be with these matches applied, in the order given. */
export function settleOwedBack(
	items: readonly OwedBack[],
	matches: readonly PaidBackMatch[],
): OwedBack[] {
	return items.map((item) => ({
		...item,
		paid: (item.paid +
			matches
				.filter((match) => match.owedBackId === item.id)
				.reduce((sum, match) => sum + match.amount, 0)) as Cents,
	}));
}

/** One person on the Owed back list: what's outstanding, and the open items, oldest first. */
export type OwedBackPerson<Item extends OwedBack = OwedBack> = {
	who: string;
	left: Cents;
	items: Item[];
};

const personKey = (who: string) => who.trim().toLowerCase();

/**
 * The Owed back list: each person with something outstanding, by name. "casey" and "Casey" are
 * one person, shown as first written. Settled items are left out.
 */
export function owedBackByPerson<Item extends OwedBack>(
	items: readonly Item[],
): OwedBackPerson<Item>[] {
	const people = new Map<string, OwedBackPerson<Item>>();
	for (const item of items) {
		const key = personKey(item.who);
		const person = people.get(key) ?? { who: item.who, left: 0 as Cents, items: [] };
		people.set(key, person);
		if (owedBackLeft(item) === 0) continue;
		person.left = (person.left + owedBackLeft(item)) as Cents;
		person.items.push(item);
	}
	return [...people.values()]
		.filter((person) => person.left > 0)
		.map((person) => ({ ...person, items: [...person.items].sort(oldestFirst) }))
		.sort((a, b) => a.who.localeCompare(b.who));
}

/**
 * What's still owed back across these items and by whom, for one line ("$600 owed back by
 * Casey"); null when nothing is.
 */
export function owedBackSummary(items: readonly OwedBack[]): { left: Cents; who: string[] } | null {
	const people = owedBackByPerson(items);
	if (people.length === 0) return null;
	return {
		left: people.reduce((sum, person) => sum + person.left, 0) as Cents,
		who: people.map((person) => person.who),
	};
}

const words = (text: string) =>
	text
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter(Boolean);

/**
 * Which of the people who owe a payment's wording names ("Zelle payment from CASEY LOWE"), by
 * whole words; the longest name wins. Null when it names none of them.
 */
export function owedBackPersonIn(text: string | null, names: readonly string[]): string | null {
	if (!text) return null;
	const said = new Set(words(text));
	const named = names
		.filter((name) => {
			const parts = words(name);
			return parts.length > 0 && parts.every((part) => said.has(part));
		})
		.sort((a, b) => b.length - a.length);
	return named[0] ?? null;
}
