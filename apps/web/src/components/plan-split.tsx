import { freeToSpendParts, type MonthState, type PlanPart } from "@noodle/domain";
import { Alert, AlertDescription } from "@noodle/ui/components/alert";
import { Button } from "@noodle/ui/components/button";
import { Card } from "@noodle/ui/components/card";
import { Section, SectionHeader } from "@noodle/ui/components/section";
import { cn } from "@noodle/ui/lib/utils";
import { useHydrated } from "@tanstack/react-router";
import { useId, useState } from "react";
import { formatMoney } from "../format";
import { planSplit, type SplitRow, shareText, splitSentence } from "../plan-split";
import { planParts } from "./plan-page";
import { TermHelp } from "./term-help";

const STRIPES =
	"bg-[image:repeating-linear-gradient(135deg,transparent_0_3px,color-mix(in_oklab,var(--card)_55%,transparent)_3px_5px)]";
const DOTS =
	"bg-[image:radial-gradient(circle,color-mix(in_oklab,var(--card)_70%,transparent)_1px,transparent_1.5px)] bg-[size:5px_5px]";

/**
 * What each part is drawn in (ticket 102). The same inks This Month's glance uses for the same things
 * (month-glance.tsx): Commitments the darkest, Buckets the mid grey, Goals the comparison grey
 * (hollow in dark), Free to Spend the brand. A Personal Allowance is a Bucket, so it is the
 * Buckets' grey, dotted; a Cover is the Pace marigold, striped. Texture, order and the row's own
 * words tell the parts apart: colour is never the only signal.
 */
const INK: Record<PlanPart | "free" | "over" | "pay", string> = {
	commitments: "bg-chart-spend",
	buckets: "bg-chart-allowance",
	"personal-allowances": cn("bg-chart-allowance", DOTS),
	// The glance's fill, with an edge in the Buckets' grey: the light fill alone is 1.45:1 from the
	// card, the edge is 3.8:1 (3.5:1 in dark, where the part is hollow).
	"goal-funding": "bg-(--chart-goal) shadow-[inset_0_0_0_1.5px_var(--chart-allowance)]",
	covers: cn("bg-pace", STRIPES),
	free: "bg-brand",
	over: cn("bg-over", STRIPES),
	pay: "bg-foreground",
};

type Ink = keyof typeof INK;

/**
 * Where take-home pay goes: one bar that is the whole pay, split in the Plan's order into
 * Commitments, Buckets, Goal funding and what's left, Free to Spend. The sentence above says the
 * takeaway and the parts under the bar are the real content (name, amount, share, in the bar's
 * order), so the bar itself is hidden from screen readers. The parts are figures, not links: the
 * tabs right above open each part (#73).
 *
 * It is the top of the Plan's first page, with the Buckets table under it (issue 109), so it is
 * short. In a card of 36rem or more the parts are cells in a row under the bar; in a narrower one
 * (a phone) they are rows, of which only Free to Spend shows until "Show the parts" opens the
 * rest. One list either way. Given a month with typed allowances (`withDraftAllowances`), it
 * shows that.
 */
export function PlanSplit({ state, current }: { state: MonthState; current: boolean }) {
	// Goal funding shows in the current month, where it can still happen, or once it did.
	const parts = freeToSpendParts(state)
		.filter(({ part, amount }) => part !== "goal-funding" || amount > 0 || current)
		.map(({ part, amount }) => ({ key: part, label: planParts[part].label, amount }));
	// Extra income a Parent sent to Free to Spend is on top of take-home pay.
	const extra = state.baseline === null ? 0 : state.extraToFreeToSpend;
	const split = planSplit({
		income: state.baseline === null ? null : state.baseline + extra,
		parts,
		left: state.freeToSpend,
	});
	const over = split.overBy > 0;
	const drawn = [...split.parts, split.free].filter((row) => row.width > 0);
	const payLabel = extra > 0 ? "Take-home pay and Extra income" : "Take-home pay";
	// What a share is a share of, for a screen reader, which can't see the column it sits in.
	const shareOf = extra > 0 ? "take-home pay and Extra income" : "take-home pay";
	// In a narrow card the parts other than Free to Spend wait behind a button.
	const [open, setOpen] = useState(false);
	const hydrated = useHydrated();
	const listId = useId();
	return (
		<Section aria-labelledby="plan-waterfall">
			<SectionHeader
				id="plan-waterfall"
				title="Where take-home pay goes"
				help={<TermHelp term="free-to-spend" />}
			/>
			<Card className="@container/split">
				<div className="grid gap-3 p-(--card-pad)">
					<p data-slot="plan-split-sentence" className="text-sm text-pretty">
						{splitSentence(split, extra)}
					</p>
					{split.income === null ? null : (
						<div className="grid gap-1.5">
							{/* The bar's own name and size: the whole of it is this amount. */}
							<p className="flex flex-wrap items-baseline justify-between gap-x-4 text-[13px] text-muted-foreground">
								<span>{over ? "Planned" : payLabel}</span>
								<span className="font-medium text-foreground tabular-nums">
									{formatMoney(over ? split.planned : split.income)}
								</span>
							</p>
							<Stack
								className="h-3"
								segments={drawn.map((row) => ({
									key: row.key,
									width: row.width,
									ink: row.key as Ink,
								}))}
							/>
							{split.reach ? (
								<>
									{/* Over: a second line on the same scale, showing where the pay runs out. */}
									<Stack
										className="h-1.5"
										segments={[
											{ key: "pay", width: split.reach.within, ink: "pay" },
											{ key: "over", width: split.reach.over, ink: "over" },
										]}
									/>
									<p className="flex flex-wrap items-baseline justify-between gap-x-4 text-[13px] text-muted-foreground">
										<span>
											{payLabel}{" "}
											<span className="font-medium text-foreground tabular-nums">
												{formatMoney(split.income)}
											</span>
										</span>
										<span className="font-medium text-over-foreground tabular-nums">
											{formatMoney(split.overBy)} over
										</span>
									</p>
								</>
							) : null}
						</div>
					)}
				</div>
				<ul
					id={listId}
					aria-label="Where take-home pay goes, part by part"
					className="@xl/split:grid @xl/split:grid-cols-[repeat(auto-fit,minmax(8rem,1fr))] @xl/split:gap-x-4 @xl/split:gap-y-3 @xl/split:px-(--card-pad) @xl/split:pb-(--card-pad)"
				>
					{split.parts.map((row) => (
						<SplitRowItem
							key={row.key}
							row={row}
							ink={row.key as Ink}
							of={shareOf}
							folded={!open}
						/>
					))}
					<SplitRowItem
						row={split.free}
						ink={over ? "over" : "free"}
						of={shareOf}
						total
						over={over}
					/>
				</ul>
				{split.parts.length > 0 ? (
					// Only where the parts are rows: as cells they are all on show.
					<div className="border-t px-(--card-pad) py-1 @xl/split:hidden">
						<Button
							type="button"
							variant="ghost"
							size="sm"
							className="-mx-2 min-h-9"
							aria-expanded={open}
							aria-controls={listId}
							disabled={!hydrated}
							onClick={() => setOpen(!open)}
						>
							{open ? "Hide the parts" : "Show the parts"}
						</Button>
					</div>
				) : null}
			</Card>
			{over ? (
				<Alert variant="destructive">
					<AlertDescription>
						{state.committed > 0
							? `Your Commitments and Buckets add up to ${formatMoney(split.overBy)} more than your take-home pay. Lower an amount, or raise your take-home pay if it has gone up.`
							: `Your Buckets add up to ${formatMoney(split.overBy)} more than your take-home pay. Lower an allowance, or raise your take-home pay if it has gone up.`}
					</AlertDescription>
				</Alert>
			) : null}
		</Section>
	);
}

/**
 * One line of parts laid end to end, each as long as its share, with a gap between neighbours so
 * two parts never rely on their inks differing. Decorative: the words around it say it all.
 */
function Stack({
	segments,
	className,
}: {
	segments: { key: string; width: number; ink: Ink }[];
	className?: string;
}) {
	return (
		<div
			aria-hidden="true"
			data-slot="plan-split-bar"
			className={cn("flex w-full gap-0.5 overflow-hidden rounded-full", className)}
		>
			{segments.map((s) =>
				s.width > 0 ? (
					<span
						key={s.key}
						data-segment={s.key}
						className={cn("h-full", INK[s.ink])}
						style={{ flexGrow: s.width, flexBasis: 0 }}
					/>
				) : null,
			)}
		</div>
	);
}

/**
 * A part: its swatch, name, amount and share of the pay, in the bar's order. A row in a narrow
 * card; from 36rem a cell, the name over its amount with the share beside it. The same elements
 * in the same order both ways. `folded` keeps a row put away until the parts are shown; a cell is
 * never put away.
 */
function SplitRowItem({
	row,
	ink,
	of,
	total = false,
	over = false,
	folded = false,
}: {
	row: SplitRow;
	ink: Ink;
	of: string;
	total?: boolean;
	over?: boolean;
	folded?: boolean;
}) {
	const share = shareText(row);
	return (
		<li
			data-part={row.key}
			className={cn(
				"grid-cols-[auto_minmax(0,1fr)_auto_2.75rem] items-center gap-x-3 border-t px-(--card-pad) py-3 text-sm",
				"@xl/split:flex @xl/split:flex-wrap @xl/split:items-baseline @xl/split:gap-x-2 @xl/split:gap-y-0.5 @xl/split:border-t-0 @xl/split:p-0",
				folded ? "hidden" : "grid",
				total && "font-semibold",
			)}
		>
			<span aria-hidden="true" className={cn("size-3 shrink-0 rounded-sm", INK[ink])} />
			{/* Name then amount, with nothing between them: what a Parent reads, and what tests read. */}
			<span data-slot="plan-split-figure" className="contents">
				<span
					className={cn(
						"min-w-0 @xl/split:w-[calc(100%-1.25rem)] @xl/split:text-[13px]",
						!total && "font-medium",
					)}
				>
					{row.label}
				</span>
				<span
					className={cn(
						"text-end tabular-nums @xl/split:text-start @xl/split:text-base @xl/split:font-semibold",
						over && "text-over-foreground",
					)}
				>
					{formatMoney(row.amount)}
				</span>
			</span>
			<span className="text-end text-[13px] font-normal text-muted-foreground tabular-nums @xl/split:text-start">
				{share === "" ? null : (
					<>
						{share}
						<span className="sr-only"> of {of}</span>
					</>
				)}
			</span>
		</li>
	);
}
