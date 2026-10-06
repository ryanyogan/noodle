import type { MonthKey, PlanWarning } from "@noodle/domain";
import { Badge } from "@noodle/ui/components/badge";
import { Button } from "@noodle/ui/components/button";
import { List } from "@noodle/ui/components/list";
import { RowButton } from "@noodle/ui/components/row-button";
import { Section, SectionHeader } from "@noodle/ui/components/section";
import { toast } from "@noodle/ui/components/toast";
import { cn } from "@noodle/ui/lib/utils";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Link, type LinkProps, useHydrated } from "@tanstack/react-router";
import { ChevronDown, ChevronRight, CircleAlert, TriangleAlert } from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import { formatMoney, fullDay, monthName } from "../format";
import { planHealthQuery } from "../queries";
import { endCommitment, keepCarriedBalance } from "../server/commitments";
import { Confirm } from "./plan-editing";

/**
 * Plan health: what in the Plan needs attention now, each warning opening the page that fixes
 * it. Nothing shows while the Plan is healthy. `folded` (the Plan's first page): one line naming
 * the most urgent, opened on a press, so the Buckets start right under where the pay goes. From
 * 1920, where it sits beside that, it is open.
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
			<div className={cn(folded && "max-[120rem]:hidden")}>
				<SectionHeader id="plan-health" title="Things to check" count={warnings.length} />
			</div>
			{folded && first ? (
				<RowButton
					variant="bordered"
					aria-expanded={open}
					aria-controls={id}
					disabled={!hydrated}
					onClick={() => setOpen((o) => !o)}
					className="min-h-11 min-w-0 justify-start gap-2 bg-card min-[120rem]:hidden"
				>
					{/* On a phone the first warning goes under the heading, on up to two lines, where
					    beside it there was room for two words of it (issue 115). */}
					<span className="flex min-w-0 flex-1 flex-col gap-0.5 text-start sm:flex-row sm:items-center sm:gap-2">
						<span className="flex items-center gap-2">
							<span className="text-sm font-semibold">Things to check</span>
							<Badge variant="count">{warnings.length}</Badge>
						</span>
						{/* Open, the first warning is the row right under the heading: not said twice on a phone. */}
						<span
							className={cn(
								"line-clamp-2 min-w-0 text-[13px] text-muted-foreground sm:line-clamp-none sm:flex-1 sm:truncate",
								open && "max-sm:hidden",
							)}
						>
							{describe(first, month).title}
						</span>
					</span>
					<ChevronDown
						aria-hidden="true"
						className={cn("size-4 shrink-0 text-muted-foreground transition-transform", {
							"rotate-180": open,
						})}
					/>
				</RowButton>
			) : null}
			{/* The wrapper hides, not the List: its Card would stay behind as a thin empty line. */}
			<div id={id} className={cn(folded && !open && "max-[120rem]:hidden")}>
				<List>
					{sorted.map((warning) => (
						<HealthRow key={keyOf(warning)} warning={warning} month={month} />
					))}
				</List>
			</div>
		</Section>
	);
}

const keyOf = (warning: PlanWarning) =>
	warning.kind === "bucket-over"
		? `${warning.kind}:${warning.bucketId}`
		: warning.kind === "goal-late"
			? `${warning.kind}:${warning.goalId}`
			: warning.kind === "card-followed"
				? `${warning.kind}:${warning.commitmentId}`
				: warning.kind;

/** Most urgent first: money running out, then income, then advice. */
const urgency: Record<PlanWarning["kind"], number> = {
	"negative-ahead": 0,
	"income-behind": 1,
	// Spending counted twice is wrong today, not advice.
	"card-followed": 2,
	"goal-late": 3,
	"bucket-over": 4,
};

const monthsText = (n: number) => `${n} month${n === 1 ? "" : "s"}`;

/** A link inside a row that is itself one big link: it sits above the row's. */
const inline =
	"relative z-1 font-medium text-foreground underline decoration-border-strong underline-offset-3 hover:decoration-foreground";

/** "November starts with $600 carried over, and its Plan uses $1,282.70 more than its take-home pay, which leaves −$682.70." */
export function negativeAheadText(warning: Extract<PlanWarning, { kind: "negative-ahead" }>) {
	const name = monthName(warning.month);
	const own =
		warning.own < 0
			? `uses ${formatMoney(-warning.own)} more than its take-home pay`
			: `adds ${formatMoney(warning.own)}`;
	const sentence =
		warning.carriedIn === 0
			? `${name}’s Plan ${own}.`
			: `${name} starts ${
					warning.carriedIn > 0
						? `with ${formatMoney(warning.carriedIn)} carried over`
						: `${formatMoney(-warning.carriedIn)} short`
				}, and its Plan ${own}, which leaves ${formatMoney(warning.freeToSpend)}.`;
	return warning.months > 1
		? `${sentence} Below zero in ${monthsText(warning.months)} of the next 12.`
		: sentence;
}

/**
 * What the figure is made of, then where to change it (issue 113): the month's largest one or two
 * planned amounts, each a link to where it is set, and its take-home pay.
 */
function NegativeAhead({ warning }: { warning: Extract<PlanWarning, { kind: "negative-ahead" }> }) {
	const params = { month: warning.month };
	return (
		<>
			{negativeAheadText(warning)} {warning.largest.length > 0 ? "Its largest: " : null}
			{warning.largest.map((item, index) => (
				<span key={item.kind === "goal-funding" ? item.kind : item.id}>
					{index > 0 ? " and " : null}
					{item.kind === "goal-funding" ? (
						<Link to="/plan/$month/goals" params={params} className={inline}>
							Goal funding
						</Link>
					) : item.kind === "bucket" ? (
						<Link
							to="/plan/$month/buckets/$id"
							params={{ ...params, id: item.id }}
							className={inline}
						>
							{item.name}
						</Link>
					) : (
						<Link
							to="/plan/$month/commitments/$id"
							params={{ ...params, id: item.id }}
							className={inline}
						>
							{item.name}
						</Link>
					)}{" "}
					{formatMoney(item.amount)}
				</span>
			))}
			{warning.largest.length > 0 ? ". Or change its " : "Change its "}
			<Link to="/plan/$month/income" params={params} className={inline}>
				take-home pay
			</Link>
			.
		</>
	);
}

/** What a warning says, and where its fix is. */
function describe(
	warning: PlanWarning,
	month: MonthKey,
): { title: string; meta: ReactNode; link: LinkProps } {
	switch (warning.kind) {
		case "negative-ahead":
			return {
				title: `Free to Spend goes below zero in ${monthName(warning.month)}`,
				meta: <NegativeAhead warning={warning} />,
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
		case "card-followed":
			return {
				title: warning.connected
					? `${warning.account} is connected now, so its payments would count twice.`
					: `Noodle sees what’s bought on ${warning.account} now, so its payments would count twice.`,
				meta: `${warning.name} pays it down, and what’s bought on the card is already in your Buckets.`,
				link: {
					to: "/plan/$month/commitments/$id",
					params: { month, id: warning.commitmentId },
				},
			};
	}
}

/**
 * A Commitment that pays down a card Noodle has begun to follow (ADR-0050), with its two ways
 * out on the row itself: end the Commitment, or keep it as a set payment on a balance being
 * carried (what the form's own tick says).
 */
function FollowedCardRow({
	warning,
	month,
}: {
	warning: Extract<PlanWarning, { kind: "card-followed" }>;
	month: MonthKey;
}) {
	const { title, meta, link } = describe(warning, month);
	const hydrated = useHydrated();
	const queryClient = useQueryClient();
	const [confirmEnd, setConfirmEnd] = useState(false);
	// The Plan, what's owed and this list all follow from either choice.
	const onSettled = () => queryClient.invalidateQueries();
	const end = useMutation({
		mutationFn: () => endCommitment({ data: { commitmentId: warning.commitmentId, month } }),
		onSuccess: () => toast(`${warning.name} ends from ${monthName(month)} on.`),
		onError: () => toast(`${warning.name} wasn’t ended. Try again.`, { tone: "error" }),
		onSettled,
	});
	const keep = useMutation({
		mutationFn: async () => {
			const kept = await keepCarriedBalance({
				data: { commitmentId: warning.commitmentId, accountId: warning.accountId },
			});
			if (!kept.ok) throw new Error(kept.reason);
		},
		onSuccess: () => toast(`${warning.name} stays: a set payment on a balance you’re carrying.`),
		onError: () => toast(`${warning.name} wasn’t changed. Try again.`, { tone: "error" }),
		onSettled,
	});
	const busy = !hydrated || end.isPending || keep.isPending;
	return (
		<li
			data-testid="plan-health-card-followed"
			className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 px-(--card-pad) py-3.5"
		>
			<TriangleAlert aria-hidden="true" className="mt-0.5 size-4 text-pace" />
			<div className="grid min-w-0 gap-2">
				<div className="grid min-w-0 gap-0.5">
					<p className="text-sm font-medium wrap-anywhere">{title}</p>
					<p className="text-[13px] text-muted-foreground wrap-anywhere">
						<Link {...link} className="font-medium text-foreground underline underline-offset-2">
							{warning.name}
						</Link>
						{typeof meta === "string" ? meta.slice(warning.name.length) : meta}
					</p>
				</div>
				<div className="flex min-w-0 flex-wrap gap-2">
					<Button
						type="button"
						variant="outline"
						size="sm"
						className="max-lg:min-h-11"
						disabled={busy}
						onClick={() => setConfirmEnd(true)}
					>
						End this Commitment
					</Button>
					<Button
						type="button"
						variant="outline"
						// Its words wrap on a narrow phone rather than running off the row.
						size="wrap"
						className="min-h-8 px-3 py-1.5 text-start text-[13px] max-lg:min-h-11"
						disabled={busy}
						onClick={() => keep.mutate()}
					>
						Keep it: it’s for a balance I’m carrying
					</Button>
				</div>
			</div>
			{confirmEnd ? (
				<Confirm
					onConfirm={() => end.mutate()}
					onCancel={() => setConfirmEnd(false)}
					confirmLabel={`End ${warning.name}`}
				>
					{warning.name} leaves the Plan from {monthName(month)} on. Earlier months keep it.
				</Confirm>
			) : null}
		</li>
	);
}

function HealthRow({ warning, month }: { warning: PlanWarning; month: MonthKey }) {
	if (warning.kind === "card-followed") return <FollowedCardRow warning={warning} month={month} />;
	return <LinkedRow warning={warning} month={month} />;
}

function LinkedRow({ warning, month }: { warning: PlanWarning; month: MonthKey }) {
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
