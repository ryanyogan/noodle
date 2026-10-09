import { type MonthKey, PAY_HISTORY_RECENT, type PayHistory, type PlanOn } from "@noodle/domain";
import { queryOptions } from "@tanstack/react-query";
import { formatMoney, monthName } from "./format";
import { monthQuery } from "./queries";
import { getPayHistory } from "./server/pay-history";

// What a Parent's pay has been (issue 159, phase b), as Plan › Income says it.

/** Each Parent whose pay varies, and their Income by month, as `month` reads it. */
export const payHistoryQuery = (month: MonthKey) =>
	queryOptions({
		// Under the month's key: Income landing, or whose pay it is changing, refetches it.
		queryKey: [...monthQuery(month).queryKey, "pay-history"],
		queryFn: () => getPayHistory({ data: { month } }),
	});

const monthsText = (months: number) => (months === 1 ? "1 month" : `${months} months`);

/** "Average, last 6 months", or "Average, 3 months so far" while there are fewer. */
export const recentLabel = (months: number) =>
	months < PAY_HISTORY_RECENT
		? `Average, ${monthsText(months)} so far`
		: `Average, last ${months} months`;

/** "Average, last 12 months", or "Average, 9 months so far". */
export const yearLabel = (history: PayHistory, months: number) =>
	months < history.months.length - 1
		? `Average, ${monthsText(months)} so far`
		: `Average, last ${months} months`;

/** Said under the figures while Noodle has fewer than six months to go on. */
export const soFarText = (name: string, counted: number) =>
	counted === 0
		? `No month of ${name}’s pay has ended yet, so there’s nothing to average.`
		: `${monthsText(counted)} so far: Noodle has ${name}’s Income for ${
				counted === 1 ? "one month that has" : `${counted} months that have`
			} ended, and only those count.`;

/**
 * Why that figure, in words a Parent can check against the months shown: "In 11 of the last 12
 * months Wren’s pay came to $3,800 or more. Only March ($0) was lower, and one month like that
 * is left out."
 */
export function planOnText(name: string, suggestion: PlanOn): string {
	const { amount, of, atLeast, below } = suggestion;
	const months = of === 12 ? "the last 12 months" : `the ${of} months Noodle has`;
	return below
		? `In ${atLeast} of ${months} ${name}’s pay came to ${formatMoney(amount)} or more. Only ${monthName(below.month)} (${formatMoney(below.total)}) was lower, and one month like that is left out.`
		: `In each of ${months} ${name}’s pay came to ${formatMoney(amount)} or more.`;
}
