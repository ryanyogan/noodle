import {
	addAccount,
	createHouseholdForParent,
	type Db,
	importStatement,
	loadSetupJobs,
	loadSetupProgress,
	saveSetupProgress,
	type Viewer,
} from "@noodle/db";
import { testDb } from "@noodle/db/test-db";
import { beforeEach, describe, expect, it } from "vitest";
import type { HouseholdChange } from "../household-changes";
import { backgroundStatus, minutesLeft } from "../setup";
import { runSetup, type SetupDeps, type SetupStep } from "./setup-run";

// The Setup Workflow's steps against a real (in-memory) D1 and fakes for the model-backed work:
// it waits for history, files each Import, drafts the Plan, and records each job as it goes.

const householdId = "household";
const parentId = "parent";
const accountId = "01J00000000000000000000001";
const params = { householdId, memberId: parentId, timeZone: "America/Chicago" };

let db: Db;
let nextId = 0;
const newId = () => `row-${String(++nextId).padStart(4, "0")}`;
let categorized: [Viewer, string][];
let drafted: Viewer[];
let notified: HouseholdChange[][];

beforeEach(async () => {
	db = testDb();
	categorized = [];
	drafted = [];
	notified = [];
	await createHouseholdForParent(db, {
		clerkUserId: "clerk-user",
		householdId,
		householdName: "The Rinks",
		timeZone: "America/Chicago",
		parentId,
		parentName: "Alex",
	});
	await addAccount(db, {
		householdId,
		accountId,
		name: "Checking",
		kind: "checking",
		balanceCents: 0,
		balanceId: "balance",
		createdByMemberId: parentId,
	});
});

const deps = (rounds = 3): SetupDeps => ({
	db,
	categorize: async (viewer, importId) => {
		categorized.push([viewer, importId]);
	},
	draftPlan: async (viewer) => {
		drafted.push(viewer);
	},
	notify: async (_household, changes) => {
		notified.push(changes);
	},
	wait: { every: "1 second", rounds },
});

/** Runs each step at once; `onSleep` stands in for time passing between looks. */
const inline = (onSleep: (round: number) => Promise<void> = async () => {}): SetupStep => {
	let round = 0;
	return {
		do: ((_name: string, configOrFn: unknown, fn?: unknown) =>
			(typeof configOrFn === "function" ? configOrFn : (fn as () => unknown))()) as SetupStep["do"],
		sleep: async () => onSleep(++round),
	};
};

const statement = (importId: string) =>
	importStatement(db, {
		householdId,
		importId,
		accountId,
		source: "csv",
		fileName: `${importId}.csv`,
		fileKey: null,
		lines: [{ date: "2026-09-18", amount: -38_50, description: "SHELL OIL 5741", bankId: null }],
		closingBalance: null,
		csvMapping: null,
		createdByMemberId: parentId,
		newId,
	});

const statuses = async () =>
	Object.fromEntries((await loadSetupJobs(db, householdId)).map((j) => [j.job, j.status]));

describe("runSetup", () => {
	it("files the history already there and drafts the Plan, as the Parent who started", async () => {
		await statement("first");
		await statement("second");

		expect(await runSetup(params, inline(), deps())).toBe("done");

		const viewer = { householdId, memberId: parentId };
		expect(categorized).toEqual([
			[viewer, "first"],
			[viewer, "second"],
		]);
		expect(drafted).toEqual([viewer]);
		expect(await statuses()).toEqual({ categorize: "done", draft: "done", history: "done" });
		expect(notified.every((changes) => changes.includes("setup"))).toBe(true);
	});

	it("waits for history to land, then goes on", async () => {
		const result = await runSetup(
			params,
			inline(async (round) => {
				if (round === 2) await statement("late");
			}),
			deps(5),
		);
		expect(result).toBe("done");
		expect(categorized.map(([, id]) => id)).toEqual(["late"]);
	});

	it("gives up when no history comes, marking every job skipped", async () => {
		let sleeps = 0;
		const result = await runSetup(
			params,
			inline(async () => {
				sleeps++;
			}),
			deps(3),
		);
		expect(result).toBe("no-history");
		expect(sleeps).toBe(2);
		expect(categorized).toEqual([]);
		expect(drafted).toEqual([]);
		expect(await statuses()).toEqual({
			categorize: "skipped",
			draft: "skipped",
			history: "skipped",
		});
	});

	it("is idempotent: running again ends the same", async () => {
		await statement("first");
		await runSetup(params, inline(), deps());
		await runSetup(params, inline(), deps());
		expect(await statuses()).toEqual({ categorize: "done", draft: "done", history: "done" });
	});
});

describe("setup progress", () => {
	it("saves after every step and keeps the first finish", async () => {
		expect(await loadSetupProgress(db, householdId)).toBeNull();
		await saveSetupProgress(db, householdId, { step: 2, answers: { path: "hand" }, skipped: [] });
		expect(await loadSetupProgress(db, householdId)).toMatchObject({
			step: 2,
			answers: { path: "hand" },
			skipped: [],
			finishedAt: null,
		});
		await saveSetupProgress(db, householdId, {
			step: 7,
			answers: { path: "hand" },
			skipped: [5],
			finished: true,
		});
		const finished = (await loadSetupProgress(db, householdId))?.finishedAt;
		expect(finished).toBeInstanceOf(Date);
		await saveSetupProgress(db, householdId, { step: 3, answers: {}, skipped: [5] });
		expect(await loadSetupProgress(db, householdId)).toMatchObject({
			step: 3,
			finishedAt: finished,
		});
	});
});

describe("the progress header's words", () => {
	it("counts minutes left and the background jobs", () => {
		expect(minutesLeft(1)).toBe(8);
		expect(minutesLeft(7)).toBe(0);
		expect(backgroundStatus([])).toBeNull();
		expect(
			backgroundStatus([
				{ job: "history", status: "done" },
				{ job: "categorize", status: "running" },
				{ job: "draft", status: "waiting" },
			]),
		).toBe("Sorting your spending… 1 of 3 done");
		expect(backgroundStatus([{ job: "history", status: "skipped" }])).toMatch(/once your spending/);
	});
});
