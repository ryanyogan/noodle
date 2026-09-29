import type { YearFigures, YearMonth } from "@noodle/domain";
import { Badge } from "@noodle/ui/components/badge";
import { Button } from "@noodle/ui/components/button";
import { Card } from "@noodle/ui/components/card";
import { List } from "@noodle/ui/components/list";
import { PageHeader } from "@noodle/ui/components/page-header";
import { Section, SectionHeader } from "@noodle/ui/components/section";
import { cn } from "@noodle/ui/lib/utils";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { lumpText } from "../../../components/coming-up";
import { formatMoney, monthName } from "../../../format";
import { yearQuery } from "../../../queries";
import { FIRST_YEAR } from "../../../server/year";

// The year at a glance: each month's Plan from the Baseline down to Free to Spend, what actually
// happened beneath it for months over or under way, and the lumpy months picked out. Each month
// opens its Plan.
export const Route = createFileRoute("/_authed/_household/plan/year/$year")({
	beforeLoad: ({ params }) => {
		const year = Number(params.year);
		if (!/^\d{4}$/.test(params.year) || year < FIRST_YEAR) throw notFound();
		return { year };
	},
	loader: async ({ context }) => {
		const data = await context.queryClient.ensureQueryData(yearQuery(context.year));
		if (data === null) throw notFound();
	},
	component: YearPage,
});

const FIGURES: { key: keyof YearFigures; label: string }[] = [
	{ key: "baseline", label: "Baseline" },
	{ key: "commitments", label: "Commitments" },
	{ key: "allowances", label: "Allowances" },
	{ key: "goalFunding", label: "Goal funding" },
	{ key: "freeToSpend", label: "Free to Spend" },
];

function YearPage() {
	const { year } = Route.useRouteContext();
	const data = useSuspenseQuery(yearQuery(year)).data;
	// The loader 404s a year outside the Plan; this only guards the types.
	if (data === null) return <PageHeader eyebrow="Plan" title={year} />;
	const { current, lastYear } = data;
	// Months before the Household planned anything are all "Not set" and $0: fold them into a line.
	const start = data.months.findIndex((m) => !isBlank(m));
	const months = start > 0 ? data.months.slice(start) : data.months;
	const lumpy = months.filter((m) => m.lumps.length > 0);
	return (
		<>
			<PageHeader
				className="max-w-3xl"
				eyebrow="Plan"
				title={year}
				leading={
					<Button variant="ghost" size="icon" asChild>
						<Link to="/plan/$month" params={{ month: current }} aria-label="Back to the Plan">
							<ChevronLeft className="size-5" />
						</Link>
					</Button>
				}
				actions={<YearLinks year={year} lastYear={lastYear} />}
			/>
			<div className="grid max-w-3xl gap-8">
				<p className="text-[13px] text-muted-foreground">
					Each month’s Plan, from the Baseline down to Free to Spend. Months over or under way show
					what actually happened beneath it: income, spending, and Goal funding. Later months are
					the Plan as it stands, with each dated Goal funded what it needs.
				</p>
				{start > 0 && months[0] ? (
					<p className="text-[13px] text-muted-foreground">
						Nothing was planned before {monthName(months[0].month)}.
					</p>
				) : null}
				<YearTable months={months} />
				<YearList months={months} />
				{lumpy.length > 0 ? (
					<Section aria-labelledby="year-lumpy">
						<SectionHeader id="year-lumpy" title="Lumpy months" />
						<List>
							{lumpy.map(({ month, lumps }) => (
								<li key={month} className="grid gap-0.5 px-(--card-pad) py-3">
									<Link to="/plan/$month" params={{ month }} className="text-sm font-medium">
										{monthName(month)}
									</Link>
									<p className="text-[13px] text-muted-foreground">{lumpText(lumps, month)}</p>
								</li>
							))}
						</List>
					</Section>
				) : null}
			</div>
		</>
	);
}

function YearLinks({ year, lastYear }: { year: number; lastYear: number }) {
	const link = (to: number, label: string, icon: ReactNode) => (
		<Button variant="ghost" size="icon" asChild>
			<Link to="/plan/year/$year" params={{ year: String(to) }} aria-label={label}>
				{icon}
			</Link>
		</Button>
	);
	return (
		<div className="flex items-center gap-1">
			{year > FIRST_YEAR
				? link(year - 1, "Previous year", <ChevronLeft className="size-5" />)
				: null}
			{year < lastYear ? link(year + 1, "Next year", <ChevronRight className="size-5" />) : null}
		</div>
	);
}

/** A past month with no Baseline and nothing planned or spent. */
function isBlank(month: YearMonth) {
	const empty = (figures: YearFigures | null) =>
		figures === null || Object.values(figures).every((cents) => cents === 0);
	return month.when === "past" && month.noBaseline && empty(month.plan) && empty(month.actual);
}

/** "This month" for the month under way, "Lumpy" for a lumpy one. */
function MonthBadges({ month }: { month: YearMonth }) {
	return (
		<>
			{month.when === "current" ? <Badge>This month</Badge> : null}
			{month.lumps.length > 0 ? <Badge>Lumpy</Badge> : null}
		</>
	);
}

/** An amount, negative ones marked as over. */
function Amount({ cents, className }: { cents: number; className?: string }) {
	return (
		<span className={cn("tabular-nums", cents < 0 && "text-over", className)}>
			{formatMoney(cents)}
		</span>
	);
}

/** The Plan's figure, with what actually happened beneath it when there is one. */
function Figure({ month, figure }: { month: YearMonth; figure: keyof YearFigures }) {
	const planned =
		figure === "baseline" && month.noBaseline ? (
			<span className="text-muted-foreground">Not set</span>
		) : (
			<Amount cents={month.plan[figure]} />
		);
	return (
		<>
			<span className="block">{planned}</span>
			{month.actual ? (
				<span className="block text-xs text-muted-foreground">
					<span className="sr-only">Actual{month.when === "current" ? " so far" : ""}: </span>
					<Amount cents={month.actual[figure]} />
				</span>
			) : null}
		</>
	);
}

/** From a tablet up: the months as rows of one table, the Plan's figures across. */
function YearTable({ months }: { months: YearMonth[] }) {
	const total = (key: keyof YearFigures) => months.reduce((sum, m) => sum + m.plan[key], 0);
	return (
		<Card className="max-md:hidden">
			<table className="w-full text-[13px]">
				<caption className="sr-only">The Plan month by month</caption>
				<thead>
					<tr className="border-b text-muted-foreground">
						<th scope="col" className="px-(--card-pad) py-2.5 text-start font-medium">
							Month
						</th>
						{FIGURES.map((f) => (
							<th key={f.key} scope="col" className="px-(--card-pad) py-2.5 text-end font-medium">
								{f.label}
							</th>
						))}
					</tr>
				</thead>
				<tbody>
					{months.map((month) => (
						<tr
							key={month.month}
							className={cn(
								"border-b align-top",
								month.lumps.length > 0 && "bg-surface-2/60",
								month.when === "current" && "font-medium",
							)}
						>
							<th scope="row" className="px-(--card-pad) py-2.5 text-start font-medium">
								<span className="flex flex-wrap items-center gap-1.5">
									<Link
										to="/plan/$month"
										params={{ month: month.month }}
										className="hover:underline"
									>
										{monthName(month.month)}
									</Link>
									<MonthBadges month={month} />
								</span>
								{month.actual ? (
									<span className="block text-xs font-normal text-muted-foreground">
										{month.when === "current" ? "Actual so far" : "Actual"}
									</span>
								) : null}
							</th>
							{FIGURES.map((f) => (
								<td key={f.key} className="px-(--card-pad) py-2.5 text-end">
									<Figure month={month} figure={f.key} />
								</td>
							))}
						</tr>
					))}
				</tbody>
				<tfoot>
					<tr className="font-semibold">
						<th scope="row" className="px-(--card-pad) py-2.5 text-start">
							Planned for the year
						</th>
						{FIGURES.map((f) => (
							<td key={f.key} className="px-(--card-pad) py-2.5 text-end">
								<Amount cents={total(f.key)} />
							</td>
						))}
					</tr>
				</tfoot>
			</table>
		</Card>
	);
}

/** On a phone: a month to a row, its figures listed down with what actually happened beside them. */
function YearList({ months }: { months: YearMonth[] }) {
	return (
		<div className="md:hidden">
			<List aria-label="The Plan month by month">
				{months.map((month) => (
					<li
						key={month.month}
						className={cn(
							"grid gap-2 px-(--card-pad) py-3.5",
							month.lumps.length > 0 && "bg-surface-2/60",
						)}
					>
						<div className="flex items-center justify-between gap-3">
							<span className="flex min-w-0 flex-wrap items-center gap-1.5">
								<Link
									to="/plan/$month"
									params={{ month: month.month }}
									className="text-sm font-medium"
								>
									{monthName(month.month)}
								</Link>
								<MonthBadges month={month} />
							</span>
							{month.actual ? (
								<span className="text-xs text-muted-foreground">
									Plan · {month.when === "current" ? "so far" : "actual"}
								</span>
							) : null}
						</div>
						<dl className="grid gap-1 text-[13px]">
							{FIGURES.map((f) => (
								<div
									key={f.key}
									className={cn(
										"flex items-baseline justify-between gap-4",
										f.key === "freeToSpend" && "font-medium",
									)}
								>
									<dt className={cn(f.key !== "freeToSpend" && "text-muted-foreground")}>
										{f.label}
									</dt>
									<dd className="flex items-baseline gap-2 text-end">
										{f.key === "baseline" && month.noBaseline ? (
											<span className="text-muted-foreground">Not set</span>
										) : (
											<Amount cents={month.plan[f.key]} />
										)}
										{month.actual ? (
											<span className="text-muted-foreground">
												<span aria-hidden="true">· </span>
												<span className="sr-only">
													Actual{month.when === "current" ? " so far" : ""}:{" "}
												</span>
												<Amount cents={month.actual[f.key]} />
											</span>
										) : null}
									</dd>
								</div>
							))}
						</dl>
					</li>
				))}
			</List>
		</div>
	);
}
