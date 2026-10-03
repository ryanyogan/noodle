import type { MonthKey, PlanWarning } from "@noodle/domain";
import { Badge } from "@noodle/ui/components/badge";
import { List } from "@noodle/ui/components/list";
import { RowButton } from "@noodle/ui/components/row-button";
import { Section, SectionHeader } from "@noodle/ui/components/section";
import { cn } from "@noodle/ui/lib/utils";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Link, type LinkProps, useHydrated } from "@tanstack/react-router";
import { ChevronDown, ChevronRight, CircleAlert, TriangleAlert } from "lucide-react";
import { useId, useState } from "react";
import { formatMoney, fullDay, monthName } from "../format";
import { planHealthQuery } from "../queries";

/**
 * Plan health: what in the Plan needs attention now, each warning opening the page that fixes
 * it. Nothing shows while the Plan is healthy. `folded` (the Plan overview, #65): on a phone it's
 * one line naming the most urgent, opened on a tap, so Free to Spend stays above the fold.
 */
export function PlanHealth({ folded = false }: { folded?: boolean }) {
	const { warnings, month } = useSuspenseQuery(planHealthQuery()).data;
	const [open, setOpen] = useState(false);
	const hydrated = useHydrated();
	const id = useId();
	if (warnings.length === 0) return null;
	const sorted = [...warnings].sort((a, b) => urgency[a.kind] - urgency[b.kind]);
	const first = sorted[0];
	return (
		<Section aria-labelledby="plan-health">
			<div className={cn(folded && "max-lg:hidden")}>
				<SectionHeader id="plan-health" title="Things to check" count={warnings.length} />
			</div>
			{folded && first ? (
				<RowButton
					variant="bordered"
					aria-expanded={open}
					aria-controls={id}
					disabled={!hydrated}
					onClick={() => setOpen((o) => !o)}
					className="min-h-11 min-w-0 justify-start gap-2 bg-card lg:hidden"
				>
					<span className="text-sm font-semibold">Things to check</span>
					<Badge variant="count">{warnings.length}</Badge>
					<span className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground">
						{describe(first, month).title}
					</span>
					<ChevronDown
						aria-hidden="true"
						className={cn("size-4 shrink-0 text-muted-foreground transition-transform", {
							"rotate-180": open,
						})}
					/>
				</RowButton>
			) : null}
			<List id={id} className={cn(folded && !open && "max-lg:hidden")}>
				{sorted.map((warning) => (
					<HealthRow key={keyOf(warning)} warning={warning} month={month} />
				))}
			</List>
		</Section>
	);
}

const keyOf = (warning: PlanWarning) =>
	warning.kind === "bucket-over"
		? `${warning.kind}:${warning.bucketId}`
		: warning.kind === "goal-late"
			? `${warning.kind}:${warning.goalId}`
			: warning.kind;

/** Most urgent first: money running out, then income, then advice. */
const urgency: Record<PlanWarning["kind"], number> = {
	"negative-ahead": 0,
	"income-behind": 1,
	"goal-late": 2,
	"bucket-over": 3,
};

const monthsText = (n: number) => `${n} month${n === 1 ? "" : "s"}`;

/** What a warning says, and where its fix is. */
function describe(
	warning: PlanWarning,
	month: MonthKey,
): { title: string; meta: string; link: LinkProps } {
	switch (warning.kind) {
		case "negative-ahead":
			return {
				title: `Free to Spend goes below zero in ${monthName(warning.month)}`,
				meta:
					warning.months > 1
						? `${formatMoney(warning.freeToSpend)} then, and below zero in ${monthsText(warning.months)} of the next 12. Lower an amount, or raise your take-home pay if it has gone up.`
						: `${formatMoney(warning.freeToSpend)} in the Plan as it stands. Lower an amount, or raise your take-home pay if it has gone up.`,
				link: { to: "/plan/$month", params: { month: warning.month } },
			};
		case "income-behind":
			return {
				title: "Income is behind your take-home pay",
				meta: `${formatMoney(warning.received)} received by now, ${formatMoney(warning.expected)} expected. If that’s the new normal, lower your take-home pay.`,
				link: { to: "/plan/$month/income", params: { month: warning.month } },
			};
		case "bucket-over":
			return {
				title: `${warning.name} is over its allowance most months`,
				meta: `Over in ${warning.over} of the last ${monthsText(warning.months)}${warning.gap > 0 ? `, ${formatMoney(warning.gap)} beyond it in all` : ""}. Its allowance may be too low.`,
				link: { to: "/plan/$month/buckets/$id", params: { month, id: warning.bucketId } },
			};
		case "goal-late":
			return {
				title: `${warning.name} won’t be reached by ${fullDay(warning.targetDate)}`,
				meta:
					warning.reachedIn === null
						? "It hasn’t grown lately. Fund it more, or move its date."
						: `At its recent pace it gets there in ${monthName(warning.reachedIn)} ${warning.reachedIn.slice(0, 4)}. Fund it more, or move its date.`,
				link: { to: "/goals/$goalId", params: { goalId: warning.goalId } },
			};
	}
}

function HealthRow({ warning, month }: { warning: PlanWarning; month: MonthKey }) {
	const { title, meta, link } = describe(warning, month);
	// The whole row opens the fix, though the link's name is just the warning.
	return (
		<li
			className={cn(
				"relative grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3 px-(--card-pad) py-3.5",
				"transition-colors duration-(--duration-fast) ease-standard hover:bg-surface-2/60",
				"has-focus-visible:outline-2 has-focus-visible:-outline-offset-2 has-focus-visible:outline-ring",
			)}
		>
			{warning.kind === "negative-ahead" ? (
				<CircleAlert aria-hidden="true" className="mt-0.5 size-4 text-over" />
			) : (
				<TriangleAlert aria-hidden="true" className="mt-0.5 size-4 text-pace" />
			)}
			<div className="grid min-w-0 gap-0.5">
				<Link {...link} className="text-sm font-medium outline-none after:absolute after:inset-0">
					{title}
				</Link>
				<p className="text-[13px] text-muted-foreground">{meta}</p>
			</div>
			<ChevronRight aria-hidden="true" className="mt-0.5 size-4 text-subtle-foreground" />
		</li>
	);
}
