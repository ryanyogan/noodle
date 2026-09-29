import type { CheckInCard, DayKey } from "@noodle/domain";
import { describe, expect, it } from "vitest";
import { checkInEmail } from "./check-in-email";

const week = "2026-09-27" as DayKey;
const cards: CheckInCard[] = [
	{ kind: "review", count: 1 },
	{ kind: "insights", titles: ["Netflix & Hulu <both>", "Gym went up"] },
];

describe("checkInEmail", () => {
	it("lists what waits for the Parent, with a link to start", () => {
		const email = checkInEmail({ name: "Alex", week, cards, link: "https://noodle.test/check-in" });
		expect(email.subject).toBe("Your Check-in for the week of Sep 27");
		expect(email.text).toBe(
			[
				"Hi Alex,",
				"",
				"It’s Check-in day. Here’s what waits for you this week:",
				"",
				"- 1 Transaction in Review",
				"- 2 new Insights: Netflix & Hulu <both>; Gym went up",
				"",
				"It takes a few minutes. Start your Check-in: https://noodle.test/check-in",
			].join("\n"),
		);
		expect(email.html).toContain('<a href="https://noodle.test/check-in">Start your Check-in</a>');
	});

	it("escapes what the Household wrote", () => {
		const email = checkInEmail({ name: "<Alex>", week, cards, link: null });
		expect(email.html).toContain("<p>Hi &lt;Alex&gt;,</p>");
		expect(email.html).toContain("<li>Netflix &amp; Hulu &lt;both&gt;</li>");
		expect(email.html).not.toContain("<both>");
	});

	it("still goes out on a quiet week", () => {
		const email = checkInEmail({ name: "Alex", week, cards: [], link: null });
		expect(email.text).toContain("Nothing needs you this week.");
		expect(email.html).not.toContain("<ul>");
	});

	it("says to open Noodle when it doesn't know its own address", () => {
		const email = checkInEmail({ name: "Alex", week, cards, link: null });
		expect(email.text).toContain("Open Noodle to start your Check-in.");
		expect(email.html).not.toContain("<a ");
	});
});
