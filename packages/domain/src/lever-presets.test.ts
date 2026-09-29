import { describe, expect, it } from "vitest";
import { type Lever, leverPreset, parseLeverPreset } from "./index";

const month = "2026-09";

describe("parseLeverPreset: a change written into a link", () => {
	it("ends a Commitment from a month, or from this month when none is given", () => {
		expect(parseLeverPreset("end-commitment:daycare:2027-03", month)).toEqual({
			kind: "end-commitment",
			commitmentId: "daycare",
			fromMonth: "2027-03",
		});
		expect(parseLeverPreset("end-commitment:daycare", month)).toEqual({
			kind: "end-commitment",
			commitmentId: "daycare",
			fromMonth: month,
		});
	});

	it("reads amounts in cents and a range, starting no earlier than this month", () => {
		expect(parseLeverPreset("allowance:groceries:70000:2027-03:2027-06", month)).toEqual({
			kind: "allowance",
			bucketId: "groceries",
			amount: 70_000,
			fromMonth: "2027-03",
			untilMonth: "2027-06",
		});
		expect(parseLeverPreset("baseline:950000:2026-01", month)).toEqual({
			kind: "baseline",
			amount: 950_000,
			fromMonth: month,
		});
		expect(parseLeverPreset("commitment-terms:daycare:120000", month)).toEqual({
			kind: "commitment-terms",
			commitmentId: "daycare",
			amount: 120_000,
			fromMonth: month,
		});
		expect(parseLeverPreset("archive-bucket:hockey:2027-01", month)).toEqual({
			kind: "archive-bucket",
			bucketId: "hockey",
			fromMonth: "2027-01",
		});
		expect(parseLeverPreset("goal:college:6000000:2031-08-31", month)).toEqual({
			kind: "goal",
			goalId: "college",
			target: 6_000_000,
			targetDate: "2031-08-31",
			fromMonth: month,
		});
		expect(parseLeverPreset("goal:college:6000000:none", month)).toMatchObject({
			targetDate: null,
		});
	});

	it("isn't a Lever when anything doesn't read", () => {
		for (const preset of [
			"",
			"end-commitment",
			"end-commitment:daycare:March",
			"end-commitment:daycare:2027-03:2027-03",
			"end-commitment:day care",
			"allowance:groceries:-5",
			"allowance:groceries:12.50",
			"allowance:groceries:99999999999",
			"commitment-terms:daycare:0",
			"goal:college:0",
			"goal:college:100:2031-13-01",
			"baseline:1:2027-01:2027-02:extra",
			"one-off:roof:300000",
			"growth:3:2",
		]) {
			expect(parseLeverPreset(preset, month), preset).toBeNull();
		}
	});

	it("round-trips the kinds it carries", () => {
		const levers: Lever[] = [
			{ kind: "end-commitment", commitmentId: "daycare", fromMonth: "2027-03" },
			{
				kind: "allowance",
				bucketId: "groceries",
				amount: 70_000,
				fromMonth: "2027-03",
				untilMonth: "2027-06",
			},
			{ kind: "baseline", amount: 950_000, fromMonth: month },
			{ kind: "commitment-terms", commitmentId: "daycare", amount: 1, fromMonth: month },
			{ kind: "archive-bucket", bucketId: "hockey", fromMonth: "2027-01" },
			{ kind: "goal", goalId: "college", target: 1, targetDate: null, fromMonth: month },
		];
		for (const lever of levers) {
			const preset = leverPreset(lever);
			expect(preset).not.toBeNull();
			expect(parseLeverPreset(preset ?? "", month)).toEqual(lever);
		}
		expect(leverPreset({ kind: "growth", incomePct: 3, costsPct: 2, fromMonth: month })).toBeNull();
	});
});
