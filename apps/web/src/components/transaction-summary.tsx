import type { MonthKey } from "@noodle/domain";
import { RowButton } from "@noodle/ui/components/row-button";
import { cn } from "@noodle/ui/lib/utils";
import { useQuery, useSuspenseInfiniteQuery } from "@tanstack/react-query";
import { useHydrated } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { formatMoney } from "../format";
import { moneyInQuery } from "../money-in";
import { monthIncome, monthSummary, type TransactionShow } from "../transaction-summary";
import { type TransactionFilters, transactionsQuery } from "../transactions";

// The month at a glance, over the Transactions table (issue 134): Money in, Money out and Needs
// review. Each is a filter, pressed while it is on and kept in the address (`show`). Money in is
// the address month's; Money out follows the page's other filters, and says so under its figure.

function Figure({
	show,
	on,
	label,
	onShow,
	disabled,
	children,
}: {
	show: TransactionShow;
	on: TransactionShow | undefined;
	label: string;
	onShow: (show: TransactionShow | undefined) => void;
	disabled: boolean;
	children: ReactNode;
}) {
	const pressed = on === show;
	return (
		<RowButton
			type="button"
			variant="tile"
			aria-pressed={pressed}
			disabled={disabled}
			data-testid={`summary-${show}`}
			className="flex min-w-0 flex-col items-start justify-start gap-0.5 whitespace-normal px-3 py-2 text-start aria-pressed:border-brand aria-pressed:bg-brand-soft"
			onClick={() => onShow(pressed ? undefined : show)}
		>
			<span className="text-xs font-normal text-muted-foreground">{label}</span>
			{children}
		</RowButton>
	);
}

/** The line that says why the page's bar is off under Money in: what the bar is described by. */
export const MONEY_IN_HINT_ID = "money-in-hint";

const figure = "text-base font-semibold tabular-nums lg:text-2xl lg:tracking-tight";

export function MonthSummary({
	month,
	filters,
	caption,
	onShow,
}: {
	month: MonthKey;
	filters: TransactionFilters;
	/** What Money out totals: the month, a range of months, or the page's filters. */
	caption: string;
	onShow: (show: TransactionShow | undefined) => void;
}) {
	// The list's own query (already loaded): its first page carries the month's figures.
	const list = useSuspenseInfiniteQuery(transactionsQuery(month, filters)).data.pages[0]?.summary;
	const moneyIn = useQuery(moneyInQuery(month)).data ?? [];
	// Until hydrated, a press would do nothing.
	const disabled = !useHydrated();
	const { inCents, outCents, needsReview } = monthSummary(moneyIn, list);
	const incomeCents = monthIncome(moneyIn);
	const shared = { on: filters.show, onShow, disabled };
	// Money out follows the page's filters; Money in is the whole month's whatever they are, and
	// says so while they narrow the list (the simpler of the two: no filter but the month applies
	// to every kind of money in).
	const narrowed = Boolean(filters.bucket || filters.for || filters.account || filters.q);
	return (
		<>
			{/* biome-ignore lint/a11y/useSemanticElements: a fieldset's legend can't sit in this grid. */}
			<div
				role="group"
				aria-label="The month at a glance"
				data-testid="month-summary"
				// Three across down to a 320 px phone; the floor is in rem, so at large text they stack
				// instead of pushing the page sideways.
				className="grid grid-cols-[repeat(auto-fit,minmax(5.6rem,1fr))] gap-2 sm:gap-3 lg:max-w-3xl"
			>
				<Figure show="in" label="Money in" {...shared}>
					<span className={cn(figure, inCents > 0 && "text-money-in")} data-testid="month-in">
						{inCents > 0 ? "+" : ""}
						{formatMoney(inCents)}
					</span>
					{/* Refunds and Paid back came in too, and aren't Income: say how much is, as This
					    Month's "received" does. */}
					{incomeCents !== inCents ? (
						<span
							className="text-[11px] font-normal text-subtle-foreground"
							data-testid="month-in-income"
						>
							{formatMoney(incomeCents)} of it Income
						</span>
					) : null}
					{narrowed ? (
						<span
							className="text-[11px] font-normal text-subtle-foreground"
							data-testid="month-in-caption"
						>
							All money in
						</span>
					) : null}
				</Figure>
				<Figure show="out" label="Money out" {...shared}>
					<span className={figure} data-testid="month-total">
						{formatMoney(outCents)}
					</span>
					<span className="text-[11px] font-normal text-subtle-foreground">{caption}</span>
				</Figure>
				<Figure show="review" label="Needs review" {...shared}>
					<span className={figure} data-testid="month-review">
						{needsReview}
					</span>
				</Figure>
			</div>
			{/* Under Money in the page's search, filters and sort are off: they are for spending. */}
			{filters.show === "in" ? (
				<p id={MONEY_IN_HINT_ID} className="text-xs text-muted-foreground">
					Search, filters and sort are for spending. Press Money in again to use them.
				</p>
			) : null}
		</>
	);
}
