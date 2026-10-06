import {
	addDays,
	addMonths,
	type Cents,
	checkInWeek,
	type DayKey,
	daysInMonth,
	dueDatesIn,
	type GuessMethod,
	type MonthKey,
	merchantKey,
	monthOfDay,
	type PlanChangeValue,
	perkKey,
	type ReceiptLine,
	type ScenarioChange,
} from "@noodle/domain";
import { eq, getTableColumns } from "drizzle-orm";
import type { Db } from "./index";
import * as s from "./schema";

// Seed data for local development (#46): a fresh Household, one two weeks in, and a busy one with
// eight months of heavy use, for designing and reviewing every screen. `buildSeed` only computes
// rows (no I/O), so a test can load them into an in-memory database and check the invariants the
// app relies on; `apps/web/scripts/seed.ts` writes them into the local D1 and nothing else.
// Rows follow the same rules the db package's writers do (see each section's comment), with
// dates relative to `today` so "this month" always has live data, and fixed ULIDs so a page's
// URL survives a reseed.

export const SEED_SCENARIOS = ["fresh", "starter", "busy"] as const;
export type SeedScenario = (typeof SEED_SCENARIOS)[number];

export type SeedParent = { clerkUserId: string; name: string; email: string };

export type SeedOptions = {
	/** The Household's today. */
	today: DayKey;
	/** Now, in ms: no row is created after it. */
	now: number;
	timeZone: string;
	/** The two Parents' Clerk logins; `fresh` and `starter` use only the first. */
	parents: [SeedParent, SeedParent];
};

/** Every table a Household's data lives in, in an order that satisfies foreign keys. */
const TABLES = {
	households: s.households,
	members: s.members,
	invites: s.invites,
	baselines: s.baselines,
	buckets: s.buckets,
	bucketAllowances: s.bucketAllowances,
	bucketRolling: s.bucketRolling,
	// Before Commitments: one may pay down a card or loan (commitments.account_id, issue 93).
	bankConnections: s.bankConnections,
	accounts: s.accounts,
	accountBalances: s.accountBalances,
	commitments: s.commitments,
	commitmentTerms: s.commitmentTerms,
	imports: s.imports,
	csvMappings: s.csvMappings,
	goals: s.goals,
	earmarkClaims: s.earmarkClaims,
	income: s.income,
	transactions: s.transactions,
	bankLinePairs: s.bankLinePairs,
	deletedBankLines: s.deletedBankLines,
	transactionFor: s.transactionFor,
	splits: s.splits,
	splitFor: s.splitFor,
	matches: s.matches,
	transfers: s.transfers,
	refunds: s.refunds,
	moves: s.moves,
	pushSubscriptions: s.pushSubscriptions,
	nudgePreferences: s.nudgePreferences,
	scenarios: s.scenarios,
	planChanges: s.planChanges,
	monthCloses: s.monthCloses,
	rules: s.rules,
	ruleFor: s.ruleFor,
	categorizations: s.categorizations,
	captureTokens: s.captureTokens,
	checkIns: s.checkIns,
	perkSources: s.perkSources,
	perks: s.perks,
	insights: s.insights,
	receipts: s.receipts,
	planDrafts: s.planDrafts,
	planDraftDecisions: s.planDraftDecisions,
};
type Tables = typeof TABLES;
export type SeedRows = { [K in keyof Tables]: Tables[K]["$inferInsert"][] };

const emptyRows = (): SeedRows =>
	Object.fromEntries(Object.keys(TABLES).map((k) => [k, []])) as unknown as SeedRows;

/** Deletes every Household row from every table (the whole local database), children first. */
export async function wipeAll(db: Db): Promise<void> {
	await db.update(s.households).set({ emergencyGoalId: null });
	for (const table of Object.values(TABLES).reverse()) await db.delete(table);
}

/** Inserts the rows, parents before children. The emergency Goal is set once Goals exist. */
export async function writeSeed(db: Db, rows: SeedRows): Promise<void> {
	for (const [name, table] of Object.entries(TABLES)) {
		let list = rows[name as keyof SeedRows] as Record<string, unknown>[];
		if (name === "households") list = list.map((h) => ({ ...h, emergencyGoalId: null }));
		// D1 allows 100 bound parameters a statement, and each row binds one a column.
		const atOnce = Math.max(1, Math.floor(100 / Object.keys(getTableColumns(table)).length));
		for (let i = 0; i < list.length; i += atOnce) {
			await db.insert(table).values(list.slice(i, i + atOnce) as never);
		}
	}
	for (const h of rows.households) {
		if (h.emergencyGoalId)
			await db
				.update(s.households)
				.set({ emergencyGoalId: h.emergencyGoalId })
				.where(eq(s.households.id, h.id));
	}
}

export function buildSeed(scenario: SeedScenario, options: SeedOptions): SeedRows {
	if (scenario === "fresh") return fresh(options);
	if (scenario === "starter") return starter(options);
	return busy(options);
}

// --- helpers --------------------------------------------------------------------------------

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const base32 = (value: number, length: number) => {
	let out = "";
	let n = value;
	for (let i = 0; i < length; i++) {
		out = CROCKFORD[n % 32] + out;
		n = Math.floor(n / 32);
	}
	return out;
};

/** Fixed ULIDs in creation order: the same scenario gets the same IDs on every reseed. */
function ids(scenario: SeedScenario) {
	const time = base32(1_780_000_000_000 + SEED_SCENARIOS.indexOf(scenario) * 1_000_000_000, 10);
	let n = 0;
	return () => time + base32(++n, 16);
}

/** A deterministic 0–1 value per seed, so amounts don't change between reseeds. */
const unit = (seed: number) => {
	const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
	return x - Math.floor(x);
};

const pad = (n: number) => String(n).padStart(2, "0");
const dayIn = (month: MonthKey, day: number): DayKey =>
	`${month}-${pad(Math.min(Math.max(day, 1), daysInMonth(month)))}` as DayKey;
const dayNumber = (day: DayKey) => Number(day.slice(8));

/** A moment on `day` (US Central, give or take DST), `minutes` after midnight, never after now. */
const clock =
	(now: number) =>
	(day: DayKey, minutes = 12 * 60) =>
		Math.min(Date.parse(`${day}T00:00:00Z`) + (minutes + 5 * 60) * 60_000, now - 60_000);

/** Splits `total` over `weights`, in cents, each at least 1, adding up exactly. */
function spread(total: Cents, weights: number[]): Cents[] {
	const sum = weights.reduce((a, b) => a + b, 0);
	const parts = weights.map((w) => Math.max(1, Math.round((total * w) / sum)));
	const drift = total - parts.reduce((a, b) => a + b, 0);
	const last = parts.length - 1;
	parts[last] = (parts[last] as number) + drift;
	return parts;
}

type ChangeInput = {
	member: string;
	kind: (typeof s.planChanges.$inferInsert)["kind"];
	target: string | null;
	month: MonthKey;
	scope?: "from-on" | "just";
	before: PlanChangeValue | null;
	after: PlanChangeValue | null;
	at: number;
	owner?: string;
	scenarioId?: string;
};

function planChange(rows: SeedRows, householdId: string, c: ChangeInput) {
	rows.planChanges.push({
		householdId,
		memberId: c.member,
		kind: c.kind,
		targetId: c.target,
		month: c.month,
		scope: c.scope ?? "from-on",
		before: c.before,
		after: c.after,
		ownerMemberId: c.owner ?? null,
		source: c.scenarioId ? "scenario" : "plan",
		scenarioId: c.scenarioId ?? null,
		createdAt: new Date(c.at),
	});
}

// --- fresh ----------------------------------------------------------------------------------

/** A Household just created: one Parent, nothing else. */
function fresh(o: SeedOptions): SeedRows {
	const rows = emptyRows();
	const id = ids("fresh");
	const household = id();
	const createdAt = new Date(o.now - 5 * 60_000);
	rows.households.push({ id: household, name: "The Rinks", timeZone: o.timeZone, createdAt });
	rows.members.push({
		id: id(),
		householdId: household,
		kind: "parent",
		name: o.parents[0].name,
		clerkUserId: o.parents[0].clerkUserId,
		createdAt,
	});
	return rows;
}

// --- starter --------------------------------------------------------------------------------

/** About two weeks in: one Parent (the other invited), a small Plan, one Account and one Goal. */
function starter(o: SeedOptions): SeedRows {
	const rows = emptyRows();
	const id = ids("starter");
	const at = clock(o.now);
	const created = addDays(o.today, -14);
	const month = monthOfDay(created);
	const household = id();
	const alex = id();
	rows.households.push({
		id: household,
		name: "The Rinks",
		timeZone: o.timeZone,
		createdAt: new Date(at(created, 20 * 60)),
	});
	rows.members.push({
		id: alex,
		householdId: household,
		kind: "parent",
		name: o.parents[0].name,
		clerkUserId: o.parents[0].clerkUserId,
		createdAt: new Date(at(created, 20 * 60)),
	});
	rows.invites.push({
		id: id(),
		householdId: household,
		email: o.parents[1].email,
		invitedByMemberId: alex,
		createdAt: new Date(at(created, 20 * 60 + 10)),
	});
	const setup = at(created, 20 * 60 + 30);
	rows.baselines.push({ householdId: household, month, amountCents: 900_000 });
	planChange(rows, household, {
		member: alex,
		kind: "baseline",
		target: null,
		month,
		before: null,
		after: { amount: 900_000 },
		at: setup,
	});
	const buckets = [
		["Groceries", 90_000, false, 4],
		["Eating out", 30_000, false, 2],
		["Kids", 25_000, true, 1],
		["Fun", 20_000, false, 5],
	] as const;
	const bucketIds: Record<string, string> = {};
	buckets.forEach(([name, amount, carriesOver, color], i) => {
		const bucket = id();
		bucketIds[name] = bucket;
		rows.buckets.push({
			id: bucket,
			householdId: household,
			name,
			color,
			position: i + 1,
			fromMonth: month,
			createdAt: new Date(setup + i * 1000),
		});
		rows.bucketAllowances.push({
			householdId: household,
			bucketId: bucket,
			month,
			amountCents: amount,
		});
		if (carriesOver)
			rows.bucketRolling.push({
				householdId: household,
				bucketId: bucket,
				month,
				rolling: carriesOver,
			});
		planChange(rows, household, {
			member: alex,
			kind: "bucket-add",
			target: bucket,
			month,
			before: null,
			after: { name, amount, ...(carriesOver ? { rolling: true } : {}) },
			at: setup + i * 1000,
		});
	});
	const commitments = [
		["Mortgage", 220_000, 1],
		["Internet", 7_000, 12],
		["Netflix", 1_549, 20],
	] as const;
	const commitmentIds: Record<string, string> = {};
	commitments.forEach(([name, amount, day], i) => {
		const commitment = id();
		commitmentIds[name] = commitment;
		const dueDate = dayIn(month, day);
		rows.commitments.push({
			id: commitment,
			householdId: household,
			name,
			fromMonth: month,
			createdAt: new Date(setup + 10_000 + i * 1000),
		});
		rows.commitmentTerms.push({
			householdId: household,
			commitmentId: commitment,
			month,
			amountCents: amount,
			cadence: "monthly",
			dueDate,
		});
		planChange(rows, household, {
			member: alex,
			kind: "commitment-add",
			target: commitment,
			month,
			before: null,
			after: { name, amount, cadence: "monthly", dueDate },
			at: setup + 10_000 + i * 1000,
		});
	});
	const checking = id();
	rows.accounts.push({
		id: checking,
		householdId: household,
		name: "Everyday Checking",
		kind: "checking",
		createdAt: new Date(at(addDays(created, 1), 19 * 60)),
	});
	rows.accountBalances.push({
		id: id(),
		householdId: household,
		accountId: checking,
		amountCents: 421_560,
		createdByMemberId: alex,
		createdAt: new Date(at(addDays(created, 1), 19 * 60 + 1)),
	});
	const goal = id();
	rows.goals.push({
		id: goal,
		householdId: household,
		accountId: checking,
		name: "Emergency fund",
		targetCents: 1_000_000,
		targetDate: null,
		fromMonth: month,
		createdAt: new Date(at(addDays(created, 1), 19 * 60 + 5)),
	});
	rows.earmarkClaims.push({
		id: id(),
		householdId: household,
		goalId: goal,
		month,
		amountCents: 100_000,
		createdByMemberId: alex,
		createdAt: new Date(at(addDays(created, 1), 19 * 60 + 6)),
	});
	planChange(rows, household, {
		member: alex,
		kind: "goal-add",
		target: goal,
		month,
		before: null,
		after: { name: "Emergency fund", target: 1_000_000, targetDate: null },
		at: at(addDays(created, 1), 19 * 60 + 5),
	});
	// A handful of Quick Adds over the two weeks, and the Commitments that came due.
	const spends = [
		[1, "Groceries", "H-E-B", 8_742],
		[2, "Eating out", "Tacos after school", 3_120],
		[3, "Kids", "Soccer cleats", 4_999],
		[4, "Groceries", "Trader Joe's", 6_418],
		[6, "Fun", "Movie night", 2_450],
		[7, "Groceries", "H-E-B", 11_305],
		[8, "Eating out", "Pizza Friday", 4_280],
		[10, "Groceries", "Farmers market", 3_600],
		[12, "Kids", "Birthday present", 2_799],
		[13, "Eating out", "Coffee", 1_125],
	] as const;
	for (const [offset, bucket, note, amount] of spends) {
		const date = addDays(created, offset);
		if (date > o.today) continue;
		rows.transactions.push({
			id: id(),
			householdId: household,
			source: "quick-add",
			date,
			amountCents: amount,
			bucketId: bucketIds[bucket],
			note,
			createdByMemberId: alex,
			createdAt: new Date(at(date, 18 * 60)),
		});
	}
	for (const [name, amount] of commitments) {
		const terms = {
			cadence: "monthly" as const,
			dueDate: rows.commitmentTerms.find((t) => t.commitmentId === commitmentIds[name])
				?.dueDate as DayKey,
		};
		for (const m of [month, monthOfDay(o.today)].filter((v, i, a) => a.indexOf(v) === i)) {
			for (const due of dueDatesIn(terms, m)) {
				if (due < addDays(created, 1) || due > o.today) continue;
				rows.transactions.push({
					id: id(),
					householdId: household,
					source: "quick-add",
					date: due,
					amountCents: amount,
					commitmentId: commitmentIds[name],
					note: name,
					createdByMemberId: alex,
					createdAt: new Date(at(due, 19 * 60)),
				});
			}
		}
	}
	const payday = addDays(created, 2);
	rows.income.push({
		id: id(),
		householdId: household,
		date: payday,
		amountCents: 450_000,
		note: "Paycheck",
		createdByMemberId: alex,
		accountId: checking,
		createdAt: new Date(at(payday, 9 * 60)),
	});
	return rows;
}

// --- busy -----------------------------------------------------------------------------------

type BucketSpec = {
	key: string;
	name: string;
	color: number;
	/** Allowance changes: [month index, cents]. */
	allowances: [number, Cents][];
	rolling?: boolean;
	/** carries over from this month index on (a Plan change). */
	rollingFrom?: number;
	owner?: "alex" | "jordan";
	archivedFrom?: number;
	/** Visits in a full month. */
	visits: number;
	/** Spent as a share of the allowance, per month index (default for the rest). */
	ratio: number | Record<number | "rest", number>;
	merchants: Merchant[];
};

type Merchant = {
	text: string;
	/** Where it's charged: an Account key, or "cash" for a Quick Add. */
	via: "sapphire" | "checking" | "costco" | "cash";
	for?: ("maya" | "theo")[];
	/** Some visits are a Quick Add later Matched to its imported copy. */
	matched?: boolean;
	/** A Costco trip split across Groceries, Household supplies and Kids activities. */
	split?: boolean;
	weight?: number;
};

const LONG_MERCHANT = "SQ *EL CHILITO TACOS & BREAKFAST BAR ON MANOR ROAD AUSTIN TX 78722";

const BUCKETS: BucketSpec[] = [
	{
		key: "groceries",
		name: "Groceries",
		color: 4,
		allowances: [
			[0, 130_000],
			[4, 140_000],
		],
		visits: 32,
		ratio: 0.93,
		merchants: [
			{ text: "H-E-B #512 AUSTIN TX", via: "sapphire", weight: 3 },
			{ text: "TRADER JOE'S #423", via: "sapphire", weight: 2 },
			{ text: "COSTCO WHSE #1042", via: "costco", split: true, weight: 2 },
			{ text: "Farmers market", via: "cash" },
			{ text: "WHOLEFDS MKT 10234", via: "sapphire", matched: true },
		],
	},
	{
		key: "eating",
		name: "Eating out",
		color: 2,
		allowances: [
			[0, 40_000],
			[7, 45_000],
		],
		visits: 42,
		ratio: { rest: 1.12, 0: 0.9, 2: 0.95, 7: 1.3 },
		merchants: [
			{ text: "TST* TORCHY'S TACOS 0021", via: "sapphire", weight: 2 },
			{ text: "SQ *BLUE BOTTLE COFFEE", via: "sapphire", weight: 3 },
			{ text: "DOORDASH*CHIPOTLE", via: "sapphire" },
			{ text: "CHICK-FIL-A #03312", via: "sapphire" },
			{ text: "Pizza after hockey", via: "cash", matched: true },
			{ text: LONG_MERCHANT, via: "sapphire" },
		],
	},
	{
		key: "gas",
		name: "Gas & parking",
		color: 6,
		allowances: [[0, 30_000]],
		visits: 12,
		ratio: 0.88,
		merchants: [
			{ text: "SHELL OIL 57444", via: "sapphire", weight: 2 },
			{ text: "COSTCO GAS #1042", via: "costco" },
			{ text: "PARKMOBILE", via: "sapphire" },
		],
	},
	{
		key: "household",
		name: "Household supplies",
		color: 3,
		allowances: [[0, 25_000]],
		visits: 22,
		ratio: 0.8,
		merchants: [
			{ text: "TARGET 00012345", via: "sapphire", weight: 2 },
			{ text: "AMAZON MKTPLACE PMTS", via: "sapphire", weight: 2 },
			{ text: "WALGREENS #7788", via: "sapphire" },
		],
	},
	{
		key: "hockey",
		name: "Hockey & swim",
		color: 1,
		allowances: [[0, 40_000]],
		rolling: true,
		visits: 5,
		ratio: { rest: 0.85, 3: 1.6 },
		merchants: [
			{ text: "AUSTIN ICE HOCKEY ASSN", via: "sapphire", for: ["maya"], weight: 2 },
			{ text: "SWIM ATX LESSONS", via: "sapphire", for: ["theo"] },
			{ text: "PLAY IT AGAIN SPORTS", via: "sapphire", for: ["maya", "theo"] },
		],
	},
	{
		key: "clothing",
		name: "Clothing",
		color: 5,
		allowances: [[0, 20_000]],
		rollingFrom: 2,
		visits: 4,
		ratio: { rest: 0.75, 6: 1.9 },
		merchants: [
			{ text: "OLD NAVY #5521", via: "sapphire", for: ["maya"] },
			{ text: "CARTERS OSHKOSH", via: "sapphire", for: ["theo"] },
			{ text: "NIKE.COM", via: "sapphire" },
		],
	},
	{
		key: "medical",
		name: "Medical & dental",
		color: 3,
		allowances: [[0, 25_000]],
		rolling: true,
		visits: 2,
		ratio: { rest: 0.55, 2: 1.8 },
		merchants: [
			{ text: "ST DAVIDS URGENT CARE", via: "sapphire", for: ["maya"] },
			{ text: "CVS/PHARMACY #0943", via: "sapphire" },
			{ text: "BRIGHT SMILES PEDIATRIC DENTISTRY", via: "sapphire", for: ["theo"] },
		],
	},
	{
		key: "car",
		name: "Car maintenance",
		color: 7,
		allowances: [[0, 15_000]],
		rolling: true,
		visits: 1,
		// A transmission last month: more than it has saved, so this month's Available is negative.
		ratio: { rest: 0.4, 6: 12.5 },
		merchants: [
			{ text: "JIFFY LUBE #1823", via: "sapphire" },
			{ text: "FIRESTONE COMPLETE AUTO CARE #0441", via: "sapphire" },
		],
	},
	{
		key: "gifts",
		name: "Gifts & holidays",
		color: 8,
		allowances: [
			[0, 15_000],
			[4, 50_000],
			[5, 15_000],
		],
		rolling: true,
		visits: 2,
		ratio: { rest: 0.3, 4: 0.95 },
		merchants: [
			{ text: "ETSY.COM", via: "sapphire" },
			{ text: "BARNES & NOBLE #2211", via: "sapphire" },
		],
	},
	{
		key: "fun",
		name: "Fun & outings",
		color: 5,
		allowances: [[0, 30_000]],
		visits: 14,
		ratio: 0.85,
		merchants: [
			{ text: "ALAMO DRAFTHOUSE", via: "sapphire", weight: 2 },
			{ text: "AUSTIN ZOO", via: "sapphire" },
			{ text: "THINKERY AUSTIN", via: "sapphire" },
		],
	},
	{
		key: "repairs",
		name: "Home repairs",
		color: 7,
		allowances: [[0, 20_000]],
		rolling: true,
		visits: 3,
		ratio: { rest: 0.45, 1: 2.5 },
		merchants: [
			{ text: "THE HOME DEPOT #6543", via: "sapphire" },
			{ text: "LOWES #01234", via: "sapphire" },
		],
	},
	{
		key: "pets",
		name: "Pets",
		color: 6,
		allowances: [
			[0, 10_000],
			[7, 12_000],
		],
		visits: 4,
		ratio: 0.9,
		merchants: [
			{ text: "PETCO 1234", via: "sapphire" },
			{ text: "BANFIELD PET HOSPITAL", via: "sapphire" },
		],
	},
	{
		key: "school",
		name: "Back-to-school, field trips, class gifts",
		color: 1,
		allowances: [[0, 8_000]],
		rolling: true,
		visits: 2,
		ratio: { rest: 0.5, 6: 2.2 },
		merchants: [
			{ text: "AUSTIN ISD FIELD TRIP PMT", via: "checking", for: ["maya", "theo"] },
			{ text: "SCHOOL SUPPLY LIST CO", via: "sapphire", for: ["maya", "theo"] },
		],
	},
	{
		// Never used: planned at $0 and never spent from.
		key: "piano",
		name: "Piano lessons (maybe next year)",
		color: 8,
		allowances: [[0, 0]],
		visits: 0,
		ratio: 0,
		merchants: [],
	},
	{
		key: "daycare",
		name: "Daycare extras",
		color: 2,
		allowances: [[0, 6_000]],
		archivedFrom: 5,
		visits: 2,
		ratio: 0.8,
		merchants: [{ text: "BRIGHT HORIZONS EXTRA CARE", via: "checking", for: ["theo"] }],
	},
	{
		key: "pa-alex",
		name: "Alex’s Personal Allowance",
		color: 2,
		owner: "alex",
		allowances: [
			[0, 15_000],
			[3, 20_000],
		],
		visits: 7,
		ratio: 0.95,
		merchants: [
			{ text: "STEAM GAMES", via: "sapphire" },
			{ text: "REI #45 AUSTIN", via: "sapphire" },
			{ text: "BOOKPEOPLE", via: "sapphire" },
		],
	},
	{
		key: "pa-jordan",
		name: "Jordan’s Personal Allowance",
		color: 4,
		owner: "jordan",
		allowances: [[0, 20_000]],
		rolling: true,
		visits: 6,
		ratio: 0.8,
		merchants: [
			{ text: "SEPHORA", via: "sapphire" },
			{ text: "YOGA WORKS", via: "sapphire" },
			{ text: "ANTHROPOLOGIE #512", via: "sapphire" },
		],
	},
];

type CommitmentSpec = {
	key: string;
	name: string;
	amount: Cents;
	cadence: "monthly" | "biweekly" | "annual";
	/** Due day in the first month, or [month offset from this month, day] for an annual one. */
	due: number | [number, number];
	via: "checking" | "sapphire";
	text: string;
	/** New terms from a month index. */
	change?: [number, Cents];
	endedFrom?: number;
	/** Each payment's amount wobbles by this share (a utility bill). */
	varies?: number;
};

const COMMITMENTS: CommitmentSpec[] = [
	{
		key: "mortgage",
		name: "Mortgage",
		amount: 265_000,
		cadence: "monthly",
		due: 1,
		via: "checking",
		text: "ROCKET MORTGAGE PMT",
	},
	{
		key: "car",
		name: "Honda car payment",
		amount: 48_900,
		cadence: "monthly",
		due: 15,
		via: "checking",
		text: "ALLY AUTO PAYMENT",
	},
	{
		key: "electric",
		name: "Electric",
		amount: 18_000,
		cadence: "monthly",
		due: 9,
		via: "checking",
		text: "AUSTIN ENERGY UTIL",
		varies: 0.25,
	},
	{
		key: "water",
		name: "Water & trash",
		amount: 9_500,
		cadence: "monthly",
		due: 12,
		via: "checking",
		text: "CITY OF AUSTIN UTIL",
	},
	{
		key: "internet",
		name: "Internet",
		amount: 8_000,
		cadence: "monthly",
		due: 8,
		via: "sapphire",
		text: "GOOGLE FIBER",
	},
	{
		key: "phone",
		name: "T-Mobile",
		amount: 18_500,
		cadence: "monthly",
		due: 18,
		via: "sapphire",
		text: "T-MOBILE AUTOPAY",
	},
	{
		key: "netflix",
		name: "Netflix",
		amount: 1_999,
		cadence: "monthly",
		due: 20,
		via: "sapphire",
		text: "NETFLIX.COM",
		change: [4, 2_299],
	},
	{
		key: "spotify",
		name: "Spotify Family",
		amount: 1_999,
		cadence: "monthly",
		due: 22,
		via: "sapphire",
		text: "SPOTIFY USA",
	},
	{
		key: "disney",
		name: "Disney+",
		amount: 1_399,
		cadence: "monthly",
		due: 5,
		via: "sapphire",
		text: "DISNEY PLUS",
		endedFrom: 6,
	},
	{
		key: "daycare",
		name: "Daycare",
		amount: 61_000,
		cadence: "biweekly",
		due: 2,
		via: "checking",
		text: "BRIGHT HORIZONS TUITION",
	},
	{
		key: "braces",
		name: "Maya’s braces — Dr. Patel’s payment plan",
		amount: 21_000,
		cadence: "monthly",
		due: 26,
		via: "checking",
		text: "PATEL ORTHODONTICS",
	},
	{
		key: "prime",
		name: "Amazon Prime",
		amount: 13_900,
		cadence: "annual",
		due: [-4, 11],
		via: "sapphire",
		text: "AMAZON PRIME*2K4LM",
	},
	// Due two months ahead: that month's Free to Spend goes below zero (Plan health warns).
	{
		key: "tax",
		name: "Property tax",
		amount: 680_000,
		cadence: "annual",
		due: [2, 15],
		via: "checking",
		text: "TRAVIS COUNTY TAX",
	},
	// A Lumpy month four months ahead.
	{
		key: "insurance",
		name: "Car insurance",
		amount: 138_000,
		cadence: "annual",
		due: [4, 3],
		via: "checking",
		text: "GEICO AUTO",
	},
];

const BUSY_NAME = "The Okonkwo-Lindqvist Household of Texas";

function busy(o: SeedOptions): SeedRows {
	const rows = emptyRows();
	const id = ids("busy");
	const at = clock(o.now);
	const thisMonth = monthOfDay(o.today);
	const start = addMonths(thisMonth, -7);
	const months = Array.from({ length: 8 }, (_, i) => addMonths(start, i));
	const monthAt = (i: number) => months[i] as MonthKey;
	const elapsed = dayNumber(o.today) / daysInMonth(thisMonth);
	const lapsed = addDays(o.today, -21);
	let seq = 0;
	const next = () => ++seq;

	// People ----------------------------------------------------------------------------------
	const household = id();
	const created = addDays(`${start}-01` as DayKey, -3);
	const alex = id();
	const jordan = id();
	const maya = id();
	const theo = id();
	const kids = { maya, theo };
	const parent = (i: number) => (i % 2 === 0 ? alex : jordan);
	rows.households.push({
		id: household,
		name: BUSY_NAME,
		timeZone: o.timeZone,
		createdAt: new Date(at(created, 20 * 60)),
		checkInDay: 0,
		receiptAddress: "k7m3p9q2r8t4v6w1x5z0",
	});
	rows.members.push(
		{
			id: alex,
			householdId: household,
			kind: "parent",
			name: o.parents[0].name,
			clerkUserId: o.parents[0].clerkUserId,
			createdAt: new Date(at(created, 20 * 60)),
		},
		{
			id: jordan,
			householdId: household,
			kind: "parent",
			name: o.parents[1].name,
			clerkUserId: o.parents[1].clerkUserId,
			createdAt: new Date(at(addDays(created, 1), 21 * 60)),
		},
		{
			id: maya,
			householdId: household,
			kind: "child",
			name: "Maya",
			color: 3,
			createdAt: new Date(at(created, 20 * 60 + 5)),
		},
		{
			id: theo,
			householdId: household,
			kind: "child",
			name: "Theo",
			color: 6,
			createdAt: new Date(at(created, 20 * 60 + 6)),
		},
	);
	rows.invites.push({
		id: id(),
		householdId: household,
		email: o.parents[1].email,
		invitedByMemberId: alex,
		acceptedByMemberId: jordan,
		createdAt: new Date(at(created, 20 * 60 + 10)),
	});
	rows.nudgePreferences.push(
		{
			memberId: alex,
			householdId: household,
			bucketPace: true,
			otherParentQuickAdds: true,
			windfalls: true,
			timeZone: o.timeZone,
		},
		{
			memberId: jordan,
			householdId: household,
			bucketPace: false,
			otherParentQuickAdds: true,
			windfalls: true,
			quietStart: 22 * 60,
			quietEnd: 7 * 60,
			timeZone: o.timeZone,
		},
	);
	const setup = at(created, 21 * 60);

	// take-home pay: raised three months in ----------------------------------------------------------
	const takeHomePayAt = [
		[0, 1_240_000],
		[4, 1_300_000],
	] as const;
	for (const [i, amount] of takeHomePayAt) {
		rows.baselines.push({ householdId: household, month: monthAt(i), amountCents: amount });
	}
	planChange(rows, household, {
		member: alex,
		kind: "baseline",
		target: null,
		month: start,
		before: null,
		after: { amount: 1_240_000 },
		at: setup,
	});
	planChange(rows, household, {
		member: jordan,
		kind: "baseline",
		target: null,
		month: monthAt(4),
		before: { amount: 1_240_000 },
		after: { amount: 1_300_000 },
		at: at(addDays(`${monthAt(4)}-01` as DayKey, -2), 20 * 60),
	});

	// Buckets ------------------------------------------------------------------------------------
	const bucketId: Record<string, string> = {};
	const spec: Record<string, BucketSpec> = {};
	const owners = { alex, jordan };
	BUCKETS.forEach((b, i) => {
		const bucket = id();
		bucketId[b.key] = bucket;
		spec[b.key] = b;
		const owner = b.owner ? owners[b.owner] : null;
		const first = b.allowances[0]?.[1] ?? 0;
		rows.buckets.push({
			id: bucket,
			householdId: household,
			name: b.name,
			color: b.color,
			position: i + 1,
			fromMonth: start,
			archivedFromMonth: b.archivedFrom === undefined ? null : monthAt(b.archivedFrom),
			ownerMemberId: owner,
			createdAt: new Date(setup + i * 1000),
		});
		planChange(rows, household, {
			member: owner ?? alex,
			kind: "bucket-add",
			target: bucket,
			month: start,
			before: null,
			after: {
				name: b.key === "hockey" ? "Kids activities" : b.name,
				amount: first,
				...(b.rolling ? { rolling: true } : {}),
			},
			at: setup + i * 1000,
			...(owner ? { owner } : {}),
		});
		let before = first;
		b.allowances.forEach(([mi, amount], n) => {
			rows.bucketAllowances.push({
				householdId: household,
				bucketId: bucket,
				month: monthAt(mi),
				amountCents: amount,
			});
			if (n === 0) return;
			// Gifts: a Just change for the holidays, back the month after (its own row).
			const just = b.key === "gifts" && n === 1;
			if (b.key === "gifts" && n === 2) return;
			const who = owner ?? (mi === 7 && b.key === "eating" ? alex : jordan);
			planChange(rows, household, {
				member: who,
				kind: "allowance",
				target: bucket,
				month: monthAt(mi),
				scope: just ? "just" : "from-on",
				before: { amount: before },
				after: { amount, ...(just ? { until: monthAt(mi + 1) } : {}) },
				at:
					mi === 7
						? at(addDays(o.today, -2), 21 * 60)
						: at(addDays(`${monthAt(mi)}-01` as DayKey, -3), 21 * 60),
				...(owner ? { owner } : {}),
			});
			before = amount;
		});
		if (b.rolling)
			rows.bucketRolling.push({
				householdId: household,
				bucketId: bucket,
				month: start,
				rolling: true,
			});
		if (b.rollingFrom !== undefined) {
			rows.bucketRolling.push({
				householdId: household,
				bucketId: bucket,
				month: monthAt(b.rollingFrom),
				rolling: true,
			});
			planChange(rows, household, {
				member: alex,
				kind: "rolling",
				target: bucket,
				month: monthAt(b.rollingFrom),
				before: { rolling: false },
				after: { rolling: true },
				at: at(addDays(`${monthAt(b.rollingFrom)}-01` as DayKey, -1), 20 * 60),
			});
		}
		if (b.archivedFrom !== undefined) {
			planChange(rows, household, {
				member: alex,
				kind: "bucket-archive",
				target: bucket,
				month: monthAt(b.archivedFrom),
				before: null,
				after: null,
				at: at(addDays(`${monthAt(b.archivedFrom)}-01` as DayKey, -4), 20 * 60),
			});
		}
	});
	planChange(rows, household, {
		member: jordan,
		kind: "bucket-rename",
		target: bucketId.hockey as string,
		month: monthAt(5),
		before: { name: "Kids activities" },
		after: { name: "Hockey & swim" },
		at: at(`${monthAt(5)}-06` as DayKey, 20 * 60),
	});
	// A Just change coming next month, made this week.
	rows.bucketAllowances.push(
		{
			householdId: household,
			bucketId: bucketId.gifts as string,
			month: addMonths(thisMonth, 1),
			amountCents: 40_000,
		},
		{
			householdId: household,
			bucketId: bucketId.gifts as string,
			month: addMonths(thisMonth, 2),
			amountCents: 15_000,
		},
	);
	planChange(rows, household, {
		member: jordan,
		kind: "allowance",
		target: bucketId.gifts as string,
		month: addMonths(thisMonth, 1),
		scope: "just",
		before: { amount: 15_000 },
		after: { amount: 40_000, until: addMonths(thisMonth, 2) },
		at: at(addDays(o.today, -1), 21 * 60),
	});
	const allowanceIn = (key: string, i: number) => {
		let amount = 0;
		for (const [mi, cents] of (spec[key] as BucketSpec).allowances) if (mi <= i) amount = cents;
		return amount;
	};
	const inPlan = (key: string, i: number) => {
		const b = spec[key] as BucketSpec;
		return b.archivedFrom === undefined || i < b.archivedFrom;
	};

	// Commitments ------------------------------------------------------------------------------
	const commitmentId: Record<string, string> = {};
	const termsIn: Record<
		string,
		(i: number) => { amount: Cents; cadence: CommitmentSpec["cadence"]; dueDate: DayKey }
	> = {};
	COMMITMENTS.forEach((c, n) => {
		const commitment = id();
		commitmentId[c.key] = commitment;
		const dueDate =
			typeof c.due === "number"
				? dayIn(start, c.due)
				: dayIn(addMonths(thisMonth, c.due[0]), c.due[1]);
		rows.commitments.push({
			id: commitment,
			householdId: household,
			name: c.name,
			fromMonth: start,
			endedFromMonth: c.endedFrom === undefined ? null : monthAt(c.endedFrom),
			createdAt: new Date(setup + 60_000 + n * 1000),
		});
		rows.commitmentTerms.push({
			householdId: household,
			commitmentId: commitment,
			month: start,
			amountCents: c.amount,
			cadence: c.cadence,
			dueDate,
		});
		planChange(rows, household, {
			member: n % 3 === 0 ? jordan : alex,
			kind: "commitment-add",
			target: commitment,
			month: start,
			before: null,
			after: { name: c.name, amount: c.amount, cadence: c.cadence, dueDate },
			at: setup + 60_000 + n * 1000,
		});
		if (c.change) {
			const [mi, amount] = c.change;
			rows.commitmentTerms.push({
				householdId: household,
				commitmentId: commitment,
				month: monthAt(mi),
				amountCents: amount,
				cadence: c.cadence,
				dueDate,
			});
			planChange(rows, household, {
				member: jordan,
				kind: "commitment-terms",
				target: commitment,
				month: monthAt(mi),
				before: { amount: c.amount, cadence: c.cadence, dueDate },
				after: { amount, cadence: c.cadence, dueDate },
				at: at(`${monthAt(mi)}-21` as DayKey, 20 * 60),
			});
		}
		termsIn[c.key] = (i) => ({
			amount: c.change && i >= c.change[0] ? c.change[1] : c.amount,
			cadence: c.cadence,
			dueDate,
		});
	});

	// Accounts and Bank Connections ---------------------------------------------------------------
	const chase = id();
	const ally = id();
	rows.bankConnections.push(
		{
			id: chase,
			householdId: household,
			provider: "plaid",
			externalId: "seed-item-chase",
			institution: "Chase",
			// Never decrypted on a page load; reconnecting a seeded connection fails (it isn't real).
			credential: "v1:seed-not-a-real-credential",
			status: "ready",
			lastImportedAt: new Date(o.now - 2 * 3_600_000),
			createdByMemberId: alex,
			createdAt: new Date(setup + 120_000),
		},
		{
			id: ally,
			householdId: household,
			provider: "plaid",
			externalId: "seed-item-ally",
			institution: "Ally Bank",
			credential: "v1:seed-not-a-real-credential",
			status: "reconnect",
			lastImportedAt: new Date(at(lapsed, 6 * 60)),
			createdByMemberId: jordan,
			createdAt: new Date(setup + 130_000),
		},
	);
	const account = {
		checking: id(),
		ally: id(),
		kids: id(),
		sapphire: id(),
		costco: id(),
		loan: id(),
	};
	const accountRows: [
		keyof typeof account,
		string,
		(typeof s.accounts.$inferInsert)["kind"],
		string | null,
	][] = [
		["checking", "Chase Total Checking", "checking", chase],
		["ally", "Ally Online Savings — House & Rainy Days", "savings", ally],
		["kids", "Kids’ Savings", "savings", null],
		["sapphire", "Chase Sapphire Preferred", "credit-card", chase],
		["costco", "Costco Anywhere Visa", "credit-card", null],
		["loan", "Honda Odyssey loan", "loan", ally],
	];
	accountRows.forEach(([key, name, kind, connection], n) => {
		rows.accounts.push({
			id: account[key],
			householdId: household,
			name,
			kind,
			bankConnectionId: connection,
			externalId: connection ? `seed-acct-${key}` : null,
			createdAt: new Date(setup + 140_000 + n * 1000),
		});
	});

	// Transactions -----------------------------------------------------------------------------
	type Tx = typeof s.transactions.$inferInsert;
	const imported: { tx: Tx; account: keyof typeof account }[] = [];
	const importedIncome: { row: typeof s.income.$inferInsert; account: keyof typeof account }[] = [];
	const addFor = (tx: string, who: ("maya" | "theo")[] | undefined) => {
		for (const k of who ?? [])
			rows.transactionFor.push({ transactionId: tx, memberId: kids[k], householdId: household });
	};
	/** An imported row on a bank or statement Account, filed later by categorization. */
	const importRow = (key: keyof typeof account, tx: Omit<Tx, "id" | "householdId" | "source">) => {
		const row: Tx = {
			...tx,
			id: id(),
			householdId: household,
			source: "import",
			accountId: account[key],
			externalId: `seed-${next()}`,
		};
		rows.transactions.push(row);
		imported.push({ tx: row, account: key });
		return row;
	};
	const quickAdd = (tx: Omit<Tx, "id" | "householdId" | "source">) => {
		const row: Tx = { ...tx, id: id(), householdId: household, source: "quick-add" };
		rows.transactions.push(row);
		return row;
	};
	// The Costco card is read from monthly statements, so this month's Costco trips are Quick Adds.
	const onStatement = (via: Merchant["via"], date: DayKey) =>
		via === "costco" && monthOfDay(date) === thisMonth;

	const spent: Record<string, Cents[]> = {};
	const addSpent = (key: string, i: number, cents: Cents) => {
		const list = spent[key] ?? months.map(() => 0);
		list[i] = (list[i] as number) + cents;
		spent[key] = list;
	};
	const refundable: Tx[] = [];
	const receiptable: Tx[] = [];
	const splitTrips: { tx: Tx; parts: { key: string; amount: Cents }[] }[] = [];

	months.forEach((month, i) => {
		const current = month === thisMonth;
		for (const b of BUCKETS) {
			if (!inPlan(b.key, i) || b.visits === 0 || b.merchants.length === 0) continue;
			const ratio = typeof b.ratio === "number" ? b.ratio : (b.ratio[i] ?? b.ratio.rest ?? 1);
			const share = current && b.key !== "eating" ? elapsed : 1;
			const target = Math.round(allowanceIn(b.key, i) * ratio * share);
			const visits = Math.max(1, Math.round(b.visits * (current ? elapsed : 1)));
			if (target <= 0) continue;
			const weights = Array.from(
				{ length: visits },
				(_, v) => 0.5 + unit(i * 131 + v * 17 + b.key.length),
			);
			const amounts = spread(target, weights);
			const lastDay = current ? dayNumber(o.today) : daysInMonth(month);
			amounts.forEach((amount, v) => {
				const seed = i * 977 + v * 31 + b.key.length * 7;
				const merchant = pickMerchant(b.merchants, seed);
				const date = dayIn(month, 1 + Math.floor(unit(seed) * lastDay));
				const who = merchant.for;
				const bucket = bucketId[b.key] as string;
				if (merchant.split && !onStatement(merchant.via, date)) {
					// A Costco trip: this Bucket's share, plus Household supplies and, now and then, Hockey.
					const household$ = Math.round(amount * 0.35);
					const hockey = v % 3 === 0 ? Math.round(amount * 0.12) : 0;
					const tx = importRow("costco", {
						date,
						amountCents: amount + household$ + hockey,
						note: merchant.text,
						createdAt: new Date(at(date, 23 * 60)),
					});
					const parts = [
						{ key: b.key, amount },
						{ key: "household", amount: household$ },
						...(hockey ? [{ key: "hockey", amount: hockey }] : []),
					];
					splitTrips.push({ tx, parts });
					for (const p of parts) addSpent(p.key, i, p.amount);
					return;
				}
				addSpent(b.key, i, amount);
				if (merchant.via === "cash" || onStatement(merchant.via, date)) {
					const tx = quickAdd({
						date,
						amountCents: amount,
						bucketId: bucket,
						note: merchant.via === "cash" ? merchant.text : "Costco",
						createdByMemberId: parent(v),
						capturedVia: v % 4 === 1 ? "shortcut" : null,
						createdAt: new Date(at(date, 18 * 60 + v)),
					});
					addFor(tx.id as string, who);
					if (merchant.matched && date < o.today && v % 2 === 0) {
						// The same spend, imported a day later, Matched to the Quick Add.
						const copy = importRow("sapphire", {
							date: addDays(date, 1),
							amountCents: amount,
							note:
								merchant.text === "Pizza after hockey"
									? "SQ *HOME SLICE PIZZA"
									: merchant.text.toUpperCase(),
							createdAt: new Date(at(addDays(date, 1), 23 * 60)),
						});
						rows.matches.push({
							id: id(),
							householdId: household,
							quickAddId: tx.id as string,
							importedId: copy.id,
							createdAt: copy.createdAt as Date,
						});
					}
					return;
				}
				const via = merchant.via === "costco" ? "costco" : merchant.via;
				const tx = importRow(via, {
					date,
					amountCents: amount,
					bucketId: bucket,
					note: merchant.text,
					createdAt: new Date(at(addDays(date, 1), 6 * 60)),
				});
				addFor(tx.id as string, who);
				if (b.key === "household" && merchant.text.startsWith("TARGET")) refundable.push(tx);
				if (b.key === "household" && merchant.text.startsWith("AMAZON")) receiptable.push(tx);
			});
		}
	});

	// Splits for the Costco trips (the Transaction itself is unassigned).
	for (const { tx, parts } of splitTrips) {
		parts.forEach((p, position) => {
			const split = id();
			rows.splits.push({
				id: split,
				householdId: household,
				transactionId: tx.id as string,
				position,
				amountCents: p.amount,
				bucketId: bucketId[p.key] as string,
			});
			if (p.key === "hockey")
				rows.splitFor.push({ splitId: split, memberId: maya, householdId: household });
		});
	}

	// Refunds: every other month, half a Target run comes back three days later.
	refundable
		.filter((tx, n) => n % 9 === 0 && addDays(tx.date as DayKey, 3) <= o.today)
		.forEach((original) => {
			const date = addDays(original.date as DayKey, 3);
			const amount = Math.round((original.amountCents as number) / 2);
			const refund = importRow("sapphire", {
				date,
				amountCents: -amount,
				bucketId: original.bucketId,
				note: "TARGET 00012345 RETURN",
				createdAt: new Date(at(addDays(date, 1), 6 * 60)),
			});
			rows.refunds.push({
				id: id(),
				householdId: household,
				refundTransactionId: refund.id,
				originalTransactionId: original.id as string,
				createdByMemberId: jordan,
				createdAt: new Date(at(addDays(date, 1), 20 * 60)),
			});
			addSpent("household", months.indexOf(monthOfDay(date)), -amount);
		});

	// A $0 charge (a free trial) and a charge made twice by mistake, this month.
	importRow("sapphire", {
		date: dayIn(monthAt(6), 4),
		amountCents: 0,
		bucketId: bucketId.fun,
		note: "APPLE.COM/BILL FREE TRIAL",
		createdAt: new Date(at(dayIn(monthAt(6), 5), 6 * 60)),
	});
	const dupDate = addDays(o.today, dayNumber(o.today) > 3 ? -2 : 0);
	const duplicates = [0, 1].map(() =>
		importRow("sapphire", {
			date: dupDate,
			amountCents: 3_847,
			bucketId: bucketId.eating,
			note: "DOORDASH*CHIPOTLE",
			createdAt: new Date(at(dupDate, 23 * 60)),
		}),
	);
	addSpent("eating", 7, 2 * 3_847);

	// Pending: the last couple of days' card charges the bank hasn't posted yet.
	const pendingSpecs = [
		["H-E-B #512 AUSTIN TX", "groceries", 6_231],
		["SHELL OIL 57444", "gas", 4_410],
		["SQ *BLUE BOTTLE COFFEE", "eating", 1_275],
	] as const;
	pendingSpecs.forEach(([text, key, amount], n) => {
		const date = addDays(o.today, -(n % 2));
		if (monthOfDay(date) !== thisMonth) return;
		importRow("sapphire", {
			date,
			amountCents: amount,
			bucketId: bucketId[key],
			note: text,
			pending: true,
			createdAt: new Date(o.now - (n + 1) * 1_800_000),
		});
		addSpent(key, 7, amount);
	});

	// Review: imported charges nobody has filed yet, each with a different kind of guess: a Rule's
	// (one sent back to Review), a similar merchant's, the model's, Alex's own Personal Allowance,
	// or none at all.
	const reviewSpecs: [number, string, Cents, string | null, number, GuessMethod, string | null][] =
		[
			[0, "SQ *MARIA'S TAQUERIA", 2_340, "eating", 0.81, "similar", "Torchy's Tacos"],
			[0, "PAYPAL *EBAY INC", 8_999, null, 0, "none", null],
			[0, "VENMO *KAREN MITCHELL", 4_000, "hockey", 0.41, "model", "looks like a team fee"],
			[0, "AMZN MKTP US*2K4LM1QZ0", 3_187, "household", 0.55, "model", "looks like home supplies"],
			[0, "SP * HANDMADE CANDLE CO", 2_800, "gifts", 0.48, "model", "looks like a gift"],
			[0, "BUC-EE'S #22 NEW BRAUNFELS", 6_512, "gas", 0.78, "similar", "Shell"],
			[0, "ZELLE TO DAVID NGUYEN", 15_000, null, 0, "none", null],
			[0, "EVENTBRITE *SPRING GALA", 12_500, "fun", 0.35, "model", "looks like event tickets"],
			[0, "NINTENDO *ESHOP US", 1_999, "pa-alex", 0.64, "model", "looks like a video game"],
			[0, "H-E-B #512 AUSTIN TX", 9_418, "groceries", 1, "rule", null],
			[1, "TST* UCHIKO AUSTIN", 18_450, "eating", 0.6, "model", "looks like a restaurant"],
			[1, "WWW.KOHLS.COM #0873", 5_612, "clothing", 0.66, "model", "looks like clothes"],
			[1, "SQ *AUSTIN FC SHOP", 7_900, null, 0, "none", null],
		];
	reviewSpecs.forEach(([ago, text, amount, guess, confidence, method, reason], n) => {
		const month = addMonths(thisMonth, -ago);
		const last = ago === 0 ? dayNumber(o.today) : daysInMonth(month);
		const date = dayIn(month, 1 + ((n * 7) % last));
		const tx = importRow("sapphire", {
			date,
			amountCents: amount,
			note: text,
			createdAt: new Date(at(addDays(date, 1), 6 * 60)),
		});
		rows.categorizations.push({
			transactionId: tx.id,
			householdId: household,
			outcome: "review",
			method,
			bucketId: guess ? (bucketId[guess] as string) : null,
			confidence: guess ? confidence : null,
			merchant: merchantKey(text),
			reason,
			createdAt: new Date(at(addDays(date, 1), 6 * 60 + 5)),
		});
	});

	// Commitments paid: from checking or the card, as the bank reported them.
	months.forEach((month, i) => {
		for (const c of COMMITMENTS) {
			if (c.endedFrom !== undefined && i >= c.endedFrom) continue;
			const terms = termsIn[c.key]?.(i);
			if (!terms) continue;
			for (const due of dueDatesIn(terms, month)) {
				if (due > o.today) continue;
				const wobble = c.varies
					? Math.round(terms.amount * c.varies * (unit(i * 7 + due.length) * 2 - 1))
					: 0;
				const tx = importRow(c.via, {
					date: due,
					amountCents: terms.amount + wobble,
					commitmentId: commitmentId[c.key],
					note: c.text,
					createdAt: new Date(at(addDays(due, 1), 6 * 60)),
				});
				if (c.key === "braces") addFor(tx.id as string, ["maya"]);
			}
		}
	});

	// Income: two paychecks each, a raise three months in; Jordan's latest is late this month.
	const paychecks = [
		[alex, 1, "ACME CORP PAYROLL", () => 340_000],
		[alex, 15, "ACME CORP PAYROLL", () => 340_000],
		[jordan, 7, "AUSTIN ISD PAYROLL", (i: number) => (i >= 4 ? 310_000 : 280_000)],
		[jordan, 21, "AUSTIN ISD PAYROLL", (i: number) => (i >= 4 ? 310_000 : 280_000)],
	] as const;
	const incomeRow = (key: keyof typeof account, date: DayKey, amount: Cents, note: string) => {
		const row = {
			id: id(),
			householdId: household,
			date,
			amountCents: amount,
			note,
			accountId: account[key],
			externalId: `seed-${next()}`,
			createdAt: new Date(at(addDays(date, 1), 6 * 60)),
		};
		rows.income.push(row);
		importedIncome.push({ row, account: key });
		return row;
	};
	months.forEach((month, i) => {
		for (const [who, day, note, amount] of paychecks) {
			const date = dayIn(month, day);
			if (date > o.today) continue;
			if (month === thisMonth && who === jordan && day === 21) continue;
			incomeRow("checking", date, amount(i), note);
		}
	});
	// Extra income: a bonus (to the house), a tax refund (split), and last month's sale, undecided.
	const bonus = incomeRow("checking", dayIn(monthAt(2), 12), 420_000, "ACME CORP BONUS");
	const refundIncome = incomeRow(
		"checking",
		dayIn(monthAt(5), 9),
		231_000,
		"IRS TREAS 310 TAX REF",
	);
	incomeRow("checking", dayIn(monthAt(6), 17), 64_000, "VENMO CASHOUT — SOLD JOGGING STROLLER");

	// The Costco card carries a balance from before; a payoff Goal (ADR-0019) plans an extra
	// $250 a month on it from the fifth month, paid with each month's card payment.
	const PAYOFF_FROM = 4;
	const PAYOFF_EXTRA = 25_000;
	// Transfers: the cards are paid from checking, and savings moved to Ally each month.
	months.forEach((month, i) => {
		if (i === 7 && dayNumber(o.today) < 26) return;
		const cardSpend = (key: "sapphire" | "costco") =>
			imported
				.filter(
					(r) =>
						r.account === key &&
						monthOfDay(r.tx.date as DayKey) === addMonths(month, -1) &&
						(r.tx.amountCents as number) > 0,
				)
				.reduce((sum, r) => sum + (r.tx.amountCents as number), 0);
		for (const [key, day, text] of [
			["sapphire", 25, "AUTOMATIC PAYMENT - THANK YOU"],
			["costco", 20, "ONLINE PAYMENT, THANK YOU"],
		] as const) {
			const date = dayIn(month, day);
			// From the month the payoff Goal was added, the Costco card gets its extra payment too.
			const extra = key === "costco" && i >= PAYOFF_FROM ? PAYOFF_EXTRA : 0;
			const amount = (i === 0 ? 150_000 : cardSpend(key)) + extra;
			if (date > o.today || amount <= 0) continue;
			const out = importRow("checking", {
				date,
				amountCents: amount,
				note: key === "sapphire" ? "CHASE CREDIT CRD AUTOPAY" : "CITI CARD ONLINE PAYMENT",
				createdAt: new Date(at(addDays(date, 1), 6 * 60)),
			});
			// Costco card statements arrive monthly: this month's payment isn't on one yet.
			const into =
				key === "costco" && month === thisMonth
					? null
					: importRow(key, {
							date,
							amountCents: -amount,
							note: text,
							createdAt: new Date(at(addDays(date, 1), 6 * 60)),
						});
			rows.transfers.push({
				id: id(),
				householdId: household,
				outTransactionId: out.id,
				inTransactionId: into?.id ?? null,
				createdAt: new Date(at(addDays(date, 1), 6 * 60 + 1)),
			});
		}
		const date = dayIn(month, 3);
		if (date > o.today) return;
		const out = importRow("checking", {
			date,
			amountCents: 130_000,
			note: "ONLINE TRANSFER TO ALLY SAVINGS",
			createdAt: new Date(at(addDays(date, 1), 6 * 60)),
		});
		// Ally lapsed three weeks ago, so the latest arrivals were never imported.
		const into = date <= lapsed ? incomeRow("ally", date, 130_000, "TRANSFER FROM CHASE") : null;
		rows.transfers.push({
			id: id(),
			householdId: household,
			outTransactionId: out.id,
			inIncomeId: into?.id ?? null,
			createdByMemberId: into ? null : alex,
			createdAt: new Date(at(addDays(date, 1), 6 * 60 + 1)),
		});
	});

	// Goals and what Goals have set aside ------------------------------------------------------------------------
	const goal = { emergency: id(), house: id(), trip: id(), laptop: id(), hockey: id() };
	const goalSpecs = [
		["emergency", "Emergency fund", "ally", 3_000_000, null, 0, 1_800_000, 50_000, [0, 8]],
		[
			"house",
			"House down payment",
			"ally",
			15_000_000,
			// No date: a dated one this far off would need more each month than the Plan has.
			null,
			0,
			4_000_000,
			80_000,
			[0, 8],
		],
		[
			"trip",
			"Spring break: Disney World with Grandma!",
			"checking",
			900_000,
			`${addMonths(thisMonth, 5)}-28`,
			1,
			120_000,
			25_000,
			[1, 8],
		],
		["laptop", "Theo’s school laptop", "kids", 100_000, `${monthAt(4)}-28`, 0, 0, 20_000, [0, 5]],
		[
			"hockey",
			"Hockey tournament — Dallas",
			"kids",
			45_000,
			`${monthAt(2)}-20`,
			0,
			0,
			15_000,
			[0, 3],
		],
	] as const;
	for (const [key, name, acct, target, targetDate, from, claim, funding, [f0, f1]] of goalSpecs) {
		const g = goal[key];
		const at0 = at(dayIn(monthAt(from), 2), 20 * 60);
		rows.goals.push({
			id: g,
			householdId: household,
			accountId: account[acct],
			name,
			// The house target went up four months in (the first target is in its Plan change).
			targetCents: target,
			targetDate: targetDate as DayKey | null,
			fromMonth: monthAt(from),
			completedAt:
				key === "laptop"
					? new Date(at(dayIn(monthAt(4), 28), 20 * 60))
					: key === "hockey"
						? new Date(at(dayIn(monthAt(2), 20), 20 * 60))
						: null,
			archivedAt: key === "hockey" ? new Date(at(dayIn(monthAt(3), 4), 20 * 60)) : null,
			createdAt: new Date(at0),
		});
		planChange(rows, household, {
			member: key === "trip" ? jordan : alex,
			kind: "goal-add",
			target: g,
			month: monthAt(from),
			before: null,
			after: {
				name,
				target: key === "house" ? 12_000_000 : target,
				targetDate: targetDate as DayKey | null,
			},
			at: at0,
		});
		if (claim)
			rows.earmarkClaims.push({
				id: id(),
				householdId: household,
				goalId: g,
				month: monthAt(from),
				amountCents: claim,
				createdByMemberId: alex,
				createdAt: new Date(at0 + 60_000),
			});
		for (let i = f0; i < f1; i++) {
			const date = dayIn(monthAt(i), 2);
			if (date > o.today) continue;
			rows.moves.push({
				id: id(),
				householdId: household,
				kind: "goal-funding",
				month: monthAt(i),
				amountCents: funding,
				toGoalId: g,
				createdByMemberId: parent(i),
				createdAt: new Date(at(date, 20 * 60)),
			});
		}
	}
	planChange(rows, household, {
		member: jordan,
		kind: "goal",
		target: goal.house,
		month: monthAt(3),
		before: { target: 12_000_000, targetDate: null },
		after: { target: 15_000_000, targetDate: null },
		at: at(dayIn(monthAt(3), 10), 20 * 60),
	});
	rows.households[0] = {
		...(rows.households[0] as typeof s.households.$inferInsert),
		emergencyGoalId: goal.emergency,
	};
	// Paying off the Costco card (ADR-0019): added in the fifth month at what was owed then, which
	// three extra payments have brought down to this month's statement balance ($612.40).
	const payoff = id();
	const costcoOwed = 61_240;
	const payoffTarget = costcoOwed + 3 * PAYOFF_EXTRA;
	const payoffAt = at(dayIn(monthAt(PAYOFF_FROM), 2), 20 * 60);
	const payoffDate = `${addMonths(thisMonth, 3)}-28` as DayKey;
	rows.goals.push({
		id: payoff,
		householdId: household,
		accountId: account.costco,
		kind: "payoff",
		name: "Pay off the Costco Visa",
		targetCents: payoffTarget,
		targetDate: payoffDate,
		fromMonth: monthAt(PAYOFF_FROM),
		completedAt: null,
		archivedAt: null,
		createdAt: new Date(payoffAt),
	});
	planChange(rows, household, {
		member: jordan,
		kind: "goal-add",
		target: payoff,
		month: monthAt(PAYOFF_FROM),
		before: null,
		after: { name: "Pay off the Costco Visa", target: payoffTarget, targetDate: payoffDate },
		at: payoffAt,
	});
	for (let i = PAYOFF_FROM; i < 8; i++) {
		const date = dayIn(monthAt(i), 2);
		if (date > o.today) continue;
		rows.moves.push({
			id: id(),
			householdId: household,
			kind: "goal-funding",
			month: monthAt(i),
			amountCents: PAYOFF_EXTRA,
			toGoalId: payoff,
			createdByMemberId: parent(i),
			createdAt: new Date(at(date, 20 * 60 + 5)),
		});
	}
	// Spending from Goals: the trip deposit, the laptop, and the tournament.
	for (const [key, acct, i, day, amount, note] of [
		["trip", "checking", 5, 14, 50_000, "Disney resort deposit"],
		["laptop", "kids", 5, 6, 97_900, "Apple Store — MacBook Air"],
		["hockey", "kids", 2, 19, 45_000, "Dallas tournament hotel"],
	] as const) {
		const date = dayIn(monthAt(i), day);
		quickAdd({
			date,
			amountCents: amount,
			goalId: goal[key],
			accountId: account[acct],
			note,
			createdByMemberId: jordan,
			createdAt: new Date(at(date, 19 * 60)),
		});
	}

	// Balances: the banks' latest, and a statement's closing balance for the kids' savings.
	const balance = (
		key: keyof typeof account,
		cents: Cents,
		when: number,
		by: string | null = null,
	) =>
		rows.accountBalances.push({
			id: id(),
			householdId: household,
			accountId: account[key],
			amountCents: cents,
			createdByMemberId: by,
			createdAt: new Date(when),
		});
	balance("checking", 791_004, at(addDays(o.today, -8), 6 * 60));
	balance("checking", 843_217, o.now - 2 * 3_600_000);
	balance("sapphire", 284_733, o.now - 2 * 3_600_000);
	balance("ally", 11_248_055, at(lapsed, 6 * 60));
	balance("loan", 2_138_000, at(lapsed, 6 * 60));
	// What was owed on the Costco card when its payoff Goal was added, then each statement since.
	balance("costco", payoffTarget, payoffAt - 60_000, jordan);
	for (let i = PAYOFF_FROM + 1; i < 7; i++) {
		balance(
			"costco",
			payoffTarget - (i - PAYOFF_FROM) * PAYOFF_EXTRA,
			at(dayIn(monthAt(i), 3), 9 * 60),
			jordan,
		);
	}
	balance("costco", costcoOwed, at(dayIn(thisMonth, 3), 9 * 60));
	balance("kids", 310_000, at(dayIn(monthAt(0), 5), 20 * 60), alex);

	// Moves: Covers, Extra income decisions, then Month-close Sweeps ---------------------------------------
	const moved: Record<string, Cents[]> = {};
	const addMoved = (key: string, i: number, cents: Cents) => {
		const list = moved[key] ?? months.map(() => 0);
		list[i] = (list[i] as number) + cents;
		moved[key] = list;
	};
	const leftOf = (key: string, i: number) =>
		allowanceIn(key, i) + (moved[key]?.[i] ?? 0) - (spent[key]?.[i] ?? 0);
	for (const [i, from, who] of [
		[1, "groceries", jordan],
		[3, "groceries", alex],
		[4, "fun", jordan],
		[5, null, alex],
	] as const) {
		const over = -leftOf("eating", i);
		if (over <= 0) continue;
		const amount = from ? Math.min(over, Math.max(0, leftOf(from, i))) : over;
		if (amount <= 0) continue;
		rows.moves.push({
			id: id(),
			householdId: household,
			kind: "cover",
			month: monthAt(i),
			fromBucketId: from ? (bucketId[from] as string) : null,
			toBucketId: bucketId.eating,
			amountCents: amount,
			createdByMemberId: who,
			createdAt: new Date(at(dayIn(monthAt(i), 27), 20 * 60)),
		});
		addMoved("eating", i, amount);
		if (from) addMoved(from, i, -amount);
	}
	for (const [i, cents, to, who] of [
		[2, bonus.amountCents, { toGoalId: goal.house }, jordan],
		[5, 150_000, { toGoalId: goal.emergency }, alex],
		[5, refundIncome.amountCents - 150_000, { toBucketId: bucketId.fun }, alex],
	] as const) {
		rows.moves.push({
			id: id(),
			householdId: household,
			kind: "windfall",
			month: monthAt(i),
			amountCents: cents,
			...to,
			createdByMemberId: who,
			createdAt: new Date(at(dayIn(monthAt(i), 14), 21 * 60)),
		});
		if ("toBucketId" in to) addMoved("fun", i, cents);
	}
	// Closed months: every resets monthly Household Bucket's leftover swept to a Goal. Last month is
	// still open, so This Month (in its first week) and the Check-in offer its Sweeps and Extra income.
	const resetsMonthly = BUCKETS.filter(
		(b) => !b.owner && !b.rolling && b.rollingFrom === undefined,
	);
	for (let i = 0; i < 6; i++) {
		const decidedBy = [alex, null, jordan, jordan, null, alex][i] ?? null;
		const closedOn = dayIn(monthAt(i + 1), 2 + (i % 3));
		for (const b of resetsMonthly) {
			if (!inPlan(b.key, i)) continue;
			const left = leftOf(b.key, i);
			if (left <= 0) continue;
			rows.moves.push({
				id: id(),
				householdId: household,
				kind: "sweep",
				month: monthAt(i),
				fromBucketId: bucketId[b.key],
				toGoalId: i === 3 ? goal.trip : goal.emergency,
				amountCents: left,
				createdByMemberId: decidedBy,
				createdAt: new Date(at(closedOn, 20 * 60)),
			});
		}
		rows.monthCloses.push({
			id: id(),
			householdId: household,
			month: monthAt(i),
			decidedByMemberId: decidedBy,
			createdAt: new Date(at(closedOn, 20 * 60 + 1)),
		});
	}

	// Scenarios ------------------------------------------------------------------------------------
	const scenario = { cut: id(), house: id(), disney: id() };
	const next1 = addMonths(thisMonth, 1);
	const scenarioRows: [
		string,
		string,
		ScenarioChange[],
		string,
		number,
		{ by: string; at: number } | null,
	][] = [
		[
			scenario.cut,
			"Cut eating out to $300",
			[
				{
					kind: "allowance",
					bucketId: bucketId.eating as string,
					amount: 30_000,
					fromMonth: next1,
				},
				{
					kind: "allowance",
					bucketId: bucketId.fun as string,
					amount: 20_000,
					fromMonth: next1,
					muted: true,
				},
				// Its Bucket was archived since: "No longer in the Plan".
				{ kind: "allowance", bucketId: bucketId.daycare as string, amount: 0, fromMonth: next1 },
			],
			alex,
			at(addDays(o.today, -9), 21 * 60),
			null,
		],
		[
			scenario.house,
			"Bigger house in two years",
			[
				{
					kind: "end-commitment",
					commitmentId: commitmentId.mortgage as string,
					fromMonth: addMonths(thisMonth, 24),
				},
				{
					kind: "add-commitment",
					commitmentId: "01SEEDNEWMORTGAGE000000000",
					name: "New mortgage",
					amount: 395_000,
					cadence: "monthly",
					dueDay: 1,
					months: 360,
					fromMonth: addMonths(thisMonth, 24),
				},
				{
					kind: "one-off",
					oneOffId: "down-payment",
					name: "Down payment and closing",
					amount: 12_000_000,
					flow: "expense",
					fromMonth: addMonths(thisMonth, 24),
				},
				{ kind: "growth", incomePct: 3, costsPct: 2.5, fromMonth: next1 },
			],
			jordan,
			at(addDays(o.today, -20), 21 * 60),
			null,
		],
		[
			scenario.disney,
			"Drop Disney+",
			[
				{
					kind: "end-commitment",
					commitmentId: commitmentId.disney as string,
					fromMonth: monthAt(6),
				},
			],
			jordan,
			at(dayIn(monthAt(5), 20), 21 * 60),
			{ by: jordan, at: at(dayIn(monthAt(5), 21), 21 * 60) },
		],
	];
	for (const [sid, name, changes, by, when, applied] of scenarioRows) {
		rows.scenarios.push({
			id: sid,
			householdId: household,
			name,
			levers: { version: 2, levers: changes },
			createdByMemberId: by,
			createdAt: new Date(when),
			updatedAt: new Date(applied?.at ?? when + 3_600_000),
			appliedAt: applied ? new Date(applied.at) : null,
			appliedByMemberId: applied?.by ?? null,
		});
	}
	planChange(rows, household, {
		member: jordan,
		kind: "commitment-end",
		target: commitmentId.disney as string,
		month: monthAt(6),
		before: null,
		after: null,
		at: at(dayIn(monthAt(5), 21), 21 * 60),
		scenarioId: scenario.disney,
	});

	// Rules and categorization ----------------------------------------------------------------------
	const ruleSpecs = [
		["H-E-B #512 AUSTIN TX", "groceries", null, []],
		["TRADER JOE'S #423", "groceries", null, []],
		["SHELL OIL 57444", "gas", null, []],
		["TST* TORCHY'S TACOS 0021", "eating", null, []],
		["SQ *BLUE BOTTLE COFFEE", "eating", null, []],
		["TARGET 00012345", "household", null, []],
		["AUSTIN ICE HOCKEY ASSN", "hockey", null, ["maya"]],
		["SWIM ATX LESSONS", "hockey", null, ["theo"]],
		["PETCO 1234", "pets", null, []],
		["STEAM GAMES", "pa-alex", alex, []],
		["SEPHORA", "pa-jordan", jordan, []],
	] as const;
	const rulePatterns = new Set<string>();
	ruleSpecs.forEach(([text, key, owner, who], n) => {
		const pattern = merchantKey(text);
		rulePatterns.add(pattern);
		const rule = id();
		rows.rules.push({
			id: rule,
			householdId: household,
			pattern,
			bucketId: bucketId[key] as string,
			createdByMemberId: owner ?? parent(n),
			ownerMemberId: owner,
			matchedCount: imported.filter((r) => r.tx.note === text).length,
			createdAt: new Date(at(dayIn(start, 5 + n), 20 * 60)),
		});
		for (const k of who)
			rows.ruleFor.push({ ruleId: rule, memberId: kids[k], householdId: household });
	});
	for (const { tx } of imported) {
		if (!tx.bucketId || (tx.amountCents as number) < 0) continue;
		const merchant = merchantKey(tx.note as string);
		const byRule = rulePatterns.has(merchant);
		rows.categorizations.push({
			transactionId: tx.id as string,
			householdId: household,
			outcome: "filed",
			method: byRule ? "rule" : unit(merchant.length) > 0.5 ? "similar" : "model",
			bucketId: tx.bucketId,
			confidence: byRule ? 1 : 0.9,
			merchant,
			createdAt: tx.createdAt as Date,
		});
	}

	// Imports: the banks read every morning (grouped by week here), statements monthly -----------------
	const importFor = (key: keyof typeof account, date: DayKey) => {
		if (key === "costco") {
			const month = monthOfDay(date);
			const on = dayIn(addMonths(month, 1), 4);
			return { group: month, source: "csv" as const, on: on > o.today ? o.today : on };
		}
		// The week's Saturday, or today for this week.
		const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
		const saturday = addDays(date, 6 - weekday);
		return {
			group: saturday,
			source: "bank" as const,
			on: saturday > o.today ? o.today : saturday,
		};
	};
	const groups = new Map<
		string,
		{
			key: keyof typeof account;
			source: "csv" | "bank";
			on: DayKey;
			dates: DayKey[];
			tx: Tx[];
			income: (typeof s.income.$inferInsert)[];
		}
	>();
	const groupOf = (key: keyof typeof account, date: DayKey) => {
		const f = importFor(key, date);
		const k = `${key}|${f.group}`;
		let g = groups.get(k);
		if (!g) {
			g = { key, source: f.source, on: f.on, dates: [], tx: [], income: [] };
			groups.set(k, g);
		}
		g.dates.push(date);
		return g;
	};
	for (const { tx, account: key } of imported) groupOf(key, tx.date as DayKey).tx.push(tx);
	for (const { row, account: key } of importedIncome)
		groupOf(key, row.date as DayKey).income.push(row);
	for (const g of [...groups.values()].sort((a, b) => (a.on < b.on ? -1 : 1))) {
		const importId = id();
		const dates = [...g.dates].sort();
		const createdAt = new Date(g.on === o.today ? o.now - 2 * 3_600_000 : at(g.on, 6 * 60));
		const bank = accountRows.find(([key]) => key === g.key)?.[3] ?? null;
		rows.imports.push({
			id: importId,
			householdId: household,
			accountId: account[g.key],
			source: g.source,
			fileName: g.source === "csv" ? `costco-visa-${dates[0]?.slice(0, 7)}.csv` : null,
			fileKey: g.source === "csv" ? `${household}/${account[g.key]}/${importId}.csv` : null,
			status: "imported",
			transactionCount: g.tx.length,
			incomeCount: g.income.length,
			duplicateCount: 0,
			firstDate: dates[0] ?? null,
			lastDate: dates.at(-1) ?? null,
			closingBalanceCents: g.source === "csv" ? 61_240 : null,
			closingBalanceDate: g.source === "csv" ? (dates.at(-1) ?? null) : null,
			createdByMemberId: g.source === "csv" ? alex : null,
			bankConnectionId: g.source === "bank" ? bank : null,
			createdAt,
		});
		for (const tx of g.tx) {
			tx.importId = importId;
			tx.createdAt = createdAt;
		}
		for (const row of g.income) {
			row.importId = importId;
			row.createdAt = createdAt;
		}
	}
	rows.imports.push({
		id: id(),
		householdId: household,
		accountId: account.kids,
		source: "ofx",
		fileName: `kids-savings-${start}.ofx`,
		fileKey: null,
		status: "imported",
		transactionCount: 0,
		firstDate: dayIn(start, 1),
		lastDate: dayIn(start, 5),
		closingBalanceCents: 310_000,
		closingBalanceDate: dayIn(start, 5),
		createdByMemberId: alex,
		createdAt: new Date(at(dayIn(start, 5), 20 * 60)),
	});

	// Receipts: forwarded Amazon orders and a snapped Costco receipt ----------------------------------
	const lineItems = [
		"Paper towels, 12 rolls",
		"Dish soap, 3 pack",
		"Laundry pods",
		"Kids’ toothpaste",
		"LED bulbs, 4 pack",
	];
	const receiptOf = (tx: Tx, source: "email" | "photo", member: string, n: number) => {
		const total = tx.amountCents as number;
		const tax = Math.round((total * 0.0825) / 1.0825);
		const items = spread(total - tax, [1 + unit(n), 1 + unit(n + 1), 1 + unit(n + 2)]);
		const lines: ReceiptLine[] = [
			...items.map((amount, k) => ({
				text: lineItems[(n + k) % lineItems.length] as string,
				kind: "item" as const,
				amount,
				bucketId: tx.bucketId ?? null,
				confidence: 0.92,
				for: [],
			})),
			{ text: "Sales tax", kind: "tax", amount: tax, bucketId: null, confidence: 1, for: [] },
		];
		rows.receipts.push({
			id: id(),
			householdId: household,
			memberId: member,
			source,
			transactionId: tx.id as string,
			fileKey: `receipts/${household}/seed-${n}.${source === "email" ? "eml" : "jpg"}`,
			merchant: source === "email" ? "Amazon.com" : "Costco",
			date: tx.date as DayKey,
			totalCents: total,
			lines,
			createdAt: new Date((tx.createdAt as Date).getTime() + 60_000),
		});
	};
	receiptable.slice(-5).forEach((tx, n) => {
		receiptOf(tx, "email", parent(n), n);
	});
	const snapped = splitTrips.at(-1)?.tx;
	if (snapped) {
		const total = snapped.amountCents as number;
		const parts = splitTrips.at(-1)?.parts ?? [];
		rows.receipts.push({
			id: id(),
			householdId: household,
			memberId: jordan,
			source: "photo",
			transactionId: snapped.id as string,
			fileKey: `receipts/${household}/seed-costco.jpg`,
			merchant: "Costco",
			date: snapped.date as DayKey,
			totalCents: total,
			lines: parts.map((p) => ({
				text:
					p.key === "groceries"
						? "Groceries (14 items)"
						: p.key === "household"
							? "Kirkland paper goods"
							: "Hockey tape and socks",
				kind: "item",
				amount: p.amount,
				bucketId: bucketId[p.key] as string,
				confidence: 0.88,
				for: p.key === "hockey" ? [maya] : [],
			})),
			createdAt: new Date((snapped.createdAt as Date).getTime() + 60_000),
		});
	}

	// Perk Sources and Perks, Insights and Overlaps ------------------------------------------------------
	const checked = at(addDays(o.today, -12), 3 * 60);
	const tmobile = id();
	const sapphire = id();
	const perkSourceRows: [
		string | null,
		string,
		string,
		(typeof s.perkSources.$inferInsert)["kind"],
		"suggested" | "confirmed" | "dismissed",
		string | null,
		string,
	][] = [
		[
			tmobile,
			"t-mobile",
			"T-Mobile",
			"phone-plan",
			"confirmed",
			"Go5G Plus",
			"https://www.t-mobile.com/cell-phone-plans",
		],
		[
			sapphire,
			"chase-sapphire",
			"Chase Sapphire",
			"credit-card",
			"confirmed",
			"Sapphire Preferred",
			"https://creditcards.chase.com/rewards-credit-cards/sapphire",
		],
		[
			null,
			"costco",
			"Costco",
			"membership",
			"suggested",
			null,
			"https://www.costco.com/join-costco.html",
		],
		[
			null,
			"amazon-prime",
			"Amazon Prime",
			"membership",
			"dismissed",
			null,
			"https://www.amazon.com/amazonprime",
		],
	];
	for (const [sid, key, name, kind, status, plan, page] of perkSourceRows) {
		rows.perkSources.push({
			id: sid ?? id(),
			householdId: household,
			name,
			kind,
			catalogKey: key,
			plan,
			pageUrl: page,
			seenIn:
				key === "chase-sapphire"
					? "Chase Sapphire Preferred"
					: key === "costco"
						? "COSTCO WHSE #1042"
						: null,
			status,
			research: status === "confirmed" ? "done" : "idle",
			checkedAt: status === "confirmed" ? new Date(checked) : null,
			fingerprint: `household|catalog:${key}`,
			decidedByMemberId: status === "suggested" ? null : jordan,
			createdAt: new Date(at(dayIn(monthAt(4), 9), 3 * 60)),
		});
	}
	const perkRows: [string, string, "service" | "cost", string, string, string][] = [
		[
			tmobile,
			"Netflix Standard with ads",
			"service",
			"netflix",
			"Netflix Standard with ads is on us with Go5G Plus.",
			"https://www.t-mobile.com/cell-phone-plans",
		],
		[
			tmobile,
			"Apple TV+",
			"service",
			"apple tv",
			"Apple TV+ included on Go5G Plus lines.",
			"https://www.t-mobile.com/cell-phone-plans",
		],
		[
			sapphire,
			"DoorDash DashPass",
			"service",
			"doordash",
			"Complimentary DashPass membership for a minimum of one year.",
			"https://creditcards.chase.com/rewards-credit-cards/sapphire",
		],
		[
			sapphire,
			"$50 annual hotel credit",
			"cost",
			"hotel",
			"Get up to $50 in statement credits each account anniversary year for hotel stays.",
			"https://creditcards.chase.com/rewards-credit-cards/sapphire",
		],
	];
	const perkId: Record<string, string> = {};
	for (const [source, name, kind, matches, quote, url] of perkRows) {
		const pid = id();
		perkId[matches] = pid;
		rows.perks.push({
			id: pid,
			householdId: household,
			perkSourceId: source,
			key: perkKey({ kind, matches }),
			name,
			kind,
			matches,
			quote,
			sourceUrl: url,
			checkedAt: new Date(checked),
		});
	}
	const lastOf = (key: string) =>
		rows.transactions.filter((t) => t.commitmentId === commitmentId[key]).at(-1)?.id as string;
	const insightRows: [
		(typeof s.insights.$inferInsert)["kind"],
		string,
		string,
		Cents,
		string[],
		string[],
		string[],
		string,
		"new" | "accepted" | "dismissed",
		string | null,
	][] = [
		[
			"perk-service",
			"Netflix is included with your T-Mobile plan",
			"Your Go5G Plus lines include Netflix Standard with ads, but you’re paying Netflix $22.99 a month yourselves.",
			27_588,
			[lastOf("netflix")],
			[commitmentId.netflix as string],
			[perkId.netflix as string],
			`household|perk-service:${tmobile}:${perkKey({ kind: "service", matches: "netflix" })}:netflix`,
			"new",
			null,
		],
		[
			"duplicate-charge",
			"DoorDash charged you twice",
			"Two identical $38.47 DoorDash*Chipotle charges on the same day. If you only ordered once, ask DoorDash for a refund.",
			3_847,
			duplicates.map((t) => t.id as string),
			[],
			[],
			`household|duplicate-charge:${duplicates.map((t) => t.id).join(",")}`,
			"new",
			null,
		],
		[
			"price-increase",
			"Netflix went up $3 a month",
			"Netflix went from $19.99 to $22.99 a month in the last few months.",
			3_600,
			[lastOf("netflix")],
			[commitmentId.netflix as string],
			[],
			`household|price-increase:netflix.com:2299`,
			"new",
			null,
		],
		[
			"unused",
			"Nobody seems to use Spotify Family",
			"You’ve paid Spotify Family every month but nothing else suggests it’s used. Ending it saves about $240 a year.",
			23_988,
			[lastOf("spotify")],
			[commitmentId.spotify as string],
			[],
			`household|unused:${commitmentId.spotify}:${lastOf("spotify")}`,
			"accepted",
			alex,
		],
		[
			"duplicate-service",
			"Two ways to get DashPass",
			"Your Sapphire card includes DashPass, which you’re not using.",
			9_600,
			[],
			[],
			[perkId.doordash as string],
			`household|duplicate-service:dashpass`,
			"dismissed",
			jordan,
		],
	];
	insightRows.forEach(
		([kind, title, body, impact, txIds, cIds, pIds, fingerprint, status, decided], n) => {
			rows.insights.push({
				id: id(),
				householdId: household,
				kind,
				title,
				body,
				yearlyImpactCents: impact,
				transactionIds: txIds.filter(Boolean),
				commitmentIds: cIds,
				perkIds: pIds,
				status,
				fingerprint,
				decidedByMemberId: decided,
				createdAt: new Date(at(addDays(o.today, -(n + 1)), 3 * 60)),
			});
		},
	);

	// Check-ins: most weeks both Parents; this week only Jordan so far --------------------------------------
	const thisWeek = checkInWeek(o.today, 0);
	for (let week = checkInWeek(dayIn(start, 7), 0); week <= thisWeek; week = addDays(week, 7)) {
		const n = Math.round(unit(week.length + dayNumber(week)) * 10);
		for (const [who, skip] of [
			// Alex (the first login) hasn't done this week's, so the Check-in opens its card stack.
			[alex, n === 3 || week === thisWeek],
			[jordan, n === 7],
		] as const) {
			if (skip) continue;
			const done = at(week, (who === alex ? 9 : 20) * 60 + 20);
			if (done >= o.now) continue;
			rows.checkIns.push({
				householdId: household,
				memberId: who,
				week,
				completedAt: new Date(done),
			});
		}
	}
	return rows;
}

function pickMerchant(merchants: Merchant[], seed: number): Merchant {
	const total = merchants.reduce((sum, m) => sum + (m.weight ?? 1), 0);
	let r = unit(seed + 0.5) * total;
	for (const m of merchants) {
		r -= m.weight ?? 1;
		if (r < 0) return m;
	}
	return merchants.at(-1) as Merchant;
}

export const SEED_BUSY_NAME = BUSY_NAME;
