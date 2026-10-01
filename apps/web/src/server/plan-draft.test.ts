import {
	addBucket,
	addIncome,
	addPersonalAllowance,
	addQuickAdd,
	createHouseholdForParent,
	type Db,
	loadPlanDraft,
	setTakeHomePay,
	type Viewer,
} from "@noodle/db";
import { testDb } from "@noodle/db/test-db";
import { addDays, type DayKey } from "@noodle/domain";
import { beforeEach, describe, expect, it } from "vitest";
import {
	type DraftModel,
	type LineToLabel,
	linesToLabel,
	readLabels,
	stubDraftModel,
} from "./plan-draft-model";
import { buildPlanDraft, labelPlanDraft, type PlanDraftDeps } from "./plan-draft-run";

const householdId = "household";
const month = "2026-09";
const asOf = "2026-09-28" as DayKey;
const alex: Viewer = { householdId, memberId: "alex" };

let db: Db;
let ids = 0;
const newId = () => `id-${String(++ids).padStart(4, "0")}`;

/** The fake model, recording every line it was shown. */
function recordingModel(model: DraftModel = stubDraftModel) {
	const shown: LineToLabel[][] = [];
	const recording: DraftModel = {
		label: (toSort, toName) => {
			shown.push([...toSort, ...toName]);
			return model.label(toSort, toName);
		},
	};
	return { model: recording, shown };
}

const deps = (model: DraftModel): PlanDraftDeps => ({ db, model });

async function spend(bucketId: string, date: DayKey, amountCents: number, note: string) {
	await addQuickAdd(db, {
		householdId,
		transactionId: newId(),
		bucketId,
		date,
		amountCents,
		note,
		forMemberIds: [],
		createdByMemberId: "alex",
	});
}

beforeEach(async () => {
	db = testDb();
	ids = 0;
	await createHouseholdForParent(db, {
		clerkUserId: "clerk-alex",
		householdId,
		householdName: "The Rinks",
		timeZone: "America/Chicago",
		parentId: "alex",
		parentName: "Alex",
	});
	await addBucket(db, {
		householdId,
		memberId: "alex",
		bucketId: "misc",
		name: "Misc",
		color: 1,
		month: "2026-06",
		allowanceCents: 0,
	});
	await addPersonalAllowance(db, {
		householdId,
		memberId: "alex",
		bucketId: "alex-pa",
		name: "Alex’s Personal Allowance",
		color: 2,
		month: "2026-06",
		allowanceCents: 10_000,
	});
	// Paid every other Friday.
	for (let day = "2026-06-05" as DayKey; day <= asOf; day = addDays(day, 14)) {
		await addIncome(db, {
			householdId,
			incomeId: newId(),
			date: day,
			amountCents: 250_000,
			note: "ACME CORP PAYROLL PPD",
			createdByMemberId: "alex",
		});
	}
	for (let day = "2026-06-06" as DayKey; day <= asOf; day = addDays(day, 7)) {
		await spend("misc", day, 18_000, "COSTCO WHSE #0123");
	}
	for (const date of ["2026-06-12", "2026-07-12", "2026-08-12", "2026-09-12"]) {
		await spend("misc", date as DayKey, 1_799, "NETFLIX.COM 866-579-7172 CA");
		// Alex’s own, from their Personal Allowance: never named for the Household.
		await spend("alex-pa", date as DayKey, 4_000, "SECRET HOBBY SHOP");
	}
});

describe("the model's labels", () => {
	const lines = linesToLabel(
		[{ key: "costco", description: "COSTCO WHSE" }],
		[{ key: "acme corp", description: "ACME CORP PAYROLL" }],
	);

	it("keep only codes it was given and Buckets from the list", () => {
		const answer = JSON.stringify({
			lines: [
				{ code: "m1", name: "Acme payroll", bucket: "Groceries" },
				{ code: "m2", name: "Costco", bucket: "Groceries" },
				{ code: "m9", name: "Invented", bucket: "Gas" },
			],
		});
		expect(readLabels(answer, lines)).toEqual({
			names: { "acme corp": "Acme payroll", costco: "Costco" },
			// A payer isn't sorted into a Bucket.
			buckets: { costco: "Groceries" },
		});
		expect(
			readLabels(JSON.stringify({ lines: [{ code: "m2", name: "$40", bucket: "Toys" }] }), lines),
		).toEqual({ names: {}, buckets: {} });
		expect(readLabels("not json", lines)).toEqual({ names: {}, buckets: {} });
	});
});

describe("drafting the first Plan", () => {
	it("drafts a take-home pay, Commitments and Buckets from the history, naming nothing private", async () => {
		const { model, shown } = recordingModel();
		expect(await labelPlanDraft(deps(model), alex, asOf)).not.toBeNull();
		expect(JSON.stringify(shown).toLowerCase()).not.toContain("secret");

		const draft = await buildPlanDraft(db, alex, asOf);
		// Every two weeks is two paychecks a month.
		expect(draft?.baseline?.amount).toBe(500_000);
		expect(draft?.commitments.map((c) => [c.name, c.amount])).toEqual([["Netflix", 1_799]]);
		expect(draft?.buckets.map((b) => b.name)).toContain("Groceries");
	});

	it("names each merchant once, asking about new ones only", async () => {
		await labelPlanDraft(deps(stubDraftModel), alex, asOf);
		const { model, shown } = recordingModel();
		await labelPlanDraft(deps(model), alex, asOf);
		expect(shown).toEqual([]);
	});

	it("still starts when the model fails, with plain names", async () => {
		const failing: DraftModel = { label: () => Promise.reject(new Error("down")) };
		await labelPlanDraft(deps(failing), alex, asOf);
		expect(await loadPlanDraft(db, householdId)).not.toBeNull();
		const draft = await buildPlanDraft(db, alex, asOf);
		expect(draft?.commitments.map((c) => c.name)).toEqual(["Netflix Ca"]);
		expect(draft?.buckets.map((b) => b.name)).toEqual(["Everyday"]);
	});

	it("leaves a Plan already set up alone", async () => {
		await setTakeHomePay(db, { householdId, memberId: "alex", month, amountCents: 400_000 });
		expect(await labelPlanDraft(deps(stubDraftModel), alex, asOf)).toBeNull();
		expect(await loadPlanDraft(db, householdId)).toBeNull();
		expect(await buildPlanDraft(db, alex, asOf)).toBeNull();
	});
});
