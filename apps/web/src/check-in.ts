import type { CheckInCard, CheckInStackCard } from "@noodle/domain";
import { formatMoney, monthName } from "./format";

// How the weekly Check-in's cards read, in a line each: on its screen, in its Nudge, and in its
// email. Each card was read for the Parent it's shown to, so nothing here filters.

const plural = (count: number, one: string, many = `${one}s`) =>
	`${count} ${count === 1 ? one : many}`;

/** "3 Transactions in Review", "$55 to Sweep from August", …: what a card is, in a line. */
export function checkInLine(card: CheckInCard): string {
	switch (card.kind) {
		case "review":
			return `${plural(card.count, "Transaction")} in Review`;
		case "insights":
			return plural(card.titles.length, "new Insight");
		case "sweeps":
			return `${formatMoney(card.total)} to Sweep from ${monthName(card.month)}`;
		case "windfalls":
			return card.windfalls.length === 1
				? `${formatMoney(card.total)} of Extra income to decide`
				: `${formatMoney(card.total)} of Extra income to decide, from ${card.windfalls.length} months`;
	}
}

/** Every card's line, as one sentence: "3 Transactions in Review, 1 new Insight." */
export function checkInSummary(cards: readonly CheckInCard[]): string {
	if (cards.length === 0) return "Nothing needs you this week.";
	const lines = cards.map(checkInLine);
	return `${lines[0]}${lines
		.slice(1)
		.map((line) => `, ${line.charAt(0).toLowerCase()}${line.slice(1)}`)
		.join("")}.`;
}

/** "You", "Sam", "You and Sam": who dealt with a card, as the Parent `me` reads it. */
function doers(by: Extract<CheckInStackCard, { state: "dealt" }>["by"], me: string): string | null {
	if (by.length === 0) return null;
	// The reader first.
	const names = [...by]
		.sort((a, b) => Number(b.memberId === me) - Number(a.memberId === me))
		.map((doer) => (doer.memberId === me ? "You" : doer.name));
	return names.length === 1
		? (names[0] ?? null)
		: `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/**
 * What was done about a card that nothing waits on any more, in a line: "Sam decided $250 of
 * Extra income", "3 Transactions cleared from Review". It names who where there's a record of
 * it (nobody is on record for Review), and the figures are what the card held when it joined
 * the week's stack, read for this Parent.
 */
export function checkInDealtLine(
	card: Extract<CheckInStackCard, { state: "dealt" }>,
	me: string,
): string {
	const who = doers(card.by, me);
	const started = card.started;
	switch (started.kind) {
		case "review":
			return `${plural(started.count, "Transaction")} cleared from Review`;
		case "insights": {
			const what = plural(started.count, "Insight");
			return who ? `${who} decided ${what}` : `${what} decided`;
		}
		case "sweeps": {
			const what = `${formatMoney(started.total)} of Sweeps from ${monthName(started.month)}`;
			return who ? `${who} decided ${what}` : `${what} decided`;
		}
		case "windfalls": {
			const what = `${formatMoney(started.total)} of Extra income`;
			return who ? `${who} decided ${what}` : `${what} decided`;
		}
	}
}

/**
 * A card of the week's stack in a line, for the Parent `me`: what waits on it, what was done
 * about it, or "Skipped" when they moved past it while it still waits.
 */
export function checkInStackLine(card: CheckInStackCard, me: string, skipped: boolean): string {
	if (card.state === "dealt") return checkInDealtLine(card, me);
	return skipped ? "Skipped" : checkInLine(card.card);
}

/** What each card is called on its screen. */
export const checkInCardTitle: Record<CheckInCard["kind"], string> = {
	review: "Review",
	insights: "Insights",
	sweeps: "Sweeps",
	windfalls: "Extra income",
};

/** The weekday names, Sunday first, for choosing the Check-in day. */
export const weekdayNames = [
	"Sunday",
	"Monday",
	"Tuesday",
	"Wednesday",
	"Thursday",
	"Friday",
	"Saturday",
] as const;
