import {
	type Db,
	listMembers,
	loadAmountBands,
	loadBucketMonths,
	loadDailySpend,
	loadForCells,
	loadGoals,
	loadIncomeCells,
	loadMerchants,
	loadMovesBetween,
	loadPlanRecords,
	loadReportItems,
	loadSpendCells,
	loadTargetsByMerchant,
	type MerchantTotal,
	type ReportFilters,
	type ReportItem,
	type ReportScope,
	type Viewer,
} from "@noodle/db";
import {
	type AmountBand,
	addDays,
	addMonths,
	annualCost,
	type Cadence,
	type Cents,
	COMPARISONS,
	cashFlow,
	comparisonRange,
	type DayKey,
	type DayRange,
	dayKeyAt,
	defaultGrouping,
	earmarkHistory,
	earmarkOf,
	type Flow,
	freeToSpendOver,
	GROUPINGS,
	type Grouping,
	headlines,
	incomeByMonth,
	type MonthKey,
	mergeCells,
	monthOfDay,
	monthsIn,
	type PlanRecords,
	periodKeys,
	periodRange,
	planForMonth,
	planHabits,
	planVsActual,
	projectedCompletion,
	REPORT_PERIODS,
	recurringSplit,
	regroupMonthly,
	rolledOver,
	type SpendCell,
	seriesOf,
	spendFor,
	sumOf,
	type Target,
	totalsBy,
	type Variance,
} from "@noodle/domain";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getDb } from "./db";
import { householdMiddleware, viewerOf } from "./household";
import { monthKeySchema } from "./month";
import { dayKeySchema, ulidSchema } from "./schemas";

// Reports (ADR-0013): one read, `getReport`, for whichever view and drill-down level a Parent
// has open. D1 does the summing (see @noodle/db reports); this only picks the queries a view
// needs and shapes their sums with @noodle/domain, so a chart, its table and its CSV all draw
// the same numbers. Privacy is the db layer's: nothing here widens what a Parent may see.

export const REPORT_VIEWS = [
	"overview",
	"big",
	"buckets",
	"plan",
	"trends",
	"merchants",
	"people",
	"cash-flow",
	"goals",
	"income",
] as const;
export type ReportView = (typeof REPORT_VIEWS)[number];

/** Where a drill-down has got to: one Bucket, Commitment, Goal, Member, merchant or Account. */
export const areaSchema = z
	.string()
	.max(200)
	.regex(/^(bucket|commitment|goal|member|account):[0-9A-Za-z]+$|^merchant:.*$|^unassigned$/s);

/** Everything a Report is asked for, with defaults applied (the route's search params). */
export const reportRequestSchema = z.object({
	view: z.enum(REPORT_VIEWS),
	period: z.enum(REPORT_PERIODS),
	from: dayKeySchema.optional(),
	to: dayKeySchema.optional(),
	compare: z.enum(COMPARISONS),
	group: z.enum(GROUPINGS).optional(),
	buckets: z.array(ulidSchema).max(40).optional(),
	member: z.union([ulidSchema, z.literal("everyone")]).optional(),
	account: ulidSchema.optional(),
	merchant: z.string().max(200).optional(),
	/** Whole dollars. */
	min: z.number().int().min(0).max(1_000_000).optional(),
	area: areaSchema.optional(),
	month: monthKeySchema.optional(),
});
export type ReportRequest = z.infer<typeof reportRequestSchema>;

/** Names for every key a Report shows, and which Buckets are another Parent's Personal Allowance. */
export type ReportMeta = {
	buckets: { id: string; name: string; color: number; private: boolean; mine: boolean }[];
	commitments: { id: string; name: string }[];
	goals: { id: string; name: string }[];
	accounts: { id: string; name: string }[];
	members: { id: string; name: string; kind: "parent" | "child"; color: number | null }[];
};

type Headlines = ReturnType<typeof headlines>;

export type AreaData = {
	kind: "area";
	total: Cents;
	count: number;
	previous: Cents | null;
	/** Over the whole period, so the drilled-into month shows in context. */
	series: { period: string; amount: Cents }[];
	items: ReportItem[];
	itemsTotal: number;
	merchants: MerchantTotal[];
	targets: { target: Target; amount: Cents }[];
	private: boolean;
};

export type ViewData =
	| AreaData
	| {
			kind: "overview";
			now: Headlines;
			previous: Headlines | null;
			series: { period: string; spent: Cents; earned: Cents }[];
			top: { target: Target; amount: Cents; previous: Cents | null; spark: Cents[] }[];
			private: boolean;
	  }
	| {
			kind: "big";
			spent: Cents;
			items: ReportItem[];
			itemsTotal: number;
			commitments: {
				id: string;
				name: string;
				amount: Cents;
				cadence: Cadence;
				annual: Cents;
				spent: Cents;
			}[];
			recurring: { period: string; recurring: Cents; oneOff: Cents }[];
			bands: AmountBand[];
	  }
	| {
			kind: "buckets";
			spent: Cents;
			totals: { target: Target; amount: Cents; count: number; private: boolean }[];
			previous: Partial<Record<Target, Cents>> | null;
	  }
	| {
			kind: "plan";
			months: MonthKey[];
			variances: Variance[];
			habits: ReturnType<typeof planHabits>;
			rolling: { bucketId: string; carried: { month: MonthKey; amount: Cents }[] }[];
	  }
	| {
			kind: "trends";
			series: { period: string; amount: Cents }[];
			previous: { period: string; amount: Cents }[] | null;
			daily: { day: DayKey; amount: Cents }[];
			multiples: { target: Target; amount: Cents; series: Cents[] }[];
	  }
	| { kind: "merchants"; byAmount: MerchantTotal[]; byCount: MerchantTotal[] }
	| {
			kind: "people";
			cells: { period: string; who: string; amount: Cents }[];
	  }
	| { kind: "cash-flow"; flow: Flow; earned: Cents; spent: Cents; goals: Cents }
	| {
			kind: "goals";
			goals: {
				id: string;
				name: string;
				target: Cents;
				saved: Cents;
				targetDate: DayKey | null;
				completed: boolean;
				history: { month: MonthKey; saved: Cents }[];
				projected: MonthKey | null;
			}[];
	  }
	| {
			kind: "income";
			cells: { period: string; source: string; name: string; amount: Cents }[];
			months: ReturnType<typeof incomeByMonth>;
	  };

export type ReportData = {
	asOf: DayKey;
	/** The period's days; a drilled-into month narrows `view`'s items, not this. */
	range: DayRange;
	compared: DayRange | null;
	grouping: Grouping;
	periods: string[];
	meta: ReportMeta;
	data: ViewData;
};

const lastMonthOf = (range: DayRange) => monthOfDay(addDays(range.until, -1));

/** A month's days within a range. */
const monthWithin = (range: DayRange, month: MonthKey): DayRange => {
	const from = `${month}-01` as DayKey;
	const until = `${addMonths(month, 1)}-01` as DayKey;
	return {
		from: from > range.from ? from : range.from,
		until: until < range.until ? until : range.until,
	};
};

/** The request's filters, narrowed to the drilled-into area. */
function filtersOf(request: ReportRequest): ReportFilters {
	const filters: ReportFilters = {
		targets: request.buckets?.length ? request.buckets.map((id) => `bucket:${id}`) : undefined,
		member: request.member,
		account: request.account,
		merchant: request.merchant,
		min: request.min ? request.min * 100 : undefined,
	};
	const area = request.area;
	if (!area) return filters;
	const kind = area.slice(0, area.indexOf(":"));
	const id = area.slice(area.indexOf(":") + 1);
	if (area === "unassigned" || ["bucket", "commitment", "goal"].includes(kind)) {
		return { ...filters, targets: [area] };
	}
	if (kind === "member") return { ...filters, member: id };
	if (kind === "account") return { ...filters, account: id };
	return { ...filters, merchant: id };
}

/** Spending cells with any private monthly totals folded in. */
async function spendCells(db: Db, scope: ReportScope, grouping: Grouping | "all") {
	const { cells, privateMonths } = await loadSpendCells(db, scope, grouping);
	const privates =
		grouping === "all"
			? privateMonths.map((cell) => ({ ...cell, period: "all" }))
			: regroupMonthly(privateMonths, grouping);
	return mergeCells(cells, privates);
}

async function earnedIn(db: Db, householdId: string, range: DayRange, account?: string) {
	return sumOf(await loadIncomeCells(db, householdId, range, "all", account));
}

export const getReport = createServerFn({ method: "GET" })
	.middleware([householdMiddleware])
	.validator(reportRequestSchema)
	.handler(async ({ data: request, context }): Promise<ReportData> => {
		const db = getDb();
		const viewer = viewerOf(context);
		const householdId = context.household.id;
		const asOf = dayKeyAt(new Date(), context.household.timeZone);
		const custom = request.from && request.to ? { from: request.from, to: request.to } : undefined;
		const range = periodRange(request.period, asOf, custom);
		const grouping = request.group ?? defaultGrouping(range);
		const compared = comparisonRange(range, request.compare);
		const periods = periodKeys(range, grouping);
		const filters = filtersOf(request);
		const scope: ReportScope = { viewer, range, filters };

		const [records, goalRecords, members] = await Promise.all([
			loadPlanRecords(db, householdId, monthOfDay(asOf)),
			loadGoals(db, viewer),
			listMembers(db, householdId),
		]);
		const meta: ReportMeta = {
			buckets: records.buckets.map((b) => ({
				id: b.id,
				name: b.name,
				color: b.color,
				private: Boolean(b.owner) && b.owner !== viewer.memberId,
				mine: b.owner === viewer.memberId,
			})),
			commitments: records.commitments.map((c) => ({ id: c.id, name: c.name })),
			goals: goalRecords.goals.map((g) => ({ id: g.id, name: g.name })),
			accounts: goalRecords.accounts.map((a) => ({ id: a.id, name: a.name })),
			members: members.map((m) => ({ id: m.id, name: m.name, kind: m.kind, color: m.color })),
		};
		const context_ = { db, viewer, request, range, compared, grouping, periods, scope, records };
		// A drill-down (an area, a month, or both) lists what's behind the number, whatever the view.
		const data =
			request.area || request.month
				? await areaData(context_)
				: await viewData(context_, goalRecords.changes, goalRecords.goals);
		return { asOf, range, compared, grouping, periods, meta, data };
	});

type Context = {
	db: Db;
	viewer: Viewer;
	request: ReportRequest;
	range: DayRange;
	compared: DayRange | null;
	grouping: Grouping;
	periods: string[];
	scope: ReportScope;
	records: PlanRecords;
};

async function areaData({
	db,
	request,
	range,
	compared,
	grouping,
	periods,
	scope,
}: Context): Promise<AreaData> {
	const itemScope = request.month ? { ...scope, range: monthWithin(range, request.month) } : scope;
	const merchantArea = request.area?.startsWith("merchant:");
	const [cells, inMonth, previous, items, merchants, targets] = await Promise.all([
		spendCells(db, scope, grouping),
		request.month ? spendCells(db, itemScope, "all") : null,
		compared && !request.month ? spendCells(db, { ...scope, range: compared }, "all") : null,
		// A whole period only previews its latest; picking a month lists that month in full.
		loadReportItems(db, itemScope, "date", request.month ? 100 : 25),
		merchantArea ? null : loadMerchants(db, itemScope, 8),
		merchantArea ? loadTargetsByMerchant(db, itemScope) : null,
	]);
	const counted = inMonth ?? cells;
	return {
		kind: "area",
		total: sumOf(counted),
		count: counted.reduce((n, cell) => n + cell.count, 0),
		previous: previous ? sumOf(previous) : null,
		series: seriesOf(cells, periods),
		items: items.items,
		itemsTotal: items.total,
		merchants: merchants?.byAmount ?? [],
		targets: targets
			? totalsBy(targets, (t: { target: Target }) => t.target).map((t) => ({
					target: t.key,
					amount: t.amount,
				}))
			: [],
		private: counted.some((cell) => cell.private),
	};
}

async function viewData(
	{ db, viewer, request, range, compared, grouping, periods, scope, records }: Context,
	goalChanges: {
		goalId: string;
		kind: "claim" | "funding" | "spending";
		amount: Cents;
		month: MonthKey;
	}[],
	goals: {
		id: string;
		name: string;
		target: Cents;
		targetDate: DayKey | null;
		fromMonth: MonthKey;
		completed: boolean;
		archived: boolean;
	}[],
): Promise<ViewData> {
	const householdId = viewer.householdId;
	const months = monthsIn(range);
	switch (request.view) {
		case "overview": {
			const [cells, previousCells, income, earnedBefore] = await Promise.all([
				spendCells(db, scope, grouping),
				compared ? spendCells(db, { ...scope, range: compared }, "all") : null,
				loadIncomeCells(db, householdId, range, grouping, request.account),
				compared ? earnedIn(db, householdId, compared, request.account) : null,
			]);
			const spent = seriesOf(cells, periods);
			const earned = seriesOf(income, periods);
			const previousByTarget = previousCells
				? new Map(totalsBy(previousCells, (c: SpendCell) => c.target).map((t) => [t.key, t.amount]))
				: null;
			return {
				kind: "overview",
				now: headlines({
					spent: sumOf(cells),
					earned: sumOf(income),
					freeToSpend: freeToSpendOver(records, months),
				}),
				previous:
					previousCells && compared && earnedBefore !== null
						? headlines({
								spent: sumOf(previousCells),
								earned: earnedBefore,
								freeToSpend: freeToSpendOver(records, monthsIn(compared)),
							})
						: null,
				series: periods.map((period, i) => ({
					period,
					spent: spent[i]?.amount ?? 0,
					earned: earned[i]?.amount ?? 0,
				})),
				top: totalsBy(cells, (c: SpendCell) => c.target)
					.filter((t) => t.amount > 0)
					.slice(0, 6)
					.map(({ key, amount }) => ({
						target: key,
						amount,
						previous: previousByTarget ? (previousByTarget.get(key) ?? 0) : null,
						spark: seriesOf(
							cells.filter((c) => c.target === key),
							periods,
						).map((p) => p.amount),
					})),
				private: cells.some((cell) => cell.private),
			};
		}
		case "big": {
			// Big expenses are the one-offs: Commitments are expected, and have their own card.
			const oneOff = { ...scope, filters: { ...scope.filters, oneOff: true } };
			const [cells, items, bands] = await Promise.all([
				spendCells(db, scope, grouping),
				loadReportItems(db, oneOff, "amount", 25),
				loadAmountBands(db, oneOff),
			]);
			const plan = planForMonth(records, lastMonthOf(range));
			const spentOn = new Map(
				totalsBy(cells, (c: SpendCell) => c.target).map((t) => [t.key, t.amount]),
			);
			return {
				kind: "big",
				spent: sumOf(cells),
				items: items.items,
				itemsTotal: items.total,
				commitments: plan.commitments
					.map((c) => ({
						id: c.id,
						name: c.name,
						amount: c.amount,
						cadence: c.cadence,
						annual: annualCost(c),
						spent: spentOn.get(`commitment:${c.id}`) ?? 0,
					}))
					.sort((a, b) => b.annual - a.annual),
				recurring: recurringSplit(cells, periods),
				bands,
			};
		}
		case "buckets": {
			const [cells, previousCells] = await Promise.all([
				spendCells(db, scope, "all"),
				compared ? spendCells(db, { ...scope, range: compared }, "all") : null,
			]);
			return {
				kind: "buckets",
				spent: sumOf(cells),
				totals: cells
					.filter((c) => c.amount > 0)
					.sort((a, b) => b.amount - a.amount)
					.map((c) => ({
						target: c.target,
						amount: c.amount,
						count: c.count,
						private: Boolean(c.private),
					})),
				previous: previousCells
					? Object.fromEntries(previousCells.map((c) => [c.target, c.amount]))
					: null,
			};
		}
		case "plan": {
			const first = months[0] as MonthKey;
			const last = months.at(-1) as MonthKey;
			// Rollover reaches back to whenever a Bucket last started Rolling.
			const since = records.buckets.map((b) => b.fromMonth).sort()[0] ?? first;
			const [spent, moves] = await Promise.all([
				loadBucketMonths(db, viewer, since < first ? since : first, addMonths(last, 1)),
				loadMovesBetween(db, householdId, since < first ? since : first, addMonths(last, 1)),
			]);
			const variances = planVsActual(records, spent, months);
			const rollingIds = [
				...new Set(records.rolling.filter((r) => r.rolling).map((r) => r.bucketId)),
			];
			return {
				kind: "plan",
				months,
				variances,
				habits: planHabits(variances),
				rolling: rollingIds.map((bucketId) => ({
					bucketId,
					carried: months.map((month) => ({
						month,
						amount:
							rolledOver({ records, spent, moves, month: addMonths(month, 1) })[bucketId] ?? 0,
					})),
				})),
			};
		}
		case "trends": {
			const [cells, previousCells, daily] = await Promise.all([
				spendCells(db, scope, grouping),
				compared ? spendCells(db, { ...scope, range: compared }, grouping) : null,
				loadDailySpend(db, scope),
			]);
			return {
				kind: "trends",
				series: seriesOf(cells, periods),
				previous:
					previousCells && compared
						? seriesOf(previousCells, periodKeys(compared, grouping))
						: null,
				daily,
				multiples: totalsBy(cells, (c: SpendCell) => c.target)
					.filter((t) => t.amount > 0)
					.slice(0, 8)
					.map(({ key, amount }) => ({
						target: key,
						amount,
						series: seriesOf(
							cells.filter((c) => c.target === key),
							periods,
						).map((p) => p.amount),
					})),
			};
		}
		case "merchants":
			return { kind: "merchants", ...(await loadMerchants(db, scope, 25)) };
		case "people":
			return { kind: "people", cells: spendFor(await loadForCells(db, scope, grouping)) };
		case "cash-flow": {
			const [income, cells] = await Promise.all([
				loadIncomeCells(db, householdId, range, "all", request.account),
				spendCells(db, scope, "all"),
			]);
			const funded = sumOf(
				goalChanges.filter((c) => c.kind === "funding" && months.includes(c.month)),
			);
			const bySource = totalsBy(income, (c: { source: string }) => c.source).map((s) => ({
				key: s.key || "income",
				name: income.find((c) => c.source === s.key)?.name || "Income",
				amount: s.amount,
			}));
			return {
				kind: "cash-flow",
				flow: cashFlow({
					income: bySource,
					spending: totalsBy(cells, (c: SpendCell) => c.target).map((t) => ({
						key: t.key,
						name: t.key,
						amount: t.amount,
					})),
					goals: funded,
				}),
				earned: sumOf(income),
				spent: sumOf(cells),
				goals: funded,
			};
		}
		case "goals": {
			const last = months.at(-1) as MonthKey;
			return {
				kind: "goals",
				goals: goals
					.filter((g) => !g.archived && g.fromMonth <= last)
					.map((g) => ({
						id: g.id,
						name: g.name,
						target: g.target,
						saved: earmarkOf(
							g.id,
							goalChanges.filter((c) => c.month <= last),
						),
						targetDate: g.targetDate,
						completed: g.completed,
						history: earmarkHistory(g.id, goalChanges, months),
						projected: projectedCompletion(
							g,
							goalChanges.filter((c) => c.month <= last),
							last,
						),
					})),
			};
		}
		case "income": {
			const [cells, byMonth] = await Promise.all([
				loadIncomeCells(db, householdId, range, grouping, request.account),
				loadIncomeCells(db, householdId, range, "month", request.account),
			]);
			return {
				kind: "income",
				cells,
				months: incomeByMonth(
					byMonth.map((c) => ({ month: c.period as MonthKey, amount: c.amount })),
					records,
					months,
				),
			};
		}
	}
}
