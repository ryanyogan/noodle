import { type MonthKey, monthCloseProposal, monthState, nothingToClose } from "@noodle/domain";
import { describe, expect, test } from "vitest";
import { type CloseMonthVariables, closingWeek, withMonthClosed } from "./month-close";
import type { MonthData } from "./server/month";

const august = "2026-08" as MonthKey;

const month: MonthData = {
	plan: {
		month: august,
		baseline: 500_000,
		commitments: [],
		buckets: [
			{ id: "groceries", name: "Groceries", color: 1, allowance: 120_000, rolling: false },
			{ id: "fun", name: "Fun", color: 2, allowance: 30_000, rolling: false },
		],
	},
	planBefore: { month: "2026-07", baseline: 500_000, commitments: [], buckets: [] },
	spending: [],
	charges: [],
	moves: [],
	rolledOver: {},
	goalFunding: [],
	sweeps: [],
	closed: null,
	income: [{ id: "pay", amount: 600_000, date: "2026-08-15", note: "Bonus" }],
	asOf: "2026-09-02",
	editable: false,
	firstMonth: "2026-01",
};

const decision: CloseMonthVariables = {
	closeId: "close",
	month: august,
	parentId: "alex",
	sweeps: [{ bucketId: "groceries", goalId: "rainy-day", amountCents: 120_000 }],
	windfall: [{ moveId: "windfall", goalId: "rainy-day", amountCents: 100_000 }],
};

describe("optimistic month-close", () => {
	test("the decision's Sweeps and Extra income Moves show at once, and the month is closed", () => {
		expect(monthCloseProposal(monthState(month))).toMatchObject({
			leftovers: [
				{ bucketId: "groceries", amount: 120_000 },
				{ bucketId: "fun", amount: 30_000 },
			],
			windfall: 100_000,
		});
		const closed = withMonthClosed(month, decision);
		expect(closed.closed).toEqual({ decidedBy: "alex" });
		const proposal = monthCloseProposal(monthState(closed));
		// Fun was left alone; the rest is decided.
		expect(proposal).toMatchObject({ leftovers: [{ bucketId: "fun" }], windfall: 0 });
		expect(nothingToClose(proposal)).toBe(false);
		expect(withMonthClosed(closed, decision)).toBe(closed);
	});

	test("Free to Spend sent to a Goal shows as Goal funding at once, and less is carried over", () => {
		const ended: MonthData = { ...month, freeHandedOn: 41_200, freeLeftToSend: 41_200 };
		const sent = withMonthClosed(ended, {
			...decision,
			sweeps: [],
			windfall: [],
			freeToSpend: [{ goalId: "trip", amountCents: 41_200 }],
		});
		expect(sent.goalFunding).toEqual([
			{ id: "close:free:0", goalId: "trip", amount: 41_200, month: august },
		]);
		expect(sent).toMatchObject({ freeHandedOn: 0, freeLeftToSend: 0 });
		// Kept: nothing is written and what is carried over stays.
		const kept = withMonthClosed(ended, { ...decision, sweeps: [], windfall: [] });
		expect(kept).toMatchObject({ goalFunding: [], freeHandedOn: 41_200 });
	});

	test("This Month asks to close the month before during its first week only", () => {
		expect(closingWeek("2026-09" as MonthKey, "2026-09-01")).toBe(true);
		expect(closingWeek("2026-09" as MonthKey, "2026-09-07")).toBe(true);
		expect(closingWeek("2026-09" as MonthKey, "2026-09-08")).toBe(false);
		expect(closingWeek("2026-08" as MonthKey, "2026-09-02")).toBe(false);
	});
});
