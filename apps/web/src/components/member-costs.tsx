import { EVERYONE, type MonthKey, monthKeyAt, type SpendTotal } from "@noodle/domain";
import { Badge } from "@noodle/ui/components/badge";
import { Card } from "@noodle/ui/components/card";
import { MetaParts } from "@noodle/ui/components/meta-parts";
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
import { Tile } from "@noodle/ui/components/tile";
import { getRouteApi, Link } from "@tanstack/react-router";
import { Users } from "lucide-react";
import type { ReactNode } from "react";
import { asBucketColor, monogram } from "../buckets";
import { formatMoney, monthName } from "../format";
import { useForTotals } from "../members";

// Where the money went for each person this month and the year so far, by Bucket: Reports › People
// shows it under the trend (#69), for every Member, Parents too, and For Everyone as its own entry
// (issue 155). It reads the Household's current month, so the Reports route loads that month and the
// months before it when People is open. Every figure leads to the Transactions behind it: the
// month's to the Bucket's page narrowed by who it was For, the year's to Transactions.

const household_ = getRouteApi("/_authed/_household");

/** A Member as both the Members list and a Report's meta name them. */
type CostMember = { id: string; name: string; color: number | null };

type Totals = ReturnType<typeof useForTotals>;
type CostBucket = Totals["buckets"][number];

/**
 * What was spent For each of `people` this month and this year, by Bucket, and with `everyone`
 * what was spent For Everyone: the Household's, counted once in its own entry and never again
 * under each person. Spending For several people counts evenly for each, so the entries add up
 * to what was spent.
 */
export function MemberCosts({ of: people, everyone }: { of: CostMember[]; everyone: boolean }) {
	const { household } = household_.useRouteContext();
	const month = monthKeyAt(new Date(), household.timeZone);
	const totals = useForTotals(month);
	return (
		<Section aria-labelledby="member-costs">
			<SectionHeader
				id="member-costs"
				title="Where the money went for each person, by Bucket"
				action={
					<span className="text-[13px] text-muted-foreground max-sm:hidden">
						{monthName(month)} and {month.slice(0, 4)} so far
					</span>
				}
			/>
			{/* On a phone the heading and the months don't fit one line, so the months go under it. */}
			<p className="-mt-2 text-[13px] text-muted-foreground sm:hidden">
				{monthName(month)} and {month.slice(0, 4)} so far
			</p>
			{people.map((person) => (
				<Cost
					key={person.id}
					who={person.id}
					name={person.name}
					tile={
						<Tile bucket={person.color ? asBucketColor(person.color) : undefined}>
							{monogram(person.name)}
						</Tile>
					}
					month={month}
					totals={totals}
					spent={{
						month: totals.month.members[person.id],
						year: totals.yearToDate.members[person.id],
					}}
				/>
			))}
			{everyone ? (
				<Cost
					who={EVERYONE}
					name="Everyone"
					tile={
						<Tile>
							<Users aria-hidden="true" />
						</Tile>
					}
					month={month}
					totals={totals}
					spent={{ month: totals.month.household, year: totals.yearToDate.household }}
				/>
			) : null}
			<p className="text-[13px] text-muted-foreground">
				Spending for several people counts evenly for each. Spending for Everyone is the whole
				Household’s: it has its own entry and isn’t shared out between the people. Choose a figure
				to see the Transactions behind it.
			</p>
		</Section>
	);
}

const noSpending: SpendTotal = { total: 0, buckets: {} };

const FIGURE_LINK =
	"rounded-sm underline decoration-border underline-offset-4 hover:decoration-current focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/**
 * One figure, leading to the Transactions behind it. Nothing spent, or the other Parent's Personal
 * Allowance (a total only, ADR-0003), is the amount alone.
 */
function Figure({
	who,
	name,
	bucket,
	month,
	period,
	amount,
	prefix,
}: {
	who: string;
	name: string;
	bucket: CostBucket;
	month: MonthKey;
	period: "month" | "year";
	amount: number;
	/** What a phone's line says before the amount, where no column heading does. */
	prefix?: string;
}) {
	const text = `${prefix ? `${prefix} ` : ""}${formatMoney(amount)}`;
	if (amount === 0 || bucket.private) return <span>{text}</span>;
	const label = `${name}, ${bucket.name}, ${
		period === "month" ? monthName(month) : `${month.slice(0, 4)} so far`
	}: ${formatMoney(amount)}. See the Transactions`;
	return period === "month" ? (
		<Link
			to="/plan/$month/buckets/$id"
			params={{ month, id: bucket.id }}
			search={{ for: who }}
			aria-label={label}
			className={FIGURE_LINK}
		>
			{text}
		</Link>
	) : (
		<Link
			to="/transactions/$month"
			params={{ month }}
			search={{ bucket: bucket.id, for: who, range: "year" }}
			aria-label={label}
			className={FIGURE_LINK}
		>
			{text}
		</Link>
	);
}

function Cost({
	who,
	name,
	tile,
	month: monthKey,
	totals,
	spent,
}: {
	/** A Member's ID, or EVERYONE. */
	who: string;
	name: string;
	tile: ReactNode;
	month: MonthKey;
	totals: Totals;
	spent: { month: SpendTotal | undefined; year: SpendTotal | undefined };
}) {
	const month = spent.month ?? noSpending;
	const year = spent.year ?? noSpending;
	// The year includes the month, so its Buckets are every Bucket spent from.
	const rows = totals.buckets
		.filter((bucket) => year.buckets[bucket.id])
		.sort((a, b) => (year.buckets[b.id] ?? 0) - (year.buckets[a.id] ?? 0));
	const headingId = `member-cost-${who}`;
	const caption = `Where the money went for ${name}, by Bucket`;
	const figure = (bucket: CostBucket, period: "month" | "year", prefix?: string) => (
		<Figure
			who={who}
			name={name}
			bucket={bucket}
			month={monthKey}
			period={period}
			amount={(period === "month" ? month : year).buckets[bucket.id] ?? 0}
			prefix={prefix}
		/>
	);
	return (
		<Card role="region" aria-labelledby={headingId}>
			<div className="flex items-center gap-3 px-(--card-pad) py-3.5">
				{tile}
				<h3 id={headingId} className="flex-1 truncate text-sm font-medium">
					{name}
				</h3>
				{rows.length === 0 ? <Badge>Nothing yet</Badge> : null}
			</div>
			{rows.length > 0 ? (
				// A phone gets a list (each Bucket's name whole, its two amounts beneath); sm+ the table.
				<ul
					aria-label={caption}
					className="grid gap-2.5 border-t px-(--card-pad) py-3 text-sm sm:hidden"
				>
					{rows.map((bucket) => (
						<li key={bucket.id} className="grid gap-0.5">
							<span className="flex items-center gap-2">
								<span
									aria-hidden="true"
									className="size-2 shrink-0 rounded-[2px]"
									style={{ background: `var(--bucket-${asBucketColor(bucket.color)})` }}
								/>
								<span className="min-w-0 break-words">{bucket.name}</span>
							</span>
							<MetaParts
								className="ms-4 py-1 text-[13px] text-muted-foreground tabular-nums"
								parts={[figure(bucket, "month", "This month"), figure(bucket, "year", "This year")]}
							/>
						</li>
					))}
					<li className="grid gap-0.5 border-t pt-2.5 font-semibold">
						<span>Total</span>
						<MetaParts
							className="tabular-nums"
							parts={[
								`This month ${formatMoney(month.total)}`,
								`This year ${formatMoney(year.total)}`,
							]}
						/>
					</li>
				</ul>
			) : null}
			{rows.length > 0 ? (
				<Table className="border-t text-sm max-sm:hidden sm:table-fixed">
					<TableCaption className="sr-only">{caption}</TableCaption>
					<TableHeader>
						<TableRow>
							<TableHead
								scope="col"
								className="px-(--card-pad) first:ps-(--card-pad) last:pe-(--card-pad)"
							>
								Bucket
							</TableHead>
							<TableHead scope="col" numeric className="sm:w-28">
								This month
							</TableHead>
							<TableHead
								scope="col"
								numeric
								className="px-(--card-pad) first:ps-(--card-pad) last:pe-(--card-pad) sm:w-28"
							>
								This year
							</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{rows.map((bucket) => (
							<TableRow key={bucket.id} className="border-0">
								<th scope="row" className="px-(--card-pad) py-2 text-start font-normal">
									<span className="flex items-center gap-2">
										<span
											aria-hidden="true"
											className="size-2 shrink-0 rounded-[2px]"
											style={{ background: `var(--bucket-${asBucketColor(bucket.color)})` }}
										/>
										<span className="min-w-0 break-words">{bucket.name}</span>
									</span>
								</th>
								<TableCell numeric>{figure(bucket, "month")}</TableCell>
								<TableCell
									numeric
									className="px-(--card-pad) first:ps-(--card-pad) last:pe-(--card-pad)"
								>
									{figure(bucket, "year")}
								</TableCell>
							</TableRow>
						))}
					</TableBody>
					<TableFooter className="bg-transparent">
						<TableRow className="font-semibold">
							<th scope="row" className="px-(--card-pad) py-2.5 text-start">
								Total
							</th>
							<TableCell numeric className="py-2.5">
								{formatMoney(month.total)}
							</TableCell>
							<TableCell
								numeric
								className="px-(--card-pad) first:ps-(--card-pad) last:pe-(--card-pad) py-2.5"
							>
								{formatMoney(year.total)}
							</TableCell>
						</TableRow>
					</TableFooter>
				</Table>
			) : null}
		</Card>
	);
}
