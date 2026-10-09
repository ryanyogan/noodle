import {
	daysInMonth,
	LOWER_PAY_LAST_DAYS,
	leanMonth,
	type MonthKey,
	receivedIn,
} from "@noodle/domain";
import { useQuery } from "@tanstack/react-query";
import { leanMonthText } from "../lean-month";
import { payHistoryQuery } from "../pay-history";
import { payToComeQuery } from "../pay-to-come";
import { useMonthState } from "../queries";

// A lean month says so (issue 159, phase b; ADR-0067), on This Month and Plan › Income: what is
// in so far of the Take-home pay, and the Pay to come expected against the rest. Nothing is said
// early in a month with no Pay to come waiting, and "short" only in its last days.

export function LeanMonthNote({ month, className }: { month: MonthKey; className?: string }) {
	const state = useMonthState(month);
	const current = state.asOf.startsWith(month);
	const { data: toCome } = useQuery({ ...payToComeQuery(month), enabled: current });
	// Whether a Parent's pay varies matters only in the month's last days: not read before them.
	const lastDays =
		current && daysInMonth(month) - Number(state.asOf.slice(8)) < LOWER_PAY_LAST_DAYS;
	const { data: histories } = useQuery({ ...payHistoryQuery(month), enabled: lastDays });
	if (!toCome) return null;
	const lean = leanMonth({
		baseline: state.baseline,
		received: receivedIn(state.income, month),
		month,
		asOf: state.asOf,
		varies: (histories?.parents.length ?? 0) > 0,
		waiting: toCome.parents.flatMap((parent) => parent.waiting),
	});
	return lean ? (
		<p
			role="note"
			data-testid="lean-month"
			data-short={lean.short || undefined}
			className={className}
		>
			{leanMonthText(lean, month)}
		</p>
	) : null;
}
