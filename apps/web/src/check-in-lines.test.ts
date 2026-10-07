import type { CheckInStackCard, MonthKey } from "@noodle/domain";
import { describe, expect, it } from "vitest";
import { checkInDealtLine, checkInStackLine } from "./check-in";

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
	it("says what was cleared from Review, with nobody named: filing keeps no record of who", () => {
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
