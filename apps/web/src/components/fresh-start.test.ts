import { describe, expect, it } from "vitest";
import { whenItRuns } from "./fresh-start";

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
