import { describe, expect, it } from "vitest";
import { type PlanChange, whatChanged } from "./plan-history";

let nextId = 1;
const change = (fields: Partial<PlanChange> & Pick<PlanChange, "kind">): PlanChange => ({
	id: nextId++,
	at: Date.UTC(2026, 9, 1) + nextId * 60_000,
	memberId: "alex",
	memberName: "Alex",
	targetId: null,
	targetName: null,
	month: "2026-10",
	scope: "from-on",
	source: "plan",
	scenarioId: null,
	before: null,
	after: null,
	...fields,
});

const groceries = { targetId: "groceries", targetName: "Groceries" } as const;

describe("whatChanged", () => {
	it("nets each item's changes that month into what it was and what it is", () => {
		const changes = [
			change({ kind: "allowance", ...groceries, before: { amount: 400 }, after: { amount: 450 } }),
			change({ kind: "baseline", before: { amount: 9000 }, after: { amount: 9500 } }),
			change({
				kind: "allowance",
				...groceries,
				memberId: "sam",
				memberName: "Sam",
				before: { amount: 450 },
				after: { amount: 500 },
			}),
			change({
				kind: "rolling",
				...groceries,
				before: { rolling: false },
				after: { rolling: true },
			}),
		];
		const groups = whatChanged(changes, "2026-10");
		expect(groups.map((g) => [g.key, g.kind, g.before, g.after])).toEqual([
			["groceries", "bucket", { amount: 400, rolling: false }, { amount: 500, rolling: true }],
			["baseline", "baseline", { amount: 9000 }, { amount: 9500 }],
		]);
		// Newest first, with who made each.
		expect(groups[0]?.changes.map((c) => c.memberName)).toEqual(["Alex", "Sam", "Alex"]);
	});

	it("leaves out other months and items changed back", () => {
		const changes = [
			change({ kind: "allowance", ...groceries, before: { amount: 400 }, after: { amount: 450 } }),
			change({ kind: "allowance", ...groceries, before: { amount: 450 }, after: { amount: 400 } }),
			change({ kind: "baseline", month: "2026-11", before: { amount: 1 }, after: { amount: 2 } }),
		];
		expect(whatChanged(changes, "2026-10")).toEqual([]);
		expect(whatChanged(changes, "2026-11").map((g) => g.key)).toEqual(["baseline"]);
	});

	it("shows an item added that month with its values now, and one taken out", () => {
		const changes = [
			change({
				kind: "commitment-add",
				targetId: "daycare",
				targetName: "Daycare",
				after: { name: "Daycare", amount: 600, cadence: "monthly", dueDate: "2026-10-05" },
			}),
			change({
				kind: "commitment-terms",
				targetId: "daycare",
				targetName: "Daycare",
				before: { amount: 600, cadence: "monthly", dueDate: "2026-10-05" },
				after: { amount: 650, cadence: "monthly", dueDate: "2026-10-05" },
			}),
			change({ kind: "bucket-archive", ...groceries }),
		];
		const [archived, added] = whatChanged(changes, "2026-10");
		expect(added).toMatchObject({
			key: "daycare",
			kind: "commitment",
			added: true,
			before: {},
			after: { name: "Daycare", amount: 650, cadence: "monthly", dueDate: "2026-10-05" },
		});
		expect(archived).toMatchObject({ key: "groceries", removed: true, before: {}, after: {} });
	});

	it("shows a Goal added that month as added", () => {
		const car = { targetId: "car", targetName: "Car" };
		const changes = [
			change({ kind: "goal-add", ...car, after: { name: "Car", target: 1_000, targetDate: null } }),
			change({
				kind: "goal",
				...car,
				before: { target: 1_000, targetDate: null },
				after: { target: 1_200, targetDate: null },
			}),
		];
		expect(whatChanged(changes, "2026-10")).toMatchObject([
			{ key: "car", kind: "goal", added: true, after: { name: "Car", target: 1_200 } },
		]);
	});

	it("keeps the other Parent's Personal Allowance one opaque group", () => {
		const changes = [
			change({ kind: "personal-allowance", targetId: "alex-pa" }),
			change({ kind: "personal-allowance", targetId: "alex-pa" }),
		];
		const groups = whatChanged(changes, "2026-10");
		expect(groups).toHaveLength(1);
		expect(groups[0]).toMatchObject({
			kind: "personal-allowance",
			targetName: null,
			before: {},
			after: {},
		});
		expect(groups[0]?.changes).toHaveLength(2);
	});
});
