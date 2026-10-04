import type { MonthKey, YearFigures, YearMonth } from "@noodle/domain";
import { Badge } from "@noodle/ui/components/badge";
import { Button } from "@noodle/ui/components/button";
import { Card } from "@noodle/ui/components/card";
import { EmptyState } from "@noodle/ui/components/empty-state";
import { List } from "@noodle/ui/components/list";
import { Money } from "@noodle/ui/components/money";
import { Section, SectionHeader } from "@noodle/ui/components/section";
import {
	Table,
	TableBody,
	TableCaption,
	TableCell,
	TableFooter,
	TableHead,
	TableHeader,
	TableRow,
} from "@noodle/ui/components/table";
import { cn } from "@noodle/ui/lib/utils";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { CalendarRange, ChevronLeft, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { lumpText } from "../../../components/coming-up";
import { SectionPending } from "../../../components/section-layout";
import { TermHelp } from "../../../components/term-help";
import { monthName } from "../../../format";
import { yearQuery } from "../../../queries";
import { FIRST_YEAR } from "../../../server/year";

// The year at a glance: each month's Plan from take-home pay down to Free to Spend, what actually
// happened beneath it for months over or under way, and the lumpy months picked out. Each month
// opens its Plan. A tab of the month's Plan, showing the year that month is in.
export const Route = createFileRoute("/_authed/_household/plan/$month/year")({
	beforeLoad: ({ context }) => {
		const year = Number(context.month.slice(0, 4));
		if (year < FIRST_YEAR) throw notFound();
		return { year };
	},
	loader: async ({ context }) => {
		const data = await context.queryClient.ensureQueryData(yearQuery(context.year));
		if (data === null) throw notFound();
	},
	pendingComponent: SectionPending,
	component: YearPage,
});

const FIGURES: { key: keyof YearFigures; label: string }[] = [
	{ key: "baseline", label: "Take-home pay" },
	{ key: "commitments", label: "Commitments" },
	{ key: "allowances", label: "Buckets & allowances" },
	{ key: "goalFunding", label: "Goal funding" },
	{ key: "freeToSpend", label: "Free to Spend" },
];

function YearPage() {
	const { year, month: shown } = Route.useRouteContext();
	const data = useSuspenseQuery(yearQuery(year)).data;
	// The loader 404s a year outside the Plan; this only guards the types.
	if (data === null) return null;
	const { current, lastYear } = data;
	// Months before the Household planned anything are all "Not set" and $0: fold them into a line.
	const start = data.months.findIndex((m) => !isBlank(m));
	const months = start > 0 ? data.months.slice(start) : data.months;
	const lumpy = months.filter((m) => m.lumps.length > 0);
	// A new Household: a table of "Not set" and $0 would say nothing.
	const nothingPlanned = data.months.every(unplanned);
	return (
		<>
			{/* The Plan's header names the month; this names its year, with the years either side. */}
			<div className="mb-4 flex min-h-11 items-center justify-between gap-3">
				<h2 className="text-lg font-semibold tracking-[-0.015em]">{year}</h2>
				<YearLinks year={year} lastYear={lastYear} month={shown} />
			</div>
			{nothingPlanned ? (
				<EmptyState
					className="max-w-3xl"
					icon={<CalendarRange />}
					title={`Your ${year} appears once the Plan is set up`}
					description="Month by month, from what comes in to what’s free to spend, with the months that cost more picked out."
					action={
						<Button variant="outline" size="sm" asChild>
							<Link to="/plan/$month" params={{ month: current }}>
								Set up the Plan
							</Link>
						</Button>
					}
				/>
			) : (
				<div className="grid gap-8">
					<p className="max-w-prose text-[13px] text-muted-foreground max-md:hidden">
						Each month’s Plan, from take-home pay down to Free to Spend, as the Plan shows it.
						Months over or under way show what actually happened beneath it: income received,
						spending, and Goal funding. Beneath Free to Spend, that’s the income received less the
						spending and Goal funding, so this month it’s only what’s come in so far. Later months
						are the Plan as it stands, with each dated Goal funded what it needs.
					</p>
					{start > 0 && months[0] ? (
						<p className="text-[13px] text-muted-foreground">
							Nothing was planned before {monthName(months[0].month)}.
						</p>
					) : null}
					<div className="grid gap-3 max-md:hidden">
						<YearLegend />
						<YearTable months={months} />
					</div>
					<YearList months={months} />
					{lumpy.length > 0 ? (
						<Section aria-labelledby="year-lumpy">
							<SectionHeader
								id="year-lumpy"
								title="Lumpy months"
								help={<TermHelp term="lumpy-month" />}
							/>
							<List>
								{lumpy.map(({ month, lumps }) => (
									<li key={month} className="grid gap-0.5 px-(--card-pad) py-3">
										{/* The month's name in the table above is its link (#73). */}
										<p className="text-sm font-medium">{monthName(month)}</p>
										<p className="text-[13px] text-muted-foreground">{lumpText(lumps, month)}</p>
									</li>
								))}
							</List>
						</Section>
					) : null}
				</div>
			)}
		</>
	);
}

function YearLinks({
	year,
	lastYear,
	month,
}: {
	year: number;
	lastYear: number;
	/** The month whose Plan this is a tab of: another year opens on the same month of it. */
	month: MonthKey;
}) {
	const link = (to: number, label: string, icon: ReactNode) => (
		<Button variant="ghost" size="icon" asChild>
			<Link
				to="/plan/$month/year"
				params={{ month: `${to}-${month.slice(5)}` }}
				resetScroll={false}
				aria-label={label}
			>
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

const empty = (figures: YearFigures | null) =>
	figures === null || Object.values(figures).every((cents) => cents === 0);

/** A month with no take-home pay and nothing planned or spent. */
const unplanned = (month: YearMonth) =>
	month.noBaseline && empty(month.plan) && empty(month.actual);

/** A past month with no take-home pay and nothing planned or spent. */
const isBlank = (month: YearMonth) => month.when === "past" && unplanned(month);

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
	return <Money cents={cents} flagNegative className={className} />;
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

/** From a tablet up: what each cell's two lines are. */
function YearLegend() {
	return (
		<p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground max-md:hidden">
			<span>
				<span className="font-medium text-foreground">Top:</span> the Plan
			</span>
			<span>
				<span className="font-medium text-foreground">Below:</span> what actually happened, for
				months over or under way
			</span>
		</p>
	);
}

/** From a tablet up: the months as rows of one table, the Plan's figures across. */
function YearTable({ months }: { months: YearMonth[] }) {
	const total = (key: keyof YearFigures) => months.reduce((sum, m) => sum + m.plan[key], 0);
	return (
		<Card className="max-md:hidden">
			<Table>
				<TableCaption className="sr-only">The Plan month by month</TableCaption>
				<TableHeader>
					<TableRow>
						<TableHead
							scope="col"
							className="px-(--card-pad) first:ps-(--card-pad) last:pe-(--card-pad)"
						>
							Month
						</TableHead>
						{FIGURES.map((f) => (
							<TableHead
								key={f.key}
								scope="col"
								numeric
								className="px-(--card-pad) first:ps-(--card-pad) last:pe-(--card-pad)"
							>
								{f.label}
							</TableHead>
						))}
					</TableRow>
				</TableHeader>
				<TableBody>
					{months.map((month) => (
						<TableRow
							key={month.month}
							className={cn("align-top", month.when === "current" && "font-medium")}
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
								<TableCell
									key={f.key}
									numeric
									className="px-(--card-pad) first:ps-(--card-pad) last:pe-(--card-pad) py-2.5"
								>
									<Figure month={month} figure={f.key} />
								</TableCell>
							))}
						</TableRow>
					))}
				</TableBody>
				<TableFooter>
					<TableRow className="font-semibold">
						<th scope="row" className="px-(--card-pad) py-2.5 text-start">
							Planned for the year
						</th>
						{FIGURES.map((f) => (
							<TableCell
								key={f.key}
								numeric
								className="px-(--card-pad) first:ps-(--card-pad) last:pe-(--card-pad) py-2.5"
							>
								<Amount cents={total(f.key)} />
							</TableCell>
						))}
					</TableRow>
				</TableFooter>
			</Table>
		</Card>
	);
}

/**
 * On a phone (#74): one row per month, its Free to Spend on the right with what actually happened
 * beneath it. The rest of each month's figures are on its Plan, which the month's name opens.
 */
function YearList({ months }: { months: YearMonth[] }) {
	return (
		<div className="grid gap-2 md:hidden">
			<p
				aria-hidden="true"
				className="flex justify-between gap-3 px-(--card-pad) text-xs text-muted-foreground"
			>
				<span>Month</span>
				<span>Free to Spend</span>
			</p>
			<List aria-label="The Plan month by month">
				{months.map((month) => (
					<li
						key={month.month}
						className="flex items-center justify-between gap-3 px-(--card-pad) py-1.5"
					>
						<span className="flex min-w-0 flex-wrap items-center gap-1.5">
							<Link
								to="/plan/$month"
								params={{ month: month.month }}
								className="inline-flex min-h-11 min-w-11 items-center text-sm font-medium"
							>
								{monthName(month.month)}
							</Link>
							<MonthBadges month={month} />
						</span>
						<span className="shrink-0 text-end text-sm font-medium tabular-nums">
							<span className="sr-only">Free to Spend: </span>
							<Amount cents={month.plan.freeToSpend} />
							{month.actual ? (
								<span className="block text-xs font-normal text-muted-foreground">
									{month.when === "current" ? "So far " : "Actual "}
									<Amount cents={month.actual.freeToSpend} />
								</span>
							) : null}
						</span>
					</li>
				))}
			</List>
		</div>
	);
}
