import { type ForTotals, monthKeyAt, type SpendTotal } from "@noodle/domain";
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
import { getRouteApi } from "@tanstack/react-router";
import { asBucketColor, monogram } from "../buckets";
import { formatMoney, monthName } from "../format";
import { useForTotals } from "../members";

// What each Child cost this month and the year so far, by Bucket: Reports › People shows it under
// the trend (#69), where the Household page used to. It reads the Household's current month, so the
// Reports route loads that month and the months before it when People is open.

const household_ = getRouteApi("/_authed/_household");

/** A Child as both the Members list and a Report's meta name them. */
type CostChild = { id: string; name: string; color: number | null };

/**
 * What each Child cost this month and this year, by Bucket. Spending For Everyone is the
 * Household's, counted once and never again under each Child.
 */
export function ChildCosts({ of: children }: { of: CostChild[] }) {
	const { household } = household_.useRouteContext();
	const month = monthKeyAt(new Date(), household.timeZone);
	const totals = useForTotals(month);
	return (
		<Section aria-labelledby="child-costs">
			<SectionHeader
				id="child-costs"
				title="What each Child cost, by Bucket"
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
			{children.map((child) => (
				<ChildCost key={child.id} child={child} totals={totals} />
			))}
			<p className="text-[13px] text-muted-foreground">
				Spending For Everyone counts once, for the whole Household:{" "}
				{formatMoney(totals.month.household.total)} this month,{" "}
				{formatMoney(totals.yearToDate.household.total)} this year.
			</p>
		</Section>
	);
}

const noSpending: SpendTotal = { total: 0, buckets: {} };

function ChildCost({
	child,
	totals,
}: {
	child: CostChild;
	totals: {
		month: ForTotals;
		yearToDate: ForTotals;
		buckets: ReturnType<typeof useForTotals>["buckets"];
	};
}) {
	const month = totals.month.members[child.id] ?? noSpending;
	const year = totals.yearToDate.members[child.id] ?? noSpending;
	// The year includes the month, so its Buckets are every Bucket spent from.
	const rows = totals.buckets
		.filter((bucket) => year.buckets[bucket.id])
		.sort((a, b) => (year.buckets[b.id] ?? 0) - (year.buckets[a.id] ?? 0));
	const headingId = `child-cost-${child.id}`;
	return (
		<Card role="region" aria-labelledby={headingId}>
			<div className="flex items-center gap-3 px-(--card-pad) py-3.5">
				<Tile bucket={asBucketColor(child.color ?? 1)}>{monogram(child.name)}</Tile>
				<h3 id={headingId} className="flex-1 truncate text-sm font-medium">
					{child.name}
				</h3>
				{year.total === 0 ? <Badge>Nothing yet</Badge> : null}
			</div>
			{year.total > 0 ? (
				// A phone gets a list (each Bucket's name whole, its two amounts beneath); sm+ the table.
				<ul
					aria-label={`What ${child.name} cost, by Bucket`}
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
								className="ms-4 text-[13px] text-muted-foreground tabular-nums"
								parts={[
									`This month ${formatMoney(month.buckets[bucket.id] ?? 0)}`,
									`This year ${formatMoney(year.buckets[bucket.id] ?? 0)}`,
								]}
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
			{year.total > 0 ? (
				<Table className="border-t text-sm max-sm:hidden sm:table-fixed">
					<TableCaption className="sr-only">What {child.name} cost, by Bucket</TableCaption>
					<TableHeader>
						<TableRow className="border-0">
							<TableHead
								scope="col"
								className="px-(--card-pad) first:ps-(--card-pad) last:pe-(--card-pad) h-auto pt-2.5 pb-1.5"
							>
								Bucket
							</TableHead>
							<TableHead scope="col" numeric className="h-auto px-2 pt-2.5 pb-1.5 sm:w-28">
								This month
							</TableHead>
							<TableHead
								scope="col"
								numeric
								className="px-(--card-pad) first:ps-(--card-pad) last:pe-(--card-pad) h-auto pt-2.5 pb-1.5 sm:w-28"
							>
								This year
							</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{rows.map((bucket) => (
							<TableRow key={bucket.id} className="border-0">
								<th scope="row" className="px-(--card-pad) py-1.5 text-start font-normal">
									<span className="flex items-center gap-2">
										<span
											aria-hidden="true"
											className="size-2 shrink-0 rounded-[2px]"
											style={{ background: `var(--bucket-${asBucketColor(bucket.color)})` }}
										/>
										<span className="min-w-0 break-words">{bucket.name}</span>
									</span>
								</th>
								<TableCell numeric className="px-2 py-1.5">
									{formatMoney(month.buckets[bucket.id] ?? 0)}
								</TableCell>
								<TableCell
									numeric
									className="px-(--card-pad) first:ps-(--card-pad) last:pe-(--card-pad) py-1.5"
								>
									{formatMoney(year.buckets[bucket.id] ?? 0)}
								</TableCell>
							</TableRow>
						))}
					</TableBody>
					<TableFooter className="bg-transparent">
						<TableRow className="font-semibold">
							<th scope="row" className="px-(--card-pad) py-2.5 text-start">
								Total
							</th>
							<TableCell numeric className="px-2 py-2.5">
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
