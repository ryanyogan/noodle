import {
	type Cents,
	COMPARISONS,
	csvDollars,
	GROUPINGS,
	type MonthKey,
	REPORT_PERIODS,
	type ReportPeriod,
	toCsv,
} from "@noodle/domain";
import { z } from "zod";
import { formatMoney, fullDay, monthName, shortDay } from "./format";
import { monthKeySchema } from "./server/month";
import {
	areaSchema,
	REPORT_VIEWS,
	type ReportData,
	type ReportMeta,
	type ReportRequest,
	type ReportView,
} from "./server/reports";
import { dayKeySchema, ulidSchema } from "./server/schemas";

// Reports on the client: the route's search params (every option round-trips through the URL, so
// a Report can be bookmarked and shared), the names a Report shows for its keys, and the tables
// that each chart has as its text alternative and that Export writes as CSV.

export { REPORT_VIEWS, type ReportView };

export const CHART_KINDS = ["donut", "bar", "treemap"] as const;
export type ChartKind = (typeof CHART_KINDS)[number];

/** Every option is optional and falls back to its default, so a bad or stale link still opens. */
export const reportSearchSchema = z.object({
	view: z.enum(REPORT_VIEWS).optional().catch(undefined),
	period: z.enum(REPORT_PERIODS).optional().catch(undefined),
	from: dayKeySchema.optional().catch(undefined),
	to: dayKeySchema.optional().catch(undefined),
	compare: z.enum(COMPARISONS).optional().catch(undefined),
	group: z.enum(GROUPINGS).optional().catch(undefined),
	buckets: z.array(ulidSchema).max(40).optional().catch(undefined),
	member: z
		.union([ulidSchema, z.literal("everyone")])
		.optional()
		.catch(undefined),
	account: ulidSchema.optional().catch(undefined),
	merchant: z.string().max(200).optional().catch(undefined),
	min: z.number().int().min(0).max(1_000_000).optional().catch(undefined),
	chart: z.enum(CHART_KINDS).optional().catch(undefined),
	/** Big expenses' threshold, in whole dollars. */
	over: z.number().int().min(0).optional().catch(undefined),
	area: areaSchema.optional().catch(undefined),
	month: monthKeySchema.optional().catch(undefined),
});
export type ReportSearch = z.infer<typeof reportSearchSchema>;

export const DEFAULT_PERIOD: ReportPeriod = "6m";

/** What the server is asked for: the search params with defaults, less display-only options. */
export function requestOf(search: ReportSearch): ReportRequest {
	const period = search.period ?? DEFAULT_PERIOD;
	const custom = period === "custom" && search.from && search.to;
	return {
		view: search.view ?? "overview",
		period: period === "custom" && !custom ? DEFAULT_PERIOD : period,
		from: custom ? search.from : undefined,
		to: custom ? search.to : undefined,
		compare: search.compare ?? "previous",
		group: search.group,
		buckets: search.buckets?.length ? [...search.buckets].sort() : undefined,
		member: search.member,
		account: search.account,
		merchant: search.merchant || undefined,
		min: search.min || undefined,
		area: search.area,
		month: search.month,
	};
}

export const VIEW_LABELS: Record<ReportView, string> = {
	overview: "Overview",
	big: "Big expenses",
	buckets: "Buckets",
	plan: "Plan vs actual",
	trends: "Trends",
	merchants: "Merchants",
	people: "People",
	"cash-flow": "Cash flow",
	goals: "Goals",
	income: "Income",
};

export const PERIOD_LABELS: Record<ReportPeriod, string> = {
	"this-month": "This month",
	"last-month": "Last month",
	"3m": "Last 3 months",
	"6m": "Last 6 months",
	"12m": "Last 12 months",
	ytd: "Year to date",
	"last-year": "Last year",
	custom: "Custom range",
};

/** What a Report's keys are called: Targets, drill-down areas, Members, merchants. */
export function namesOf(meta: ReportMeta) {
	const buckets = new Map(meta.buckets.map((b) => [b.id, b]));
	const commitments = new Map(meta.commitments.map((c) => [c.id, c.name]));
	const goals = new Map(meta.goals.map((g) => [g.id, g.name]));
	const accounts = new Map([...meta.accounts, ...meta.archivedAccounts].map((a) => [a.id, a.name]));
	const members = new Map(meta.members.map((m) => [m.id, m.name]));
	const split = (key: string) => [key.slice(0, key.indexOf(":")), key.slice(key.indexOf(":") + 1)];
	const label = (key: string): string => {
		if (key === "unassigned") return "No Bucket";
		if (key === "household" || key === "member:everyone") return "Whole Household";
		const [kind, id = ""] = split(key);
		if (kind === "bucket") return buckets.get(id)?.name ?? "Bucket";
		if (kind === "commitment") return commitments.get(id)?.toString() ?? "Commitment";
		if (kind === "goal") return goals.get(id) ?? "Goal";
		if (kind === "account") return accounts.get(id) ?? "Account";
		if (kind === "member") return members.get(id) ?? "Member";
		if (kind === "merchant") return merchantName(id);
		return members.get(key) ?? key;
	};
	return {
		label,
		/** A Bucket's identity colour (1–8), or null for anything else. */
		color: (key: string) => {
			const [kind, id = ""] = split(key);
			return kind === "bucket" ? (buckets.get(id)?.color ?? null) : null;
		},
		/** The other Parent's Personal Allowance: totals only, nothing to drill into. */
		isPrivate: (key: string) => {
			const [kind, id = ""] = split(key);
			return kind === "bucket" && Boolean(buckets.get(id)?.private);
		},
		bucket: (key: string) => buckets.get(split(key)[1] ?? ""),
		kindOf: (key: string) => (key === "unassigned" ? "unassigned" : (split(key)[0] ?? "")),
	};
}
export type Names = ReturnType<typeof namesOf>;

/** The one-offs of at least the picked amount: what Big expenses' list and its table both show (issue 73). */
export const oneOffsOver = <T extends { amount: number }>(items: T[], threshold: number): T[] =>
	items.filter((item) => item.amount >= threshold);

/** A merchant key shown as a name: notes are free text, so the key is the note itself. */
export const merchantName = (key: string) =>
	key ? key.replace(/(^|\s)\S/g, (c) => c.toUpperCase()) : "No note";

/** How a period key reads on an axis ("Sep", "Sep 7", "Q3 2026"). */
export function periodLabel(period: string, style: "short" | "long" = "short"): string {
	if (/^\d{4}-Q[1-4]$/.test(period)) return `${period.slice(5)} ${period.slice(0, 4)}`;
	if (/^\d{4}-\d{2}$/.test(period)) {
		const name = monthName(period);
		return style === "long" ? `${name} ${period.slice(0, 4)}` : name.slice(0, 3);
	}
	if (/^\d{4}-\d{2}-\d{2}$/.test(period)) {
		return style === "long" ? `Week of ${fullDay(period)}` : shortDay(period);
	}
	return period;
}

export const monthLabel = (month: MonthKey) => `${monthName(month)} ${month.slice(0, 4)}`;

/** "$1.2k", "$12k", "$1.4M": axis ticks, where whole cents would crowd. */
export function formatCompact(cents: Cents): string {
	const dollars = Math.abs(cents) / 100;
	const sign = cents < 0 ? "−" : "";
	if (dollars >= 1_000_000)
		return `${sign}$${(dollars / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
	if (dollars >= 10_000) return `${sign}$${Math.round(dollars / 1000)}k`;
	if (dollars >= 1000) return `${sign}$${(dollars / 1000).toFixed(1).replace(/\.0$/, "")}k`;
	return `${sign}$${Math.round(dollars)}`;
}

export const formatPercent = (ratio: number) =>
	`${Math.abs(ratio) >= 0.1 ? Math.round(ratio * 100) : (ratio * 100).toFixed(1)}%`;

/**
 * A chart's text alternative, and the rows its CSV export writes. Money stays in cents here;
 * the table formats it and CSV writes dollars, so both come from the same numbers.
 */
export type ReportTable = {
	title: string;
	columns: { label: string; kind: "text" | "money" | "count" | "percent" }[];
	rows: (string | number | null)[][];
};

export function formatCell(
	kind: ReportTable["columns"][number]["kind"],
	value: string | number | null,
) {
	if (value === null) return "—";
	if (typeof value === "string") return value;
	if (kind === "money") return formatMoney(value);
	if (kind === "percent") return formatPercent(value);
	return value.toLocaleString("en-US");
}

/**
 * How column `i` of a table writes its cells: one format down the whole column (issue 73). If any
 * amount in it has cents, every amount shows them ("$5,971.00" over "$6,341.56"), and if any share
 * is under 10%, every share has one decimal ("38.0%" over "4.5%"), so the figures line up on
 * their decimal point. A day key is written as a date.
 */
export function columnFormatter(table: ReportTable, i: number) {
	const kind = table.columns[i]?.kind ?? "text";
	const numbers = table.rows.map((row) => row[i]).filter((v) => typeof v === "number");
	const cents = kind === "money" && numbers.some((v) => v % 100 !== 0);
	// A share of nothing is "0%" either way: it doesn't ask for the decimal on its own.
	const tenths = numbers.some((v) => v !== 0 && Math.abs(v) < 0.1);
	return (value: string | number | null) => {
		if (value === null) return "—";
		if (typeof value === "string") {
			// A day reads as on the rest of the page ("Oct 5, 2026"); the CSV keeps the day key.
			return /^\d{4}-\d{2}-\d{2}$/.test(value)
				? new Date(`${value}T00:00:00Z`).toLocaleDateString("en-US", {
						month: "short",
						day: "numeric",
						year: "numeric",
						timeZone: "UTC",
					})
				: value;
		}
		if (kind === "money")
			return cents && value % 100 === 0 ? `${formatMoney(value)}.00` : formatMoney(value);
		if (kind === "percent")
			return `${tenths ? (value * 100).toFixed(1) : Math.round(value * 100)}%`;
		return formatCell(kind, value);
	};
}

/** Every table of a view as one CSV: each under its title, a blank line between. */
export function tablesCsv(tables: readonly ReportTable[]): string {
	const rows = tables.flatMap((table, i) => [
		...(i > 0 ? [[]] : []),
		[table.title],
		table.columns.map((c) => c.label),
		...table.rows.map((row) =>
			row.map((value, j) =>
				table.columns[j]?.kind === "money" && typeof value === "number"
					? csvDollars(value)
					: table.columns[j]?.kind === "percent" && typeof value === "number"
						? Math.round(value * 1000) / 10
						: value,
			),
		),
	]);
	return toCsv(rows);
}

/** A file name for a Report's CSV: "noodle-overview-2026-04-01-to-2026-09-28.csv". */
export function csvName(report: ReportData, view: ReportView) {
	const last = new Date(`${report.range.until}T00:00:00Z`);
	last.setUTCDate(last.getUTCDate() - 1);
	return `noodle-${view}-${report.range.from}-to-${last.toISOString().slice(0, 10)}.csv`;
}

/** Saves text as a file, in the browser. */
export function download(name: string, text: string) {
	const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
	const link = document.createElement("a");
	link.href = url;
	link.download = name;
	link.click();
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}
