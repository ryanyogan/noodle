import {
	accountBalance,
	addMonths,
	type DayKey,
	goalProgress,
	type MonthKey,
	monthOfDay,
	owedFor,
	planForMonth,
	freeToSpend as planFreeToSpend,
	splitAccount,
	splitsBalance,
} from "@noodle/domain";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { extraIncomeLeftSql } from "./extra-income";
import { loadGoals, loadPlanRecords, loadRolledOver } from "./index";
import { bucketLeftSql, freeToSpendSql } from "./moves";
import * as s from "./schema";
import {
	buildSeed,
	SEED_SCENARIOS,
	type SeedOptions,
	type SeedScenario,
	wipeAll,
	writeSeed,
} from "./seed";
import { testDb } from "./test-db";

// The seed scenarios (#46) hold to the invariants the app relies on: every row has its parent,
// money adds up (Splits, Transfers, Refunds, Receipts), what Goals have set aside fit their Accounts' balances,
// every month's Plan nets out, Sweeps and Extra income decisions never exceed what there was, and
// busy has the edge cases the design reviews need. Checked on a few "todays", since every date
// is relative to it.

const TODAYS = ["2026-09-30", "2026-10-01", "2026-03-15", "2027-01-07"] as const;

const options = (today: DayKey): SeedOptions => ({
	today,
	now: Date.parse(`${today}T23:00:00Z`),
	timeZone: "America/Chicago",
	parents: [
		{ clerkUserId: "user_seed_alex", name: "Alex", email: "alex+clerk_test@example.com" },
		{ clerkUserId: "user_seed_jordan", name: "Jordan", email: "jordan+clerk_test@example.com" },
	],
});

async function seeded(scenario: SeedScenario, today: DayKey) {
	const db = testDb();
	const rows = buildSeed(scenario, options(today));
	await writeSeed(db, rows);
	const householdId = rows.households[0]?.id as string;
	const alex = rows.members.find((m) => m.clerkUserId === "user_seed_alex")?.id as string;
	return { db, rows, householdId, alex };
}

/** The first column of the first row. */
const scalar = async (db: ReturnType<typeof testDb>, query: ReturnType<typeof sql>) =>
	((await db.all(query)) as unknown[][])[0]?.[0] as number;

describe.each(SEED_SCENARIOS)("the %s seed", (scenario) => {
	it.each(TODAYS)("has no orphans and one Household (today %s)", async (today) => {
		const { db, rows, householdId } = await seeded(scenario, today);
		expect(await db.all(sql`pragma foreign_key_check`)).toEqual([]);
		for (const [name, list] of Object.entries(rows)) {
			for (const row of list as { householdId?: string }[]) {
				if ("householdId" in row) expect(row.householdId, name).toBe(householdId);
			}
		}
		// Nothing dated after today, nothing created after now.
		const now = options(today).now;
		for (const tx of rows.transactions) {
			expect(tx.date <= today, `${tx.note} on ${tx.date}`).toBe(true);
			expect((tx.createdAt as Date).getTime()).toBeLessThanOrEqual(now);
		}
		for (const row of rows.income) expect(row.date <= today).toBe(true);
	});

	it.each(TODAYS)(
		"adds up: Splits, Transfers, Refunds, Matches, Receipts (today %s)",
		async (today) => {
			const { rows } = await seeded(scenario, today);
			const tx = new Map(rows.transactions.map((t) => [t.id, t]));
			const income = new Map(rows.income.map((i) => [i.id, i]));
			for (const t of rows.transactions) {
				const assigned = [t.bucketId, t.commitmentId, t.goalId].filter(Boolean);
				expect(assigned.length).toBeLessThanOrEqual(1);
			}
			const splitsOf = new Map<string, typeof rows.splits>();
			for (const sp of rows.splits)
				splitsOf.set(sp.transactionId, [...(splitsOf.get(sp.transactionId) ?? []), sp]);
			for (const [id, splits] of splitsOf) {
				const t = tx.get(id);
				expect(
					splitsBalance(
						t?.amountCents as number,
						splits.map((sp) => ({ amount: sp.amountCents })),
					),
				).toBe(true);
				expect([t?.bucketId, t?.commitmentId, t?.goalId].filter(Boolean)).toEqual([]);
				for (const sp of splits)
					expect([sp.bucketId, sp.commitmentId, sp.goalId].filter(Boolean)).toHaveLength(1);
			}
			for (const tr of rows.transfers) {
				const out = tr.outTransactionId ? tx.get(tr.outTransactionId) : null;
				const into = tr.inTransactionId ? tx.get(tr.inTransactionId) : null;
				const inc = tr.inIncomeId ? income.get(tr.inIncomeId) : null;
				expect(out?.source).toBe("import");
				expect(out?.bucketId ?? out?.commitmentId ?? out?.goalId ?? null).toBeNull();
				if (into) expect(into.amountCents).toBe(-(out?.amountCents as number));
				if (inc) expect(inc.amountCents).toBe(out?.amountCents);
				expect(!!into && !!inc).toBe(false);
			}
			for (const r of rows.refunds) {
				const refund = tx.get(r.refundTransactionId);
				const original = tx.get(r.originalTransactionId);
				expect(refund?.amountCents).toBeLessThan(0);
				expect(
					(refund?.amountCents as number) + (original?.amountCents as number),
				).toBeGreaterThanOrEqual(0);
				expect(refund?.bucketId).toBe(original?.bucketId);
				expect((refund?.date as string) >= (original?.date as string)).toBe(true);
			}
			for (const m of rows.matches) {
				const quick = tx.get(m.quickAddId);
				const copy = tx.get(m.importedId);
				expect(quick?.source).toBe("quick-add");
				expect(copy?.source).toBe("import");
				expect(copy?.amountCents).toBe(quick?.amountCents);
				expect(copy?.bucketId ?? copy?.commitmentId ?? copy?.goalId ?? null).toBeNull();
			}
			for (const r of rows.receipts) {
				expect(r.lines.reduce((sum, l) => sum + l.amount, 0)).toBe(r.totalCents);
				expect(tx.get(r.transactionId as string)?.amountCents).toBe(r.totalCents);
			}
			// A Transaction is in at most one live Transfer, Match or Refund.
			const linked = [
				...rows.transfers.flatMap((t) => [t.outTransactionId, t.inTransactionId]),
				...rows.matches.flatMap((m) => [m.quickAddId, m.importedId]),
				...rows.refunds.map((r) => r.refundTransactionId),
			].filter(Boolean);
			expect(new Set(linked).size).toBe(linked.length);
			// Pending rows are imported, and never alongside a posted twin.
			for (const t of rows.transactions.filter((t) => t.pending)) expect(t.source).toBe("import");
		},
	);

	it.each(TODAYS)(
		"keeps what Goals set aside within their Accounts' balances (today %s)",
		async (today) => {
			const { db, householdId, alex } = await seeded(scenario, today);
			if (!alex) return;
			const records = await loadGoals(db, { householdId, memberId: alex });
			for (const account of records.accounts) {
				const balance = accountBalance(
					account.latestBalance,
					records.withdrawals.filter((w) => w.accountId === account.id),
				);
				// A payoff Goal sets nothing aside (ADR-0019).
				const goals = records.goals
					.filter((g) => g.accountId === account.id && g.kind === "save")
					.map((g) => ({ id: g.id, archived: g.archived }));
				const split = splitAccount({ balance, goals, changes: records.changes });
				expect(split.overClaimedBy, account.name).toBe(0);
				for (const e of split.earmarks) expect(e.amount, e.goalId).toBeGreaterThanOrEqual(0);
			}
		},
	);

	it.each(TODAYS)(
		"nets out every month's Plan, Extra income and Sweeps (today %s)",
		async (today) => {
			const { db, rows, householdId } = await seeded(scenario, today);
			const thisMonth = monthOfDay(today);
			const first = rows.baselines.map((b) => b.month).sort()[0] as MonthKey | undefined;
			if (!first) return;
			for (let month = first; month <= thisMonth; month = addMonths(month, 1)) {
				const records = await loadPlanRecords(db, householdId, month);
				const plan = planForMonth(records, month);
				// The Plan in force leaves Free to Spend at or above zero before any Cover...
				expect(planFreeToSpend(plan), month).toBeGreaterThanOrEqual(0);
				// ...and after Covers from it and Goal funding too.
				const free = await scalar(db, sql`select ${freeToSpendSql(householdId, month)}`);
				expect(free, month).toBeGreaterThanOrEqual(0);
				// Extra income decided never exceeds the Extra income.
				const left = await scalar(
					db,
					sql`select ${extraIncomeLeftSql(householdId, month)} as left`,
				);
				expect(left, month).toBeGreaterThanOrEqual(0);
			}
			// A Sweep takes exactly the leftover a Bucket that resets monthly had.
			for (const sweep of rows.moves.filter((m) => m.kind === "sweep")) {
				const left = await scalar(
					db,
					sql`select ${bucketLeftSql(householdId, sweep.fromBucketId as string, sweep.month as MonthKey)} as left from buckets s where s.id = ${sweep.fromBucketId}`,
				);
				expect(left).toBe(0);
			}
		},
	);
});

describe("the busy seed", () => {
	it.each(TODAYS)("has every edge case and warning the reviews need (today %s)", async (today) => {
		const { db, rows, householdId } = await seeded("busy", today);
		const thisMonth = monthOfDay(today);
		const bucket = (name: string) =>
			rows.buckets.find((b) => b.name.startsWith(name))?.id as string;
		expect(rows.households[0]?.name).toHaveLength(40);
		expect(rows.transactions.length).toBeGreaterThan(1200);
		expect(rows.accounts.map((a) => a.kind).sort()).toEqual([
			"checking",
			"credit-card",
			"credit-card",
			"loan",
			"savings",
			"savings",
		]);
		expect(rows.bankConnections.map((c) => c.status).sort()).toEqual(["ready", "reconnect"]);
		expect(rows.buckets.length).toBeGreaterThanOrEqual(15);
		expect(rows.commitments.length).toBeGreaterThanOrEqual(12);
		expect(rows.commitments.some((c) => c.endedFromMonth)).toBe(true);
		expect(rows.goals.some((g) => g.completedAt)).toBe(true);
		expect(rows.goals.some((g) => g.archivedAt)).toBe(true);
		for (const kind of ["cover", "goal-funding", "windfall", "sweep"]) {
			expect(
				rows.moves.some((m) => m.kind === kind),
				kind,
			).toBe(true);
		}
		expect(rows.splits.length).toBeGreaterThan(0);
		expect(rows.transfers.length).toBeGreaterThan(0);
		expect(rows.refunds.length).toBeGreaterThan(0);
		expect(rows.matches.length).toBeGreaterThan(0);
		expect(rows.receipts.some((r) => r.source === "email")).toBe(true);
		expect(rows.imports.map((i) => i.source)).toEqual(
			expect.arrayContaining(["bank", "csv", "ofx"]),
		);
		expect(new Set(rows.planChanges.map((c) => c.memberId)).size).toBe(2);
		// Long names, big and $0 amounts.
		for (const list of [rows.accounts, rows.buckets, rows.goals, rows.commitments]) {
			expect(Math.max(...list.map((r) => r.name.length))).toBe(40);
		}
		expect(rows.transactions.some((t) => (t.note ?? "").length > 60)).toBe(true);
		expect(rows.transactions.some((t) => t.amountCents === 0)).toBe(true);
		expect(Math.max(...rows.goals.map((g) => g.targetCents))).toBeGreaterThan(10_000_000);
		// A Bucket never used.
		const piano = bucket("Piano");
		expect(rows.transactions.some((t) => t.bucketId === piano)).toBe(false);
		expect(rows.splits.some((sp) => sp.bucketId === piano)).toBe(false);
		// Review waits on this month's imports.
		const waiting = rows.categorizations.filter((c) => c.outcome === "review");
		expect(waiting.length).toBeGreaterThanOrEqual(8);
		// Eating out is overspent this month; Car maintenance's Available is below zero.
		const records = await loadPlanRecords(db, householdId, thisMonth);
		const left = await scalar(
			db,
			sql`select ${bucketLeftSql(householdId, bucket("Eating out"), thisMonth)} as left from buckets s where s.id = ${bucket("Eating out")}`,
		);
		expect(left).toBeLessThan(0);
		const rolled = await loadRolledOver(db, householdId, records, thisMonth);
		const car = planForMonth(records, thisMonth).buckets.find((b) => b.id === bucket("Car"));
		expect((car?.allowance ?? 0) + (rolled[bucket("Car")] ?? 0)).toBeLessThan(0);
		// A month ahead goes below zero (the property tax), for Plan health.
		const ahead = addMonths(thisMonth, 2);
		const future = planForMonth(await loadPlanRecords(db, householdId, ahead), ahead);
		expect(planFreeToSpend(future)).toBeLessThan(0);
	});

	it.each(TODAYS)(
		"pays down the Costco card with a payoff Goal from what it owed (today %s)",
		async (today) => {
			const { db, rows, householdId, alex } = await seeded("busy", today);
			const records = await loadGoals(db, { householdId, memberId: alex });
			const payoffs = records.goals.filter((g) => g.kind === "payoff");
			expect(payoffs).toHaveLength(1);
			const [goal] = payoffs;
			if (!goal) return;
			const card = records.accounts.find((a) => a.id === goal.accountId);
			expect(card?.kind).toBe("credit-card");
			expect(goal.completed || goal.archived).toBe(false);
			// Its target is what the card owed just before it was added.
			const added = rows.goals.find((g) => g.id === goal.id)?.createdAt as Date;
			const before = records.owed
				.filter((p) => p.accountId === goal.accountId && p.at <= added.getTime())
				.at(-1);
			expect(before?.amount).toBe(goal.target);
			// It has come down since, and still owes something, so it's neither new nor done.
			const owed = owedFor(goal, records.accounts);
			const progress = goalProgress({ ...goal, owed }, records.changes, monthOfDay(today));
			expect(progress.saved).toBeGreaterThan(0);
			expect(progress.remaining).toBeGreaterThan(0);
			expect(progress.status).toBe("on-track");
			// Funded from Free to Spend, and never set aside or spent from.
			const own = records.changes.filter((c) => c.goalId === goal.id);
			expect(own.length).toBeGreaterThan(0);
			expect(own.every((c) => c.kind === "funding")).toBe(true);
			expect(rows.earmarkClaims.some((c) => c.goalId === goal.id)).toBe(false);
		},
	);

	it("replaces the old data when reseeded", async () => {
		const { db } = await seeded("busy", "2026-09-30");
		await wipeAll(db);
		await writeSeed(db, buildSeed("fresh", options("2026-09-30")));
		expect(await scalar(db, sql`select count(*) from ${s.transactions}`)).toBe(0);
		expect(await scalar(db, sql`select count(*) from ${s.households}`)).toBe(1);
	});
});
