import {
	type Cents,
	changeOf,
	type MonthKey,
	overThreshold,
	THRESHOLD_STOPS,
	topWithOther,
} from "@noodle/domain";
import { Badge } from "@noodle/ui/components/badge";
import { Button } from "@noodle/ui/components/button";
import { Card } from "@noodle/ui/components/card";
import { EmptyState } from "@noodle/ui/components/empty-state";
import { RowButton } from "@noodle/ui/components/row-button";
import { Stat, StatGrid } from "@noodle/ui/components/stat";
import { Tile } from "@noodle/ui/components/tile";
import { ToggleGroup, ToggleGroupItem } from "@noodle/ui/components/toggle-group";
import { WithTooltip } from "@noodle/ui/components/tooltip";
import { cn } from "@noodle/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import {
	ArrowDownRight,
	ArrowRight,
	ArrowUpRight,
	ChartPie,
	ChevronRight,
	LayoutGrid,
	Lock,
	ReceiptText,
	Rows3,
} from "lucide-react";
import { type ReactNode, useId, useMemo, useState } from "react";
import { asBucketColor, bucketColors, monogram } from "../buckets";
import { formatMoney, formatWholeMoney, fullDay, shortDay } from "../format";
import {
	type ChartKind,
	formatPercent,
	merchantName,
	monthLabel,
	type Names,
	periodLabel,
	type ReportSearch,
	type ReportTable,
} from "../reports";
import type { AreaData, ReportData, ViewData } from "../server/reports";
import { ChildCosts } from "./child-costs";
import { GoalProgressBar } from "./goals";
import {
	CalendarHeatmap,
	ChartCard,
	FlowSankey,
	IncomeSpendChart,
	PeriodBars,
	RankedBars,
	type Share,
	ShareDonut,
	ShareTreemap,
	Sparkline,
	TrendLines,
	VarianceHeatmap,
} from "./report-charts";

// Each Report view: what it draws, and the tables behind it (its charts' text alternatives and
// its CSV export, from `tablesFor`, so all three show the same numbers). Every mark drills one
// level down through `nav`: into an area (a Bucket, merchant, Member…), then a month, then the
// Transactions themselves.

export type ReportNav = {
	/** Drill into an area (or, with a month, straight to that month of it). */
	area: (area: string, month?: MonthKey) => void;
	month: (month: MonthKey) => void;
	set: (patch: Partial<ReportSearch>) => void;
};

type ViewProps<K extends ViewData["kind"]> = {
	report: ReportData;
	data: Extract<ViewData, { kind: K }>;
	names: Names;
	search: ReportSearch;
	nav: ReportNav;
	tables: Record<string, ReportTable>;
};

/** A Target's colour: its Bucket's identity, or a neutral ink tone for anything else. */
export const shareColor = (names: Names, key: string) => {
	const color = names.color(key);
	if (color) return `var(--bucket-${color})`;
	const kind = names.kindOf(key);
	return kind === "commitment"
		? "var(--chart-spend)"
		: kind === "goal"
			? "var(--chart-seq-3)"
			: "var(--subtle-foreground)";
};

const monthOfPeriod = (period: string) => period.slice(0, 7) as MonthKey;

/** The Tile for a key: a Bucket's monogram in its colour, a lock for another Parent's Personal Allowance. */
function KeyTile({
	names,
	target,
	className,
}: {
	names: Names;
	target: string;
	className?: string;
}) {
	const color = names.color(target);
	if (names.isPrivate(target)) {
		return (
			<Tile bucket={color ? asBucketColor(color) : undefined} className={className}>
				<Lock />
			</Tile>
		);
	}
	return (
		<Tile bucket={color ? asBucketColor(color) : undefined} className={className}>
			{names.kindOf(target) === "commitment" ? <ReceiptText /> : monogram(names.label(target))}
		</Tile>
	);
}

/** "▲ 12%" against the comparison period, in words for screen readers. */
export function Delta({
	now,
	before,
	invert = false,
	className,
}: {
	now: Cents;
	before: Cents | null | undefined;
	/** A rise is good news (earned, saved), so it reads in the brand tone. */
	invert?: boolean;
	className?: string;
}) {
	const change = changeOf(now, before);
	if (!change || change.delta === 0) {
		return change ? (
			<span className={cn("text-xs text-subtle-foreground", className)}>No change</span>
		) : null;
	}
	// Nothing to compare against (the period before had none): a percentage would be meaningless,
	// and the whole amount repeated as a change only restates the figure.
	if (change.ratio === null) return null;
	const up = change.delta > 0;
	const good = invert ? up : !up;
	const Arrow = up ? ArrowUpRight : ArrowDownRight;
	const amount = formatPercent(Math.abs(change.ratio));
	return (
		<span
			className={cn(
				"inline-flex items-center gap-0.5 text-xs font-medium tabular-nums",
				good ? "text-brand" : "text-over",
				className,
			)}
		>
			<Arrow aria-hidden="true" className="size-3.5" />
			{amount} {up ? "more" : "less"}
			<span className="sr-only"> than the period before</span>
		</span>
	);
}

/** A headline figure of a Report: the shared Stat, with what changed since the period before under it. */
function ReportStat({
	label,
	value,
	delta,
	hint,
	index = 0,
}: {
	label: string;
	value: ReactNode;
	delta?: ReactNode;
	hint?: ReactNode;
	index?: number;
}) {
	return (
		<Stat
			className="animate-enter"
			style={{ animationDelay: `${index * 40}ms` }}
			label={label}
			value={value}
			note={
				delta || hint ? (
					<span className="flex flex-wrap items-center gap-x-1.5">
						{delta}
						{hint}
					</span>
				) : undefined
			}
		/>
	);
}

/** A row that drills (or, for another Parent's Personal Allowance, just shows its total). */
function DrillRow({
	onClick,
	disabled,
	label,
	children,
}: {
	onClick: () => void;
	disabled?: boolean;
	label: string;
	children: ReactNode;
}) {
	return (
		<RowButton
			onClick={onClick}
			disabled={disabled}
			aria-label={label}
			className="group -mx-2 w-[calc(100%+1rem)] px-2"
		>
			{children}
			{disabled ? (
				<span className="size-4 shrink-0" />
			) : (
				<ChevronRight
					aria-hidden="true"
					className="size-4 shrink-0 text-subtle-foreground transition-transform duration-(--duration-fast) group-hover:translate-x-0.5"
				/>
			)}
		</RowButton>
	);
}

// ── Tables ────────────────────────────────────────────────────────────────────────────────────

const money = (label: string) => ({ label, kind: "money" as const });
const text = (label: string) => ({ label, kind: "text" as const });
const count = (label: string) => ({ label, kind: "count" as const });
const percent = (label: string) => ({ label, kind: "percent" as const });

const itemRows = (items: AreaData["items"], names: Names) =>
	items.map((item) => [item.date, item.note ?? "", names.label(item.target), item.amount]);

/** Every table a view shows, by name. Export writes them all. */
export function tablesFor(report: ReportData, names: Names): Record<string, ReportTable> {
	const { data } = report;
	const period = (p: string) => periodLabel(p, "long");
	switch (data.kind) {
		case "area":
			return {
				series: {
					title: "Spending by period",
					columns: [text("Period"), money("Spent")],
					rows: data.series.map((s) => [period(s.period), s.amount]),
				},
				items: {
					title: "Transactions",
					columns: [text("Date"), text("Note"), text("Where"), money("Amount")],
					rows: itemRows(data.items, names),
				},
				...(data.merchants.length
					? {
							merchants: {
								title: "Merchants",
								columns: [text("Merchant"), count("Times"), money("Spent")],
								rows: data.merchants.map((m) => [m.name || merchantName(m.key), m.count, m.amount]),
							},
						}
					: {}),
				...(data.targets.length
					? {
							targets: {
								title: "Where it went",
								columns: [text("Where"), money("Spent")],
								rows: data.targets.map((t) => [names.label(t.target), t.amount]),
							},
						}
					: {}),
			};
		case "overview":
			return {
				headlines: {
					title: "Headlines",
					columns: [text("Figure"), money("This period"), money("Comparison")],
					rows: [
						["Spent", data.now.spent, data.previous?.spent ?? null],
						["Earned", data.now.earned, data.previous?.earned ?? null],
						["Saved", data.now.saved, data.previous?.saved ?? null],
						["Free to Spend", data.now.freeToSpend, data.previous?.freeToSpend ?? null],
					],
				},
				series: {
					title: "Income and spending",
					columns: [text("Period"), money("Earned"), money("Spent"), money("Left over")],
					rows: data.series.map((s) => [period(s.period), s.earned, s.spent, s.earned - s.spent]),
				},
				top: {
					title: "Top spending",
					columns: [text("Where"), money("Spent"), money("Comparison")],
					rows: data.top.map((t) => [names.label(t.target), t.amount, t.previous]),
				},
			};
		case "big":
			return {
				items: {
					title: "Largest Transactions",
					columns: [text("Date"), text("Note"), text("Where"), money("Amount")],
					rows: itemRows(data.items, names),
				},
				commitments: {
					title: "Commitments by yearly cost",
					columns: [
						text("Commitment"),
						text("Cadence"),
						money("Each"),
						money("A year"),
						money("This period"),
					],
					rows: data.commitments.map((c) => [c.name, c.cadence, c.amount, c.annual, c.spent]),
				},
				recurring: {
					title: "Recurring and one-off",
					columns: [text("Period"), money("Recurring"), money("One-off")],
					rows: data.recurring.map((r) => [period(r.period), r.recurring, r.oneOff]),
				},
				bands: {
					title: "Spending by size",
					columns: [money("From"), count("Transactions"), money("Spent")],
					rows: data.bands.map((b) => [b.floor, b.count, b.amount]),
				},
			};
		case "buckets":
			return {
				shares: {
					title: "Share of spending",
					columns: [text("Where"), money("Spent"), percent("Share"), money("Comparison")],
					rows: data.totals.map((t) => [
						`${names.label(t.target)}${t.private ? " (private)" : ""}`,
						t.amount,
						data.spent > 0 ? t.amount / data.spent : 0,
						data.previous ? (data.previous[t.target] ?? 0) : null,
					]),
				},
			};
		case "plan":
			return {
				variance: {
					title: "Plan vs actual",
					columns: [
						text("Bucket"),
						text("Month"),
						money("Planned"),
						money("Spent"),
						percent("Of Plan"),
					],
					rows: data.variances.map((v) => [
						names.label(`bucket:${v.bucketId}`),
						monthLabel(v.month),
						v.planned,
						v.spent,
						v.ratio,
					]),
				},
				habits: {
					title: "Usually over or under",
					columns: [
						text("Bucket"),
						text("Habit"),
						count("Months over"),
						count("Months under"),
						money("Net gap"),
					],
					rows: data.habits.map((h) => [
						names.label(`bucket:${h.bucketId}`),
						h.habit,
						h.over,
						h.under,
						h.gap,
					]),
				},
				...(data.rolling.length
					? {
							rolling: {
								title: "Carried over",
								columns: [text("Bucket"), text("Month"), money("Carried into next month")],
								rows: data.rolling.flatMap((r) =>
									r.carried.map((c) => [
										names.label(`bucket:${r.bucketId}`),
										monthLabel(c.month),
										c.amount,
									]),
								),
							},
						}
					: {}),
			};
		case "trends":
			return {
				series: {
					title: "Spending over time",
					columns: [text("Period"), money("Spent"), text("Comparison period"), money("Comparison")],
					rows: data.series.map((s, i) => [
						period(s.period),
						s.amount,
						data.previous?.[i] ? period(data.previous[i].period) : null,
						data.previous?.[i]?.amount ?? null,
					]),
				},
				daily: {
					title: "Daily spending",
					columns: [text("Day"), money("Spent")],
					rows: data.daily.map((d) => [d.day, d.amount]),
				},
				multiples: {
					title: "By Bucket",
					columns: [text("Where"), ...report.periods.map((p) => money(periodLabel(p, "long")))],
					rows: data.multiples.map((m) => [names.label(m.target), ...m.series]),
				},
			};
		case "merchants":
			return {
				byAmount: {
					title: "Top merchants by spending",
					columns: [text("Merchant"), count("Times"), money("Spent")],
					rows: data.byAmount.map((m) => [m.name || merchantName(m.key), m.count, m.amount]),
				},
				byCount: {
					title: "Top merchants by visits",
					columns: [text("Merchant"), count("Times"), money("Spent")],
					rows: data.byCount.map((m) => [m.name || merchantName(m.key), m.count, m.amount]),
				},
			};
		case "people": {
			const who = [...new Set(data.cells.map((c) => c.who))];
			return {
				people: {
					title: "Spending for each person",
					columns: [text("Period"), ...who.map((w) => money(names.label(w)))],
					rows: report.periods.map((p) => [
						period(p),
						...who.map((w) => data.cells.find((c) => c.period === p && c.who === w)?.amount ?? 0),
					]),
				},
			};
		}
		case "cash-flow":
			return {
				flow: {
					title: "Cash flow",
					columns: [text("From"), text("To"), money("Amount")],
					rows: data.flow.links.map((l) => [
						flowName(names, data.flow.nodes[l.source]),
						flowName(names, data.flow.nodes[l.target]),
						l.value,
					]),
				},
			};
		case "goals":
			return {
				goals: {
					title: "Goals",
					columns: [text("Goal"), money("Saved or paid down"), money("Target"), text("Projected")],
					rows: data.goals.map((g) => [
						g.name,
						g.saved,
						g.target,
						g.projected ? monthLabel(g.projected) : null,
					]),
				},
			};
		case "income":
			return {
				months: {
					title: "Income by month",
					columns: [
						text("Month"),
						money("Received"),
						money("Take-home pay"),
						money("Extra income"),
					],
					rows: data.months.map((m) => [monthLabel(m.month), m.total, m.baseline, m.windfall]),
				},
				sources: {
					title: "Income by source",
					columns: [text("Period"), text("Source"), money("Received")],
					rows: data.cells.map((c) => [period(c.period), c.name || "Income", c.amount]),
				},
			};
	}
}

const flowName = (names: Names, node?: { key: string; name: string }) => {
	if (!node) return "";
	return node.key.startsWith("out:") &&
		/^(bucket|commitment|goal):|^unassigned$/.test(node.key.slice(4))
		? names.label(node.key.slice(4))
		: node.name;
};

// ── Views ─────────────────────────────────────────────────────────────────────────────────────

export function ReportBody(props: {
	report: ReportData;
	names: Names;
	search: ReportSearch;
	nav: ReportNav;
	tables: Record<string, ReportTable>;
}) {
	const { data } = props.report;
	switch (data.kind) {
		case "area":
			return <AreaView {...props} data={data} />;
		case "overview":
			return <OverviewView {...props} data={data} />;
		case "big":
			return <BigView {...props} data={data} />;
		case "buckets":
			return <BucketsView {...props} data={data} />;
		case "plan":
			return <PlanView {...props} data={data} />;
		case "trends":
			return <TrendsView {...props} data={data} />;
		case "merchants":
			return <MerchantsView {...props} data={data} />;
		case "people":
			return <PeopleView {...props} data={data} />;
		case "cash-flow":
			return <CashFlowView {...props} data={data} />;
		case "goals":
			return <GoalsView {...props} data={data} />;
		case "income":
			return <IncomeView {...props} data={data} />;
	}
}

function OverviewView({ report, data, names, nav, tables }: ViewProps<"overview">) {
	const { now, previous } = data;
	if (now.spent === 0 && now.earned === 0 && data.series.every((s) => s.spent === 0)) {
		return <NothingYet />;
	}
	return (
		<div className="grid gap-4 lg:gap-6">
			<Card>
				<StatGrid
					size="lg"
					className="grid-cols-2 gap-x-4 gap-y-6 p-(--card-pad) sm:grid-cols-3 lg:grid-cols-5 lg:py-6"
				>
					<ReportStat
						index={0}
						label="Spent"
						value={formatWholeMoney(now.spent)}
						delta={<Delta now={now.spent} before={previous?.spent} />}
						hint={data.private ? <PrivateMark /> : null}
					/>
					<ReportStat
						index={1}
						label="Earned"
						value={formatWholeMoney(now.earned)}
						delta={<Delta now={now.earned} before={previous?.earned} invert />}
					/>
					<ReportStat
						index={2}
						label="Saved"
						value={formatWholeMoney(now.saved)}
						delta={<Delta now={now.saved} before={previous?.saved} invert />}
					/>
					<ReportStat
						index={3}
						label="Savings rate"
						value={now.savingsRate === null ? "—" : formatPercent(now.savingsRate)}
						hint={
							previous?.savingsRate != null && now.savingsRate !== null
								? `${formatPercent(previous.savingsRate)} before`
								: null
						}
					/>
					<ReportStat
						index={4}
						label="Free to Spend"
						value={formatWholeMoney(now.freeToSpend)}
						hint="over the Plans"
					/>
				</StatGrid>
			</Card>
			<div className="grid gap-4 lg:gap-6 xl:grid-cols-12 xl:items-start">
				<ChartCard
					className="xl:col-span-7"
					title="Income and spending"
					description={`By ${report.grouping}. The dashed line is what was left over.`}
					table={tables.series}
				>
					<IncomeSpendChart
						data={data.series}
						labelOf={periodLabel}
						onSelect={(period) => nav.month(monthOfPeriod(period))}
					/>
				</ChartCard>
				<ChartCard
					className="xl:col-span-5"
					title="Where it went"
					description="The biggest spending, with its trend"
					table={tables.top}
				>
					<ul className="grid gap-0.5">
						{data.top.map((top, i) => (
							<li
								key={top.target}
								className="animate-enter"
								style={{ animationDelay: `${i * 35}ms` }}
							>
								<DrillRow
									onClick={() => nav.area(top.target)}
									disabled={names.isPrivate(top.target)}
									label={`${names.label(top.target)}: ${formatMoney(top.amount)}`}
								>
									<KeyTile names={names} target={top.target} />
									<span className="grid min-w-0 flex-1 gap-0.5">
										<span className="truncate text-sm font-medium">{names.label(top.target)}</span>
										<span className="flex items-center gap-2 text-xs text-muted-foreground">
											{now.spent > 0
												? `${formatPercent(top.amount / now.spent)} of spending`
												: null}
											{names.isPrivate(top.target) ? <PrivateMark /> : null}
										</span>
									</span>
									<Sparkline
										values={top.spark}
										className="hidden sm:block"
										color={shareColor(names, top.target)}
									/>
									<span className="grid justify-items-end gap-0.5">
										<span className="shrink-0 text-sm font-semibold tabular-nums">
											{formatMoney(top.amount)}
										</span>
										<Delta now={top.amount} before={top.previous} />
									</span>
								</DrillRow>
							</li>
						))}
					</ul>
				</ChartCard>
			</div>
		</div>
	);
}

/** A threshold as a short label: $0, $25, $250, $1k. */
function stopLabel(s: number) {
	return s === 0 ? "$0" : s >= 1_000_00 ? `$${s / 1_000_00}k` : `$${s / 100}`;
}

function BigView({ data, names, search, nav, tables, report }: ViewProps<"big">) {
	const stops = THRESHOLD_STOPS;
	const wanted = (search.over ?? 250) * 100;
	let index = 0;
	for (let i = stops.length - 1; i > 0; i--) {
		if ((stops[i] ?? 0) <= wanted) {
			index = i;
			break;
		}
	}
	const threshold = stops[index] ?? 0;
	const over = overThreshold(data.bands, threshold);
	const pickerId = useId();
	const shown = data.items.filter((item) => item.amount >= threshold);
	const maxItem = Math.max(1, ...data.items.map((i) => i.amount));
	const bandMax = Math.max(1, ...data.bands.map((b) => b.amount));
	// The picked bar in words, so touch reads what hover's tooltip shows.
	const band = data.bands.find((b) => b.floor === threshold);
	const next = stops[index + 1];
	const bandCount = band?.count ?? 0;
	const bandText = `${next === undefined ? `${stopLabel(threshold)} and up` : `${stopLabel(threshold)} to ${stopLabel(next)}`}: ${formatMoney(band?.amount ?? 0)} in ${bandCount} ${bandCount === 1 ? "Transaction" : "Transactions"}`;
	if (data.spent === 0 && data.items.length === 0 && data.commitments.length === 0)
		return <NothingYet />;
	return (
		<div className="grid gap-4 lg:grid-cols-5 lg:items-start lg:gap-6">
			<Card className="grid gap-5 p-(--card-pad) lg:col-span-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] lg:items-center lg:gap-10 lg:py-6">
				<div className="grid gap-1">
					<span className="text-[13px] text-muted-foreground">
						One-offs over {formatMoney(threshold)}
					</span>
					<span
						key={threshold}
						className="text-[2rem] font-semibold tracking-[-0.03em] tabular-nums animate-enter lg:text-[2.5rem]"
					>
						{formatMoney(over.amount)}
					</span>
					<span className="text-[13px] text-muted-foreground">
						{over.count.toLocaleString("en-US")} {over.count === 1 ? "Transaction" : "Transactions"}
						{data.spent > 0
							? ` · ${formatPercent(over.amount / data.spent)} of all spending`
							: null}
					</span>
				</div>
				<div className="grid gap-2">
					<p id={pickerId} className="text-[13px] font-medium">
						What did we spend over…
					</p>
					{/* One option per threshold: its bar is what was spent from there up to the next. */}
					<ToggleGroup
						type="single"
						aria-labelledby={pickerId}
						value={String(threshold)}
						onValueChange={(value) => nav.set({ over: Number(value) / 100 })}
						className="grid w-full grid-cols-10 gap-0.5"
					>
						{stops.map((s, i) => {
							const band = data.bands.find((b) => b.floor === s);
							const amount = band?.amount ?? 0;
							const count = band?.count ?? 0;
							const label = stopLabel(s);
							return (
								<WithTooltip
									key={s}
									label={`Over ${label}: ${formatMoney(amount)} in ${count} ${count === 1 ? "Transaction" : "Transactions"}`}
								>
									<ToggleGroupItem
										value={String(s)}
										aria-label={`${label}: ${formatMoney(amount)} in ${count} ${count === 1 ? "Transaction" : "Transactions"}`}
										className="group/stop h-auto min-w-0 flex-col items-stretch gap-1 rounded-md px-0 pt-1 pb-0.5 hover:bg-surface-2 data-[state=on]:bg-transparent"
									>
										<span className="flex h-14 items-end justify-center" aria-hidden="true">
											<span
												className={cn(
													"w-4 max-w-full rounded-t-[3px] transition-[height,background-color] duration-300",
													s >= threshold ? "bg-(--chart-spend)" : "bg-(--chart-mid)",
												)}
												style={{
													height: amount > 0 ? `${Math.max(6, (amount / bandMax) * 100)}%` : "2px",
												}}
											/>
										</span>
										<span
											className={cn(
												"text-center text-[11px] font-normal text-muted-foreground tabular-nums",
												"group-data-[state=on]/stop:font-semibold group-data-[state=on]/stop:text-foreground",
												i % 2 === 1 && "max-sm:invisible",
											)}
										>
											{label}
										</span>
									</ToggleGroupItem>
								</WithTooltip>
							);
						})}
					</ToggleGroup>
					<p className="text-xs text-muted-foreground tabular-nums">{bandText}</p>
				</div>
			</Card>
			<ChartCard
				className={data.commitments.length ? "lg:col-span-3" : "lg:col-span-5"}
				title="Largest Transactions"
				description={
					shown.length
						? `The biggest ${shown.length} one-offs over ${formatMoney(threshold)}; Commitments aren't counted`
						: `No one-offs over ${formatMoney(threshold)} this period`
				}
				table={tables.items}
			>
				<RankedBars
					max={maxItem}
					rows={shown.map((item) => ({
						key: `${item.id}:${item.target}`,
						amount: item.amount,
						color: shareColor(names, item.target),
					}))}
					renderRow={(row, bar) => {
						const item = shown.find((i) => `${i.id}:${i.target}` === row.key);
						if (!item) return null;
						const target =
							names.kindOf(item.target) === "bucket" ? item.target.slice(7) : undefined;
						return (
							<Link
								to="/transactions/$month"
								params={{ month: item.date.slice(0, 7) }}
								search={{ bucket: target }}
								className="-mx-2 grid gap-1.5 rounded-xl px-2 py-2 transition-colors duration-(--duration-fast) hover:bg-surface-2"
							>
								<span className="flex items-baseline gap-3">
									<span className="min-w-0 flex-1 truncate text-sm font-medium">
										{item.note || names.label(item.target)}
									</span>
									<span className="shrink-0 text-sm font-semibold tabular-nums">
										{formatMoney(item.amount)}
									</span>
								</span>
								{bar}
								<span className="text-xs text-muted-foreground">
									{fullDay(item.date)} · {names.label(item.target)}
									{item.split ? " · part of a split" : ""}
								</span>
							</Link>
						);
					}}
				/>
			</ChartCard>
			{data.commitments.length ? (
				<ChartCard
					className="lg:col-span-2 lg:self-start"
					title="Commitments, by the year"
					description="What each costs a year, from how often it's due"
					table={tables.commitments}
				>
					{data.commitments.length ? (
						<RankedBars
							rows={data.commitments.map((c) => ({ key: c.id, amount: c.annual }))}
							renderRow={(row, bar) => {
								const c = data.commitments.find((x) => x.id === row.key);
								if (!c) return null;
								return (
									<DrillRow
										onClick={() => nav.area(`commitment:${c.id}`)}
										label={`${c.name}: ${formatMoney(c.annual)} a year`}
									>
										<span className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)] gap-1.5">
											<span className="flex items-baseline gap-3">
												<span className="min-w-0 flex-1 truncate text-sm font-medium">
													{c.name}
												</span>
												<span className="shrink-0 text-sm font-semibold tabular-nums">
													{formatMoney(c.annual)}
												</span>
											</span>
											{bar}
											<span className="text-xs text-muted-foreground">
												{formatMoney(c.amount)} {c.cadence}
											</span>
										</span>
									</DrillRow>
								);
							}}
						/>
					) : null}
					{data.commitments.length ? (
						<p className="border-t pt-3 text-[13px] text-muted-foreground">
							All together{" "}
							<span className="font-semibold text-foreground tabular-nums">
								{formatMoney(data.commitments.reduce((s, c) => s + c.annual, 0))}
							</span>{" "}
							a year
						</p>
					) : null}
				</ChartCard>
			) : null}
			<ChartCard
				className="lg:col-span-5"
				title="Recurring and one-off"
				description="Commitments against everything else"
				table={tables.recurring}
			>
				<PeriodBars
					data={[]}
					labelOf={periodLabel}
					onSelect={(p) => nav.month(monthOfPeriod(p))}
					stacked={{
						rows: data.recurring,
						series: [
							{ key: "recurring", label: "Recurring", color: "var(--chart-spend)" },
							{ key: "oneOff", label: "One-off", color: "var(--chart-compare)" },
						],
					}}
				/>
				<span className="sr-only">{report.periods.length} periods</span>
			</ChartCard>
		</div>
	);
}

/** What a share of spending is, said on its row: the list mixes all four. */
const SHARE_KIND: Record<string, string> = {
	bucket: "Bucket",
	commitment: "Commitment",
	goal: "Goal spending",
	unassigned: "Not in a Bucket",
};

function BucketsView({ data, names, search, nav, tables }: ViewProps<"buckets">) {
	const chart: ChartKind = search.chart ?? "donut";
	const shares: Share[] = useMemo(
		() =>
			topWithOther(
				data.totals.map((t) => ({ key: t.target as string, amount: t.amount })),
				7,
			).map((t) => ({
				key: t.key,
				amount: t.amount,
				label: t.key === "other" ? "Everything else" : names.label(t.key),
				color: t.key === "other" ? "var(--chart-compare)" : shareColor(names, t.key),
			})),
		[data.totals, names],
	);
	// The row the pointer or focus is on in the list, shown in the donut's centre.
	const [active, setActive] = useState<string | null>(null);
	if (data.totals.length === 0) return <NothingYet />;
	const select = (key: string) => {
		if (key !== "other" && !names.isPrivate(key)) nav.area(key);
	};
	const kinds = [
		{ kind: "donut", label: "Donut", icon: ChartPie },
		{ kind: "bar", label: "Bars", icon: Rows3 },
		{ kind: "treemap", label: "Treemap", icon: LayoutGrid },
	] as const;
	return (
		<ChartCard
			title="Share of spending"
			description="Pick a Bucket to see its trend, merchants and Transactions"
			table={tables.shares}
			actions={
				<ToggleGroup
					type="single"
					variant="segmented"
					size="icon-sm"
					aria-label="Chart type"
					value={chart}
					onValueChange={(kind) =>
						nav.set({ chart: kind === "donut" ? undefined : (kind as typeof chart) })
					}
				>
					{kinds.map(({ kind, label, icon: Icon }) => (
						<ToggleGroupItem key={kind} value={kind} aria-label={label}>
							<Icon />
						</ToggleGroupItem>
					))}
				</ToggleGroup>
			}
		>
			{/* biome-ignore lint/a11y/noStaticElementInteractions: it only follows the pointer and focus in the list to label the donut */}
			<div
				className={cn(
					"grid grid-cols-[minmax(0,1fr)] gap-6",
					chart === "donut" &&
						"lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)] lg:items-start lg:gap-10",
				)}
				onMouseOver={(event) =>
					setActive(
						(event.target as HTMLElement).closest<HTMLElement>("[data-share]")?.dataset.share ??
							null,
					)
				}
				onMouseLeave={() => setActive(null)}
				onFocus={(event) =>
					setActive(
						(event.target as HTMLElement).closest<HTMLElement>("[data-share]")?.dataset.share ??
							null,
					)
				}
				onBlur={() => setActive(null)}
			>
				{chart === "donut" ? (
					<div className="lg:sticky lg:top-4">
						<ShareDonut data={shares} total={data.spent} onSelect={select} active={active} />
					</div>
				) : chart === "treemap" ? (
					<ShareTreemap data={shares} onSelect={select} />
				) : null}
				<RankedBars
					rows={data.totals.map((t) => ({
						key: t.target,
						amount: t.amount,
						color: shareColor(names, t.target),
					}))}
					renderRow={(row, bar) => {
						const t = data.totals.find((x) => x.target === row.key);
						if (!t) return null;
						const before = data.previous ? (data.previous[t.target] ?? 0) : null;
						return (
							<div data-share={t.target} className="contents">
								<DrillRow
									onClick={() => select(t.target)}
									disabled={t.private || names.isPrivate(t.target)}
									label={`${names.label(t.target)}: ${formatMoney(t.amount)}`}
								>
									<KeyTile names={names} target={t.target} className="size-8" />
									<span className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)] gap-1.5">
										<span className="flex items-baseline gap-3">
											<span className="min-w-0 flex-1 truncate text-sm font-medium">
												{names.label(t.target)}
											</span>
											<span className="shrink-0 text-sm font-semibold tabular-nums">
												{formatMoney(t.amount)}
											</span>
										</span>
										{chart === "bar" ? bar : null}
										<span className="flex items-center gap-1.5 text-xs whitespace-nowrap text-muted-foreground">
											<span className="max-sm:hidden">
												{SHARE_KIND[names.kindOf(t.target)] ?? ""}
											</span>
											<span aria-hidden="true" className="max-sm:hidden">
												·
											</span>
											<span className="tabular-nums">
												{data.spent > 0 ? formatPercent(t.amount / data.spent) : "—"}
											</span>
											{t.count > 0 ? (
												<span>
													<span aria-hidden="true" className="me-1.5">
														·
													</span>
													{t.count} {t.count === 1 ? "Transaction" : "Transactions"}
												</span>
											) : null}
											{t.private ? <PrivateMark /> : null}
											<Delta now={t.amount} before={before} className="ms-auto" />
										</span>
									</span>
								</DrillRow>
							</div>
						);
					}}
				/>
			</div>
		</ChartCard>
	);
}

function AreaView({ report, data, names, search, nav, tables }: ViewProps<"area">) {
	const area = search.area;
	const month = search.month;
	const isPrivate = area ? names.isPrivate(area) : false;
	const bucketId = area?.startsWith("bucket:") ? area.slice(7) : undefined;
	const openMonth = month ?? (report.periods.at(-1)?.slice(0, 7) as MonthKey);
	return (
		<div className="grid gap-4 lg:grid-cols-5 lg:gap-6">
			<Card className="lg:col-span-5">
				<StatGrid size="lg" className="grid-cols-2 gap-4 p-(--card-pad) sm:grid-cols-3">
					<ReportStat
						label={month ? monthLabel(month) : "This period"}
						value={formatMoney(data.total)}
						delta={<Delta now={data.total} before={data.previous} />}
						hint={data.private ? <PrivateMark /> : null}
					/>
					<ReportStat index={1} label="Transactions" value={data.count.toLocaleString("en-US")} />
					<ReportStat
						index={2}
						label="Average"
						value={data.count > 0 ? formatMoney(Math.round(data.total / data.count)) : "—"}
					/>
				</StatGrid>
			</Card>
			<ChartCard
				className="lg:col-span-5"
				title="Over time"
				description={
					month
						? "Pick another month, or the same one to step back"
						: "Pick a month to see its Transactions"
				}
				table={tables.series}
			>
				<PeriodBars
					data={data.series}
					labelOf={periodLabel}
					selected={month ? report.periods.find((p) => p.startsWith(month)) : undefined}
					onSelect={(p) => nav.month(monthOfPeriod(p))}
				/>
			</ChartCard>
			<ChartCard
				className="lg:col-span-3"
				title="Transactions"
				description={
					isPrivate
						? "A Personal Allowance's Transactions are its owner's"
						: data.itemsTotal > data.items.length
							? `The latest ${data.items.length} of ${data.itemsTotal.toLocaleString("en-US")}`
							: `${data.itemsTotal.toLocaleString("en-US")} in ${month ? monthLabel(month) : "this period"}`
				}
				table={tables.items}
				actions={
					isPrivate ? null : (
						<Button variant="ghost" size="sm" asChild>
							<Link
								to="/transactions/$month"
								params={{ month: openMonth }}
								search={{ bucket: bucketId }}
							>
								Open in Transactions
								<ArrowRight />
							</Link>
						</Button>
					)
				}
			>
				{data.items.length ? (
					<ul className="-mx-(--card-pad) divide-y border-t">
						{data.items.map((item, i) => (
							<li
								key={`${item.id}:${item.target}`}
								className="animate-enter"
								style={{ animationDelay: `${Math.min(i, 12) * 20}ms` }}
							>
								<Link
									to="/transactions/$month"
									params={{ month: item.date.slice(0, 7) }}
									search={{
										bucket:
											names.kindOf(item.target) === "bucket" ? item.target.slice(7) : undefined,
									}}
									className="flex items-center gap-3 px-(--card-pad) py-2.5 transition-colors duration-(--duration-fast) hover:bg-surface-2"
								>
									<KeyTile names={names} target={item.target} className="size-8" />
									<span className="grid min-w-0 flex-1 gap-0.5">
										<span className="truncate text-sm font-medium">
											{item.note || names.label(item.target)}
										</span>
										<span className="text-xs text-muted-foreground">
											{shortDay(item.date)} · {names.label(item.target)}
											{item.split ? " · split" : ""}
										</span>
									</span>
									<span
										className={cn(
											"text-sm font-semibold tabular-nums",
											item.amount < 0 && "text-brand",
										)}
									>
										{formatMoney(item.amount)}
									</span>
								</Link>
							</li>
						))}
					</ul>
				) : (
					<p className="text-sm text-muted-foreground">
						{isPrivate ? "Only its total shows here." : "Nothing here in this period."}
					</p>
				)}
			</ChartCard>
			<div className="grid content-start gap-4 lg:col-span-2 lg:gap-6">
				{data.merchants.length ? (
					<ChartCard title="Merchants" description="Where it was spent" table={tables.merchants}>
						<RankedBars
							rows={data.merchants.map((m) => ({ key: m.key, amount: m.amount }))}
							renderRow={(row, bar) => {
								const m = data.merchants.find((x) => x.key === row.key);
								if (!m) return null;
								return (
									<DrillRow
										onClick={() => nav.area(`merchant:${m.key}`)}
										label={`${m.name || merchantName(m.key)}: ${formatMoney(m.amount)}`}
									>
										<span className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)] gap-1.5">
											<span className="flex items-baseline gap-3">
												<span className="min-w-0 flex-1 truncate text-sm font-medium">
													{m.name || merchantName(m.key)}
												</span>
												<span className="shrink-0 text-sm font-semibold tabular-nums">
													{formatMoney(m.amount)}
												</span>
											</span>
											{bar}
										</span>
									</DrillRow>
								);
							}}
						/>
					</ChartCard>
				) : null}
				{data.targets.length ? (
					<ChartCard
						title="Where it lands"
						description="The Buckets it's spent from"
						table={tables.targets}
					>
						<RankedBars
							rows={data.targets.map((t) => ({
								key: t.target,
								amount: t.amount,
								color: shareColor(names, t.target),
							}))}
							renderRow={(row, bar) => (
								<DrillRow
									onClick={() => nav.area(row.key)}
									label={`${names.label(row.key)}: ${formatMoney(row.amount)}`}
								>
									<span className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)] gap-1.5">
										<span className="flex items-baseline gap-3">
											<span className="min-w-0 flex-1 truncate text-sm font-medium">
												{names.label(row.key)}
											</span>
											<span className="shrink-0 text-sm font-semibold tabular-nums">
												{formatMoney(row.amount)}
											</span>
										</span>
										{bar}
									</span>
								</DrillRow>
							)}
						/>
					</ChartCard>
				) : null}
			</div>
		</div>
	);
}

function PlanView({ data, names, nav, tables }: ViewProps<"plan">) {
	const buckets = [...new Set(data.variances.map((v) => v.bucketId))];
	if (buckets.length === 0) return <NothingYet what="No Buckets in the Plan for this period." />;
	const rows = buckets.map((id) => ({
		key: `bucket:${id}`,
		label: (
			<span className="flex items-center gap-2">
				<KeyTile names={names} target={`bucket:${id}`} className="size-6 rounded-md text-[11px]" />
				<span className="min-w-0 truncate max-sm:line-clamp-2 max-sm:whitespace-normal">
					{names.label(`bucket:${id}`)}
				</span>
			</span>
		),
		cells: data.months.map(
			(m) => data.variances.find((v) => v.bucketId === id && v.month === m) ?? null,
		),
	}));
	const habits = data.habits.filter((h) => h.habit !== "on-plan");
	return (
		<div className="grid items-start gap-4 lg:grid-cols-5 lg:gap-6">
			<ChartCard
				className="lg:col-span-5"
				title="Plan vs actual"
				description="Spent as a share of each month's allowance"
				table={tables.variance}
			>
				<VarianceHeatmap
					rows={rows}
					months={data.months}
					monthLabel={(m) => periodLabel(m)}
					onSelect={(key, month) => !names.isPrivate(key) && nav.area(key, month as MonthKey)}
				/>
			</ChartCard>
			<ChartCard
				className={data.rolling.length ? "lg:col-span-2" : "lg:col-span-5"}
				title="Usually over or under"
				description="Buckets over or under the Plan in most months"
				table={tables.habits}
			>
				{habits.length ? (
					<ul className="grid gap-0.5">
						{habits.map((h) => (
							<li key={h.bucketId}>
								<DrillRow
									onClick={() => nav.area(`bucket:${h.bucketId}`)}
									disabled={names.isPrivate(`bucket:${h.bucketId}`)}
									label={`${names.label(`bucket:${h.bucketId}`)}: usually ${h.habit} Plan`}
								>
									<KeyTile names={names} target={`bucket:${h.bucketId}`} className="size-8" />
									<span className="grid min-w-0 flex-1 gap-0.5">
										<span className="truncate text-sm font-medium">
											{names.label(`bucket:${h.bucketId}`)}
										</span>
										<span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
											<span className="whitespace-nowrap">
												{h.habit === "over" ? h.over : h.under} of {h.months} months {h.habit}
											</span>
											<Badge variant={h.gap > 0 ? "over" : "brand"} dot>
												{h.gap > 0 ? `${formatMoney(h.gap)} over` : `${formatMoney(-h.gap)} under`}
											</Badge>
										</span>
									</span>
								</DrillRow>
							</li>
						))}
					</ul>
				) : (
					<p className="text-sm text-muted-foreground">Every Bucket is mostly on Plan.</p>
				)}
			</ChartCard>
			{data.rolling.length ? (
				<ChartCard
					className="lg:col-span-3"
					title="Balances carried to next month"
					description="What each Bucket that carries over took into the next month"
					table={tables.rolling}
				>
					{data.rolling.length >= 8 ? (
						// Eight or more lines tangle: one small chart each instead.
						<ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
							{data.rolling.map((r) => (
								<li key={r.bucketId} className="grid gap-1 rounded-xl bg-surface-2/60 p-3">
									<span className="truncate text-[13px] font-medium">
										{names.label(`bucket:${r.bucketId}`)}
									</span>
									<span className="text-sm font-semibold tabular-nums">
										{formatMoney(
											r.carried.find((c) => c.month === data.months.at(-1))?.amount ?? 0,
										)}
									</span>
									<Sparkline
										values={data.months.map(
											(m) => r.carried.find((c) => c.month === m)?.amount ?? 0,
										)}
										className="h-10 w-full"
										color={shareColor(names, `bucket:${r.bucketId}`)}
									/>
								</li>
							))}
						</ul>
					) : (
						<TrendLines
							className="h-60"
							labelOf={periodLabel}
							rows={data.months.map((m) => ({
								period: m,
								...Object.fromEntries(
									data.rolling.map((r) => [
										r.bucketId,
										r.carried.find((c) => c.month === m)?.amount ?? 0,
									]),
								),
							}))}
							series={data.rolling.map((r) => ({
								key: r.bucketId,
								label: names.label(`bucket:${r.bucketId}`),
								color: shareColor(names, `bucket:${r.bucketId}`),
							}))}
						/>
					)}
				</ChartCard>
			) : null}
		</div>
	);
}

function TrendsView({ report, data, names, nav, tables }: ViewProps<"trends">) {
	if (data.series.every((s) => s.amount === 0)) return <NothingYet />;
	return (
		<div className="grid gap-4 lg:gap-6">
			<ChartCard
				title="Spending over time"
				description={
					data.previous ? "Against the comparison period, in grey" : `By ${report.grouping}`
				}
				table={tables.series}
			>
				<PeriodBars
					data={data.series}
					previous={data.previous}
					labelOf={periodLabel}
					onSelect={(p) => nav.month(monthOfPeriod(p))}
				/>
			</ChartCard>
			<ChartCard title="Every day" description="Darker days cost more" table={tables.daily}>
				<CalendarHeatmap
					days={data.daily}
					from={report.range.from}
					until={report.range.until}
					onSelect={(day) => nav.month(day.slice(0, 7) as MonthKey)}
				/>
			</ChartCard>
			<ChartCard title="By Bucket" description="Each on its own scale" table={tables.multiples}>
				<ul className="grid grid-cols-1 gap-3 min-[360px]:grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
					{data.multiples.map((m) => (
						<li key={m.target} className="min-w-0">
							<RowButton
								variant="soft"
								disabled={names.isPrivate(m.target)}
								onClick={() => nav.area(m.target)}
							>
								<span className="flex items-center gap-2">
									<span
										className="size-2 shrink-0 rounded-full"
										style={{ background: shareColor(names, m.target) }}
									/>
									<span className="min-w-0 truncate text-[13px] font-medium">
										{names.label(m.target)}
									</span>
								</span>
								<span className="text-base font-semibold tabular-nums">
									{formatMoney(m.amount)}
								</span>
								<Sparkline
									values={m.series}
									className="h-10 w-full"
									color={shareColor(names, m.target)}
								/>
							</RowButton>
						</li>
					))}
				</ul>
			</ChartCard>
		</div>
	);
}

function MerchantList({
	merchants,
	nav,
	by,
}: {
	merchants: Extract<ViewData, { kind: "merchants" }>["byAmount"];
	nav: ReportNav;
	by: "amount" | "count";
}) {
	return (
		<RankedBars
			rows={merchants.map((m) => ({ key: m.key, amount: by === "amount" ? m.amount : m.count }))}
			renderRow={(row, bar) => {
				const m = merchants.find((x) => x.key === row.key);
				if (!m) return null;
				const name = m.name || merchantName(m.key);
				return (
					<DrillRow
						onClick={() => nav.area(`merchant:${m.key}`)}
						label={`${name}: ${formatMoney(m.amount)}, ${m.count} times`}
					>
						<span className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)] gap-1.5">
							<span className="flex items-baseline gap-3">
								<span className="min-w-0 flex-1 truncate text-sm font-medium" title={name}>
									{name}
								</span>
								<span className="shrink-0 text-sm font-semibold tabular-nums">
									{by === "amount" ? formatMoney(m.amount) : `${m.count}×`}
								</span>
							</span>
							{bar}
							<span className="text-xs text-muted-foreground">
								{by === "amount"
									? `${m.count} ${m.count === 1 ? "time" : "times"}`
									: formatMoney(m.amount)}
								{m.targets > 1 ? ` · ${m.targets} Buckets` : ""}
							</span>
						</span>
					</DrillRow>
				);
			}}
		/>
	);
}

function MerchantsView({ data, nav, tables }: ViewProps<"merchants">) {
	if (data.byAmount.length === 0) return <NothingYet />;
	return (
		<div className="grid gap-4 lg:grid-cols-2 lg:gap-6">
			<ChartCard
				title="By spending"
				description="Grouped by merchant, from each Transaction’s note"
				table={tables.byAmount}
			>
				<MerchantList merchants={data.byAmount.slice(0, 15)} nav={nav} by="amount" />
			</ChartCard>
			<ChartCard title="By visits" description="The places you go most" table={tables.byCount}>
				<MerchantList merchants={data.byCount.slice(0, 15)} nav={nav} by="count" />
			</ChartCard>
		</div>
	);
}

function PeopleView({ report, data, names, nav, tables, search }: ViewProps<"people">) {
	const totals = [...new Set(data.cells.map((c) => c.who))]
		.map((who) => ({
			key: who,
			amount: data.cells.filter((c) => c.who === who).reduce((s, c) => s + c.amount, 0),
		}))
		.sort((a, b) => b.amount - a.amount);
	if (totals.length === 0) return <NothingYet />;
	const children = report.meta.members.filter((m) => m.kind === "child").map((m) => m.id);
	// Filtered to one Child (Household's "See what … costs"), the by-Bucket costs show only theirs.
	const costChildren = report.meta.members.filter(
		(m) =>
			m.kind === "child" &&
			(!search.member || !children.includes(search.member) || m.id === search.member),
	);
	const memberColor = (who: string) => {
		const color = report.meta.members.find((m) => m.id === who)?.color;
		return color ? `var(--bucket-${color})` : "var(--chart-spend)";
	};
	return (
		<div className="grid gap-4 lg:grid-cols-5 lg:gap-6">
			<ChartCard
				className="lg:col-span-2"
				title="Spending for each person"
				description="Shared spending counts evenly for each"
				table={tables.people}
			>
				<RankedBars
					rows={totals.map((t) => ({ ...t, color: memberColor(t.key) }))}
					renderRow={(row, bar) => (
						<DrillRow
							onClick={() =>
								nav.area(row.key === "household" ? "member:everyone" : `member:${row.key}`)
							}
							label={`${names.label(row.key)}: ${formatMoney(row.amount)}`}
						>
							<span className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)] gap-1.5">
								<span className="flex items-baseline gap-3">
									<span className="min-w-0 flex-1 truncate text-sm font-medium">
										{names.label(row.key)}
									</span>
									<span className="shrink-0 text-sm font-semibold tabular-nums">
										{formatMoney(row.amount)}
									</span>
								</span>
								{bar}
							</span>
						</DrillRow>
					)}
				/>
			</ChartCard>
			<ChartCard
				className="lg:col-span-3"
				title="What each Child costs"
				description={`By ${report.grouping}`}
			>
				{children.length ? (
					<TrendLines
						labelOf={periodLabel}
						rows={report.periods.map((p) => ({
							period: p,
							...Object.fromEntries(
								children.map((c) => [
									c,
									data.cells.find((x) => x.period === p && x.who === c)?.amount ?? 0,
								]),
							),
						}))}
						series={children.map((c) => ({ key: c, label: names.label(c), color: memberColor(c) }))}
						className="h-64"
					/>
				) : (
					<p className="text-sm text-muted-foreground">
						Add Children in Household settings to see their costs.
					</p>
				)}
			</ChartCard>
			{costChildren.length ? (
				<div className="lg:col-span-5">
					<ChildCosts of={costChildren} />
				</div>
			) : null}
		</div>
	);
}

function CashFlowView({ data, nav, tables, names }: ViewProps<"cash-flow">) {
	if (data.flow.nodes.length === 0) return <NothingYet />;
	const nodes = data.flow.nodes.map((n) => ({ ...n, name: flowName(names, n) }));
	return (
		<div className="grid gap-4 lg:gap-6">
			<Card>
				<StatGrid size="lg" className="grid-cols-3 gap-4 p-(--card-pad)">
					<ReportStat label="Came in" value={formatMoney(data.earned)} />
					<ReportStat index={1} label="Went out" value={formatMoney(data.spent)} />
					<ReportStat index={2} label="To Goals" value={formatMoney(data.goals)} />
				</StatGrid>
			</Card>
			<ChartCard
				title="Where the money flowed"
				description="From income, through the Household, to Buckets, Goals and savings"
				table={tables.flow}
			>
				<div className="-mx-(--card-pad) overflow-x-auto px-(--card-pad)">
					<div className="min-w-[36rem]">
						<FlowSankey
							nodes={nodes}
							links={data.flow.links}
							onSelect={(key) => {
								const target = key.slice(4);
								if (
									key.startsWith("out:") &&
									/^(bucket|commitment|goal):|^unassigned$/.test(target) &&
									!names.isPrivate(target)
								)
									nav.area(target);
							}}
						/>
					</div>
				</div>
			</ChartCard>
		</div>
	);
}

function GoalsView({ data, tables, report }: ViewProps<"goals">) {
	if (data.goals.length === 0) return <NothingYet what="No Goals yet." />;
	return (
		<div className="grid gap-4 lg:gap-6">
			<ChartCard
				title="Set aside and paid down over time"
				description="What each Goal had set aside, or paid down on its card or loan, at each month's end"
				table={tables.goals}
			>
				<TrendLines
					labelOf={periodLabel}
					rows={monthsOf(data.goals).map((m) => ({
						period: m,
						...Object.fromEntries(
							data.goals.map((g) => [g.id, g.history.find((h) => h.month === m)?.saved ?? null]),
						),
					}))}
					series={data.goals.map((g, i) => ({
						key: g.id,
						label: g.name,
						color: goalColor(i),
					}))}
					className="h-64"
				/>
			</ChartCard>
			<ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
				{data.goals.map((g, i) => {
					const share = g.target > 0 ? Math.min(1, g.saved / g.target) : 0;
					const done = g.completed || g.saved >= g.target;
					const late = g.projected && g.targetDate && g.projected > g.targetDate.slice(0, 7);
					const pastDue = !done && g.targetDate !== null && g.targetDate < report.asOf;
					const status = g.completed
						? [
								"Completed",
								...(g.spent > 0 ? [`spent ${formatMoney(g.spent)}`] : []),
								...(g.kind === "payoff" ? [] : [`${formatMoney(g.saved)} still set aside`]),
							].join(" · ")
						: g.saved >= g.target
							? g.kind === "payoff"
								? "Paid off"
								: "Reached"
							: g.kind === "payoff"
								? g.projected
									? `Paid off by ${monthLabel(g.projected)} at this pace`
									: "Not coming down yet"
								: g.projected
									? `On course for ${monthLabel(g.projected)}`
									: "No recent saving to project from";
					return (
						<li key={g.id} className="animate-enter" style={{ animationDelay: `${i * 40}ms` }}>
							<Link to="/goals/$goalId" params={{ goalId: g.id }} className="block h-full">
								<Card className="grid h-full content-start gap-3 p-(--card-pad) transition-shadow duration-(--duration-fast) hover:shadow-pop">
									<span className="flex items-center gap-2">
										<span
											aria-hidden="true"
											className="size-2.5 shrink-0 rounded-full"
											style={{ background: goalColor(i) }}
										/>
										<span className="min-w-0 flex-1 truncate text-sm font-semibold">{g.name}</span>
										{g.completed ? null : (
											<span className="text-xs text-muted-foreground tabular-nums">
												{formatPercent(share)}
											</span>
										)}
									</span>
									{g.completed ? null : (
										<>
											<span className="text-xl font-semibold tabular-nums">
												{formatMoney(g.saved)}
												<span className="text-sm font-normal text-muted-foreground">
													{" "}
													{g.kind === "payoff" ? "paid down of" : "of"} {formatMoney(g.target)}
												</span>
											</span>
											<GoalProgressBar share={share} />
										</>
									)}
									<span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
										{status}
										{pastDue ? (
											<Badge variant="over" dot>
												Past its target date
											</Badge>
										) : late ? (
											<Badge variant="pace" dot>
												After its target date
											</Badge>
										) : null}
									</span>
								</Card>
							</Link>
						</li>
					);
				})}
			</ul>
			<span className="sr-only">As of {fullDay(report.asOf)}</span>
		</div>
	);
}

/** A Goal's line and dot: the Bucket palette in order, so each Goal reads apart. */
const goalColor = (index: number) =>
	`var(--bucket-${bucketColors[index % bucketColors.length]?.value})`;

const monthsOf = (goals: Extract<ViewData, { kind: "goals" }>["goals"]) =>
	goals[0]?.history.map((h) => h.month) ?? [];

function IncomeView({ data, nav, tables }: ViewProps<"income">) {
	if (data.months.every((m) => m.total === 0))
		return <NothingYet what="No income recorded in this period." />;
	const total = data.months.reduce((s, m) => s + m.total, 0);
	const extraIncomes = data.months.reduce((s, m) => s + m.windfall, 0);
	const sources = [...new Map(data.cells.map((c) => [c.source, c.name || "Income"])).entries()];
	const bySource = sources
		.map(([key, name]) => ({
			key,
			name,
			amount: data.cells.filter((c) => c.source === key).reduce((s, c) => s + c.amount, 0),
		}))
		.sort((a, b) => b.amount - a.amount);
	return (
		<div className="grid gap-4 lg:grid-cols-5 lg:gap-6">
			<Card className="lg:col-span-5">
				<StatGrid size="lg" className="grid-cols-2 gap-4 p-(--card-pad)">
					<ReportStat label="Received" value={formatMoney(total)} />
					<ReportStat
						index={1}
						label="Extra income"
						value={formatMoney(extraIncomes)}
						hint="above your usual take-home pay"
					/>
				</StatGrid>
			</Card>
			<ChartCard
				className="lg:col-span-3"
				title="Income by month"
				description="Up to your usual take-home pay in ink; Extra income above it in blue"
				table={tables.months}
			>
				<PeriodBars
					data={[]}
					labelOf={periodLabel}
					onSelect={(p) => nav.month(monthOfPeriod(p))}
					stacked={{
						rows: data.months.map((m) => ({
							period: m.month,
							regular: m.total - m.windfall,
							windfall: m.windfall,
						})),
						series: [
							{ key: "regular", label: "Regular", color: "var(--chart-spend)" },
							{ key: "windfall", label: "Extra income", color: "var(--chart-income)" },
						],
					}}
				/>
			</ChartCard>
			<ChartCard
				className="lg:col-span-2"
				title="By source"
				description="Grouped by each entry's note"
				table={tables.sources}
			>
				<RankedBars
					rows={bySource.map((s) => ({
						key: s.key,
						amount: s.amount,
						color: "var(--chart-income)",
					}))}
					renderRow={(row, bar) => (
						<span className="grid gap-1.5 py-2">
							<span className="flex items-baseline gap-3">
								<span className="min-w-0 flex-1 truncate text-sm font-medium">
									{bySource.find((s) => s.key === row.key)?.name}
								</span>
								<span className="shrink-0 text-sm font-semibold tabular-nums">
									{formatMoney(row.amount)}
								</span>
							</span>
							{bar}
						</span>
					)}
				/>
			</ChartCard>
		</div>
	);
}

/** Marks a figure that includes another Parent's Personal Allowance, as This Month does. */
export function PrivateMark() {
	return (
		<span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
			<Lock aria-hidden="true" className="size-3" />
			Includes private
		</span>
	);
}

function NothingYet({ what }: { what?: string }) {
	return (
		<EmptyState
			icon={<ChartPie />}
			title="Nothing to report yet"
			description={
				what ??
				"Once there's spending in this period, it shows up here. Try a longer period, or clear the filters."
			}
		/>
	);
}
