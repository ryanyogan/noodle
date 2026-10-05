import type { PlanCommitment } from "@noodle/domain";
import { describe, expect, it } from "vitest";
import {
	type CommitmentVariables,
	needsCarriedTick,
	paysDownAccounts,
	paysDownHint,
	paysDownRefusal,
	readPaysDown,
	withCommitment,
	withNewCommitment,
} from "./commitments";
import { type GoalsData, withAccount } from "./goals";
import type { MonthData } from "./server/month";

// What a Commitment pays down (issue 93, ADR-0050): the choices, their hints, what the form sends
// and what a Parent is told when the server refuses.

const accounts = [
	{ id: "chk", name: "Checking", kind: "checking", bankConnectionId: null, owed: null },
	{
		id: "amex",
		name: "American Express",
		kind: "credit-card",
		bankConnectionId: null,
		owed: 200_000,
	},
	{
		id: "chase",
		name: "Chase Freedom",
		kind: "credit-card",
		bankConnectionId: "bc1",
		owed: 90_000,
	},
	{ id: "visa", name: "Store Visa", kind: "credit-card", bankConnectionId: null, owed: null },
	{ id: "car", name: "Car loan", kind: "loan", bankConnectionId: null, owed: 900_000 },
	{ id: "house", name: "Mortgage", kind: "loan", bankConnectionId: "bc2", owed: 30_000_000 },
] as const;

const byId = (id: string) => {
	const account = paysDownAccounts(accounts, ["visa", "car"]).find((a) => a.id === id);
	if (!account) throw new Error(`no ${id}`);
	return account;
};

describe("paysDownAccounts", () => {
	it("offers cards and loans only", () => {
		expect(paysDownAccounts(accounts, []).map((a) => a.id)).toEqual([
			"amex",
			"chase",
			"visa",
			"car",
			"house",
		]);
	});

	it("marks a card followed when it syncs with its bank or purchases were brought in", () => {
		expect(byId("amex").followed).toBe(false);
		expect(byId("chase").followed).toBe(true);
		expect(byId("visa").followed).toBe(true);
	});

	it("never asks for the tick on a loan", () => {
		expect(needsCarriedTick(byId("car"))).toBe(false);
		expect(needsCarriedTick(byId("house"))).toBe(false);
		expect(needsCarriedTick(byId("chase"))).toBe(true);
		expect(needsCarriedTick(byId("amex"))).toBe(false);
	});
});

describe("paysDownHint", () => {
	it("words each case as the design does", () => {
		expect(paysDownHint(null)).toBe(
			"Pick a card or loan and each payment brings what’s owed down.",
		);
		expect(paysDownHint(byId("amex"))).toBe(
			"Noodle can’t see what’s bought on American Express, so these payments are the spending.",
		);
		expect(paysDownHint(byId("chase"))).toBe(
			"Noodle already counts what you buy on Chase Freedom in your Buckets. Paying it off is a Transfer, so it isn’t counted twice.",
		);
		expect(paysDownHint(byId("car"))).toBe("Each payment brings what’s owed on Car loan down.");
		expect(paysDownHint(byId("house"))).toBe(
			"Each payment counts toward Mortgage. Its bank keeps what’s owed up to date.",
		);
	});
});

const form = (fields: Record<string, string>) => {
	const values = new FormData();
	for (const [name, value] of Object.entries(fields)) values.append(name, value);
	return values;
};

describe("readPaysDown", () => {
	it("changes nothing when the form has no Pays down field", () => {
		expect(readPaysDown(form({}))).toEqual({ needsTick: false, busy: false });
	});

	it("sends a new choice, and Nothing only when there was one", () => {
		expect(readPaysDown(form({ paysDown: "amex", paysDownTick: "none" }))).toEqual({
			paysDown: { accountId: "amex", carriedBalance: false },
			needsTick: false,
			busy: false,
		});
		expect(readPaysDown(form({ paysDown: "", paysDownTick: "none" }))).toEqual({
			needsTick: false,
			busy: false,
		});
		expect(
			readPaysDown(form({ paysDown: "", paysDownTick: "none" }), { accountId: "amex" }),
		).toEqual({
			paysDown: { accountId: null, carriedBalance: false },
			needsTick: false,
			busy: false,
		});
	});

	it("sends nothing when the choice is as it was", () => {
		expect(
			readPaysDown(form({ paysDown: "chase", paysDownTick: "ticked" }), {
				accountId: "chase",
				carriedBalance: true,
			}),
		).toEqual({ needsTick: false, busy: false });
		// A card that became followed after it was chosen doesn't block saving something else.
		expect(
			readPaysDown(form({ paysDown: "amex", paysDownTick: "needed" }), { accountId: "amex" }),
		).toEqual({ needsTick: false, busy: false });
	});

	it("needs the tick for a newly chosen card Noodle follows", () => {
		expect(readPaysDown(form({ paysDown: "chase", paysDownTick: "needed" })).needsTick).toBe(true);
		expect(readPaysDown(form({ paysDown: "chase", paysDownTick: "ticked" }))).toEqual({
			paysDown: { accountId: "chase", carriedBalance: true },
			needsTick: false,
			busy: false,
		});
		// Unticking one that had it is a change, and it's refused here before the server would.
		expect(
			readPaysDown(form({ paysDown: "chase", paysDownTick: "needed" }), {
				accountId: "chase",
				carriedBalance: true,
			}).needsTick,
		).toBe(true);
	});

	it("says a card or loan added in the form is still saving", () => {
		expect(readPaysDown(form({ paysDown: "amex", paysDownBusy: "1" })).busy).toBe(true);
	});
});

describe("paysDownRefusal", () => {
	it("says the Commitment was saved and why it pays nothing down", () => {
		for (const reason of ["wrong-kind", "archived", "followed", "not-found"] as const) {
			expect(paysDownRefusal(reason, "Amex payment")).toMatch(/^Amex payment was saved, but /);
		}
		expect(paysDownRefusal("followed", "Amex payment")).toContain(
			"“This is a set payment on a balance I’m carrying”",
		);
		expect(paysDownRefusal("archived", "Amex payment")).toContain("archived");
	});
});

describe("the optimistic edit", () => {
	const was: PlanCommitment = {
		id: "c1",
		name: "Amex payment",
		amount: 50_000,
		cadence: "monthly",
		dueDate: "2026-10-01" as PlanCommitment["dueDate"],
		accountId: "amex",
		carriedBalance: false,
	};
	const data = { plan: { month: "2026-10", commitments: [was] } } as unknown as MonthData;
	const variables = {
		commitmentId: "c1",
		month: "2026-10",
		name: "Amex",
		amountCents: 60_000,
		cadence: "monthly",
		dueDate: "2026-10-01",
	} as CommitmentVariables;
	const only = (next: MonthData) => next.plan.commitments[0];

	it("keeps what a Commitment pays down when a save doesn't mention it", () => {
		expect(only(withCommitment(data, variables))).toMatchObject({
			name: "Amex",
			amount: 60_000,
			accountId: "amex",
			carriedBalance: false,
		});
	});

	it("sets and clears it when the save does", () => {
		const moved = only(
			withCommitment(data, {
				...variables,
				paysDown: { accountId: "chase", carriedBalance: true },
			}),
		);
		expect(moved).toMatchObject({ accountId: "chase", carriedBalance: true });
		const cleared = only(
			withCommitment(data, { ...variables, paysDown: { accountId: null, carriedBalance: false } }),
		);
		expect(cleared).not.toHaveProperty("accountId");
		expect(cleared).not.toHaveProperty("carriedBalance");
	});

	it("adds a Commitment already paying a card down", () => {
		const added = withNewCommitment(data, {
			...variables,
			commitmentId: "c2",
			paysDown: { accountId: "car", carriedBalance: false },
		}).plan.commitments.find((c) => c.id === "c2");
		expect(added).toMatchObject({ accountId: "car", carriedBalance: false });
	});
});

describe("a card or loan added from the Commitment form", () => {
	const goals = { accounts: [accounts[1]], asOf: "2026-10-05" } as unknown as GoalsData;
	const loan = {
		accountId: "new",
		name: "Car loan",
		kind: "loan",
		balanceCents: 900_000,
		balanceId: "b1",
	} as const;

	it("is among the choices before the Household's list has it", () => {
		const choices = paysDownAccounts(withAccount(goals, loan).accounts, []);
		expect(choices.map((a) => a.id)).toEqual(["amex", "new"]);
		expect(choices[1]).toMatchObject({ name: "Car loan", kind: "loan", owed: 900_000 });
		expect(paysDownHint(choices[1] ?? null)).toBe(
			"Each payment brings what’s owed on Car loan down.",
		);
	});

	it("is listed once when the Household's list has it too", () => {
		const saved = withAccount(goals, loan);
		expect(paysDownAccounts(withAccount(saved, loan).accounts, []).map((a) => a.id)).toEqual([
			"amex",
			"new",
		]);
	});
});
