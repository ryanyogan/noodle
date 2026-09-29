import { planForMonth } from "@noodle/domain";
import { beforeEach, describe, expect, it } from "vitest";
import {
	createHouseholdForParent,
	type Db,
	decideDraft,
	finishDraft,
	loadPlanChanges,
	loadPlanDraft,
	loadPlanRecords,
	saveDraftLabels,
} from "./index";
import { testDb } from "./test-db";

const householdId = "household";
const month = "2026-09";

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

const plan = async () => planForMonth(await loadPlanRecords(db, householdId, month), month);

const accept = () =>
	decideDraft(db, {
		householdId,
		memberId: "alex",
		month,
		baselineCents: 480000,
		commitments: [
			{
				key: "commitment:netflix",
				commitmentId: "netflix",
				name: "Netflix",
				amountCents: 1799,
				cadence: "monthly",
				dueDate: "2026-09-12",
			},
		],
		buckets: [
			{ key: "bucket:groceries", bucketId: "groceries", name: "Groceries", allowanceCents: 76000 },
			{ key: "bucket:gas", bucketId: "gas", name: "Gas", allowanceCents: 8000 },
		],
		skipped: ["commitment:rocket mortgage"],
	});

describe("the Plan's draft", () => {
	it("is kept once a model has named things, and not before", async () => {
		expect(await loadPlanDraft(db, householdId)).toBeNull();
		await saveDraftLabels(db, householdId, { buckets: { costco: "Groceries" }, names: {} });
		await saveDraftLabels(db, householdId, {
			buckets: { costco: "Groceries", shell: "Gas" },
			names: { netflix: "Netflix" },
		});
		const draft = await loadPlanDraft(db, householdId);
		expect(draft).toEqual({
			labels: { buckets: { costco: "Groceries", shell: "Gas" }, names: { netflix: "Netflix" } },
			finished: false,
			decided: new Set(),
		});
	});

	it("adds suggestions to the Plan with their Plan changes, and records every decision", async () => {
		await saveDraftLabels(db, householdId, { buckets: {}, names: {} });
		await accept();
		const now = await plan();
		expect(now.baseline).toBe(480000);
		expect(now.commitments.map((c) => [c.name, c.amount, c.cadence, c.dueDate])).toEqual([
			["Netflix", 1799, "monthly", "2026-09-12"],
		]);
		// Colours in turn, as when added one by one.
		expect(now.buckets.map((b) => [b.name, b.allowance, b.color])).toEqual([
			["Groceries", 76000, 1],
			["Gas", 8000, 2],
		]);
		const { changes } = await loadPlanChanges(db, { householdId, memberId: "alex" }, { month });
		expect(changes.map((c) => c.kind).sort()).toEqual([
			"baseline",
			"bucket-add",
			"bucket-add",
			"commitment-add",
		]);
		expect((await loadPlanDraft(db, householdId))?.decided).toEqual(
			new Set([
				"baseline",
				"commitment:netflix",
				"bucket:groceries",
				"bucket:gas",
				"commitment:rocket mortgage",
			]),
		);
	});

	it("adds nothing twice when a save is retried", async () => {
		await accept();
		await accept();
		const now = await plan();
		expect(now.commitments).toHaveLength(1);
		expect(now.buckets).toHaveLength(2);
		const { changes } = await loadPlanChanges(db, { householdId, memberId: "alex" }, { month });
		expect(changes).toHaveLength(4);
	});

	it("stops showing once a Parent is done with it", async () => {
		await saveDraftLabels(db, householdId, { buckets: {}, names: {} });
		await finishDraft(db, householdId, "alex");
		expect((await loadPlanDraft(db, householdId))?.finished).toBe(true);
	});
});
