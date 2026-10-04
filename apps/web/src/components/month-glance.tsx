import type { MonthState } from "@noodle/domain";
import { cn } from "@noodle/ui/lib/utils";
import { formatMoney } from "../format";

/**
 * This Month at a glance (#64): one sentence saying how the month is going, from the numbers.
 * Null for an ended month or one without take-home pay, where the card says what to do instead.
 */
export function monthSentence(state: MonthState): string | null {
	if (state.baseline === null || state.month < state.asOf.slice(0, 7)) return null;
	if (state.freeToSpend < 0) return null;
	const over = state.buckets.filter((b) => b.status === "over").map((b) => b.name);
	const ahead = state.buckets.filter((b) => b.status === "ahead").map((b) => b.name);
	const days =
		state.daysLeft === 0
			? "on the last day of the month"
			: `with ${state.daysLeft} ${state.daysLeft === 1 ? "day" : "days"} left`;
	const lead = over.length > 0 ? "Heads up" : ahead.length > 0 ? "Mostly on track" : "On track";
	return [
		`${lead}: ${formatMoney(state.freeToSpend)} free to spend ${days}.`,
		over.length > 0 ? `${names(over)} ${over.length === 1 ? "is" : "are"} over.` : null,
		ahead.length > 0
			? ahead.length > 2
				? `${ahead.length} Buckets are running ahead.`
				: `${names(ahead)} ${ahead.length === 1 ? "is" : "are"} running ahead.`
			: null,
	]
		.filter(Boolean)
		.join(" ");
}

const names = (list: string[]) =>
	list.length <= 2 ? list.join(" and ") : `${list.length} Buckets`;

type Segment = {
	key: string;
	label: string;
	amount: number;
	/** The swatch and segment: neutral inks (ADR-0008 keeps hue for Buckets and Pace), told apart by
	 * shade, a stripe and the legend's order, which is the bar's order. */
	className: string;
};

/**
 * Where take-home pay goes this month, as one stacked bar: Commitments, Buckets spent and left,
 * Goals, then Free to Spend. The legend under it is the text version (amounts in words), so the
 * bar itself is hidden from screen readers.
 */
export function MonthGlance({
	state,
	labelledBy,
	className,
}: {
	state: MonthState;
	/** The id of the line naming the list ("Where $6,200 take-home pay goes"). */
	labelledBy?: string;
	className?: string;
}) {
	const segments = monthSegments(state);
	const total = segments.reduce((sum, s) => sum + Math.max(0, s.amount), 0);
	if (total <= 0) return null;
	return (
		<div className={cn("grid gap-2.5", className)}>
			<div aria-hidden="true" className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full">
				{segments.map((s) =>
					s.amount > 0 ? (
						<span
							key={s.key}
							data-segment={s.key}
							className={cn("h-full min-w-1", s.className)}
							style={{ flexGrow: s.amount, flexBasis: 0 }}
						/>
					) : null,
				)}
			</div>
			<ul
				aria-labelledby={labelledBy}
				className="grid gap-1 text-[13px] text-muted-foreground tabular-nums"
			>
				{segments.map((s) => (
					<li key={s.key} className="flex items-center gap-2">
						<span aria-hidden="true" className={cn("size-2.5 shrink-0 rounded-sm", s.className)} />
						<span className="flex-1">{s.label}</span>
						<span className={cn("font-medium text-foreground", s.amount < 0 && "text-over")}>
							{formatMoney(s.amount)}
						</span>
					</li>
				))}
			</ul>
		</div>
	);
}

const STRIPES =
	"bg-[image:repeating-linear-gradient(135deg,transparent_0_3px,color-mix(in_oklab,var(--card)_55%,transparent)_3px_5px)]";

/**
 * The bar's parts, in order. Free to Spend is always listed, with the amount the card's headline
 * says: below zero when the Plan is over take-home pay (it then has no part of the bar).
 */
export function monthSegments(state: MonthState): Segment[] {
	// What Buckets have spent and have left, as This Month counts them ("Left in Buckets"). With
	// money carried over from last month these can add up to a little more than the Plan gave them.
	let bucketsSpent = 0;
	for (const b of state.buckets) {
		bucketsSpent += Math.min(Math.max(0, b.spent), Math.max(0, b.available));
	}
	return [
		{
			key: "commitments",
			label: "Commitments",
			amount: state.committed,
			className: "bg-chart-spend",
		},
		{
			key: "buckets-spent",
			label: "Spent from Buckets",
			amount: bucketsSpent,
			className: "bg-chart-allowance",
		},
		{
			key: "buckets-left",
			label: "Left in Buckets",
			amount: Math.max(0, state.leftInBuckets),
			className: cn("bg-chart-allowance", STRIPES),
		},
		{
			key: "goals",
			label: "Goals",
			amount: state.fundedGoals,
			className: "bg-chart-compare",
		},
		{
			key: "free",
			label: "Free to Spend",
			amount: state.freeToSpend,
			className: "bg-brand",
		},
	].filter((s) => s.amount > 0 || s.key === "free");
}
