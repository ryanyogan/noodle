import type { LeanMonth } from "@noodle/domain";
import { formatMoney, monthName, shortDay } from "./format";

// A lean month, as This Month and Plan › Income say it (issue 159, phase b; ADR-0067).

/**
 * "$2,800 of the $4,000 your Plan counts on is in so far, $1,200 to go. $2,500 of pay to come is
 * expected by Oct 24, which would cover it." In the month's last days it is "short".
 */
export function leanMonthText(lean: LeanMonth, month: string): string {
	const said = [
		lean.short
			? `${monthName(month)} is ${formatMoney(lean.gap)} short of the ${formatMoney(lean.planned)} your Plan counts on, ${
					lean.daysLeft === 0
						? "on its last day"
						: `with ${lean.daysLeft} ${lean.daysLeft === 1 ? "day" : "days"} left`
				}.`
			: `${formatMoney(lean.inSoFar)} of the ${formatMoney(lean.planned)} your Plan counts on is in so far, ${formatMoney(lean.gap)} to go.`,
	];
	if (lean.toCome > 0 && lean.by) {
		const covers =
			lean.after === 0 ? "would cover it" : `would leave ${formatMoney(lean.after)} to go`;
		said.push(
			lean.overdue
				? `${formatMoney(lean.toCome)} of pay to come was expected by ${shortDay(lean.by)} and isn’t in yet; it ${covers}.`
				: `${formatMoney(lean.toCome)} of pay to come is expected by ${shortDay(lean.by)}, which ${covers}.`,
		);
	}
	if (lean.noDay > 0)
		said.push(
			lean.toCome > 0
				? `Another ${formatMoney(lean.noDay)} is to come with no day expected.`
				: `${formatMoney(lean.noDay)} of pay to come has no day expected.`,
		);
	return said.join(" ");
}
