import {
	type BucketState,
	type CoverSource,
	lastDayOf,
	type MonthState,
	monthOfDay,
} from "@noodle/domain";
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
import { type ReactNode, useState } from "react";
import { ulid } from "ulid";
import { asBucketColor, monogram } from "../../../buckets";
import { Commitments } from "../../../components/commitment-list";
import { ALittleOver, CoverSheet, CoversInto, sourceName } from "../../../components/cover";
import { type CoverVariables, useCovers } from "../../../covers";
import { formatMoney, monthName, shortDay } from "../../../format";
import { useMonthState } from "../../../queries";

export const Route = createFileRoute("/_authed/_household/month/$month/")({
	component: ThisMonth,
});

function ThisMonth() {
	const { month } = Route.useRouteContext();
	const state = useMonthState(month);
	const { cover, undo } = useCovers();
	// The overspent Bucket being covered, by ID, so the sheet follows its latest state.
	const [covering, setCovering] = useState<string | null>(null);
	const planned =
		state.baseline !== null || state.buckets.length > 0 || state.commitments.length > 0;
	// Commitments due this month, or paid anyway.
	const commitments = state.commitments.filter((c) => c.status !== "not-due");
	// Covers happen within the current month; earlier months are closed.
	const canCover = monthOfDay(state.asOf) === month;
	const over = canCover ? state.buckets.filter((b) => b.status === "over") : [];
	const coverVariables = (bucket: BucketState, source: CoverSource, amountCents: number) =>
		({
			moveId: ulid(),
			month,
			fromBucketId: source.bucket?.id ?? null,
			fromName: sourceName(source.bucket),
			toBucketId: bucket.id,
			toName: bucket.name,
			amountCents,
		}) satisfies CoverVariables;
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
					{over.length > 0 ? (
						<ALittleOver buckets={over} onCover={(bucket) => setCovering(bucket.id)} />
					) : null}
					{state.buckets.length > 0 ? (
						<Section aria-labelledby="buckets">
							<SectionHeader id="buckets" title="Buckets" count={state.buckets.length} />
							<List>
								{state.buckets.map((bucket) => {
									const covers = state.moves.filter((m) => m.toBucketId === bucket.id);
									return (
										<BucketRow
											key={bucket.id}
											bucket={bucket}
											covers={
												covers.length > 0 ? (
													<CoversInto
														moves={covers}
														buckets={state.buckets}
														onUndo={
															canCover
																? (move, fromName) =>
																		undo.mutate({
																			moveId: move.id,
																			month,
																			fromName,
																			toName: bucket.name,
																		})
																: undefined
														}
													/>
												) : null
											}
										/>
									);
								})}
							</List>
						</Section>
					) : null}
					{commitments.length > 0 ? (
						<Commitments month={month} asOf={state.asOf} commitments={commitments} />
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
			<CoverSheet
				state={state}
				bucket={over.find((b) => b.id === covering) ?? null}
				onOpenChange={(open) => {
					if (!open) setCovering(null);
				}}
				onCover={(source, amountCents) => {
					const bucket = over.find((b) => b.id === covering);
					setCovering(null);
					if (bucket) cover.mutate(coverVariables(bucket, source, amountCents));
				}}
			/>
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
							Your {state.committed > 0 ? "Commitments and Buckets" : "Buckets"} add up to{" "}
							{formatMoney(-state.freeToSpend)} more than your Baseline.{" "}
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

/**
 * A Bucket's vessel: what's left of what it has this month, draining as money is spent, against
 * its Pace tick. `covers` lists Covers into it.
 */
function BucketRow({ bucket, covers }: { bucket: BucketState; covers?: ReactNode }) {
	const color = asBucketColor(bucket.color);
	const share = (cents: number) => (bucket.available > 0 ? cents / bucket.available : 0);
	const left = Math.max(0, bucket.left);
	return (
		<ListRow
			aria-label={`${bucket.name}: ${formatMoney(left)} left of ${formatMoney(bucket.available)}${
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
			meta={[
				`${formatMoney(bucket.spent)} spent`,
				bucket.moved < 0 ? `${formatMoney(-bucket.moved)} moved out` : null,
			]
				.filter(Boolean)
				.join(" · ")}
			trailing={
				<>
					<span className="text-sm font-semibold tabular-nums">{formatMoney(left)}</span>
					<span className="text-xs text-subtle-foreground tabular-nums">
						of {formatMoney(bucket.available)}
					</span>
				</>
			}
			below={
				<div className="grid gap-1.5">
					<Meter
						bucket={color}
						left={share(bucket.left)}
						paceLeft={bucket.pace.leftShare}
						over={bucket.status === "over"}
					/>
					{covers}
				</div>
			}
		/>
	);
}
