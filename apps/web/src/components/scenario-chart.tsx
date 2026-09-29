import type { Cents, MonthKey } from "@noodle/domain";
import { cn } from "@noodle/ui/lib/utils";
import { type KeyboardEvent, type PointerEvent, useEffect, useRef, useState } from "react";
import { formatMoney } from "../format";

// Free to Spend each month, the Plan against a Scenario: two lines on one axis. Drawn as plain
// SVG (no chart library) and loaded only in the browser, so it costs nothing on the server.
// Colour follows the dataviz method: the Plan is the quiet reference line, the Scenario the one
// accent, both from tokens; a legend names them and a crosshair reads out every value.

export type ChartRow = { month: MonthKey; plan: Cents; scenario: Cents };

const HEIGHT = 220;
const MARGIN = { top: 12, right: 12, bottom: 24, left: 56 };

const monthLabel = (month: MonthKey, style: "short" | "long") => {
	const [year, m] = month.split("-").map(Number);
	return new Date(Date.UTC(year ?? 1970, (m ?? 1) - 1, 1)).toLocaleDateString("en-US", {
		month: style === "short" ? "short" : "long",
		year: "numeric",
		timeZone: "UTC",
	});
};

/** Round tick values covering [min, max], about four of them. */
function ticks(min: number, max: number): number[] {
	const span = max - min || Math.abs(max) || 100_00;
	const raw = span / 4;
	const power = 10 ** Math.floor(Math.log10(raw));
	const step = ([1, 2, 2.5, 5, 10].find((s) => s * power >= raw) ?? 10) * power;
	const values: number[] = [];
	const top = Math.ceil(max / step) * step;
	for (let v = Math.floor(min / step) * step; v <= top + step / 100; v += step) values.push(v);
	return values;
}

const compactMoney = (cents: number) => {
	const dollars = Math.abs(cents) / 100;
	const text =
		dollars >= 1000
			? `$${(dollars / 1000).toFixed(dollars % 1000 === 0 || dollars >= 10_000 ? 0 : 1)}k`
			: `$${Math.round(dollars)}`;
	return cents < 0 ? `−${text}` : text;
};

export default function ScenarioChart({ rows }: { rows: ChartRow[] }) {
	const frame = useRef<HTMLDivElement>(null);
	const [width, setWidth] = useState(0);
	const [active, setActive] = useState<number | null>(null);

	useEffect(() => {
		const element = frame.current;
		if (!element) return;
		const observer = new ResizeObserver(([entry]) => setWidth(entry?.contentRect.width ?? 0));
		observer.observe(element);
		return () => observer.disconnect();
	}, []);

	const values = rows.flatMap((r) => [r.plan, r.scenario]);
	const yTicks = ticks(Math.min(0, ...values), Math.max(0, ...values));
	const yMin = yTicks[0] ?? 0;
	const yMax = yTicks[yTicks.length - 1] ?? 1;
	const innerWidth = Math.max(0, width - MARGIN.left - MARGIN.right);
	const innerHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
	const x = (i: number) =>
		MARGIN.left + (rows.length > 1 ? (i / (rows.length - 1)) * innerWidth : 0);
	const y = (v: number) => MARGIN.top + ((yMax - v) / (yMax - yMin || 1)) * innerHeight;
	const path = (key: "plan" | "scenario") =>
		rows.map((r, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(r[key]).toFixed(1)}`).join("");

	// A year ahead is labelled every third month; longer, each January as its year.
	const xLabels = rows.flatMap((r, i) => {
		if (rows.length <= 12) {
			return i % 3 === 0 ? [{ i, text: monthLabel(r.month, "short").split(" ")[0] ?? "" }] : [];
		}
		return r.month.endsWith("-01") ? [{ i, text: r.month.slice(0, 4) }] : [];
	});

	function pick(event: PointerEvent<HTMLDivElement>) {
		const box = event.currentTarget.getBoundingClientRect();
		const at = (event.clientX - box.left) / (box.width || 1);
		setActive(Math.round(Math.min(1, Math.max(0, at)) * (rows.length - 1)));
	}

	function step(event: KeyboardEvent<HTMLDivElement>) {
		const delta = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
		if (!delta) return;
		event.preventDefault();
		setActive((i) => Math.min(rows.length - 1, Math.max(0, (i ?? -1) + delta)));
	}

	const hovered = active === null ? undefined : rows[active];
	const last = rows[rows.length - 1];
	const reading = hovered ?? last;

	return (
		<div className="grid gap-3">
			<div className="flex gap-4 text-xs text-muted-foreground">
				<span className="inline-flex items-center gap-1.5">
					<SeriesKey tone="plan" />
					Plan
				</span>
				<span className="inline-flex items-center gap-1.5">
					<SeriesKey tone="scenario" />
					Scenario
				</span>
			</div>
			<div ref={frame} className="relative">
				{width > 0 ? (
					<svg width={width} height={HEIGHT} className="block overflow-visible" aria-hidden="true">
						{yTicks.map((v) => (
							<g key={v}>
								<line
									x1={MARGIN.left}
									x2={width - MARGIN.right}
									y1={y(v)}
									y2={y(v)}
									className={v === 0 ? "stroke-border-strong" : "stroke-border"}
									strokeWidth={1}
									shapeRendering="crispEdges"
								/>
								<text
									x={MARGIN.left - 8}
									y={y(v)}
									dy="0.32em"
									textAnchor="end"
									className="fill-subtle-foreground text-[11px] tabular-nums"
								>
									{compactMoney(v)}
								</text>
							</g>
						))}
						{xLabels.map(({ i, text }) => (
							<text
								key={i}
								x={x(i)}
								y={HEIGHT - 6}
								textAnchor={i === 0 ? "start" : "middle"}
								className="fill-subtle-foreground text-[11px]"
							>
								{text}
							</text>
						))}
						<path
							d={path("plan")}
							fill="none"
							className="stroke-subtle-foreground"
							strokeWidth={2}
							strokeLinejoin="round"
							strokeLinecap="round"
						/>
						<path
							d={path("scenario")}
							fill="none"
							className="stroke-brand"
							strokeWidth={2}
							strokeLinejoin="round"
							strokeLinecap="round"
						/>
						{last ? (
							<>
								<circle
									cx={x(rows.length - 1)}
									cy={y(last.plan)}
									r={4}
									className="fill-subtle-foreground stroke-card"
									strokeWidth={2}
								/>
								<circle
									cx={x(rows.length - 1)}
									cy={y(last.scenario)}
									r={4}
									className="fill-brand stroke-card"
									strokeWidth={2}
								/>
							</>
						) : null}
						{hovered && active !== null ? (
							<g>
								<line
									x1={x(active)}
									x2={x(active)}
									y1={MARGIN.top}
									y2={MARGIN.top + innerHeight}
									className="stroke-border-strong"
									strokeWidth={1}
								/>
								<circle
									cx={x(active)}
									cy={y(hovered.plan)}
									r={4}
									className="fill-subtle-foreground stroke-card"
									strokeWidth={2}
								/>
								<circle
									cx={x(active)}
									cy={y(hovered.scenario)}
									r={4}
									className="fill-brand stroke-card"
									strokeWidth={2}
								/>
							</g>
						) : null}
					</svg>
				) : (
					<div style={{ height: HEIGHT }} />
				)}
				{width > 0 ? (
					// Reads out a month at a time: the arrow keys step through them.
					<div
						className="absolute top-0 touch-pan-y rounded-lg outline-none focus-visible:outline-2 focus-visible:outline-ring"
						style={{ left: MARGIN.left, width: innerWidth, height: HEIGHT }}
						role="slider"
						aria-label="Free to Spend each month, the Plan and this Scenario"
						aria-orientation="horizontal"
						aria-valuemin={0}
						aria-valuemax={rows.length - 1}
						aria-valuenow={active ?? rows.length - 1}
						aria-valuetext={
							reading
								? `${monthLabel(reading.month, "long")}: Scenario ${formatMoney(reading.scenario)}, Plan ${formatMoney(reading.plan)}`
								: undefined
						}
						tabIndex={0}
						onPointerMove={pick}
						onPointerDown={pick}
						onPointerLeave={() => setActive(null)}
						onFocus={() => setActive((i) => i ?? rows.length - 1)}
						onBlur={() => setActive(null)}
						onKeyDown={step}
					/>
				) : null}
				{hovered && active !== null ? (
					<div
						className={cn(
							"pointer-events-none absolute top-0 z-10 grid min-w-36 gap-1 rounded-xl border bg-popover px-3 py-2 text-xs shadow-pop",
						)}
						style={{
							left: Math.min(Math.max(0, x(active) - 72), Math.max(0, width - 160)),
						}}
					>
						<span className="font-medium text-muted-foreground">
							{monthLabel(hovered.month, "long")}
						</span>
						<TooltipRow tone="scenario" label="Scenario" value={hovered.scenario} />
						<TooltipRow tone="plan" label="Plan" value={hovered.plan} />
					</div>
				) : null}
			</div>
		</div>
	);
}

function TooltipRow({
	tone,
	label,
	value,
}: {
	tone: "plan" | "scenario";
	label: string;
	value: Cents;
}) {
	return (
		<span className="flex items-center gap-2">
			<SeriesKey tone={tone} />
			<span className="font-semibold tabular-nums text-foreground">{formatMoney(value)}</span>
			<span className="ms-auto text-muted-foreground">{label}</span>
		</span>
	);
}

/** A short stroke in a series' colour: its key in the legend and tooltip. */
function SeriesKey({ tone }: { tone: "plan" | "scenario" }) {
	return (
		<span
			aria-hidden="true"
			className={cn(
				"inline-block h-0.5 w-3 shrink-0 rounded-full",
				tone === "plan" ? "bg-subtle-foreground" : "bg-brand",
			)}
		/>
	);
}
