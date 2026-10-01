import { expectedIn } from "./commitments";
import { extraIncomeOf } from "./extra-income";
import { shares } from "./for";
import { type GoalKind, paidDownOf, type SetAsideChange, setAsideOf } from "./goals";
import type { Cents } from "./money";
import {
	addDays,
	addMonths,
	type DayKey,
	daysBetween,
	daysInMonth,
	type MonthKey,
	monthOfDay,
	monthsBetween,
} from "./month";
import { type PlanRecords, planForMonth } from "./plan";

// Reports: where the money went over a period, pure and unit-tested. D1 aggregates spending with
// GROUP BY into Cells (a period, a Target, a sum); these functions only reshape and compare those
// sums, so the numbers a chart draws, its table and its CSV are always the same numbers.

/** A Report's period, as a Parent picks it. Every range ends today unless it's in the past. */
export const REPORT_PERIODS = [
	"this-month",
	"last-month",
	"3m",
	"6m",
	"12m",
	"ytd",
	"last-year",
	"custom",
] as const;
export type ReportPeriod = (typeof REPORT_PERIODS)[number];

/** What a Report compares its period to. */
export const COMPARISONS = ["previous", "last-year", "none"] as const;
export type Comparison = (typeof COMPARISONS)[number];

/** How a Report groups days into its chart's periods. */
export const GROUPINGS = ["week", "month", "quarter"] as const;
export type Grouping = (typeof GROUPINGS)[number];

/** Days from `from` up to, not including, `until`. */
export type DayRange = { from: DayKey; until: DayKey };

const firstOf = (month: MonthKey) => `${month}-01` as DayKey;

/** The same day `months` later, on the month's last day when it's shorter. */
export function addMonthsToDay(day: DayKey, months: number): DayKey {
	const month = addMonths(monthOfDay(day), months);
	const date = Math.min(Number(day.slice(8, 10)), daysInMonth(month));
	return `${month}-${String(date).padStart(2, "0")}` as DayKey;
}

/**
 * The days a period covers, as of `asOf` (today in the Household's time zone). "Last N months"
 * counts this month as one of them, up to today; a custom range runs `from` to `to`, both
 * included, whichever order they come in.
 */
export function periodRange(
	period: ReportPeriod,
	asOf: DayKey,
	custom?: { from: DayKey; to: DayKey },
): DayRange {
	const month = monthOfDay(asOf);
	const tomorrow = addDays(asOf, 1);
	const lastMonths = (n: number) => ({ from: firstOf(addMonths(month, 1 - n)), until: tomorrow });
	switch (period) {
		case "this-month":
			return lastMonths(1);
		case "last-month":
			return { from: firstOf(addMonths(month, -1)), until: firstOf(month) };
		case "3m":
			return lastMonths(3);
		case "6m":
			return lastMonths(6);
		case "12m":
			return lastMonths(12);
		case "ytd":
			return { from: `${asOf.slice(0, 4)}-01-01` as DayKey, until: tomorrow };
		case "last-year": {
			const year = Number(asOf.slice(0, 4)) - 1;
			return { from: `${year}-01-01` as DayKey, until: `${year + 1}-01-01` as DayKey };
		}
		case "custom": {
			if (!custom) return lastMonths(1);
			const [from, to] =
				custom.from <= custom.to ? [custom.from, custom.to] : [custom.to, custom.from];
			return { from, until: addDays(to, 1) };
		}
	}
}

/** The months a range touches, in order. */
export function monthsIn(range: DayRange): MonthKey[] {
	const last = monthOfDay(addDays(range.until, -1));
	const months: MonthKey[] = [];
	for (let m = monthOfDay(range.from); m <= last; m = addMonths(m, 1)) months.push(m);
	return months;
}

/**
 * The range a period is compared to, like for like: the one before it (a range starting on a
 * month's first day moves back by whole months, so "this month so far" compares to the same days
 * of last month), the same days a year earlier, or none.
 */
export function comparisonRange(range: DayRange, comparison: Comparison): DayRange | null {
	if (comparison === "none") return null;
	if (comparison === "last-year") {
		return { from: addMonthsToDay(range.from, -12), until: addMonthsToDay(range.until, -12) };
	}
	if (range.from.endsWith("-01")) {
		const months = monthsIn(range).length;
		return {
			from: addMonthsToDay(range.from, -months),
			until: addMonthsToDay(range.until, -months),
		};
	}
	const days = daysBetween(range.from, range.until);
	return { from: addDays(range.from, -days), until: range.from };
}

/**
 * A Report's period and comparison kept to the Household's history, which starts on
 * `historyFrom` (its first spending or income; null when there's none). The period starts no
 * earlier than that month, so charts don't open on empty months. A comparison reaching before it
 * is dropped: against months with nothing in them, "226% more" says only that there was no
 * history yet.
 */
export function withinHistory(
	range: DayRange,
	compared: DayRange | null,
	historyFrom: DayKey | null,
): { range: DayRange; compared: DayRange | null } {
	if (historyFrom === null) return { range, compared: null };
	const start = `${monthOfDay(historyFrom)}-01` as DayKey;
	return {
		range: range.from < start && start < range.until ? { ...range, from: start } : range,
		compared: compared && compared.from >= start ? compared : null,
	};
}

/** Grouping that suits a range when the Parent hasn't picked one: weeks for a month or two. */
export const defaultGrouping = (range: DayRange): Grouping =>
	daysBetween(range.from, range.until) <= 62 ? "week" : "month";

/**
 * The period a day falls in: its month ("2026-09"), its quarter ("2026-Q3"), or its week, named
 * by the Monday it starts on ("2026-09-07"). The same keys D1 groups by (see @noodle/db reports).
 */
export function periodKey(day: DayKey, grouping: Grouping): string {
	if (grouping === "month") return day.slice(0, 7);
	if (grouping === "quarter") {
		return `${day.slice(0, 4)}-Q${Math.ceil(Number(day.slice(5, 7)) / 3)}`;
	}
	// 1970-01-05 was a Monday.
	const sinceMonday = (((daysBetween("1970-01-05" as DayKey, day) % 7) + 7) % 7) as number;
	return addDays(day, -sinceMonday);
}

/** Every period in a range, in order, so a chart shows periods with nothing spent too. */
export function periodKeys(range: DayRange, grouping: Grouping): string[] {
	const keys: string[] = [];
	const step = grouping === "week" ? 7 : 0;
	let day = range.from;
	while (day < range.until) {
		const key = periodKey(day, grouping);
		if (keys.at(-1) !== key) keys.push(key);
		day =
			step > 0
				? addDays(key as DayKey, step)
				: grouping === "month"
					? firstOf(addMonths(monthOfDay(day), 1))
					: firstOf(addMonths(`${day.slice(0, 4)}-${quarterStart(key)}` as MonthKey, 3));
	}
	return keys;
}

const quarterStart = (key: string) => String((Number(key.slice(-1)) - 1) * 3 + 1).padStart(2, "0");

/** The first day of a period key. */
export function periodStart(key: string): DayKey {
	if (/^\d{4}-Q[1-4]$/.test(key)) return `${key.slice(0, 4)}-${quarterStart(key)}-01` as DayKey;
	if (/^\d{4}-\d{2}$/.test(key)) return firstOf(key as MonthKey);
	return key as DayKey;
}

/**
 * Where spending went, as a key: a Bucket's, a Commitment's or a Goal's ID with its kind
 * ("bucket:…"), or "unassigned".
 */
export type Target = `bucket:${string}` | `commitment:${string}` | `goal:${string}` | "unassigned";

export const targetKind = (target: string) =>
	target.slice(0, Math.max(0, target.indexOf(":"))) || "unassigned";
export const targetId = (target: string) => target.slice(target.indexOf(":") + 1);

/**
 * Spending summed by D1 for one period and Target. `private` marks another Parent's Personal
 * Allowance: a total only, with nothing to drill into.
 */
export type SpendCell = {
	period: string;
	target: Target;
	amount: Cents;
	count: number;
	private?: boolean;
};

/** Cells from several queries (whole Transactions, Splits, private totals) as one per period and Target. */
export function mergeCells(...lists: SpendCell[][]): SpendCell[] {
	const byKey = new Map<string, SpendCell>();
	for (const cell of lists.flat()) {
		const key = `${cell.period}|${cell.target}`;
		const seen = byKey.get(key);
		byKey.set(
			key,
			seen
				? {
						...seen,
						amount: seen.amount + cell.amount,
						count: seen.count + cell.count,
						private: seen.private || cell.private,
					}
				: { ...cell },
		);
	}
	return [...byKey.values()];
}

/** Monthly private totals regrouped: each counts on its month's first day, as the rest of the app dates them. */
export const regroupMonthly = (cells: SpendCell[], grouping: Grouping): SpendCell[] =>
	mergeCells(
		cells.map((cell) => ({ ...cell, period: periodKey(periodStart(cell.period), grouping) })),
	);

/** Sums of `amount` per key, largest first. */
export function totalsBy<K extends string>(
	cells: readonly { amount: Cents }[],
	keyOf: (cell: never) => K,
): { key: K; amount: Cents }[] {
	const totals = new Map<K, Cents>();
	for (const cell of cells) {
		const key = keyOf(cell as never);
		totals.set(key, (totals.get(key) ?? 0) + cell.amount);
	}
	return [...totals]
		.map(([key, amount]) => ({ key, amount }))
		.sort((a, b) => b.amount - a.amount || a.key.localeCompare(b.key));
}

export const sumOf = (cells: readonly { amount: Cents }[]): Cents =>
	cells.reduce((sum, cell) => sum + cell.amount, 0);

/** A total per period, one for every key given (zero where nothing was spent). */
export function seriesOf(
	cells: readonly { period: string; amount: Cents }[],
	keys: readonly string[],
): { period: string; amount: Cents }[] {
	const totals = new Map<string, Cents>();
	for (const cell of cells) totals.set(cell.period, (totals.get(cell.period) ?? 0) + cell.amount);
	return keys.map((period) => ({ period, amount: totals.get(period) ?? 0 }));
}

/** The first `count` entries (by amount) and the rest summed as one "other" entry, if any. */
export function topWithOther<T extends { key: string; amount: Cents }>(
	entries: readonly T[],
	count: number,
): (T | { key: "other"; amount: Cents; others: number })[] {
	const sorted = [...entries].sort((a, b) => b.amount - a.amount);
	if (sorted.length <= count + 1) return sorted;
	const rest = sorted.slice(count);
	return [...sorted.slice(0, count), { key: "other", amount: sumOf(rest), others: rest.length }];
}

/** How a figure moved against its comparison: by how much, and as a share of before (null from zero). */
export function changeOf(current: Cents, previous: Cents | null | undefined) {
	if (previous === null || previous === undefined) return null;
	const delta = current - previous;
	return { delta, ratio: previous === 0 ? null : delta / Math.abs(previous) };
}

/**
 * A period's headline numbers: spent (Transactions, Refunds netted), earned (income), saved (what
 * was earned and not spent), the savings rate, and Free to Spend summed over its months' Plans.
 */
export function headlines({
	spent,
	earned,
	freeToSpend,
}: {
	spent: Cents;
	earned: Cents;
	freeToSpend: Cents;
}) {
	const saved = earned - spent;
	return { spent, earned, saved, savingsRate: earned > 0 ? saved / earned : null, freeToSpend };
}

/** The Plans' Free to Spend summed over some months. */
export function freeToSpendOver(records: PlanRecords, months: readonly MonthKey[]): Cents {
	return months.reduce((sum, month) => {
		const plan = planForMonth(records, month);
		const commitments = plan.commitments.reduce((s, c) => s + expectedIn(c, month), 0);
		const allowances = plan.buckets.reduce((s, b) => s + b.allowance, 0);
		return sum + (plan.baseline ?? 0) - commitments - allowances;
	}, 0);
}

/** The amounts Big expenses' threshold snaps to; D1 counts Transactions in bands between them. */
export const THRESHOLD_STOPS: readonly Cents[] = [
	0, 25_00, 50_00, 100_00, 250_00, 500_00, 1_000_00, 2_500_00, 5_000_00, 10_000_00,
];

/** Transactions per band: those from `floor` up to the next stop. */
export type AmountBand = { floor: Cents; count: number; amount: Cents };

/** How many Transactions were `threshold` or more, and what they came to. */
export function overThreshold(bands: readonly AmountBand[], threshold: Cents) {
	const over = bands.filter((band) => band.floor >= threshold);
	return { count: over.reduce((n, band) => n + band.count, 0), amount: sumOf(over) };
}

/** Per period, spending on Commitments (recurring) against everything else (one-offs). */
export function recurringSplit(cells: readonly SpendCell[], keys: readonly string[]) {
	return keys.map((period) => {
		const inPeriod = cells.filter((cell) => cell.period === period);
		const recurring = sumOf(inPeriod.filter((cell) => targetKind(cell.target) === "commitment"));
		return { period, recurring, oneOff: sumOf(inPeriod) - recurring };
	});
}

/** A Bucket's month against its Plan. `ratio` is spent over planned (null with nothing planned). */
export type Variance = {
	bucketId: string;
	month: MonthKey;
	planned: Cents;
	spent: Cents;
	ratio: number | null;
};

/** Planned (the allowance) against spent, per Bucket in each month's Plan. */
export function planVsActual(
	records: PlanRecords,
	spent: readonly { bucketId: string; month: MonthKey; amount: Cents }[],
	months: readonly MonthKey[],
): Variance[] {
	const spentOf = new Map(spent.map((s) => [`${s.bucketId}|${s.month}`, s.amount]));
	return months.flatMap((month) =>
		planForMonth(records, month).buckets.map((bucket) => {
			const amount = spentOf.get(`${bucket.id}|${month}`) ?? 0;
			return {
				bucketId: bucket.id,
				month,
				planned: bucket.allowance,
				spent: amount,
				ratio: bucket.allowance > 0 ? amount / bucket.allowance : null,
			};
		}),
	);
}

/** Within this share of its allowance a month counts as on Plan. */
const ON_PLAN = 0.1;

/**
 * Which Buckets are chronically over or under their Plan: months over (spent beyond the
 * allowance by more than a tenth), months under (by more than a tenth), and the total gap.
 */
export function planHabits(variances: readonly Variance[]) {
	const byBucket = new Map<string, { over: number; under: number; months: number; gap: Cents }>();
	for (const v of variances) {
		if (v.planned <= 0) continue;
		const habit = byBucket.get(v.bucketId) ?? { over: 0, under: 0, months: 0, gap: 0 };
		habit.months += 1;
		habit.gap += v.spent - v.planned;
		if (v.spent > v.planned * (1 + ON_PLAN)) habit.over += 1;
		else if (v.spent < v.planned * (1 - ON_PLAN)) habit.under += 1;
		byBucket.set(v.bucketId, habit);
	}
	return [...byBucket]
		.map(([bucketId, habit]) => ({
			bucketId,
			...habit,
			habit:
				habit.months >= 2 && habit.over / habit.months > 0.5
					? ("over" as const)
					: habit.months >= 2 && habit.under / habit.months > 0.5
						? ("under" as const)
						: ("on-plan" as const),
		}))
		.sort((a, b) => b.gap - a.gap);
}

/**
 * Which of `steps` levels a value falls in, 0 for nothing and `steps` for the largest, on a
 * square-root scale so one huge day doesn't wash out the rest (calendar and heatmap shading).
 */
export function levelOf(value: number, max: number, steps = 4): number {
	if (value <= 0 || max <= 0) return 0;
	return Math.max(1, Math.min(steps, Math.ceil(Math.sqrt(value / max) * steps)));
}

/** Spending For a group of Members (none: the whole Household), summed per period by D1. */
export type ForCell = { period: string; for: string[]; amount: Cents; count: number };

/**
 * What each Member cost per period, and the Household (spending For everyone). Spending For
 * several Members is shared evenly between them, as on This Month (forTotals), so nothing counts
 * twice.
 */
export function spendFor(
	cells: readonly ForCell[],
): { period: string; who: string; amount: Cents }[] {
	const totals = new Map<string, Cents>();
	const add = (period: string, who: string, amount: Cents) => {
		const key = `${period}|${who}`;
		totals.set(key, (totals.get(key) ?? 0) + amount);
	};
	for (const cell of cells) {
		const members = [...new Set(cell.for)];
		if (members.length === 0) add(cell.period, "household", cell.amount);
		const split = shares(cell.amount, Math.max(1, members.length));
		members.forEach((member, i) => {
			add(cell.period, member, split[i] ?? 0);
		});
	}
	return [...totals].map(([key, amount]) => {
		const [period = "", who = ""] = key.split("|");
		return { period, who, amount };
	});
}

/** A Sankey diagram: nodes by index, links between them. */
export type Flow = {
	nodes: { key: string; name: string; kind: "source" | "hub" | "destination" }[];
	links: { source: number; target: number; value: Cents }[];
};

/**
 * Where the period's money came from and went: income sources into the Household, then out to
 * Commitments, Buckets (the largest few, the rest as one), Goals, and whatever was left as saved.
 * Spending beyond income is drawn as coming out of savings, so every link stays positive.
 */
export function cashFlow({
	income,
	spending,
	goals,
	buckets = 6,
}: {
	income: readonly { key: string; name: string; amount: Cents }[];
	spending: readonly { key: string; name: string; amount: Cents }[];
	goals: Cents;
	buckets?: number;
}): Flow {
	const sources = income.filter((s) => s.amount > 0);
	const outs = spending.filter((s) => s.amount > 0);
	const top = topWithOther(outs, buckets).map((entry) =>
		entry.key === "other"
			? { key: "other", name: "Everything else", amount: entry.amount }
			: (entry as { key: string; name: string; amount: Cents }),
	);
	const destinations = [
		...top,
		...(goals > 0 ? [{ key: "goals", name: "Goals", amount: goals }] : []),
	];
	const inTotal = sumOf(sources);
	const outTotal = sumOf(destinations);
	const saved = inTotal - outTotal;
	const allSources = [
		...sources,
		...(saved < 0 ? [{ key: "savings", name: "From savings", amount: -saved }] : []),
	];
	const allOuts = [
		...destinations,
		...(saved > 0 ? [{ key: "saved", name: "Saved", amount: saved }] : []),
	];
	if (allSources.length === 0 && allOuts.length === 0) return { nodes: [], links: [] };
	const nodes: Flow["nodes"] = [
		...allSources.map((s) => ({ key: `in:${s.key}`, name: s.name, kind: "source" as const })),
		{ key: "household", name: "Household", kind: "hub" },
		...allOuts.map((d) => ({ key: `out:${d.key}`, name: d.name, kind: "destination" as const })),
	];
	const hub = allSources.length;
	return {
		nodes,
		links: [
			...allSources.map((s, i) => ({ source: i, target: hub, value: s.amount })),
			...allOuts.map((d, i) => ({ source: hub, target: hub + 1 + i, value: d.amount })),
		],
	};
}

/** A Goal's set-aside money at the end of each month (changes up to and including it). */
export function setAsideHistory(
	goalId: string,
	changes: readonly SetAsideChange[],
	months: readonly MonthKey[],
): { month: MonthKey; saved: Cents }[] {
	const own = changes.filter((c) => c.goalId === goalId);
	return months.map((month) => ({
		month,
		saved: setAsideOf(
			goalId,
			own.filter((c) => c.month <= month),
		),
	}));
}

/**
 * When a Goal will reach its target at the pace of its last `window` months (claims and funding,
 * less spending), as the month it gets there; null when it isn't growing. Reached Goals get
 * `month` itself.
 */
export function projectedCompletion(
	goal: { id: string; target: Cents; fromMonth: MonthKey; kind?: GoalKind; owed?: Cents | null },
	changes: readonly SetAsideChange[],
	month: MonthKey,
	window = 6,
): MonthKey | null {
	if (goal.kind === "payoff") return projectedPayoff(goal, goal.owed ?? null, month);
	const own = changes.filter((c) => c.goalId === goal.id);
	const saved = setAsideOf(goal.id, own);
	if (saved >= goal.target) return month;
	const start = [addMonths(month, 1 - window), goal.fromMonth].sort().at(-1) as MonthKey;
	const months = Math.max(1, monthsBetween(start, month) + 1);
	const recent = setAsideOf(
		goal.id,
		own.filter((c) => c.month >= start && c.month <= month),
	);
	const perMonth = recent / months;
	if (perMonth <= 0) return null;
	return addMonths(month, Math.ceil((goal.target - saved) / perMonth));
}

/**
 * When a payoff Goal's card or loan will be paid off at the pace it has been paid down since the
 * Goal was added (ADR-0019), as a month; null when it isn't coming down (or has no balance yet).
 * Paid off already gets `month` itself.
 */
export function projectedPayoff(
	goal: { target: Cents; fromMonth: MonthKey },
	owed: Cents | null,
	month: MonthKey,
): MonthKey | null {
	if (owed === null) return null;
	if (owed <= 0) return month;
	const paid = paidDownOf(goal.target, owed);
	const months = Math.max(1, monthsBetween(goal.fromMonth, month) + 1);
	const perMonth = paid / months;
	if (perMonth <= 0) return null;
	return addMonths(month, Math.ceil(owed / perMonth));
}

/**
 * What's owed on a card or loan at the end of `month`: the latest balance recorded in or before
 * it (`owed`, oldest first, each with the month it was recorded in); null before the first.
 */
export function owedAtEndOf(
	owed: readonly { month: MonthKey; amount: Cents }[],
	month: MonthKey,
): Cents | null {
	let found: Cents | null = null;
	for (const point of owed) if (point.month <= month) found = point.amount;
	return found;
}

/** A payoff Goal's paid down at the end of each month, from what was owed then (ADR-0019). */
export function paidDownHistory(
	goal: { target: Cents; fromMonth: MonthKey },
	owed: readonly { month: MonthKey; amount: Cents }[],
	months: readonly MonthKey[],
): { month: MonthKey; saved: Cents }[] {
	return months.map((month) => ({
		month,
		saved: month < goal.fromMonth ? 0 : paidDownOf(goal.target, owedAtEndOf(owed, month)),
	}));
}

/** Income per month against its take-home pay: what came in, and the Extra income beyond take-home pay. */
export function incomeByMonth(
	received: readonly { month: MonthKey; amount: Cents }[],
	records: Pick<PlanRecords, "baselines">,
	months: readonly MonthKey[],
) {
	return months.map((month) => {
		const total = sumOf(received.filter((r) => r.month === month));
		const takeHomePay =
			[...records.baselines]
				.filter((b) => b.month <= month)
				.sort((a, b) => a.month.localeCompare(b.month))
				.at(-1)?.amount ?? null;
		return {
			month,
			total,
			baseline: takeHomePay,
			windfall: extraIncomeOf({ baseline: takeHomePay, received: total, decided: 0 }).windfall,
		};
	});
}

/** Cents as a plain dollar figure for a spreadsheet: 1240.5, -3.07. */
export const csvDollars = (cents: Cents): number => Math.round(cents) / 100;

/**
 * Rows as CSV (RFC 4180, CRLF). Text that a spreadsheet would run as a formula (=, +, -, @ first)
 * is prefixed with an apostrophe, since notes come from bank statements.
 */
export function toCsv(rows: readonly (readonly (string | number | null)[])[]): string {
	const cell = (value: string | number | null) => {
		if (value === null) return "";
		if (typeof value === "number") return String(value);
		const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
		return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
	};
	return `${rows.map((row) => row.map(cell).join(",")).join("\r\n")}\r\n`;
}
