import type { MonthKey } from "@noodle/domain";
import { RowButton } from "@noodle/ui/components/row-button";
import { cn } from "@noodle/ui/lib/utils";
import { useQuery, useSuspenseInfiniteQuery } from "@tanstack/react-query";
import { useHydrated } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { formatMoney } from "../format";
import { moneyInQuery } from "../money-in";
import { monthSummary, type TransactionShow } from "../transaction-summary";
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
			className="flex min-w-0 flex-col items-start justify-start gap-0.5 px-3 py-2 text-start aria-pressed:border-brand aria-pressed:bg-brand-soft"
			onClick={() => onShow(pressed ? undefined : show)}
		>
			<span className="text-xs font-normal text-muted-foreground">{label}</span>
			{children}
		</RowButton>
	);
}

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
	const shared = { on: filters.show, onShow, disabled };
	return (
		// biome-ignore lint/a11y/useSemanticElements: a fieldset's legend can't sit in this grid.
		<div
			role="group"
			aria-label="The month at a glance"
			data-testid="month-summary"
			className="grid grid-cols-3 gap-2 sm:gap-3 lg:max-w-3xl"
		>
			<Figure show="in" label="Money in" {...shared}>
				<span className={cn(figure, inCents > 0 && "text-money-in")} data-testid="month-in">
					{inCents > 0 ? "+" : ""}
					{formatMoney(inCents)}
				</span>
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
	);
}
