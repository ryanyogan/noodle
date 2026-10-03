import {
	type Cents,
	type MonthBreakdown,
	type MonthKey,
	monthBreakdown,
	type Projection,
	type ScenarioChange,
	type ScenarioChangeImpact,
} from "@noodle/domain";
import { Button } from "@noodle/ui/components/button";
import {
	type ChartConfig,
	ChartContainer,
	ChartLegend,
	ChartLegendContent,
	ChartTooltip,
} from "@noodle/ui/components/chart";
import {
	Table,
	TableBody,
	TableCaption,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@noodle/ui/components/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@noodle/ui/components/tabs";
import { ToggleGroup, ToggleGroupItem } from "@noodle/ui/components/toggle-group";
import { cn } from "@noodle/ui/lib/utils";
import { X } from "lucide-react";
import {
	createContext,
	type ReactNode,
	type PointerEvent as ReactPointerEvent,
	use,
	useCallback,
	useEffect,
	useId,
	useState,
} from "react";
import {
	Area,
	Bar,
	CartesianGrid,
	Cell,
	ComposedChart,
	Line,
	ReferenceDot,
	ReferenceLine,
	XAxis,
	YAxis,
} from "recharts";
import { formatMoney, monthName, shortMonth } from "../format";
import { useReducedMotion } from "../motion";
import { formatCompact, type ReportTable } from "../reports";
import { ChartCard, MoneyTooltip } from "./report-charts";
import { TermHelp } from "./term-help";

// Explore's outcome charts (ADR-0013): the Plan against the Scenario, on #40's chart wrapper.
// The Plan is always the quiet reference (ghost bars, dashed lines), the Scenario the one solid
// series in the brand colour; the over colour only where money runs out. Hovering a month (or
// tapping it on a phone) says what the Scenario changed that month and why. Every chart has its
// table, and the charts animate as Changes change unless the Parent asked for less motion.

/** Everything a chart needs to explain a month: the projections and the changes behind them. */
export type Outcome = {
	plan: Projection;
	scenario: Projection;
	levers: readonly ScenarioChange[];
	impacts: readonly ScenarioChangeImpact[];
	/** A Change of `levers` in words, by index. */
	describe: (index: number) => string;
};

const OutcomeContext = createContext<Outcome | null>(null);

/** Provides the projections every chart below explains its months by. */
export function OutcomeProvider({ value, children }: { value: Outcome; children: ReactNode }) {
	return <OutcomeContext value={value}>{children}</OutcomeContext>;
}

function useOutcome(): Outcome {
	const outcome = use(OutcomeContext);
	if (!outcome) throw new Error("Outcome charts need an OutcomeProvider");
	return outcome;
}

function useAnimation() {
	const reduced = useReducedMotion();
	return {
		isAnimationActive: !reduced,
		animationDuration: 450,
		animationEasing: "ease-out" as const,
	};
}

const axisProps = { tickLine: false, axisLine: false, tickMargin: 8, fontSize: 11 } as const;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Mar" within a year; "Mar ’27" further out. */
const tickMonth = (count: number) => (month: string) => {
	const name = MONTHS[Number(month.slice(5, 7)) - 1] ?? month;
	return count <= 12 ? name : `${name} ’${month.slice(2, 4)}`;
};

const signed = (cents: Cents) => (cents > 0 ? `+${formatMoney(cents)}` : formatMoney(cents));

/**
 * A money axis on round steps (1, 2, 2.5 or 5 times a power of ten) that always shows zero:
 * "$0 $1k $2k $3k" rather than Recharts' "$0 $750 $1.5k $2.3k".
 */
function moneyAxis(low: Cents, high: Cents, count = 4) {
	const lo = Math.min(0, low);
	const hi = Math.max(0, high);
	const raw = Math.max(hi - lo, 100_00) / count;
	const power = 10 ** Math.floor(Math.log10(raw));
	const step = [1, 2, 2.5, 5].map((m) => m * power).find((s) => s >= raw) ?? 10 * power;
	const start = Math.floor(lo / step) * step;
	const end = Math.ceil(hi / step) * step;
	const ticks: Cents[] = [];
	for (let tick = start; tick <= end; tick += step) ticks.push(Math.round(tick));
	return { domain: [start, end] as [number, number], ticks };
}

/** Legend keys drawn like their marks: a solid line, a dashed one, a ring. */
function lineKey(color: string, dashed = false) {
	return function LineKey() {
		return (
			<svg viewBox="0 0 14 12" aria-hidden="true" className="h-3 w-3.5!">
				<line
					x1={1}
					x2={13}
					y1={6}
					y2={6}
					stroke={color}
					strokeWidth={2}
					strokeLinecap="round"
					strokeDasharray={dashed ? "3 2.5" : undefined}
				/>
			</svg>
		);
	};
}
const ScenarioKey = lineKey("var(--chart-income)");
const PlanKey = lineKey("var(--subtle-foreground)", true);
function OneOffKey() {
	return (
		<svg viewBox="0 0 12 12" aria-hidden="true">
			<circle cx={6} cy={6} r={3.5} fill="none" stroke="var(--foreground)" strokeWidth={1.5} />
		</svg>
	);
}

/** The tooltip above neighbouring cards and legends, free to run past the chart's bottom edge. */
const tooltipProps = {
	wrapperStyle: { zIndex: 30 },
	allowEscapeViewBox: { x: false, y: true },
} as const;

const monthLong = (month: MonthKey) => `${monthName(month)} ${month.slice(0, 4)}`;

/** A month in full: the Plan against the Scenario, line by line, and the changes behind it. */
function MonthDetail({ breakdown }: { breakdown: MonthBreakdown }) {
	const { levers, describe } = useOutcome();
	const lines = (
		[
			["Income", "baseline"],
			["Commitments", "commitments"],
			["Allowances", "allowances"],
			["Goal funding", "goalFunding"],
			["One-offs", "oneOffs"],
			["Free to Spend", "freeToSpend"],
			["Projected balance", "cushion"],
		] as const
	).filter(
		([, key]) =>
			key === "freeToSpend" || key === "cushion" || breakdown.plan[key] !== breakdown.scenario[key],
	);
	return (
		<div className="grid gap-2 text-xs">
			<Table dense>
				<TableCaption>{monthLong(breakdown.month)}</TableCaption>
				<TableHeader className="sr-only">
					<TableRow>
						<TableHead>Line</TableHead>
						<TableHead>Plan</TableHead>
						<TableHead>Scenario</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{lines.map(([label, key]) => (
						<TableRow key={key}>
							<TableHead scope="row">{label}</TableHead>
							<TableCell numeric className="text-muted-foreground">
								{formatMoney(breakdown.plan[key])}
							</TableCell>
							<TableCell
								numeric
								className={cn(
									"font-medium text-foreground",
									breakdown.scenario[key] < 0 && (key === "freeToSpend" || key === "cushion")
										? "text-over"
										: null,
								)}
							>
								{formatMoney(breakdown.scenario[key])}
							</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
			{levers.length > 0 ? (
				<div className="grid gap-1 border-t pt-2">
					<p className="font-medium text-muted-foreground">
						{breakdown.changes.length > 0 ? "Why" : "No change of yours this month"}
					</p>
					{breakdown.changes.length > 0 ? (
						<ul className="grid gap-1">
							{breakdown.changes.map((change) => {
								const effect = [
									change.freeToSpend !== 0 ? `${signed(change.freeToSpend)} Free to Spend` : null,
									change.oneOffs !== 0 ? `${signed(change.oneOffs)} one-off` : null,
								].filter(Boolean);
								return (
									<li key={change.lever} className="grid">
										<span className="text-foreground">{describe(change.lever)}</span>
										<span className="text-muted-foreground tabular-nums">
											{effect.length > 0 ? effect.join(" · ") : "In play, no change this month"}
										</span>
									</li>
								);
							})}
						</ul>
					) : null}
				</div>
			) : null}
		</div>
	);
}

/** The month breakdown for a month key, from the projections in context. */
function useBreakdown() {
	const outcome = useOutcome();
	return useCallback(
		(month: string) => {
			const index = outcome.scenario.months.findIndex((m) => m.month === month);
			return index < 0 ? null : monthBreakdown({ ...outcome, index });
		},
		[outcome],
	);
}

/** The hover tooltip: the month in full. */
function BreakdownTooltip({ active, label }: { active?: boolean; label?: string | number }) {
	const breakdownOf = useBreakdown();
	const breakdown = active && label !== undefined ? breakdownOf(String(label)) : null;
	if (!breakdown) return null;
	return (
		<div className="w-72 max-w-[80vw] rounded-xl border bg-popover px-3 py-2.5 shadow-pop">
			<MonthDetail breakdown={breakdown} />
		</div>
	);
}

/**
 * Hover on a pointer, tap on touch: a mouse reads a month in the tooltip, a finger taps a month
 * and reads it under the chart (a tooltip under a finger can't be read). On touch the tooltip
 * follows taps rather than hover, so the month it lands on is the one tapped.
 */
function useMonthReveal() {
	const [touch, setTouch] = useState(false);
	const [month, setMonth] = useState<string | null>(null);
	const onPointerDownCapture = useCallback((event: ReactPointerEvent) => {
		setTouch(event.pointerType === "touch");
	}, []);
	const tooltip = touch ? <TapCatcher onPick={setMonth} /> : <BreakdownTooltip />;
	return {
		onPointerDownCapture,
		tooltip,
		trigger: touch ? ("click" as const) : ("hover" as const),
		month,
		close: () => setMonth(null),
	};
}

/** On touch, in the tooltip's place: shows nothing, and hands on the month tapped. */
function TapCatcher({
	onPick,
	active,
	label,
}: {
	onPick: (month: string) => void;
	active?: boolean;
	label?: string | number;
}) {
	useEffect(() => {
		if (active && label !== undefined) onPick(String(label));
	}, [onPick, active, label]);
	return null;
}

/** A tapped month, under its chart. */
function TappedMonth({ month, onClose }: { month: string | null; onClose: () => void }) {
	const breakdownOf = useBreakdown();
	const breakdown = month ? breakdownOf(month) : null;
	if (!breakdown) return null;
	return (
		<div className="relative rounded-xl bg-surface-2 px-3 py-2.5">
			<Button
				type="button"
				variant="ghost"
				size="icon-sm"
				className="absolute top-1 right-1 z-10 text-muted-foreground"
				onClick={onClose}
			>
				<X />
				<span className="sr-only">Close {monthLong(breakdown.month)}</span>
			</Button>
			<MonthDetail breakdown={breakdown} />
		</div>
	);
}

const monthTable = (
	title: string,
	columns: string[],
	rows: (string | number | null)[][],
): ReportTable => ({
	title,
	columns: [
		{ label: "Month", kind: "text" },
		...columns.map((label) => ({ label, kind: "money" as const })),
	],
	rows,
});

/** Free to Spend each month: the Plan as ghost bars, the Scenario as a line over them. */
export function FreeToSpendChart({ title }: { title: string }) {
	const { plan, scenario } = useOutcome();
	const animation = useAnimation();
	const reveal = useMonthReveal();
	const rows = scenario.months.map((m, i) => ({
		month: m.month,
		plan: plan.months[i]?.freeToSpend ?? 0,
		scenario: m.freeToSpend,
	}));
	const negative = rows.some((r) => r.plan < 0 || r.scenario < 0);
	const values = rows.flatMap((r) => [r.plan, r.scenario]);
	const y = moneyAxis(Math.min(...values), Math.max(...values));
	// The Scenario's line turns the over colour below zero (placed on the line's own box).
	const gradient = useId().replace(/:/g, "");
	const high = Math.max(...rows.map((r) => r.scenario));
	const low = Math.min(...rows.map((r) => r.scenario));
	const zero = high <= 0 ? 0 : low >= 0 ? 1 : high / (high - low);
	const stroke =
		high === low ? (high < 0 ? "var(--over)" : "var(--color-scenario)") : `url(#${gradient})`;
	const config = {
		plan: { label: "Plan", color: "var(--chart-compare)" },
		scenario: { label: "Scenario", color: "var(--chart-income)", icon: ScenarioKey },
	} satisfies ChartConfig;
	const table = monthTable(
		title,
		["Plan", "Scenario", "Difference"],
		rows.map((r) => [shortMonth(r.month), r.plan, r.scenario, r.scenario - r.plan]),
	);
	return (
		<ChartCard
			title={title}
			description="The Plan against this Scenario"
			table={table}
			className="overflow-visible"
		>
			<ChartContainer
				config={config}
				className="aspect-auto h-56 w-full"
				onPointerDownCapture={reveal.onPointerDownCapture}
			>
				<ComposedChart data={rows} barCategoryGap="18%" accessibilityLayer>
					<defs>
						<linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
							<stop offset={zero} stopColor="var(--color-scenario)" />
							<stop offset={zero} stopColor="var(--over)" />
						</linearGradient>
					</defs>
					<CartesianGrid vertical={false} stroke="var(--chart-grid)" />
					<XAxis
						dataKey="month"
						tickFormatter={tickMonth(rows.length)}
						interval="preserveStart"
						minTickGap={18}
						{...axisProps}
					/>
					<YAxis
						tickFormatter={formatCompact}
						width={52}
						domain={y.domain}
						ticks={y.ticks}
						{...axisProps}
					/>
					<ChartTooltip
						cursor={{ fill: "var(--surface-2)" }}
						content={reveal.tooltip}
						trigger={reveal.trigger}
						{...tooltipProps}
					/>
					<ChartLegend content={<ChartLegendContent />} />
					{negative ? <ReferenceLine y={0} stroke="var(--border-strong)" /> : null}
					<Bar dataKey="plan" name="Plan" fill="var(--color-plan)" radius={2} {...animation} />
					<Line
						dataKey="scenario"
						name="Scenario"
						type="linear"
						stroke={stroke}
						strokeWidth={2}
						dot={false}
						activeDot={{ r: 4, fill: "var(--color-scenario)", stroke: "var(--card)" }}
						{...animation}
					/>
				</ComposedChart>
			</ChartContainer>
			<TappedMonth month={reveal.month} onClose={reveal.close} />
		</ChartCard>
	);
}

/**
 * The Projected balance month by month: the Scenario as a filled area that turns the over colour below
 * zero, the Plan as a dashed line, and the Scenario's lowest point marked.
 */
export function ProjectedBalanceChart() {
	const { plan, scenario } = useOutcome();
	const animation = useAnimation();
	const reveal = useMonthReveal();
	const gradient = useId().replace(/:/g, "");
	const rows = scenario.months.map((m, i) => ({
		month: m.month,
		plan: plan.months[i]?.cushion ?? 0,
		scenario: m.cushion,
	}));
	const values = rows.flatMap((r) => [r.plan, r.scenario]);
	const max = Math.max(...values);
	const min = Math.min(...values);
	const lowest = scenario.lowest;
	const lowestIndex = lowest ? rows.findIndex((r) => r.month === lowest.month) : -1;
	// Below zero, the lowest point's label goes under it: leave it room there.
	const axis = moneyAxis(min, max, 5);
	const room = (axis.domain[1] - axis.domain[0]) * 0.1;
	const y =
		min < 0 && min - axis.domain[0] < room
			? { ...axis, domain: [min - room, axis.domain[1]] as [number, number] }
			: axis;
	// Where zero falls down the Scenario's area, for it to turn the over colour there. A gradient
	// stretches over its mark's own box, not the chart's, so it's placed by the Scenario alone.
	const high = Math.max(...rows.map((r) => r.scenario));
	const low = Math.min(...rows.map((r) => r.scenario));
	const zero = high <= 0 ? 0 : low >= 0 ? 1 : high / (high - low);
	const config = {
		scenario: { label: "Scenario", color: "var(--chart-income)", icon: ScenarioKey },
		plan: { label: "Plan", color: "var(--subtle-foreground)", icon: PlanKey },
	} satisfies ChartConfig;
	const table = monthTable(
		"Projected balance",
		["Plan", "Scenario"],
		rows.map((r) => [shortMonth(r.month), r.plan, r.scenario]),
	);
	return (
		<ChartCard
			title="Projected balance"
			description="What’s left month by month if you spend what’s planned, starting from $0 today"
			actions={<TermHelp term="projected-balance" />}
			table={table}
			className="overflow-visible"
		>
			<ChartContainer
				config={config}
				className="aspect-auto h-56 w-full"
				onPointerDownCapture={reveal.onPointerDownCapture}
			>
				<ComposedChart
					data={rows}
					margin={{ top: 8, right: 8, bottom: 8, left: 0 }}
					accessibilityLayer
				>
					<defs>
						<linearGradient id={`${gradient}-fill`} x1="0" y1="0" x2="0" y2="1">
							<stop offset={0} stopColor="var(--chart-income)" stopOpacity={0.22} />
							<stop offset={zero} stopColor="var(--chart-income)" stopOpacity={0.03} />
							<stop offset={zero} stopColor="var(--over)" stopOpacity={0.1} />
							<stop offset={1} stopColor="var(--over)" stopOpacity={0.3} />
						</linearGradient>
						<linearGradient id={`${gradient}-stroke`} x1="0" y1="0" x2="0" y2="1">
							<stop offset={zero} stopColor="var(--chart-income)" />
							<stop offset={zero} stopColor="var(--over)" />
						</linearGradient>
					</defs>
					<CartesianGrid vertical={false} stroke="var(--chart-grid)" />
					<XAxis
						dataKey="month"
						tickFormatter={tickMonth(rows.length)}
						interval="preserveStart"
						minTickGap={18}
						{...axisProps}
					/>
					<YAxis
						tickFormatter={formatCompact}
						width={52}
						domain={y.domain}
						ticks={y.ticks}
						{...axisProps}
					/>
					<ChartTooltip
						cursor={{ stroke: "var(--border-strong)" }}
						content={reveal.tooltip}
						trigger={reveal.trigger}
						{...tooltipProps}
					/>
					<ChartLegend content={<ChartLegendContent />} />
					<ReferenceLine y={0} stroke="var(--border-strong)" />
					<Area
						dataKey="scenario"
						name="Scenario"
						type="linear"
						baseValue={0}
						fill={`url(#${gradient}-fill)`}
						// A flat line has no height for a gradient to stretch over.
						stroke={
							high === low
								? high < 0
									? "var(--over)"
									: "var(--chart-income)"
								: `url(#${gradient}-stroke)`
						}
						strokeWidth={2}
						activeDot={{ r: 4, fill: "var(--color-scenario)", stroke: "var(--card)" }}
						{...animation}
					/>
					<Line
						dataKey="plan"
						name="Plan"
						type="linear"
						stroke="var(--color-plan)"
						strokeWidth={1.5}
						strokeDasharray="4 3"
						dot={false}
						activeDot={false}
						{...animation}
					/>
					{lowest && lowestIndex >= 0 ? (
						<ReferenceDot
							x={lowest.month}
							y={lowest.amount}
							r={4}
							fill="var(--card)"
							stroke={lowest.amount < 0 ? "var(--over)" : "var(--foreground)"}
							strokeWidth={2}
							label={(props: { viewBox?: { x?: number; y?: number } }) => (
								<LowestLabel
									x={props.viewBox?.x ?? 0}
									y={props.viewBox?.y ?? 0}
									amount={lowest.amount}
									month={lowest.month}
									// Near an edge, the label reads away from it.
									anchor={
										lowestIndex < rows.length * 0.2
											? "start"
											: lowestIndex > rows.length * 0.8
												? "end"
												: "middle"
									}
								/>
							)}
						/>
					) : null}
				</ComposedChart>
			</ChartContainer>
			<TappedMonth month={reveal.month} onClose={reveal.close} />
		</ChartCard>
	);
}

function LowestLabel({
	x,
	y,
	amount,
	month,
	anchor,
}: {
	x: number;
	y: number;
	amount: Cents;
	month: MonthKey;
	anchor: "start" | "middle" | "end";
}) {
	// Below zero the point is at the bottom of the chart with room left under it; otherwise above.
	const below = amount < 0;
	return (
		<text
			// Under the point it lines up with it; beside it, it clears the dot.
			x={x + (anchor === "middle" ? 0 : (anchor === "start" ? 1 : -1) * (below ? -4 : 8))}
			y={below ? y + 18 : y - 10}
			textAnchor={anchor}
			className={cn("text-[11px] font-medium", below ? "fill-over" : "fill-foreground")}
			paintOrder="stroke"
			stroke="var(--card)"
			strokeWidth={4}
			strokeLinejoin="round"
		>
			Lowest {formatMoney(Math.round(amount / 100) * 100)} · {shortMonth(month)}
		</text>
	);
}

const PARTS = [
	{ key: "commitments", label: "Commitments", color: "var(--chart-spend)" },
	{
		key: "allowances",
		label: "Allowances",
		color: "color-mix(in oklab, var(--chart-spend) 42%, var(--card))",
	},
	{ key: "goalFunding", label: "Goal funding", color: "var(--chart-seq-2)" },
	{ key: "freeToSpend", label: "Free to Spend", color: "var(--chart-seq-4)" },
] as const;

/**
 * Each month's take-home pay split into what it's for, stacked, the Plan's or the Scenario's. One-offs
 * come out of the Projected balance, not take-home pay: they're marked above their month with their amount
 * rather than plotted to scale, where one big one would flatten every bar.
 */
export function CompositionChart() {
	const { plan, scenario } = useOutcome();
	const animation = useAnimation();
	const reveal = useMonthReveal();
	const [which, setWhich] = useState<"scenario" | "plan">("scenario");
	const projection = which === "plan" ? plan : scenario;
	const stacked = (m: (typeof projection.months)[number]) =>
		m.commitments + m.allowances + m.goalFunding + Math.max(0, m.freeToSpend);
	const rows = projection.months.map((m) => ({
		...m,
		oneOffMark: m.oneOffs === 0 ? null : stacked(m),
	}));
	const hasOneOffs = rows.some((r) => r.oneOffMark !== null);
	const tallest = Math.max(...rows.map(stacked));
	// Headroom over the bars for the one-off marks and their amounts.
	const y = moneyAxis(
		Math.min(...rows.map((r) => r.freeToSpend)),
		tallest * (hasOneOffs ? 1.2 : 1),
		5,
	);
	const config: ChartConfig = {
		...Object.fromEntries(PARTS.map((p) => [p.key, { label: p.label, color: p.color }])),
		...(hasOneOffs
			? { oneOffMark: { label: "One-offs", color: "var(--foreground)", icon: OneOffKey } }
			: {}),
	};
	const table = monthTable(
		`Each month, ${which === "plan" ? "the Plan" : "this Scenario"}`,
		["Income", ...PARTS.map((p) => p.label), "One-offs"],
		rows.map((r) => [
			shortMonth(r.month),
			r.baseline,
			r.commitments,
			r.allowances,
			r.goalFunding,
			r.freeToSpend,
			r.oneOffs,
		]),
	);
	return (
		<ChartCard
			title="Each month"
			description="Where take-home pay goes"
			table={table}
			className="overflow-visible"
			actions={
				<ToggleGroup
					type="single"
					variant="segmented"
					size="sm"
					aria-label="Show"
					value={which}
					onValueChange={(value) => setWhich(value as typeof which)}
				>
					<ToggleGroupItem value="plan">Plan</ToggleGroupItem>
					<ToggleGroupItem value="scenario">Scenario</ToggleGroupItem>
				</ToggleGroup>
			}
		>
			<ChartContainer
				config={config}
				className="aspect-auto h-56 w-full"
				onPointerDownCapture={reveal.onPointerDownCapture}
			>
				<ComposedChart data={rows} stackOffset="sign" barCategoryGap="16%" accessibilityLayer>
					<CartesianGrid vertical={false} stroke="var(--chart-grid)" />
					<XAxis
						dataKey="month"
						tickFormatter={tickMonth(rows.length)}
						interval="preserveStart"
						minTickGap={18}
						{...axisProps}
					/>
					<YAxis
						tickFormatter={formatCompact}
						width={52}
						domain={y.domain}
						ticks={y.ticks}
						{...axisProps}
					/>
					<ChartTooltip
						cursor={{ fill: "var(--surface-2)" }}
						content={reveal.tooltip}
						trigger={reveal.trigger}
						{...tooltipProps}
					/>
					<ChartLegend content={<ChartLegendContent />} />
					<ReferenceLine y={0} stroke="var(--border-strong)" />
					{PARTS.map((part) => (
						<Bar
							key={part.key}
							dataKey={part.key}
							name={part.label}
							stackId="month"
							fill={`var(--color-${part.key})`}
							{...animation}
						>
							{/* Free to Spend below zero is money that isn't there: the over colour. */}
							{part.key === "freeToSpend"
								? rows.map((r) => (
										<Cell
											key={r.month}
											fill={r.freeToSpend < 0 ? "var(--over)" : "var(--color-freeToSpend)"}
										/>
									))
								: null}
						</Bar>
					))}
					{hasOneOffs ? (
						<Line
							dataKey="oneOffMark"
							name="One-offs"
							stroke="none"
							connectNulls={false}
							dot={<OneOffMark />}
							activeDot={false}
							{...animation}
						/>
					) : null}
				</ComposedChart>
			</ChartContainer>
			<TappedMonth month={reveal.month} onClose={reveal.close} />
		</ChartCard>
	);
}

/** A one-off over its month's bar: a ring, and its amount above it. */
function OneOffMark({
	cx,
	cy,
	payload,
}: {
	cx?: number;
	cy?: number;
	payload?: { oneOffs: Cents };
}) {
	if (cx === undefined || cy === undefined || !payload?.oneOffs) return null;
	const amount = payload.oneOffs;
	return (
		<g>
			<circle
				cx={cx}
				cy={cy - 8}
				r={3.5}
				fill="var(--card)"
				stroke="var(--foreground)"
				strokeWidth={1.5}
			/>
			<text
				x={cx}
				y={cy - 17}
				textAnchor="middle"
				className="fill-foreground text-[10px] font-medium tabular-nums"
				paintOrder="stroke"
				stroke="var(--card)"
				strokeWidth={3}
				strokeLinejoin="round"
			>
				{amount > 0 ? `+${formatCompact(amount)}` : formatCompact(amount)}
			</text>
		</g>
	);
}

/**
 * Each Goal's set-aside money over the months, one small chart per Goal: the Plan dashed, the Scenario
 * solid, the target as a line and the month it's reached marked. Added Goals have no Plan line.
 */
export function GoalPathsChart({ names }: { names: ReadonlyMap<string, string> }) {
	const { plan, scenario } = useOutcome();
	const goals = scenario.goals;
	const nameOf = (id: string) => names.get(id) ?? "Goal";
	const table = monthTable(
		"Goal paths",
		goals.flatMap((g) => {
			const planned = plan.goals.some((p) => p.goalId === g.goalId);
			return planned ? [`${nameOf(g.goalId)} (Plan)`, nameOf(g.goalId)] : [nameOf(g.goalId)];
		}),
		scenario.months.map((m, i) => [
			shortMonth(m.month),
			...goals.flatMap((g) => {
				const planned = plan.goals.find((p) => p.goalId === g.goalId);
				const now = g.earmarks[i] ?? null;
				return planned ? [planned.earmarks[i] ?? null, now] : [now];
			}),
		]),
	);
	return (
		<ChartCard
			title="Goal paths"
			description="How much each Goal has set aside, or paid down on its card or loan, over time. Dashed: the Plan as it is."
			table={table}
			className="overflow-visible"
		>
			{/* As many small charts per row as fit (3 at 1280+ on a desktop), never one squeezed below 13rem. */}
			<div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,13rem),1fr))] gap-5">
				{goals.map((goal) => (
					<GoalPath key={goal.goalId} name={nameOf(goal.goalId)} goalId={goal.goalId} />
				))}
			</div>
		</ChartCard>
	);
}

function GoalPath({ name, goalId }: { name: string; goalId: string }) {
	const { plan, scenario } = useOutcome();
	const animation = useAnimation();
	const reveal = useMonthReveal();
	const goal = scenario.goals.find((g) => g.goalId === goalId);
	const planned = plan.goals.find((g) => g.goalId === goalId);
	if (!goal) return null;
	const rows = scenario.months.map((m, i) => ({
		month: m.month,
		plan: planned ? (planned.earmarks[i] ?? null) : null,
		scenario: goal.earmarks[i] ?? 0,
	}));
	const y = moneyAxis(
		0,
		Math.max(goal.target, ...rows.map((r) => Math.max(r.scenario, r.plan ?? 0))),
		3,
	);
	const config: ChartConfig = {
		scenario: { label: "Scenario", color: "var(--chart-income)" },
		...(planned ? { plan: { label: "Plan", color: "var(--subtle-foreground)" } } : {}),
	};
	const reached = (month: MonthKey | null) =>
		month ? `Reached ${shortMonth(month)}` : "Not reached yet";
	return (
		<figure className="grid min-w-0 gap-1">
			<figcaption className="flex items-baseline justify-between gap-x-2 text-[13px]">
				{/* One line, so a long name doesn't push its chart below its neighbour's. */}
				<span className="min-w-0 truncate font-medium" title={name}>
					{name}
					{goal.added ? <span className="font-normal text-muted-foreground"> · new</span> : null}
				</span>
				<span className="shrink-0 text-muted-foreground tabular-nums">
					{reached(goal.reachedIn)}
					{planned && planned.reachedIn !== goal.reachedIn
						? ` (Plan: ${planned.reachedIn ? shortMonth(planned.reachedIn) : "not reached yet"})`
						: null}
				</span>
			</figcaption>
			<ChartContainer
				config={config}
				className="aspect-auto h-40 w-full"
				onPointerDownCapture={reveal.onPointerDownCapture}
			>
				<ComposedChart
					data={rows}
					margin={{ top: 14, right: 8, bottom: 0, left: 0 }}
					accessibilityLayer
				>
					<CartesianGrid vertical={false} stroke="var(--chart-grid)" />
					<XAxis
						dataKey="month"
						tickFormatter={tickMonth(rows.length)}
						interval="preserveStart"
						minTickGap={24}
						{...axisProps}
					/>
					<YAxis
						tickFormatter={formatCompact}
						width={48}
						domain={y.domain}
						ticks={y.ticks}
						{...axisProps}
					/>
					<ChartTooltip
						cursor={{ stroke: "var(--border-strong)" }}
						content={reveal.tooltip}
						trigger={reveal.trigger}
						{...tooltipProps}
					/>
					<ReferenceLine
						y={goal.target}
						stroke="var(--foreground)"
						strokeOpacity={0.5}
						strokeDasharray="2 3"
						label={{
							value: `Target ${formatCompact(goal.target)}`,
							position: "insideTopLeft",
							fontSize: 11,
							fill: "var(--muted-foreground)",
							offset: 4,
							dy: -14,
						}}
					/>
					{planned ? (
						<Line
							dataKey="plan"
							name="Plan"
							type="linear"
							stroke="var(--color-plan)"
							strokeWidth={1.5}
							strokeDasharray="4 3"
							dot={false}
							activeDot={false}
							{...animation}
						/>
					) : null}
					<Line
						dataKey="scenario"
						name="Scenario"
						type="linear"
						stroke="var(--color-scenario)"
						strokeWidth={2}
						dot={false}
						activeDot={{ r: 4, fill: "var(--color-scenario)", stroke: "var(--card)" }}
						{...animation}
					/>
					{goal.reachedIn ? (
						<ReferenceDot
							x={goal.reachedIn}
							y={goal.target}
							r={4}
							fill="var(--chart-income)"
							stroke="var(--card)"
							strokeWidth={2}
						/>
					) : null}
				</ComposedChart>
			</ChartContainer>
			<TappedMonth month={reveal.month} onClose={reveal.close} />
		</figure>
	);
}

/** The outcome charts below the Free to Spend one: the Projected balance, each month, and Goal paths. */
export default function ScenarioOutcomes({
	outcome,
	goalNames,
}: {
	outcome: Outcome;
	goalNames: ReadonlyMap<string, string>;
}) {
	const hasGoals = outcome.scenario.goals.length > 0;
	return (
		<OutcomeProvider value={outcome}>
			<ProjectedBalanceChart />
			<CompositionChart />
			{hasGoals ? <GoalPathsChart names={goalNames} /> : null}
		</OutcomeProvider>
	);
}

/**
 * Every outcome chart as Tabs (Free to Spend, Projected balance, each month, Goal paths), so they
 * fit beside the Changes in one pane: one chart at a time, each the same size.
 */
export function OutcomeTabs({
	outcome,
	goalNames,
}: {
	outcome: Outcome;
	goalNames: ReadonlyMap<string, string>;
}) {
	const hasGoals = outcome.scenario.goals.length > 0;
	return (
		<OutcomeProvider value={outcome}>
			<Tabs defaultValue="free-to-spend" className="grid-cols-[minmax(0,1fr)]">
				<TabsList aria-label="Charts">
					<TabsTrigger value="free-to-spend">Free to Spend</TabsTrigger>
					<TabsTrigger value="projected-balance">Projected balance</TabsTrigger>
					<TabsTrigger value="each-month">Each month</TabsTrigger>
					{hasGoals ? <TabsTrigger value="goal-paths">Goal paths</TabsTrigger> : null}
				</TabsList>
				<TabsContent value="free-to-spend">
					<FreeToSpendChart title="Free to Spend each month" />
				</TabsContent>
				<TabsContent value="projected-balance">
					<ProjectedBalanceChart />
				</TabsContent>
				<TabsContent value="each-month">
					<CompositionChart />
				</TabsContent>
				{hasGoals ? (
					<TabsContent value="goal-paths">
						<GoalPathsChart names={goalNames} />
					</TabsContent>
				) : null}
			</Tabs>
		</OutcomeProvider>
	);
}

/** Free to Spend each month, on its own: it sits beside the Changes, where it stays in view. */
export function FreeToSpendOutcome({ outcome, title }: { outcome: Outcome; title: string }) {
	return (
		<OutcomeProvider value={outcome}>
			<FreeToSpendChart title={title} />
		</OutcomeProvider>
	);
}

/**
 * Compare's series, in turn: blue, orange-brown and purple from the colour-blind validated Bucket
 * palette (as Reports' Goals), so up to three Scenarios stay apart from each other and from the
 * Plan's grey dashed line.
 */
const COMPARED = [
	{ color: "var(--bucket-1)", dashed: false },
	{ color: "var(--bucket-7)", dashed: false },
	{ color: "var(--bucket-2)", dashed: false },
] as const;

/**
 * Up to three Scenarios month by month against the Plan, one line each (Compare): the Plan is the
 * quiet dashed reference, as on Explore's charts.
 */
export function CompareChart({
	title,
	description,
	months,
	plan,
	scenarios,
}: {
	title: string;
	description: string;
	months: readonly MonthKey[];
	plan: readonly Cents[];
	scenarios: readonly { id: string; name: string; values: readonly Cents[] }[];
}) {
	const animation = useAnimation();
	const shown = scenarios.slice(0, COMPARED.length);
	const rows = months.map((month, i) => ({
		month,
		plan: plan[i] ?? 0,
		...Object.fromEntries(shown.map((s, n) => [`s${n}`, s.values[i] ?? 0])),
	}));
	const values = [...plan, ...shown.flatMap((s) => s.values)];
	const y = moneyAxis(Math.min(...values), Math.max(...values));
	const config: ChartConfig = {
		plan: { label: "Plan", color: "var(--subtle-foreground)", icon: PlanKey },
		...Object.fromEntries(
			shown.map((s, n) => {
				const { color, dashed } = COMPARED[n] ?? COMPARED[0];
				return [`s${n}`, { label: s.name, color, icon: lineKey(color, dashed) }];
			}),
		),
	};
	const table = monthTable(
		title,
		["Plan", ...shown.map((s) => s.name)],
		rows.map((r, i) => [shortMonth(r.month), r.plan, ...shown.map((s) => s.values[i] ?? 0)]),
	);
	return (
		<ChartCard title={title} description={description} table={table} className="overflow-visible">
			<ChartContainer config={config} className="aspect-auto h-56 w-full">
				<ComposedChart data={rows} accessibilityLayer>
					<CartesianGrid vertical={false} stroke="var(--chart-grid)" />
					<XAxis
						dataKey="month"
						tickFormatter={tickMonth(rows.length)}
						interval="preserveStart"
						minTickGap={18}
						{...axisProps}
					/>
					<YAxis
						tickFormatter={formatCompact}
						width={52}
						domain={y.domain}
						ticks={y.ticks}
						{...axisProps}
					/>
					<ChartTooltip
						content={<MoneyTooltip labelOf={(month) => monthLong(month as MonthKey)} />}
						{...tooltipProps}
					/>
					<ChartLegend itemSorter={null} content={<ChartLegendContent />} />
					{values.some((v) => v < 0) ? <ReferenceLine y={0} stroke="var(--border-strong)" /> : null}
					<Line
						dataKey="plan"
						name="Plan"
						type="linear"
						stroke="var(--color-plan)"
						strokeWidth={1.5}
						strokeDasharray="4 3"
						dot={false}
						{...animation}
					/>
					{shown.map((s, n) => (
						<Line
							key={s.id}
							dataKey={`s${n}`}
							name={s.name}
							type="linear"
							stroke={`var(--color-s${n})`}
							strokeWidth={2}
							strokeDasharray={COMPARED[n]?.dashed ? "6 3" : undefined}
							dot={false}
							activeDot={{ r: 4, fill: `var(--color-s${n})`, stroke: "var(--card)" }}
							{...animation}
						/>
					))}
				</ComposedChart>
			</ChartContainer>
		</ChartCard>
	);
}
