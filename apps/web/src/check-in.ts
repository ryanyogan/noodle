import type { CheckInCard } from "@noodle/domain";
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
				? `A ${formatMoney(card.total)} Windfall to decide`
				: `${formatMoney(card.total)} in Windfalls to decide`;
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

/** What each card is called on its screen. */
export const checkInCardTitle: Record<CheckInCard["kind"], string> = {
	review: "Review",
	insights: "Insights",
	sweeps: "Sweeps",
	windfalls: "Windfalls",
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
