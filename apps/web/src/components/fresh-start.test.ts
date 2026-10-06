import { describe, expect, it } from "vitest";
import { stillNeeded, troubleWords, whenItRuns } from "./fresh-start";

// "Scheduled for …": one Parent's fresh start runs now (today), two Parents' a day later.

describe("whenItRuns", () => {
	const now = new Date(2026, 9, 3, 15, 12);
	it("says today for one run at once", () => {
		expect(whenItRuns(now.getTime(), now)).toBe("today 3:12 PM");
	});
	it("says tomorrow for one 24 hours away", () => {
		expect(whenItRuns(now.getTime() + 24 * 60 * 60 * 1000, now)).toBe("tomorrow 3:12 PM");
	});
	it("gives the date further out", () => {
		expect(whenItRuns(new Date(2026, 9, 10, 9, 5).getTime(), now)).toContain("10/10/2026");
	});
});

// Why the confirm button doesn't work yet (issue 118): said beside it, until nothing is missing.
describe("stillNeeded", () => {
	const base = { householdName: "The Rinks", banks: ["Chase"], typed: "", disconnect: false };
	it("names the Household's name and the bank box when both are missing", () => {
		expect(stillNeeded(base)).toBe(
			"Still needed: type “The Rinks” and tick “Disconnect Chase from Noodle”.",
		);
	});
	it("names only the bank box once the name is typed", () => {
		expect(stillNeeded({ ...base, typed: " The Rinks " })).toBe(
			"Still needed: tick “Disconnect Chase from Noodle”.",
		);
	});
	it("names only the name once the box is ticked, or when no bank is connected", () => {
		expect(stillNeeded({ ...base, typed: "The Rink", disconnect: true })).toBe(
			"Still needed: type “The Rinks”.",
		);
		expect(stillNeeded({ ...base, banks: [] })).toBe("Still needed: type “The Rinks”.");
	});
	it("names every bank", () => {
		expect(stillNeeded({ ...base, typed: "The Rinks", banks: ["Chase", "Ally"] })).toBe(
			"Still needed: tick “Disconnect Chase and Ally from Noodle”.",
		);
	});
	it("says nothing once both are done", () => {
		expect(stillNeeded({ ...base, typed: "The Rinks", disconnect: true })).toBeNull();
		expect(stillNeeded({ ...base, typed: "The Rinks", banks: [] })).toBeNull();
	});
});

// A failed or stuck clear, said plainly (issue 118): only what was done, and nothing since.
describe("troubleWords", () => {
	const now = new Date(2026, 9, 5, 21, 30);
	const since = new Date(2026, 9, 5, 21, 14).getTime();
	const trouble = {
		kind: "failed" as const,
		stoppedAt: "Forgetting merchants",
		since,
		notBegun: false,
		done: ["a snapshot taken", "banks disconnected", "background work stopped"],
	};
	it("says where a failed clear stopped, what is done, and that nothing else is", () => {
		expect(troubleWords({ level: "fresh-start", trouble }, now)).toEqual({
			title: "Starting fresh stopped at “Forgetting merchants”.",
			body: "Done so far: a snapshot taken, banks disconnected and background work stopped. Nothing else has been cleared since today 9:14 PM. Try again carries on from that step.",
		});
	});
	it("claims nothing cleared when nothing was", () => {
		const words = troubleWords(
			{ level: "fresh-start", trouble: { ...trouble, stoppedAt: "Taking a snapshot", done: [] } },
			now,
		);
		expect(words?.body).toBe("Nothing has been cleared yet. Try again carries on from that step.");
	});
	it("says since when a clear hasn't moved", () => {
		const words = troubleWords({ level: "delete", trouble: { ...trouble, kind: "stuck" } }, now);
		expect(words?.title).toBe(
			"Deleting the Household hasn’t moved since today 9:14 PM, at “Forgetting merchants”.",
		);
	});
	it("says one that was due never began", () => {
		const words = troubleWords(
			{
				level: "fresh-start",
				trouble: { kind: "stuck", stoppedAt: null, since, notBegun: true, done: [] },
			},
			now,
		);
		expect(words).toEqual({
			title: "Starting fresh was due today 9:14 PM and hasn’t begun.",
			body: "Nothing has been cleared yet. Try again starts it now.",
		});
	});
	it("is nothing without trouble", () => {
		expect(troubleWords({ level: "fresh-start", trouble: null }, now)).toBeNull();
	});
});
