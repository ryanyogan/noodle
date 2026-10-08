import {
	type Cents,
	freeToSpendParts,
	freeToSpendSources,
	type MonthState,
	type PlanPart,
} from "@noodle/domain";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@noodle/ui/components/collapsible";
import { cn } from "@noodle/ui/lib/utils";
import { ChevronRight } from "lucide-react";
import { type ReactNode, useId } from "react";
import { formatMoney } from "../format";

/** One line of the working: what the month has (added) or a part of the Plan (taken off). */
export type FreeLedgerRow = { key: string; label: string; amount: Cents };

const partLabel: Record<PlanPart, string> = {
	commitments: "Commitments",
	buckets: "Buckets",
	"personal-allowances": "Personal Allowances",
	"goal-funding": "Goal funding",
	covers: "Moved into Buckets",
};

/**
 * How a month's Free to Spend is worked out, as a short ledger (issue 149): take-home pay, Extra
 * income a Parent added and what was carried over, less each part of the Plan. The amounts are
 * signed and add up to `state.freeToSpend`. Commitments and Buckets are always listed; the other
 * lines only when they have an amount.
 */
export function freeLedgerRows(
	state: Pick<
		MonthState,
		| "baseline"
		| "extraToFreeToSpend"
		| "freeCarriedIn"
		| "buckets"
		| "committed"
		| "fundedGoals"
		| "movedToBuckets"
	>,
	lastMonth: string,
): FreeLedgerRow[] {
	const has = freeToSpendSources(state);
	return [
		{ key: "take-home-pay", label: "Take-home pay", amount: has.takeHomePay },
		...(has.extraIncome > 0
			? [{ key: "extra-income", label: "Extra income added", amount: has.extraIncome }]
			: []),
		...(has.carriedOver !== 0
			? [
					{
						key: "carried-over",
						label: `${has.carriedOver < 0 ? "Short carried over" : "Carried over"} from ${lastMonth}`,
						amount: has.carriedOver,
					},
				]
			: []),
		...freeToSpendParts(state)
			.filter(({ part, amount }) => amount !== 0 || part === "commitments" || part === "buckets")
			.map(({ part, amount }) => ({
				key: part,
				label: partLabel[part],
				amount: amount === 0 ? 0 : -amount,
			})),
	];
}

/** "+$1,310" for what is added, "−$1,800" for what is taken off; the first line stands plain. */
const signed = (amount: Cents) => (amount > 0 ? `+${formatMoney(amount)}` : formatMoney(amount));

/**
 * "How this is worked out": the one disclosure at the foot of the Free to Spend card, closed on
 * every visit. Open, it shows the ledger, then whatever explanation the card passes as children.
 */
export function FreeWorking({
	rows,
	total,
	totalLabel = "Free to Spend",
	children,
}: {
	rows: FreeLedgerRow[];
	total: Cents;
	totalLabel?: string;
	children?: ReactNode;
}) {
	const id = useId();
	return (
		<Collapsible className="group border-t">
			<CollapsibleTrigger
				id={id}
				className="flex min-h-10 w-full items-center gap-1.5 rounded-b-(--radius-card,inherit) px-(--card-pad) text-start text-[13px] font-medium text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring max-lg:min-h-11"
			>
				<ChevronRight
					aria-hidden="true"
					className="size-4 shrink-0 transition-transform group-data-[state=open]:rotate-90"
				/>
				How this is worked out
			</CollapsibleTrigger>
			<CollapsibleContent className="grid grid-cols-[minmax(0,1fr)] gap-3 px-(--card-pad) pt-2 pb-(--card-pad) text-[13px] text-muted-foreground">
				<ul aria-labelledby={id} data-slot="free-ledger" className="grid gap-1 tabular-nums">
					{rows.map((row, index) => (
						<li key={row.key} className="flex items-baseline justify-between gap-3">
							<span className="min-w-0">{row.label}</span>
							<span className="shrink-0 font-medium text-foreground">
								{index === 0 ? formatMoney(row.amount) : signed(row.amount)}
							</span>
						</li>
					))}
					<li className="mt-1 flex items-baseline justify-between gap-3 border-t pt-2 font-medium text-foreground">
						<span className="min-w-0">{totalLabel}</span>
						<span className={cn("shrink-0", total < 0 && "text-over")}>{formatMoney(total)}</span>
					</li>
				</ul>
				{children}
			</CollapsibleContent>
		</Collapsible>
	);
}
