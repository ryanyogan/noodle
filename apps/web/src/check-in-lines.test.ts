import type { CheckInStackCard, MonthKey } from "@noodle/domain";
import { describe, expect, it } from "vitest";
import { checkInClearedHeading, checkInDealtLine, checkInStackLine } from "./check-in";

const sam = { memberId: "sam", name: "Sam" };
const alex = { memberId: "alex", name: "Alex" };
const september = "2026-09" as MonthKey;

type Dealt = Extract<CheckInStackCard, { state: "dealt" }>;
const dealt = (started: Dealt["started"], by: Dealt["by"] = []): Dealt => ({
	state: "dealt",
	kind: started.kind,
	started,
	by,
});

describe("a dealt-with Check-in card's line", () => {
	it("says who cleared Review, and how many each when both did, the reader first", () => {
		const review = { kind: "review", count: 6 } as const;
		const one = dealt(review, [{ ...sam, count: 6 }]);
		expect(checkInDealtLine(one, "alex")).toBe("Sam cleared 6 Transactions from Review");
		expect(checkInDealtLine(one, "sam")).toBe("You cleared 6 Transactions from Review");
		const both = dealt(review, [
			{ ...alex, count: 4 },
			{ ...sam, count: 2 },
		]);
		expect(checkInDealtLine(both, "sam")).toBe(
			"You cleared 2 Transactions from Review, Alex cleared 4",
		);
		expect(checkInDealtLine(both, "alex")).toBe(
			"You cleared 4 Transactions from Review, Sam cleared 2",
		);
		expect(checkInDealtLine(dealt(review, [{ ...sam, count: 1 }]), "alex")).toBe(
			"Sam cleared 1 Transaction from Review",
		);
	});

	it("says what was cleared from Review with nobody named, when no record says who", () => {
		expect(checkInDealtLine(dealt({ kind: "review", count: 3 }), "alex")).toBe(
			"3 Transactions cleared from Review",
		);
		expect(checkInDealtLine(dealt({ kind: "review", count: 1 }), "alex")).toBe(
			"1 Transaction cleared from Review",
		);
	});

	it("names the other Parent, and says You to the one who did it", () => {
		const card = dealt({ kind: "windfalls", months: [september], total: 25000 }, [sam]);
		expect(checkInDealtLine(card, "alex")).toBe("Sam decided $250 of Extra income");
		expect(checkInDealtLine(card, "sam")).toBe("You decided $250 of Extra income");
	});

	it("names both when both did, the reader first", () => {
		const card = dealt({ kind: "insights", count: 2, ids: ["a", "b"] }, [alex, sam]);
		expect(checkInDealtLine(card, "sam")).toBe("You and Alex decided 2 Insights");
		expect(checkInDealtLine(card, "alex")).toBe("You and Sam decided 2 Insights");
	});

	it("names nobody when no record says who", () => {
		const sweeps = dealt({ kind: "sweeps", month: september, total: 5500 });
		expect(checkInDealtLine(sweeps, "alex")).toBe("$55 of Sweeps from September decided");
		expect(
			checkInDealtLine(dealt({ kind: "sweeps", month: september, total: 5500 }, [sam]), "alex"),
		).toBe("Sam decided $55 of Sweeps from September");
	});
});

describe("a card's line in the week's stack", () => {
	const waiting: CheckInStackCard = {
		state: "waiting",
		kind: "review",
		card: { kind: "review", count: 2 },
	};

	it("is what waits, Skipped once moved past while it waits, or what was done", () => {
		expect(checkInStackLine(waiting, "alex", false)).toBe("2 Transactions in Review");
		expect(checkInStackLine(waiting, "alex", true)).toBe("Skipped");
		expect(checkInStackLine(dealt({ kind: "review", count: 2 }), "alex", true)).toBe(
			"2 Transactions cleared from Review",
		);
	});
});

describe("the line over a stack that was all dealt with before this visit", () => {
	const review = dealt({ kind: "review", count: 6 }, [{ ...sam, count: 6 }]);
	const extra = dealt({ kind: "windfalls", months: [september], total: 25000 }, [sam]);
	const sweeps = dealt({ kind: "sweeps", month: september, total: 5500 }, [alex]);

	it("names the Parent who cleared every line", () => {
		expect(checkInClearedHeading([review, extra], "alex")).toBe("Sam cleared these 2");
		expect(checkInClearedHeading([review, extra], "sam")).toBe("You cleared these 2");
	});

	it("names both when each cleared some, the reader first", () => {
		expect(checkInClearedHeading([review, extra, sweeps], "alex")).toBe(
			"You and Sam cleared these 3",
		);
	});

	it("names nobody when any line has no record of who", () => {
		const unknown = dealt({ kind: "insights", count: 1, ids: ["a"] });
		expect(checkInClearedHeading([review, unknown], "alex")).toBe("These 2 are dealt with");
	});
});
