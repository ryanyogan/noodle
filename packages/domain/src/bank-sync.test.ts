import { describe, expect, it } from "vitest";
import {
	type BankLine,
	type BankRow,
	bankLineKey,
	type DayKey,
	planBankSync,
	resplit,
	statementLineIds,
} from "./index";

const line = (bankId: string, amount: number, overrides: Partial<BankLine> = {}): BankLine => ({
	accountExternalId: "acct",
	bankId,
	date: "2026-09-10" as DayKey,
	amount,
	description: "Blue Door Bistro",
	...overrides,
});

const row = (bankId: string, amount: number, overrides: Partial<BankRow> = {}): BankRow => ({
	id: `row-${bankId}`,
	kind: "transaction",
	externalId: bankLineKey(bankId),
	date: "2026-09-10" as DayKey,
	amount,
	pending: false,
	splits: [],
	...overrides,
});

describe("bankLineKey", () => {
	it("keys a line as a statement's bank line is keyed", () => {
		const [key] = statementLineIds([
			{ date: "2026-09-10" as DayKey, amount: -100, description: "", bankId: "tx-9" },
		]);
		expect(bankLineKey("tx-9")).toBe(key);
	});
});

describe("planBankSync", () => {
	it("adds lines the Account doesn't have yet, pending or posted", () => {
		const plan = planBankSync(
			[],
			[line("a", -4_000, { pending: true }), line("b", -1_250)],
			[],
			false,
		);
		expect(plan.add.map((l) => l.bankId)).toEqual(["a", "b"]);
		expect(plan.change).toEqual([]);
		expect(plan.remove).toEqual([]);
	});

	it("posts a pending row in place, so it counts once and keeps what a Parent did", () => {
		const pending = row("p", 4_000, { pending: true });
		const plan = planBankSync(
			[pending],
			[line("posted", -4_000, { date: "2026-09-12" as DayKey, replaces: "p" })],
			// Plaid removes the pending line in the same sync.
			["p"],
			false,
		);
		expect(plan.add).toEqual([]);
		expect(plan.remove).toEqual([]);
		expect(plan.change).toEqual([
			{
				row: pending,
				externalId: bankLineKey("posted"),
				date: "2026-09-12",
				amount: 4_000,
				pending: false,
				splits: null,
			},
		]);
	});

	it("shares a tip added on posting across the pending row's Splits", () => {
		const pending = row("p", 5_000, {
			pending: true,
			splits: [
				{ id: "s1", amount: 3_000 },
				{ id: "s2", amount: 2_000 },
			],
		});
		const [change] = planBankSync(
			[pending],
			[line("posted", -6_000, { replaces: "p" })],
			[],
			false,
		).change;
		expect(change?.amount).toBe(6_000);
		expect(change?.splits).toEqual([
			{ id: "s1", amount: 3_600 },
			{ id: "s2", amount: 2_400 },
		]);
	});

	it("posts in place when the posted copy keeps the pending line's ID", () => {
		const pending = row("same", 900, { pending: true });
		const plan = planBankSync([pending], [line("same", -900)], [], false);
		expect(plan.change).toMatchObject([{ externalId: bankLineKey("same"), pending: false }]);
		expect(plan.add).toEqual([]);
	});

	it("drops a pending row whose posted copy is already in, so it isn't counted twice", () => {
		const pending = row("p", 4_000, { pending: true });
		const posted = row("posted", 4_000);
		const plan = planBankSync(
			[pending, posted],
			[line("posted", -4_000, { replaces: "p" })],
			[],
			false,
		);
		expect(plan.remove).toEqual([pending]);
		expect(plan.change).toEqual([]);
		expect(plan.add).toEqual([]);
	});

	it("changes a modified line's date and amount, and nothing when nothing changed", () => {
		const kroger = row("k", 6_412);
		expect(planBankSync([kroger], [line("k", -6_412)], [], false).change).toEqual([]);
		const plan = planBankSync(
			[kroger],
			[line("k", -7_010, { date: "2026-09-09" as DayKey })],
			[],
			false,
		);
		expect(plan.change).toMatchObject([{ date: "2026-09-09", amount: 7_010, pending: false }]);
	});

	it("keeps income in its own terms", () => {
		const pay = row("pay", 240_000, { kind: "income" });
		const plan = planBankSync([pay], [line("pay", 241_000)], [], true);
		expect(plan.change).toMatchObject([{ amount: 241_000 }]);
	});

	it("waits for pending money in to a checking or savings Account to post", () => {
		const plan = planBankSync([], [line("dep", 50_000, { pending: true })], [], true);
		expect(plan.add).toEqual([]);
		// On a card, money back pending is a Transaction like any other.
		expect(planBankSync([], [line("dep", 50_000, { pending: true })], [], false).add).toHaveLength(
			1,
		);
	});

	it("removes what the bank dropped, and ignores what it never had", () => {
		const gone = row("gone", 2_340);
		const plan = planBankSync([gone], [], ["gone", "never"], false);
		expect(plan.remove).toEqual([gone]);
	});

	it("removes a line the bank both changed and dropped", () => {
		const gone = row("gone", 2_340);
		const plan = planBankSync([gone], [line("gone", -2_500)], ["gone"], false);
		expect(plan.change).toEqual([]);
		expect(plan.remove).toEqual([gone]);
	});
});

describe("resplit", () => {
	it("shares a new amount in proportion, adding up exactly", () => {
		const shares = resplit(
			[
				{ id: "a", amount: 1_000 },
				{ id: "b", amount: 1_000 },
				{ id: "c", amount: 1_000 },
			],
			3_001,
		);
		expect(shares.map((s) => s.amount)).toEqual([1_001, 1_000, 1_000]);
	});

	it("can't share out nothing, or across a change of direction", () => {
		expect(resplit([{ id: "a", amount: 500 }], 0)).toEqual([]);
		expect(resplit([{ id: "a", amount: 500 }], -500)).toEqual([]);
	});
});
