import { describe, expect, it } from "vitest";
import {
	type Cents,
	type CommitmentState,
	commitmentKind,
	type DayKey,
	groupCommitments,
} from "./index";

const commitment = (
	id: string,
	expected: number,
	actual: number,
	accountId?: string,
): CommitmentState => ({
	id,
	name: id,
	amount: expected as Cents,
	cadence: "monthly",
	dueDate: "2026-10-05" as DayKey,
	...(accountId ? { accountId } : {}),
	dueDates: ["2026-10-05" as DayKey],
	expected: expected as Cents,
	actual: actual as Cents,
	charges: actual ? 1 : 0,
	difference: 0 as Cents,
	status: actual ? "paid" : "upcoming",
});

const accounts = [
	{ id: "card", kind: "credit-card" },
	{ id: "loan", kind: "loan" },
	{ id: "checking", kind: "checking" },
];

describe("a Commitment's kind (issue 153)", () => {
	it("comes from the Account it pays down", () => {
		expect(commitmentKind({ kind: "credit-card" })).toBe("credit-card");
		expect(commitmentKind({ kind: "loan" })).toBe("loan");
	});

	it("is a bill when it pays nothing down, or not a card or loan", () => {
		expect(commitmentKind(null)).toBe("bill");
		expect(commitmentKind(undefined)).toBe("bill");
		expect(commitmentKind({ kind: "checking" })).toBe("bill");
		expect(commitmentKind({ kind: "savings" })).toBe("bill");
	});
});

describe("a month's Commitments in groups (issue 153)", () => {
	it("lists credit cards, then loans, then bills, each with what it takes and what was paid", () => {
		const groups = groupCommitments(
			[
				commitment("Rent", 150_000, 150_000),
				commitment("Car", 42_000, 0, "loan"),
				commitment("Store card", 9_000, 9_000, "card"),
				commitment("Internet", 7_500, 0),
				commitment("Travel card", 20_000, 0, "card"),
			],
			accounts,
		);
		expect(groups.map((g) => [g.kind, g.commitments.map((c) => c.id), g.expected, g.paid])).toEqual(
			[
				["credit-card", ["Store card", "Travel card"], 29_000, 9_000],
				["loan", ["Car"], 42_000, 0],
				["bill", ["Rent", "Internet"], 157_500, 150_000],
			],
		);
		expect(groups.reduce((sum, g) => sum + g.expected, 0)).toBe(228_500);
	});

	it("leaves out a group with nothing in it", () => {
		const groups = groupCommitments(
			[commitment("Rent", 150_000, 0), commitment("Internet", 7_500, 0)],
			accounts,
		);
		expect(groups.map((g) => g.kind)).toEqual(["bill"]);
		expect(groupCommitments([], accounts)).toEqual([]);
	});

	it("keeps one whose Account isn't a card or loan, or isn't known, with the bills", () => {
		const groups = groupCommitments(
			[commitment("Savings", 10_000, 0, "checking"), commitment("Gone", 5_000, 0, "missing")],
			accounts,
		);
		expect(groups.map((g) => [g.kind, g.commitments.length])).toEqual([["bill", 2]]);
	});

	it("counts what was paid as the row says it when money was Paid back", () => {
		const card = {
			...commitment("Card", 100_000, 40_000, "card"),
			difference: -60_000 as Cents,
			paidBack: { amount: 60_000 as Cents, who: ["Casey"] },
		};
		expect(groupCommitments([card], accounts)[0]?.paid).toBe(100_000);
	});
});
