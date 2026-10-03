import { beforeEach, describe, expect, it } from "vitest";
import {
	createHouseholdForParent,
	type Db,
	hasTakeHomePay,
	loadSetupProgress,
	restartSetupProgress,
	saveSetupProgress,
	setTakeHomePay,
} from "./index";
import { testDb } from "./test-db";

const householdId = "household";
const alex = { householdId, memberId: "alex" };

let db: Db;

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

describe("setup progress", () => {
	it("knows a Household from before the wizard by its take-home pay", async () => {
		expect(await loadSetupProgress(db, householdId)).toBeNull();
		expect(await hasTakeHomePay(db, householdId)).toBe(false);
		await setTakeHomePay(db, { ...alex, month: "2026-09", amountCents: 500_000 });
		expect(await hasTakeHomePay(db, householdId)).toBe(true);
		expect(await hasTakeHomePay(db, "another")).toBe(false);
	});

	it("running setup again goes back to step 1, unfinished, with the answers kept", async () => {
		await saveSetupProgress(db, householdId, {
			step: 7,
			answers: { path: "hand" },
			skipped: [5],
			finished: true,
		});
		expect((await loadSetupProgress(db, householdId))?.finishedAt).not.toBeNull();
		await restartSetupProgress(db, householdId, { path: "hand", run: 1 });
		expect(await loadSetupProgress(db, householdId)).toMatchObject({
			step: 1,
			answers: { path: "hand", run: 1 },
			skipped: [],
			finishedAt: null,
		});
	});

	it("starts the wizard at Hello for a Household with no setup progress, as after a fresh start", async () => {
		expect(await loadSetupProgress(db, householdId)).toBeNull();
		await restartSetupProgress(db, householdId, { run: 1 });
		expect(await loadSetupProgress(db, householdId)).toMatchObject({
			step: 1,
			answers: { run: 1 },
			skipped: [],
			finishedAt: null,
		});
	});
});
