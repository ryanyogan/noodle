import type { Cents, DayKey } from "@noodle/domain";
import { levelOf } from "@noodle/domain";
import { Card } from "@noodle/ui/components/card";
import {
	type ChartConfig,
	ChartContainer,
	ChartLegend,
	ChartLegendContent,
	ChartTooltip,
} from "@noodle/ui/components/chart";
import { RowButton } from "@noodle/ui/components/row-button";
import {
	Table,
	TableBody,
	TableCaption,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@noodle/ui/components/table";
import { Toggle } from "@noodle/ui/components/toggle";
import { WithTooltip } from "@noodle/ui/components/tooltip";
import { cn } from "@noodle/ui/lib/utils";
import { Table2 } from "lucide-react";
import {
	type KeyboardEvent as ReactKeyboardEvent,
	type ReactNode,
	type PointerEvent as ReactPointerEvent,
	useCallback,
	useEffect,
	useId,
	useRef,
	useState,
} from "react";
import {
	Bar,
	BarChart,
	CartesianGrid,
	Cell,
	ComposedChart,
	Line,
	Pie,
	PieChart,
	Sankey,
	Treemap,
	XAxis,
	YAxis,
} from "recharts";
import { formatMoney, shortDay } from "../format";
import { useReducedMotion } from "../motion";
import { formatCell, formatCompact, type ReportTable } from "../reports";

// Reports' charts (ADR-0013): Recharts through the shadcn wrapper in @noodle/ui, and plain
// HTML/SVG where a chart is really a grid (heatmaps) or a ranked list. Colour follows the neutral
// system: ink for spending, the brand for income, a ghost tone for comparison, Bucket colours only
// for Buckets. Every mark drills down; on touch the first tap reveals its tooltip, the second
// drills. Each chart sits in a ChartCard whose table view is its text alternative.

/** Motion props for a Recharts series: a quick ease-out draw, or none. */
function useAnimation() {
	const reduced = useReducedMotion();
	return {
		isAnimationActive: !reduced,
		animationDuration: 650,
		animationEasing: "ease-out" as const,
	};
}

/**
 * Tap to reveal on touch: the first tap on a mark shows its tooltip, a second tap on the same
 * mark drills. A mouse or keyboard drills at once (hover already revealed it).
 */
function useTapToReveal<T>(onSelect: ((key: T) => void) | undefined) {
	const pointer = useRef<string>("mouse");
	const [revealed, setRevealed] = useState<T | null>(null);
	const onPointerDownCapture = useCallback((event: ReactPointerEvent) => {
		pointer.current = event.pointerType;
	}, []);
	const select = useCallback(
		(key: T) => {
			if (!onSelect) return;
			if (pointer.current === "touch" && revealed !== key) {
				setRevealed(key);
				return;
			}
			setRevealed(null);
			onSelect(key);
		},
		[onSelect, revealed],
	);
	return { onPointerDownCapture, select };
}

/** A tooltip: the mark's label, then each series' value with its swatch. */
export function MoneyTooltip({
	active,
	payload,
	label,
	labelOf,
}: {
	active?: boolean;
	payload?: readonly {
		name?: string | number;
		value?: unknown;
		color?: string;
		dataKey?: unknown;
		payload?: Record<string, unknown>;
	}[];
	label?: string | number;
	labelOf?: (label: string, payload: Record<string, unknown> | undefined) => ReactNode;
}) {
	if (!active || !payload?.length) return null;
	const first = payload[0]?.payload;
	return (
		<div className="grid min-w-36 gap-1.5 rounded-xl border bg-popover px-3 py-2 text-xs shadow-pop">
			<div className="font-medium text-foreground">
				{labelOf ? labelOf(String(label ?? ""), first) : label}
			</div>
			{payload.map((item) => (
				<div key={String(item.dataKey ?? item.name)} className="flex items-center gap-2">
					<span
						aria-hidden="true"
						className="size-2.5 shrink-0 rounded-[3px]"
						style={{ background: item.color }}
					/>
					<span className="text-muted-foreground">{item.name}</span>
					<span className="ms-auto font-medium tabular-nums text-foreground">
						{typeof item.value === "number" ? formatMoney(item.value) : String(item.value)}
					</span>
				</div>
			))}
		</div>
	);
}

/** A card holding one chart and, one tap away, its table (the chart's text alternative). */
export function ChartCard({
	title,
	description,
	table,
	actions,
	children,
	className,
}: {
	title: ReactNode;
	description?: ReactNode;
	table?: ReportTable;
	actions?: ReactNode;
	children: ReactNode;
	className?: string;
}) {
	const [asTable, setAsTable] = useState(false);
	const titleId = useId();
	return (
		<Card
			className={cn("grid min-w-0 content-start gap-4 p-(--card-pad)", className)}
			aria-labelledby={titleId}
			role="group"
		>
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div className="grid min-w-0 flex-1 basis-40 gap-0.5">
					<h2 id={titleId} className="text-sm font-semibold">
						{title}
					</h2>
					{description ? <p className="text-[13px] text-muted-foreground">{description}</p> : null}
				</div>
				<div className="ms-auto flex shrink-0 items-center gap-1">
					{actions}
					{table ? (
						<Toggle
							size="sm"
							aria-label={`Show ${title} as a table`}
							pressed={asTable}
							onPressedChange={setAsTable}
						>
							<Table2 />
						</Toggle>
					) : null}
				</div>
			</div>
			{asTable && table ? <DataTable table={table} /> : children}
		</Card>
	);
}

/** A ReportTable as an HTML table, money right-aligned in tabular figures. */
export function DataTable({ table, className }: { table: ReportTable; className?: string }) {
	const pad = "px-(--card-pad) first:ps-(--card-pad) last:pe-(--card-pad)";
	return (
		<div className={cn("-mx-(--card-pad)", className)}>
			<Table className="min-w-max">
				<TableCaption className="sr-only">{table.title}</TableCaption>
				<TableHeader>
					<TableRow>
						{table.columns.map((column, i) => (
							<TableHead
								key={column.label}
								scope="col"
								numeric={i > 0 && column.kind !== "text"}
								className={pad}
							>
								{column.label}
							</TableHead>
						))}
					</TableRow>
				</TableHeader>
				<TableBody>
					{table.rows.map((row) => (
						<TableRow key={row.join("|")}>
							{row.map((value, i) => {
								const kind = table.columns[i]?.kind ?? "text";
								return (
									<TableCell
										key={table.columns[i]?.label ?? i}
										numeric={i > 0 && kind !== "text"}
										className={pad}
									>
										{formatCell(kind, value)}
									</TableCell>
								);
							})}
						</TableRow>
					))}
				</TableBody>
			</Table>
		</div>
	);
}

const axisProps = {
	tickLine: false,
	axisLine: false,
	tickMargin: 8,
	fontSize: 11,
} as const;

/**
 * Spending and income per period as paired bars, with what was left (income less spending) as a
 * line. One axis: all three are dollars.
 */
export function IncomeSpendChart({
	data,
	labelOf,
	onSelect,
	className,
}: {
	data: { period: string; spent: Cents; earned: Cents }[];
	labelOf: (period: string, style?: "short" | "long") => string;
	onSelect?: (period: string) => void;
	className?: string;
}) {
	const animation = useAnimation();
	const { onPointerDownCapture, select } = useTapToReveal(onSelect);
	const rows = data.map((d) => ({ ...d, net: d.earned - d.spent }));
	const config = {
		spent: { label: "Spent", color: "var(--chart-spend)" },
		earned: { label: "Earned", color: "var(--chart-income)" },
		net: { label: "Left over", color: "var(--chart-net)" },
	} satisfies ChartConfig;
	return (
		<ChartContainer
			config={config}
			className={cn(
				"aspect-auto h-64 w-full lg:h-72",
				onSelect && "[&_.recharts-bar-rectangle]:cursor-pointer",
				className,
			)}
			onPointerDownCapture={onPointerDownCapture}
		>
			<ComposedChart data={rows} barGap={2} barCategoryGap="22%" accessibilityLayer>
				<CartesianGrid vertical={false} stroke="var(--chart-grid)" />
				<XAxis dataKey="period" tickFormatter={(p) => labelOf(p)} {...axisProps} minTickGap={12} />
				<YAxis tickFormatter={formatCompact} width={52} {...axisProps} />
				<ChartTooltip
					cursor={{ fill: "var(--surface-2)" }}
					content={<MoneyTooltip labelOf={(p) => labelOf(p, "long")} />}
				/>
				<ChartLegend content={<ChartLegendContent />} />
				<Bar
					dataKey="earned"
					name="Earned"
					fill="var(--color-earned)"
					radius={[4, 4, 0, 0]}
					onClick={(bar) => select((bar.payload as { period: string }).period)}
					{...animation}
				/>
				<Bar
					dataKey="spent"
					name="Spent"
					fill="var(--color-spent)"
					radius={[4, 4, 0, 0]}
					onClick={(bar) => select((bar.payload as { period: string }).period)}
					{...animation}
				/>
				<Line
					dataKey="net"
					name="Left over"
					type="monotone"
					stroke="var(--color-net)"
					strokeWidth={2}
					strokeDasharray="4 3"
					dot={{ r: 2.5, fill: "var(--card)", strokeWidth: 2 }}
					activeDot={{ r: 4 }}
					{...animation}
				/>
			</ComposedChart>
		</ChartContainer>
	);
}

/**
 * Spending per period as bars, the comparison period as ghost bars behind them (matched by
 * position), and the selected period, if any, in full ink with the rest receded.
 */
export function PeriodBars({
	data,
	previous,
	selected,
	labelOf,
	onSelect,
	stacked,
	className,
}: {
	data: { period: string; amount: Cents }[];
	previous?: { period: string; amount: Cents }[] | null;
	selected?: string;
	labelOf: (period: string, style?: "short" | "long") => string;
	onSelect?: (period: string) => void;
	/** Two stacked series instead (e.g. recurring and one-off). */
	stacked?: {
		rows: Record<string, number | string>[];
		series: { key: string; label: string; color: string }[];
	};
	className?: string;
}) {
	const animation = useAnimation();
	const { onPointerDownCapture, select } = useTapToReveal(onSelect);
	const rows =
		stacked?.rows ??
		data.map((d, i) => ({
			...d,
			previous: previous?.[i]?.amount ?? null,
			previousPeriod: previous?.[i]?.period,
		}));
	const config: ChartConfig = stacked
		? Object.fromEntries(stacked.series.map((s) => [s.key, { label: s.label, color: s.color }]))
		: {
				amount: { label: "Spent", color: "var(--chart-spend)" },
				previous: { label: "Comparison", color: "var(--chart-compare)" },
			};
	const onBar = (bar: { payload?: unknown }) => select((bar.payload as { period: string }).period);
	return (
		<ChartContainer
			config={config}
			className={cn(
				"aspect-auto h-56 w-full lg:h-64",
				onSelect && "[&_.recharts-bar-rectangle]:cursor-pointer",
				className,
			)}
			onPointerDownCapture={onPointerDownCapture}
		>
			<BarChart
				data={rows as Record<string, unknown>[]}
				barGap={2}
				barCategoryGap="24%"
				accessibilityLayer
			>
				<CartesianGrid vertical={false} stroke="var(--chart-grid)" />
				<XAxis dataKey="period" tickFormatter={(p) => labelOf(p)} {...axisProps} minTickGap={12} />
				<YAxis tickFormatter={formatCompact} width={52} {...axisProps} />
				<ChartTooltip
					cursor={{ fill: "var(--surface-2)" }}
					content={<MoneyTooltip labelOf={(p) => labelOf(p, "long")} />}
				/>
				{stacked ? (
					<>
						<ChartLegend content={<ChartLegendContent />} />
						{stacked.series.map((s, i) => (
							<Bar
								key={s.key}
								dataKey={s.key}
								name={s.label}
								stackId="stack"
								fill={`var(--color-${s.key})`}
								radius={i === stacked.series.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}
								onClick={onBar}
								{...animation}
							/>
						))}
					</>
				) : (
					<>
						{previous ? <ChartLegend content={<ChartLegendContent />} /> : null}
						{previous ? (
							<Bar
								dataKey="previous"
								name="Comparison"
								fill="var(--color-previous)"
								radius={[4, 4, 0, 0]}
								onClick={onBar}
								{...animation}
							/>
						) : null}
						<Bar
							dataKey="amount"
							name="Spent"
							fill="var(--color-amount)"
							radius={[4, 4, 0, 0]}
							onClick={onBar}
							{...animation}
						>
							{data.map((d) => (
								<Cell key={d.period} fillOpacity={selected && d.period !== selected ? 0.35 : 1} />
							))}
						</Bar>
					</>
				)}
			</BarChart>
		</ChartContainer>
	);
}

/**
 * A Bucket's months: its allowance as a ghost bar and what was spent in ink beside it, in the
 * over colour for a month that spent past what the Bucket had.
 */
export function AllowanceBars({
	rows,
	labelOf,
	className,
}: {
	rows: { period: string; allowance: Cents; spent: Cents; over: boolean }[];
	labelOf: (period: string, style?: "short" | "long") => string;
	className?: string;
}) {
	const animation = useAnimation();
	const config: ChartConfig = {
		allowance: { label: "Allowance", color: "var(--chart-allowance)" },
		spent: { label: "Spent", color: "var(--chart-spend)" },
	};
	const legend = [
		{ label: "Allowance", color: "var(--chart-allowance)" },
		{ label: "Spent", color: "var(--chart-spend)" },
		...(rows.some((row) => row.over) ? [{ label: "Over", color: "var(--over)" }] : []),
	];
	return (
		<ChartContainer config={config} className={cn("aspect-auto h-52 w-full", className)}>
			<BarChart data={rows} barGap={2} barCategoryGap="20%" accessibilityLayer>
				<CartesianGrid vertical={false} stroke="var(--chart-grid)" />
				<XAxis dataKey="period" tickFormatter={(p) => labelOf(p)} {...axisProps} minTickGap={4} />
				<YAxis tickFormatter={formatCompact} width={52} {...axisProps} />
				<ChartTooltip
					cursor={{ fill: "var(--surface-2)" }}
					content={<MoneyTooltip labelOf={(p) => labelOf(p, "long")} />}
				/>
				<ChartLegend
					content={() => (
						<div className="flex items-center justify-center gap-4 pt-3">
							{legend.map((item) => (
								<div key={item.label} className="flex items-center gap-1.5">
									<div
										className="size-2 shrink-0 rounded-[2px]"
										style={{ backgroundColor: item.color }}
									/>
									{item.label}
								</div>
							))}
						</div>
					)}
				/>
				<Bar
					dataKey="allowance"
					name="Allowance"
					fill="var(--color-allowance)"
					radius={[3, 3, 0, 0]}
					{...animation}
				/>
				<Bar
					dataKey="spent"
					name="Spent"
					fill="var(--color-spent)"
					radius={[3, 3, 0, 0]}
					{...animation}
				>
					{rows.map((row) => (
						<Cell key={row.period} fill={row.over ? "var(--over)" : "var(--color-spent)"} />
					))}
				</Bar>
			</BarChart>
		</ChartContainer>
	);
}

/** A small trend line with a soft fill, for a row or a small multiple; decorative (the row has the numbers). */
export function Sparkline({
	values,
	className,
	color = "var(--chart-spend)",
}: {
	values: number[];
	className?: string;
	color?: string;
}) {
	const id = useId().replace(/:/g, "");
	if (values.length < 2) return null;
	const max = Math.max(...values, 1);
	// Nothing before the first month with data: the line starts there rather than climbing from $0.
	const first = values.findIndex((v) => v !== 0);
	const from = first > 0 && values.length - first >= 2 ? first : 0;
	const points = values
		.map((v, i) => [(i / (values.length - 1)) * 100, 28 - (Math.max(v, 0) / max) * 26])
		.slice(from);
	const line = points.map(([x, y]) => `${x?.toFixed(2)},${y?.toFixed(2)}`).join(" ");
	const startX = points[0]?.[0]?.toFixed(2) ?? "0";
	return (
		<svg
			viewBox="0 0 100 30"
			preserveAspectRatio="none"
			className={cn("h-7 w-20 overflow-visible", className)}
			aria-hidden="true"
		>
			<defs>
				<linearGradient id={`spark-${id}`} x1="0" x2="0" y1="0" y2="1">
					<stop offset="0%" stopColor={color} stopOpacity={0.22} />
					<stop offset="100%" stopColor={color} stopOpacity={0} />
				</linearGradient>
			</defs>
			<polygon points={`${startX},30 ${line} 100,30`} fill={`url(#spark-${id})`} />
			<polyline
				points={line}
				fill="none"
				stroke={color}
				strokeWidth={1.5}
				strokeLinejoin="round"
				strokeLinecap="round"
				vectorEffect="non-scaling-stroke"
			/>
		</svg>
	);
}

export type Share = { key: string; label: string; amount: Cents; color: string };

/** Share of spend as a donut, the total in its hole; hovering one slice recedes the others. */
export function ShareDonut({
	data,
	total,
	onSelect,
	active,
}: {
	data: Share[];
	total: Cents;
	onSelect?: (key: string) => void;
	/** The share a list beside the donut points at (hovered or focused), shown in the centre. */
	active?: string | null;
}) {
	const animation = useAnimation();
	const [pointed, setHovered] = useState<string | null>(null);
	const { onPointerDownCapture, select } = useTapToReveal(onSelect);
	// A key outside the slices is part of "Everything else".
	const outside = active && !data.some((d) => d.key === active) ? "other" : active;
	const hovered = pointed ?? outside ?? null;
	const focus = data.find((d) => d.key === hovered);
	const other = data.find((d) => d.key === "other");
	return (
		<div className="grid w-full justify-items-center gap-3">
			<div
				className="relative mx-auto aspect-square w-full max-w-72"
				onPointerDownCapture={onPointerDownCapture}
			>
				<ChartContainer
					config={{}}
					className="aspect-square h-full w-full [&_.recharts-sector]:cursor-pointer"
				>
					<PieChart accessibilityLayer>
						<ChartTooltip content={<MoneyTooltip />} />
						<Pie
							data={data}
							dataKey="amount"
							nameKey="label"
							innerRadius="64%"
							outerRadius="96%"
							paddingAngle={1.2}
							cornerRadius={4}
							stroke="var(--card)"
							strokeWidth={2}
							onMouseEnter={(_, i) => setHovered(data[i]?.key ?? null)}
							onMouseLeave={() => setHovered(null)}
							onClick={(_, i) => {
								const key = data[i]?.key;
								if (key) select(key);
							}}
							{...animation}
						>
							{data.map((d) => (
								<Cell
									key={d.key}
									fill={d.color}
									fillOpacity={hovered && hovered !== d.key ? 0.3 : 1}
									className="transition-[fill-opacity] duration-(--duration-base)"
								/>
							))}
						</Pie>
					</PieChart>
				</ChartContainer>
				<div className="pointer-events-none absolute inset-0 grid place-content-center text-center">
					<span className="text-xs text-muted-foreground">{focus ? focus.label : "Spent"}</span>
					<span className="text-2xl font-semibold tracking-tight tabular-nums">
						{formatMoney(focus ? focus.amount : total)}
					</span>
					{focus && total > 0 ? (
						<span className="text-xs text-subtle-foreground tabular-nums">
							{Math.round((focus.amount / total) * 100)}%
						</span>
					) : null}
				</div>
			</div>
			{other ? (
				<p className="flex items-center gap-1.5 text-xs text-muted-foreground">
					<span
						aria-hidden="true"
						className="size-2.5 rounded-full"
						style={{ background: other.color }}
					/>
					Everything else
					<span className="font-medium text-foreground tabular-nums">
						{formatMoney(other.amount)}
					</span>
				</p>
			) : null}
		</div>
	);
}

/** Share of spend as a treemap: area for amount, the Bucket's colour for identity. */
export function ShareTreemap({
	data,
	onSelect,
}: {
	data: Share[];
	onSelect?: (key: string) => void;
}) {
	const animation = useAnimation();
	const { onPointerDownCapture, select } = useTapToReveal(onSelect);
	const rows = data
		.filter((d) => d.amount > 0)
		.map((d) => ({ ...d, name: d.label, size: d.amount }));
	return (
		<ChartContainer
			config={{}}
			className="aspect-auto h-72 w-full lg:h-80"
			onPointerDownCapture={onPointerDownCapture}
		>
			<Treemap
				data={rows}
				dataKey="size"
				aspectRatio={4 / 3}
				stroke="var(--card)"
				{...animation}
				content={(props: {
					x: number;
					y: number;
					width: number;
					height: number;
					name?: string;
					key?: string;
					color?: string;
					amount?: number;
					depth?: number;
				}) => {
					const { x, y, width, height, name, color, amount, depth } = props;
					if (depth !== 1 || !name) return <g />;
					const key = (props as { key?: string }).key ?? name;
					return (
						// biome-ignore lint/a11y/useSemanticElements: an SVG treemap cell can't be a <button>; the table view is its other accessible form.
						<g
							role="button"
							tabIndex={0}
							aria-label={`${name}: ${formatMoney(amount ?? 0)}`}
							className="cursor-pointer outline-none focus-visible:[&>rect]:stroke-(--ring) focus-visible:[&>rect]:stroke-[3px]"
							onClick={() => select(key)}
							onKeyDown={(event) => {
								if (event.key === "Enter" || event.key === " ") {
									event.preventDefault();
									select(key);
								}
							}}
						>
							<title>{`${name}: ${formatMoney(amount ?? 0)}`}</title>
							<rect
								x={x + 1}
								y={y + 1}
								width={Math.max(0, width - 2)}
								height={Math.max(0, height - 2)}
								rx={6}
								fill={color}
								fillOpacity={0.9}
							/>
							{width >= 64 && height >= 48 ? (
								// White on the Bucket colours; dark on the light grey of "Everything else".
								<g fill={key === "other" ? "var(--foreground)" : "white"}>
									<text x={x + 10} y={y + 20} fontSize={12} fontWeight={600}>
										{name.length > width / 8 ? `${name.slice(0, Math.floor(width / 8))}…` : name}
									</text>
									<text x={x + 10} y={y + 36} fontSize={12}>
										{formatCompact(amount ?? 0)}
									</text>
								</g>
							) : null}
						</g>
					);
				}}
			/>
		</ChartContainer>
	);
}

/**
 * A ranked list of bars: each row names its key, shows its amount and share as a bar that grows
 * in, and (with `href`) links one level down. The accessible form is the list itself.
 */
export function RankedBars({
	rows,
	max,
	renderRow,
}: {
	rows: { key: string; amount: Cents; color?: string }[];
	max?: Cents;
	renderRow: (row: { key: string; amount: Cents }, bar: ReactNode) => ReactNode;
}) {
	const top = max ?? Math.max(1, ...rows.map((r) => r.amount));
	return (
		<ul className="grid grid-cols-[minmax(0,1fr)] gap-1">
			{rows.map((row, i) => (
				<li key={row.key}>
					{renderRow(
						row,
						<span className="block h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
							<span
								className="block h-full origin-left animate-[bar-grow_var(--duration-meter)_var(--ease-standard)_both] rounded-full"
								style={{
									width: `${Math.max(1.5, (Math.max(0, row.amount) / top) * 100)}%`,
									background: row.color ?? "var(--chart-spend)",
									animationDelay: `${Math.min(i, 10) * 30}ms`,
								}}
							/>
						</span>,
					)}
				</li>
			))}
		</ul>
	);
}

/**
 * Planned vs spent per Bucket per month: each cell shaded by how far spending was from the Plan,
 * the brand for under, --over for over, a grey midpoint on Plan. The ratio is printed too, so
 * colour is never the only signal.
 */
export function VarianceHeatmap({
	rows,
	months,
	monthLabel,
	onSelect,
}: {
	rows: {
		key: string;
		label: ReactNode;
		cells: ({ ratio: number | null; planned: Cents; spent: Cents } | null)[];
	}[];
	months: string[];
	monthLabel: (month: string) => string;
	onSelect?: (key: string, month: string) => void;
}) {
	const tone = (ratio: number | null) => {
		if (ratio === null) return "transparent";
		const off = ratio - 1;
		if (Math.abs(off) <= 0.1) return "var(--chart-mid)";
		const strength = Math.min(1, Math.abs(off)) * 70 + 15;
		return `color-mix(in oklab, ${off > 0 ? "var(--over)" : "var(--brand)"} ${strength}%, var(--card))`;
	};
	// On a phone the months overflow: start scrolled to the latest, with the Buckets pinned.
	const scroller = useRef<HTMLDivElement>(null);
	useEffect(() => {
		const el = scroller.current;
		if (el && months.length) el.scrollLeft = el.scrollWidth;
	}, [months.length]);
	return (
		<>
			{/* On a phone, a list: each Bucket's latest month in words, its past months as a strip. */}
			<ul className="grid gap-1 sm:hidden">
				{rows.map((row) => {
					const at = months.length - 1;
					const month = months[at] ?? "";
					const cell = row.cells[at] ?? null;
					const text = cell && cell.ratio !== null ? `${Math.round(cell.ratio * 100)}%` : "—";
					const off = cell && cell.ratio !== null ? Math.abs(cell.ratio - 1) : 0;
					return (
						<li key={row.key}>
							<RowButton
								disabled={!onSelect || !cell}
								onClick={() => onSelect?.(row.key, month)}
								className="rounded-lg"
							>
								<span className="grid min-w-0 flex-1 gap-1">
									<span className="min-w-0 text-sm font-medium">{row.label}</span>
									<span className="text-xs text-muted-foreground tabular-nums">
										{cell
											? `${formatMoney(cell.spent)} of ${formatMoney(cell.planned)} in ${monthLabel(month)}`
											: `Not in the Plan in ${monthLabel(month)}`}
									</span>
									<span aria-hidden="true" className="flex flex-wrap gap-0.5">
										{row.cells.map((c, i) => (
											<span
												key={months[i]}
												className={cn(
													"h-2.5 w-4 rounded-[2px]",
													!c && "border border-border-strong",
												)}
												style={{ background: c ? tone(c.ratio) : undefined }}
											/>
										))}
									</span>
								</span>
								<span
									className={cn(
										"min-w-14 shrink-0 rounded-md px-2 py-1.5 text-center text-sm tabular-nums",
										off > 0.75
											? "font-semibold text-white"
											: off > 0.5
												? "font-semibold text-foreground"
												: "text-foreground",
										!cell && "bg-surface-2/40",
									)}
									style={{ background: cell ? tone(cell.ratio) : undefined }}
								>
									{text}
								</span>
							</RowButton>
						</li>
					);
				})}
			</ul>
			<div
				ref={scroller}
				className="-mx-(--card-pad) hidden overflow-x-auto px-(--card-pad) sm:block"
			>
				<table className="w-full min-w-max border-separate border-spacing-0.5 text-xs">
					<thead>
						<tr>
							<th className="sticky left-0 z-10 bg-card" scope="col">
								<span className="sr-only">Bucket</span>
							</th>
							{months.map((m) => (
								<th
									key={m}
									scope="col"
									className="px-1 pb-1 text-center font-medium text-muted-foreground"
								>
									{monthLabel(m)}
								</th>
							))}
						</tr>
					</thead>
					<tbody>
						{rows.map((row) => (
							<tr key={row.key}>
								<th
									scope="row"
									className="sticky left-0 z-10 max-w-28 truncate bg-card pe-3 text-left font-medium sm:max-w-36"
								>
									{row.label}
								</th>
								{row.cells.map((cell, i) => {
									const month = months[i] ?? "";
									const text =
										cell?.ratio === null || !cell ? "—" : `${Math.round(cell.ratio * 100)}%`;
									const off = cell && cell.ratio !== null ? Math.abs(cell.ratio - 1) : 0;
									const strong = off > 0.5;
									// The deepest tints are dark enough in both appearances to need light text.
									const deep = off > 0.75;
									return (
										<td key={month} className="p-0">
											<WithTooltip
												label={
													cell
														? `${formatMoney(cell.spent)} of ${formatMoney(cell.planned)}`
														: "Not in the Plan"
												}
											>
												<button
													type="button"
													disabled={!onSelect || !cell}
													onClick={() => onSelect?.(row.key, month)}
													aria-label={
														cell
															? `${monthLabel(month)}: ${formatMoney(cell.spent)} spent of ${formatMoney(cell.planned)} planned`
															: `${monthLabel(month)}: not in the Plan`
													}
													className={cn(
														"h-9 w-full min-w-12 rounded-md text-center tabular-nums transition-[transform,box-shadow] duration-(--duration-fast)",
														"enabled:hover:scale-[1.04] enabled:hover:shadow-card focus-visible:outline-2 focus-visible:outline-ring",
														deep
															? "font-semibold text-white"
															: strong
																? "font-semibold text-foreground"
																: "text-foreground",
														!cell && "bg-surface-2/40",
													)}
													style={{ background: cell ? tone(cell.ratio) : undefined }}
												>
													{text}
												</button>
											</WithTooltip>
										</td>
									);
								})}
							</tr>
						))}
					</tbody>
				</table>
			</div>
			<HeatmapKey tone={tone} />
		</>
	);
}

/** The variance heatmap's colour key: under the Plan, on it, over it. */
function HeatmapKey({ tone }: { tone: (ratio: number | null) => string }) {
	const stops = [0, 0.5, 1, 1.5, 2];
	return (
		<div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-3 text-xs text-muted-foreground">
			<span className="flex items-center gap-1.5">
				Under the Plan
				<span aria-hidden="true" className="flex gap-0.5">
					{stops.map((s) => (
						<span key={s} className="h-3 w-5 rounded-[3px]" style={{ background: tone(s) }} />
					))}
				</span>
				Over the Plan
			</span>
			<span>Grey is within 10% of the Plan</span>
			<span className="flex items-center gap-1.5">
				<span aria-hidden="true" className="h-3 w-5 rounded-[3px] border border-border-strong" />
				Not in the Plan
			</span>
		</div>
	);
}

/**
 * Daily spend as a calendar: a column per week, a row per weekday, darker for more (square-root
 * steps of the brand, so a few big days don't wash out the rest). Cells are 24px (the target
 * size), with weekday and month labels; the grid is one tab stop, the arrow keys move a day or a
 * week, and each day names its amount in a tooltip on hover and focus.
 */
export function CalendarHeatmap({
	days,
	from,
	until,
	onSelect,
}: {
	days: { day: DayKey; amount: Cents }[];
	from: DayKey;
	until: DayKey;
	onSelect?: (day: DayKey) => void;
}) {
	const byDay = new Map(days.map((d) => [d.day, d.amount]));
	const max = Math.max(0, ...days.map((d) => d.amount));
	const start = new Date(`${from}T00:00:00Z`);
	// Start on the Monday on or before `from`.
	start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
	const cells: { day: DayKey; inRange: boolean }[] = [];
	for (
		const date = new Date(start);
		date.toISOString().slice(0, 10) < until;
		date.setUTCDate(date.getUTCDate() + 1)
	) {
		const day = date.toISOString().slice(0, 10) as DayKey;
		cells.push({ day, inRange: day >= from });
	}
	const inRange = cells.filter((c) => c.inRange).map((c) => c.day);
	const last = inRange[inRange.length - 1];
	const [active, setActive] = useState<DayKey | undefined>(last);
	const current = active && active >= from && active < until ? active : last;
	// On touch the first tap on a day shows its amount below; a second tap opens it.
	const pointer = useRef("mouse");
	const [revealed, setRevealed] = useState<DayKey | undefined>();
	const scroller = useRef<HTMLDivElement>(null);
	useEffect(() => {
		const el = scroller.current;
		if (el && cells.length) el.scrollLeft = el.scrollWidth;
	}, [cells.length]);
	const weeks = Math.ceil(cells.length / 7);
	// A month's name over the first week that holds its 1st (or the first week shown).
	const monthLabels: { week: number; label: string }[] = [];
	cells.forEach(({ day, inRange: shown }, i) => {
		const week = Math.floor(i / 7);
		if (!shown) return;
		const first = monthLabels.length === 0 || day.endsWith("-01");
		if (first && monthLabels[monthLabels.length - 1]?.week !== week) {
			monthLabels.push({
				week,
				label: new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", {
					month: "short",
					timeZone: "UTC",
				}),
			});
		}
	});
	const move = (event: ReactKeyboardEvent<HTMLDivElement>) => {
		if (!current) return;
		const step: Record<string, number> = {
			ArrowUp: -1,
			ArrowDown: 1,
			ArrowLeft: -7,
			ArrowRight: 7,
		};
		let next: DayKey | undefined;
		if (event.key in step) {
			const at = inRange.indexOf(current) + (step[event.key] ?? 0);
			next = inRange[Math.max(0, Math.min(inRange.length - 1, at))];
		} else if (event.key === "Home") next = inRange[0];
		else if (event.key === "End") next = last;
		if (!next) return;
		event.preventDefault();
		setActive(next);
		event.currentTarget.querySelector<HTMLButtonElement>(`[data-day="${next}"]`)?.focus();
	};
	const fills = [
		"var(--surface-2)",
		"var(--chart-seq-1)",
		"var(--chart-seq-2)",
		"var(--chart-seq-3)",
		"var(--chart-seq-4)",
	];
	const weekdays = ["Mon", "", "Wed", "", "Fri", "", ""];
	return (
		<div className="grid gap-3">
			<div ref={scroller} className="-mx-(--card-pad) overflow-x-auto px-(--card-pad) pb-1">
				{/* biome-ignore lint/a11y/useSemanticElements: a fieldset breaks the grid layout; the arrow keys rove between the day buttons inside */}
				<div
					role="group"
					aria-label="Spending each day"
					onKeyDown={move}
					onPointerDownCapture={(event) => {
						pointer.current = event.pointerType;
					}}
					className="grid w-max gap-[3px] text-[11px] text-muted-foreground"
					style={{
						gridTemplateColumns: `auto repeat(${weeks}, 1.5rem)`,
						gridTemplateRows: "auto repeat(7, 1.5rem)",
					}}
				>
					{monthLabels.map(({ week, label }) => (
						<span
							key={`${week}-${label}`}
							aria-hidden="true"
							className="pb-0.5 whitespace-nowrap"
							style={{ gridColumn: `${week + 2} / span 3`, gridRow: 1 }}
						>
							{label}
						</span>
					))}
					{weekdays.map((label, d) => (
						<span
							// biome-ignore lint/suspicious/noArrayIndexKey: fixed weekday rows
							key={d}
							aria-hidden="true"
							className="sticky left-0 z-10 flex items-center bg-card pe-1.5 before:absolute before:inset-y-[-2px] before:-right-[3px] before:-left-(--card-pad) before:-z-10 before:bg-card"
							style={{ gridColumn: 1, gridRow: d + 2 }}
						>
							{label}
						</span>
					))}
					{cells.map(({ day, inRange: shown }, i) => {
						if (!shown) return null;
						const amount = byDay.get(day) ?? 0;
						const level = levelOf(amount, max);
						const label = `${shortDay(day)}: ${formatMoney(amount)}`;
						return (
							<WithTooltip key={day} label={label}>
								<button
									type="button"
									data-day={day}
									tabIndex={day === current ? 0 : -1}
									aria-disabled={onSelect ? undefined : true}
									onFocus={() => setActive(day)}
									onClick={() => {
										if (pointer.current === "touch" && revealed !== day) {
											setRevealed(day);
											setActive(day);
											return;
										}
										onSelect?.(day);
									}}
									aria-label={label}
									className={cn(
										"size-6 rounded-[4px] transition-transform duration-(--duration-fast) hover:scale-110 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
										day === revealed && "ring-2 ring-foreground/60",
									)}
									style={{
										background: fills[level],
										gridColumn: Math.floor(i / 7) + 2,
										gridRow: (i % 7) + 2,
									}}
								/>
							</WithTooltip>
						);
					})}
				</div>
			</div>
			{current ? (
				<p className="text-xs text-foreground tabular-nums">
					{shortDay(current)}: {formatMoney(byDay.get(current) ?? 0)}
				</p>
			) : null}
			<div className="flex items-center gap-1.5 text-xs text-muted-foreground" aria-hidden="true">
				Less
				{fills.map((fill) => (
					<span key={fill} className="size-3 rounded-[3px]" style={{ background: fill }} />
				))}
				More
			</div>
		</div>
	);
}

/** Lines over months (what Goals have set aside, income by source): ink for one, brand for the highlight. */
export function TrendLines({
	rows,
	series,
	labelOf,
	className,
}: {
	rows: Record<string, number | string | null>[];
	series: { key: string; label: string; color: string; dashed?: boolean }[];
	labelOf: (period: string, style?: "short" | "long") => string;
	className?: string;
}) {
	const animation = useAnimation();
	const config: ChartConfig = Object.fromEntries(
		series.map((s) => [s.key, { label: s.label, color: s.color }]),
	);
	return (
		<div className="grid gap-3">
			<ChartContainer config={config} className={cn("aspect-auto h-48 w-full", className)}>
				<ComposedChart data={rows} accessibilityLayer>
					<CartesianGrid vertical={false} stroke="var(--chart-grid)" />
					<XAxis
						dataKey="period"
						tickFormatter={(p) => labelOf(p)}
						{...axisProps}
						minTickGap={12}
					/>
					<YAxis tickFormatter={formatCompact} width={52} {...axisProps} />
					<ChartTooltip content={<MoneyTooltip labelOf={(p) => labelOf(p, "long")} />} />
					{series.map((s) => (
						<Line
							key={s.key}
							dataKey={s.key}
							name={s.label}
							type="monotone"
							stroke={`var(--color-${s.key})`}
							strokeWidth={2}
							strokeDasharray={s.dashed ? "4 3" : undefined}
							dot={false}
							activeDot={{ r: 4 }}
							connectNulls
							{...animation}
						/>
					))}
				</ComposedChart>
			</ChartContainer>
			{series.length > 1 ? (
				// Below the plot, one line each and truncated, so a long list can't squash the chart.
				<ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
					{series.map((s) => (
						<li key={s.key} className="flex min-w-0 max-w-48 items-center gap-1.5" title={s.label}>
							<span
								aria-hidden="true"
								className={cn("w-3 shrink-0 border-t-2", s.dashed && "border-dashed")}
								style={{ borderColor: s.color }}
							/>
							<span className="truncate">{s.label}</span>
						</li>
					))}
				</ul>
			) : null}
		</div>
	);
}

/** Income sources through the Household to Buckets, Goals and savings, as a Sankey. */
/** The longest Sankey label before it's cut. */
const LABEL_CHARS = 26;

export function FlowSankey({
	nodes,
	links,
	onSelect,
}: {
	nodes: { key: string; name: string; kind: "source" | "hub" | "destination" }[];
	links: { source: number; target: number; value: Cents }[];
	onSelect?: (key: string) => void;
}) {
	const animation = useAnimation();
	// Labels sit right of each node; the gutter fits the longest destination label (12px text is
	// about 6.6px a character), and longer names are cut with the full name in a tooltip.
	const label = (name: string) =>
		name.length > LABEL_CHARS ? `${name.slice(0, LABEL_CHARS - 1)}…` : name;
	const gutter = Math.min(
		240,
		Math.max(
			140,
			...nodes
				.filter((n) => n.kind === "destination")
				.map((n) => (label(n.name).length + 7) * 6.6 + 12),
		),
	);
	const fill = (kind: string, key: string) =>
		kind === "source"
			? "var(--chart-income)"
			: kind === "hub"
				? "var(--chart-net)"
				: key === "out:saved"
					? "var(--chart-income)"
					: "var(--chart-spend)";
	return (
		<ChartContainer config={{}} className="aspect-auto h-80 w-full lg:h-96">
			<Sankey
				data={{ nodes, links }}
				nodeWidth={10}
				nodePadding={18}
				linkCurvature={0.5}
				iterations={32}
				margin={{ top: 8, right: gutter, bottom: 8, left: 8 }}
				{...animation}
				onClick={(item: unknown, type: string) => {
					if (type !== "node") return;
					const key = (item as { payload?: { key?: string } }).payload?.key;
					if (key) onSelect?.(key);
				}}
				node={(props) => {
					const { x, y, width, height } = props;
					const payload = props.payload as unknown as {
						key: string;
						name: string;
						kind: string;
						value: number;
					};
					const right = payload.kind !== "destination";
					return (
						<g className={payload.kind === "destination" ? "cursor-pointer" : undefined}>
							<rect
								x={x}
								y={y}
								width={width}
								height={height}
								rx={2}
								fill={fill(payload.kind, payload.key)}
							/>
							<text
								x={right ? x + width + 6 : x + width + 6}
								y={y + height / 2}
								dominantBaseline="middle"
								fontSize={12}
								fill="var(--foreground)"
							>
								<title>{`${payload.name} ${formatMoney(payload.value)}`}</title>
								{label(payload.name)}
								<tspan fill="var(--foreground)" fontWeight={500}>
									{" "}
									{formatCompact(payload.value)}
								</tspan>
							</text>
						</g>
					);
				}}
				link={(props: {
					sourceX: number;
					targetX: number;
					sourceY: number;
					targetY: number;
					sourceControlX: number;
					targetControlX: number;
					linkWidth: number;
				}) => {
					const { sourceX, targetX, sourceY, targetY, sourceControlX, targetControlX, linkWidth } =
						props;
					return (
						<path
							d={`M${sourceX},${sourceY} C${sourceControlX},${sourceY} ${targetControlX},${targetY} ${targetX},${targetY}`}
							fill="none"
							stroke="var(--chart-compare)"
							strokeOpacity={0.55}
							strokeWidth={Math.max(1, linkWidth)}
							className="transition-[stroke-opacity] hover:[stroke-opacity:0.9]"
						/>
					);
				}}
			>
				<ChartTooltip content={<MoneyTooltip />} />
			</Sankey>
		</ChartContainer>
	);
}
