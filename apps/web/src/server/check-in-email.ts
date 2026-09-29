import type { CheckInCard, DayKey } from "@noodle/domain";
import { checkInLine } from "../check-in";
import { shortDay } from "../format";

// What the Check-in's email summary says. Pure, so it's unit-tested; the nightly run sends it.
// Each Parent's is built from their own cards, read for them alone (ADR-0003), so one Parent's
// email never mentions the other's Personal Allowance.

export type CheckInEmail = { subject: string; text: string; html: string };

const escapeHtml = (text: string) =>
	text.replace(
		/[&<>"']/g,
		(char) =>
			({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char,
	);

/** One card's line in plain text, with the Insights' titles after theirs. */
const textLine = (card: CheckInCard) =>
	card.kind === "insights"
		? `- ${checkInLine(card)}: ${card.titles.join("; ")}`
		: `- ${checkInLine(card)}`;

/**
 * A Parent's Check-in email: what waits for them this week, and a link to start (`link`, when
 * the app knows its own address).
 */
export function checkInEmail(input: {
	name: string;
	week: DayKey;
	cards: readonly CheckInCard[];
	link: string | null;
}): CheckInEmail {
	const { name, week, cards, link } = input;
	const intro =
		cards.length === 0
			? "Nothing needs you this week. A quick look and you’re done."
			: "Here’s what waits for you this week:";
	const start = link ? `Start your Check-in: ${link}` : "Open Noodle to start your Check-in.";
	const text = [
		`Hi ${name},`,
		"",
		`It’s Check-in day. ${intro}`,
		...(cards.length > 0 ? ["", ...cards.map(textLine)] : []),
		"",
		`It takes a few minutes. ${start}`,
	].join("\n");
	const items = cards
		.map((card) => {
			const titles =
				card.kind === "insights"
					? `<ul>${card.titles.map((title) => `<li>${escapeHtml(title)}</li>`).join("")}</ul>`
					: "";
			return `<li>${escapeHtml(checkInLine(card))}${titles}</li>`;
		})
		.join("");
	const html = [
		`<p>Hi ${escapeHtml(name)},</p>`,
		`<p>It’s Check-in day. ${escapeHtml(intro)}</p>`,
		cards.length > 0 ? `<ul>${items}</ul>` : "",
		link
			? `<p>It takes a few minutes. <a href="${escapeHtml(link)}">Start your Check-in</a></p>`
			: "<p>It takes a few minutes. Open Noodle to start your Check-in.</p>",
	].join("");
	return { subject: `Your Check-in for the week of ${shortDay(week)}`, text, html };
}
