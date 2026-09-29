import type { CloseMonthInput, MonthCloseResult } from "@noodle/db";
import type { MonthKey } from "@noodle/domain";
import { describe, expect, it } from "vitest";
import {
	DECISION_TIMEOUT,
	type EndedMonth,
	MONTH_CLOSE_DECIDED,
	type MonthCloseParams,
	type MonthCloseStep,
	monthClosesToStart,
	runMonthClose,
} from "./month-close-run";

const august = "2026-08" as MonthKey;
const params: MonthCloseParams = {
	householdId: "household-1",
	timeZone: "America/Chicago",
	month: august,
};

const ended = (overrides: Partial<EndedMonth> = {}): EndedMonth => ({
	proposal: {
		month: august,
		leftovers: [
			{ bucketId: "groceries", name: "Groceries", amount: 4_000 },
			{ bucketId: "fun", name: "Fun", amount: 1_500 },
		],
		windfall: 20_000,
	},
	closed: false,
	emergencyGoalId: "emergency",
	rolledOver: { fun: 500 },
	...overrides,
});

/** A Workflow step that runs each step once, and a decision that comes (or times out). */
function fakeStep(decision: "decided" | "timeout") {
	const steps: string[] = [];
	const waits: { type: string; timeout?: unknown }[] = [];
	const step = {
		do: async (name: string, callback: () => Promise<unknown>) => {
			steps.push(name);
			return callback();
		},
		waitForEvent: async (_name: string, options: { type: string; timeout?: unknown }) => {
			waits.push(options);
			if (decision === "timeout") throw new Error("Timed out");
			return { payload: { closeId: "close-1" }, timestamp: new Date(), type: options.type };
		},
	} as unknown as MonthCloseStep;
	return { step, steps, waits };
}

function fakeDeps(months: EndedMonth[], result: MonthCloseResult = { ok: true }) {
	const closes: CloseMonthInput[] = [];
	const notified: unknown[] = [];
	let loads = 0;
	return {
		closes,
		notified,
		deps: {
			loadEndedMonth: async () => months[Math.min(loads++, months.length - 1)] as EndedMonth,
			closeMonth: async (input: CloseMonthInput) => {
				closes.push(input);
				return result;
			},
			notify: async (householdId: string, changes: unknown) => {
				notified.push({ householdId, changes });
			},
		},
	};
}

describe("runMonthClose", () => {
	it("waits a week for the Parents and leaves the month to their decision", async () => {
		const { step, steps, waits } = fakeStep("decided");
		const { deps, closes, notified } = fakeDeps([ended()]);
		expect(await runMonthClose(params, step, deps)).toBe("decided");
		expect(waits).toEqual([{ type: MONTH_CLOSE_DECIDED, timeout: DECISION_TIMEOUT }]);
		expect(steps).toEqual(["propose"]);
		expect(closes).toEqual([]);
		expect(notified).toEqual([]);
	});

	it("applies the defaults once when nobody decides: leftovers to the emergency Goal", async () => {
		const { step, steps } = fakeStep("timeout");
		const { deps, closes, notified } = fakeDeps([ended()]);
		expect(await runMonthClose(params, step, deps)).toBe("defaults");
		expect(steps).toEqual(["propose", "apply defaults"]);
		const closeId = "household-1:2026-08:defaults";
		expect(closes).toEqual([
			{
				householdId: "household-1",
				month: august,
				closeId,
				decidedByMemberId: null,
				sweeps: [
					{
						moveId: `${closeId}:groceries`,
						bucketId: "groceries",
						goalId: "emergency",
						amountCents: 4_000,
						rolledOverCents: 0,
					},
					{
						moveId: `${closeId}:fun`,
						bucketId: "fun",
						goalId: "emergency",
						amountCents: 1_500,
						rolledOverCents: 500,
					},
				],
				// The Windfall is always left for the Parents.
				windfall: [],
			},
		]);
		expect(notified).toEqual([{ householdId: "household-1", changes: ["goals", "month:2026-08"] }]);
	});

	it("closes the month leaving everything when there's no emergency Goal", async () => {
		const { step } = fakeStep("timeout");
		const { deps, closes } = fakeDeps([ended({ emergencyGoalId: null })]);
		expect(await runMonthClose(params, step, deps)).toBe("defaults");
		expect(closes[0]?.sweeps).toEqual([]);
	});

	it("recomputes the leftovers when the defaults apply", async () => {
		const { step } = fakeStep("timeout");
		const later = ended();
		later.proposal = { ...later.proposal, leftovers: later.proposal.leftovers.slice(1) };
		const { deps, closes } = fakeDeps([ended(), later]);
		await runMonthClose(params, step, deps);
		expect(closes[0]?.sweeps.map((s) => s.bucketId)).toEqual(["fun"]);
	});

	it("applies nothing when the Parents closed the month as the week ran out", async () => {
		const { step } = fakeStep("timeout");
		const { deps, closes } = fakeDeps([ended(), ended({ closed: true })]);
		expect(await runMonthClose(params, step, deps)).toBe("decided");
		expect(closes).toEqual([]);
	});

	it("doesn't notify when the database refuses the defaults", async () => {
		const { step } = fakeStep("timeout");
		const { deps, notified } = fakeDeps([ended()], { ok: false, reason: "already-closed" });
		expect(await runMonthClose(params, step, deps)).toBe("decided");
		expect(notified).toEqual([]);
	});

	it("stops without waiting when the month is closed or has nothing to decide", async () => {
		const closed = fakeStep("decided");
		expect(await runMonthClose(params, closed.step, fakeDeps([ended({ closed: true })]).deps)).toBe(
			"already-closed",
		);
		expect(closed.waits).toEqual([]);
		const empty = fakeStep("decided");
		const nothing = ended({ proposal: { month: august, leftovers: [], windfall: 0 } });
		expect(await runMonthClose(params, empty.step, fakeDeps([nothing]).deps)).toBe(
			"nothing-to-close",
		);
		expect(empty.waits).toEqual([]);
	});
});

describe("monthClosesToStart", () => {
	const households = [
		{ id: "chicago", timeZone: "America/Chicago" },
		{ id: "tokyo", timeZone: "Asia/Tokyo" },
	];

	it("starts each Household's ended month once its own 1st has begun", () => {
		// 2026-09-01 03:00 UTC: already the 1st in Tokyo, still August 31st in Chicago.
		const due = monthClosesToStart(households, new Date("2026-09-01T03:00:00Z"));
		expect(due).toEqual([
			{
				id: "month-close-tokyo-2026-08",
				params: { householdId: "tokyo", timeZone: "Asia/Tokyo", month: "2026-08" },
			},
		]);
	});

	it("keeps starting them through the 3rd, and not after", () => {
		const third = monthClosesToStart(households, new Date("2026-09-03T12:00:00Z"));
		expect(third.map((d) => d.id)).toEqual([
			"month-close-chicago-2026-08",
			"month-close-tokyo-2026-08",
		]);
		expect(monthClosesToStart(households, new Date("2026-09-04T12:00:00Z"))).toEqual([]);
	});
});
