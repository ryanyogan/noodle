import type { BucketState, MonthState } from "@noodle/domain";
import { lastDayOf } from "@noodle/domain";
import { Badge } from "@noodle/ui/components/badge";
import { Button } from "@noodle/ui/components/button";
import { Card } from "@noodle/ui/components/card";
import { EmptyState } from "@noodle/ui/components/empty-state";
import { List, ListRow } from "@noodle/ui/components/list";
import { Meter } from "@noodle/ui/components/meter";
import { PageHeader } from "@noodle/ui/components/page-header";
import { Section, SectionHeader } from "@noodle/ui/components/section";
import { Tile } from "@noodle/ui/components/tile";
import { cn } from "@noodle/ui/lib/utils";
import { createFileRoute, Link } from "@tanstack/react-router";
import { CalendarDays, SlidersHorizontal } from "lucide-react";
import { asBucketColor, monogram } from "../../../buckets";
import { formatMoney, monthName, shortDay } from "../../../format";
import { useMonthState } from "../../../queries";

export const Route = createFileRoute("/_authed/_household/month/$month/")({
	component: ThisMonth,
});

function ThisMonth() {
	const { month } = Route.useRouteContext();
	const state = useMonthState(month);
	const planned = state.baseline !== null || state.buckets.length > 0;
	return (
		<>
			<PageHeader
				eyebrow="This Month"
				title={monthName(month)}
				actions={
					planned ? (
						<Button variant="outline" size="sm" asChild>
							<Link to="/month/$month/plan" params={{ month }}>
								<SlidersHorizontal />
								Edit Plan
							</Link>
						</Button>
					) : null
				}
			/>
			{planned ? (
				<div className="grid max-w-2xl gap-8">
					<FreeToSpend state={state} />
					{state.buckets.length > 0 ? (
						<Section aria-labelledby="buckets">
							<SectionHeader id="buckets" title="Buckets" count={state.buckets.length} />
							<List>
								{state.buckets.map((bucket) => (
									<BucketRow key={bucket.id} bucket={bucket} />
								))}
							</List>
						</Section>
					) : null}
				</div>
			) : (
				<EmptyState
					icon={<CalendarDays />}
					title="Nothing planned yet"
					description="Set your Baseline and add Buckets to start this month’s Plan."
					action={
						<Button asChild>
							<Link to="/month/$month/plan" params={{ month }}>
								Set up the Plan
							</Link>
						</Button>
					}
				/>
			)}
		</>
	);
}

/** Free to Spend, said plainly, with where the rest of the month stands beneath it. */
function FreeToSpend({ state }: { state: MonthState }) {
	const overPlanned = state.freeToSpend < 0;
	return (
		<Card role="region" aria-labelledby="free-to-spend">
			<div className="grid gap-1 p-(--card-pad)">
				<h2 id="free-to-spend" className="text-[13px] font-medium text-muted-foreground">
					Free to Spend
				</h2>
				<p
					className={cn(
						"text-[2.75rem] font-[650] leading-[1.05] tracking-[-0.04em] tabular-nums",
						overPlanned && "text-over",
					)}
				>
					{formatMoney(state.freeToSpend)}
				</p>
				<p className="text-sm text-muted-foreground">
					{state.baseline === null ? (
						<>
							Set your Baseline to see what’s free.{" "}
							<PlanLink month={state.month}>Set Baseline</PlanLink>
						</>
					) : overPlanned ? (
						<>
							Your Buckets add up to {formatMoney(-state.freeToSpend)} more than your Baseline.{" "}
							<PlanLink month={state.month}>Adjust the Plan</PlanLink>
						</>
					) : (
						<>Not planned for anything yet · yours until {shortDay(lastDayOf(state.month))}</>
					)}
				</p>
			</div>
			<dl className="grid grid-cols-3 border-t">
				<Stat label="In Buckets" value={formatMoney(state.planned)} />
				<Stat label="Left in Buckets" value={formatMoney(state.leftInBuckets)} />
				<Stat label="Days left" value={String(state.daysLeft)} />
			</dl>
		</Card>
	);
}

function Stat({ label, value }: { label: string; value: string }) {
	return (
		<div className="grid gap-0.5 px-(--card-pad) py-3.5 [&+&]:border-s">
			<dt className="text-xs font-medium text-muted-foreground">{label}</dt>
			<dd className="text-base font-semibold tracking-[-0.01em] tabular-nums">{value}</dd>
		</div>
	);
}

function PlanLink({ month, children }: { month: MonthState["month"]; children: string }) {
	return (
		<Link
			to="/month/$month/plan"
			params={{ month }}
			className="font-medium text-foreground underline decoration-border-strong underline-offset-3 hover:decoration-foreground"
		>
			{children}
		</Link>
	);
}

/** A Bucket's vessel: what's left, draining as money is spent, against its Pace tick. */
function BucketRow({ bucket }: { bucket: BucketState }) {
	const color = asBucketColor(bucket.color);
	const share = (cents: number) => (bucket.allowance > 0 ? cents / bucket.allowance : 0);
	const left = Math.max(0, bucket.left);
	return (
		<ListRow
			aria-label={`${bucket.name}: ${formatMoney(left)} left of ${formatMoney(bucket.allowance)}${
				bucket.status === "over"
					? `, over by ${formatMoney(-bucket.left)}`
					: bucket.status === "ahead"
						? ", ahead of Pace"
						: ""
			}`}
			leading={<Tile bucket={color}>{monogram(bucket.name)}</Tile>}
			title={bucket.name}
			badge={
				bucket.status === "over" ? (
					<Badge variant="over" dot>
						Over by {formatMoney(-bucket.left)}
					</Badge>
				) : bucket.status === "ahead" ? (
					<Badge variant="pace" dot>
						Ahead of Pace
					</Badge>
				) : null
			}
			meta={`${formatMoney(bucket.spent)} spent`}
			trailing={
				<>
					<span className="text-sm font-semibold tabular-nums">{formatMoney(left)}</span>
					<span className="text-xs text-subtle-foreground tabular-nums">
						of {formatMoney(bucket.allowance)}
					</span>
				</>
			}
			below={
				<Meter
					bucket={color}
					left={share(bucket.left)}
					paceLeft={bucket.pace.leftShare}
					over={bucket.status === "over"}
				/>
			}
		/>
	);
}
