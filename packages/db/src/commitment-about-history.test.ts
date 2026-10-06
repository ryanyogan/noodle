import { beforeEach, describe, expect, it } from "vitest";
import { addCommitment, createHouseholdForParent, type Db, updateCommitment } from "./index";
import { planChanges } from "./schema";
import { testDb } from "./test-db";

// Switching a Commitment to or from "about" is a Plan change (issue 135, ADR-0014).

const householdId = "household";
let db: Db;
const power = {
	householdId,
	memberId: "alex",
	commitmentId: "power",
	name: "Power",
	month: "2026-10",
	amountCents: 14_000,
	cadence: "monthly",
	dueDate: "2026-10-15",
} as const;

beforeEach(async () => {
	db = testDb();
	await createHouseholdForParent(db, {
		clerkUserId: "clerk-alex",
		householdId,
		householdName: "The Rinks",
		timeZone: "America/Chicago",
		parentId: "alex",
		parentName: "Alex",
	});
});

const switches = async () =>
	(await db.select().from(planChanges))
		.filter((change) => change.kind === "commitment-terms")
		.map((change) => [change.targetId, change.before, change.after]);

describe("the Plan's history of a Commitment's about", () => {
	beforeEach(() => addCommitment(db, power));

	it("says when it is switched to about, once", async () => {
		await updateCommitment(db, { ...power, about: true });
		await updateCommitment(db, { ...power, about: true });
		expect(await switches()).toEqual([["power", { about: false }, { about: true }]]);
	});

	it("says when it is switched back to the same each time", async () => {
		await updateCommitment(db, { ...power, about: true });
		await updateCommitment(db, { ...power, about: false });
		expect(await switches()).toEqual([
			["power", { about: false }, { about: true }],
			["power", { about: true }, { about: false }],
		]);
	});

	it("says nothing when a save doesn't say which, or says what it already is", async () => {
		await updateCommitment(db, { ...power });
		await updateCommitment(db, { ...power, about: false });
		expect(await switches()).toEqual([]);
	});

	it("is said beside a new amount in the same save", async () => {
		await updateCommitment(db, { ...power, amountCents: 16_000, about: true });
		expect((await switches()).map(([, , after]) => after)).toEqual([
			{ about: true },
			expect.objectContaining({ amount: 16_000 }),
		]);
	});
});
