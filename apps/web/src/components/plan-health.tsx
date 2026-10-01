import type { PlanWarning } from "@noodle/domain";
import { List } from "@noodle/ui/components/list";
import { Section, SectionHeader } from "@noodle/ui/components/section";
import { cn } from "@noodle/ui/lib/utils";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Link, type LinkProps } from "@tanstack/react-router";
import { ChevronRight, CircleAlert } from "lucide-react";
import { formatMoney, fullDay, monthName } from "../format";
import { planHealthQuery } from "../queries";

/**
 * Plan health: what in the Plan needs attention now, each warning opening the page that fixes
 * it. Nothing shows while the Plan is healthy.
 */
export function PlanHealth() {
	const { warnings } = useSuspenseQuery(planHealthQuery()).data;
	if (warnings.length === 0) return null;
	return (
		<Section aria-labelledby="plan-health">
			<SectionHeader id="plan-health" title="Plan health" count={warnings.length} />
			<List>
				{warnings.map((warning) => (
					<HealthRow key={keyOf(warning)} warning={warning} />
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

const monthsText = (n: number) => `${n} month${n === 1 ? "" : "s"}`;

/** What a warning says, and where its fix is. */
function describe(warning: PlanWarning): { title: string; meta: string; link: LinkProps } {
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
				link: { to: "/plan/buckets/$id", params: { id: warning.bucketId } },
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

function HealthRow({ warning }: { warning: PlanWarning }) {
	const { title, meta, link } = describe(warning);
	// The whole row opens the fix, though the link's name is just the warning.
	return (
		<li
			className={cn(
				"relative grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3 px-(--card-pad) py-3.5",
				"transition-colors duration-(--duration-fast) ease-standard hover:bg-surface-2/60",
				"has-focus-visible:outline-2 has-focus-visible:-outline-offset-2 has-focus-visible:outline-ring",
			)}
		>
			<CircleAlert aria-hidden="true" className="mt-0.5 size-4 text-over" />
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
