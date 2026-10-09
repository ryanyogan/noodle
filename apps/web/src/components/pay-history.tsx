import { type MonthKey, PAY_HISTORY_RECENT } from "@noodle/domain";
import { Card } from "@noodle/ui/components/card";
import { useQuery } from "@tanstack/react-query";
import { useId } from "react";
import { formatMoney, formatWholeMoney, monthName, shortMonth } from "../format";
import { payHistoryQuery, recentLabel, soFarText, yearLabel } from "../pay-history";
import type { ParentPayHistory } from "../server/pay-history";

// What a Parent's pay has been (issue 159, phase b; ADR-0067): for each Parent whose pay varies,
// the last twelve months of their Income as a row of bars, with the average, the lowest month and
// the highest. Only months that have ended count; the month being read is shown beside them.

const statLabel = "text-xs font-medium text-muted-foreground";
const statValue = "text-base font-semibold tabular-nums";
const statNote = "text-xs text-muted-foreground";

/** Each Parent whose pay varies, and what their pay has been. */
export function PayHistories({ month }: { month: MonthKey }) {
	const { data } = useQuery(payHistoryQuery(month));
	return (data ?? []).map((parent) => (
		<ParentPayHistoryCard key={parent.memberId} month={month} parent={parent} />
	));
}

function ParentPayHistoryCard({ month, parent }: { month: MonthKey; parent: ParentPayHistory }) {
	const id = useId();
	const { history, name } = parent;
	const top = Math.max(1, ...history.months.map((m) => m.total));
	return (
		<section aria-labelledby={`${id}-title`} data-testid="pay-history" className="grid gap-2">
			<h3 id={`${id}-title`} className="text-sm font-medium">
				What {name}’s pay has been
			</h3>
			<p className="text-xs text-muted-foreground">
				{name}’s Income in each of the last 12 months, counted in the month it arrived.{" "}
				{monthName(month)} is shown, and isn’t in the averages.
			</p>
			<Card className="grid gap-4 p-(--card-pad)">
				<ol aria-label={`${name}’s Income by month`} className="flex items-end gap-1 sm:gap-2">
					{history.months.map((m) => (
						<li
							key={m.month}
							data-testid="pay-month"
							data-counted={m.counted || undefined}
							title={`${monthName(m.month)}: ${formatMoney(m.total)}`}
							className="grid min-w-0 flex-1 gap-1"
						>
							<span className="flex h-20 items-end" aria-hidden>
								<span
									className={`w-full rounded-t-sm ${
										m.month === month
											? "border border-b-0 border-dashed border-(--chart-income)"
											: "bg-(--chart-income)"
									}`}
									style={{ height: m.total > 0 ? `max(2px, ${(m.total / top) * 100}%)` : 0 }}
								/>
							</span>
							<span className="border-t pt-1 text-center text-[10px] text-muted-foreground">
								<span aria-hidden>{shortMonth(m.month)}</span>
								<span className="sr-only">
									{monthName(m.month)}: {formatMoney(m.total)}
									{m.counted ? "" : ", not in the averages"}
								</span>
							</span>
						</li>
					))}
				</ol>
				{history.recent ? (
					<dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
						<div className="grid content-start gap-0.5" data-testid="pay-average-recent">
							<dt className={statLabel}>{recentLabel(history.recent.months)}</dt>
							<dd className={statValue}>{formatWholeMoney(history.recent.average)}</dd>
						</div>
						{history.year ? (
							<div className="grid content-start gap-0.5" data-testid="pay-average-year">
								<dt className={statLabel}>{yearLabel(history, history.year.months)}</dt>
								<dd className={statValue}>{formatWholeMoney(history.year.average)}</dd>
							</div>
						) : null}
						{history.low ? (
							<div className="grid content-start gap-0.5" data-testid="pay-lowest">
								<dt className={statLabel}>Lowest month</dt>
								<dd className={statValue}>{formatMoney(history.low.total)}</dd>
								<dd className={statNote}>{monthName(history.low.month)}</dd>
							</div>
						) : null}
						{history.high ? (
							<div className="grid content-start gap-0.5" data-testid="pay-highest">
								<dt className={statLabel}>Highest month</dt>
								<dd className={statValue}>{formatMoney(history.high.total)}</dd>
								<dd className={statNote}>{monthName(history.high.month)}</dd>
							</div>
						) : null}
					</dl>
				) : null}
				{history.counted < PAY_HISTORY_RECENT ? (
					<p data-testid="pay-history-so-far" className="text-sm text-muted-foreground">
						{soFarText(name, history.counted)}
					</p>
				) : null}
				<details className="text-sm">
					<summary className="cursor-pointer text-muted-foreground">Each month’s figure</summary>
					<ul className="mt-2 grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-x-4 gap-y-1">
						{history.months.map((m) => (
							<li key={m.month} className="flex justify-between gap-2">
								<span className="text-muted-foreground">
									{shortMonth(m.month)} {m.month.slice(0, 4)}
								</span>
								<span className="tabular-nums">
									{m.counted || m.month === month ? formatMoney(m.total) : "—"}
								</span>
							</li>
						))}
					</ul>
				</details>
			</Card>
		</section>
	);
}
