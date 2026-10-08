import { type LatePay, monthOfDay } from "@noodle/domain";
import { cn } from "@noodle/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { formatMoney } from "../format";
import { latePayQuery, latePayText } from "../pay-days";

/**
 * The pay days that haven't come in, this month's and last month's (issue 156). Read in the
 * background: none while loading.
 */
export function useLatePay(): LatePay[] {
	return useQuery(latePayQuery()).data ?? [];
}

/**
 * A line per pay day that hasn't come in ("Robin’s pay for Oct 15 hasn’t come in"), each linking
 * to its month's Plan › Income, where the paycheck is listed and Income is said to be whose pay;
 * nothing when every pay day due is in. It goes once Income is that pay day's paycheck.
 */
export function LatePayLines({ late, className }: { late?: LatePay[]; className?: string }) {
	const own = useLatePay();
	const lines = late ?? own;
	if (lines.length === 0) return null;
	return (
		<ul data-testid="late-pay" className={cn("grid gap-1 text-sm", className)}>
			{lines.map((line) => (
				<li key={`${line.memberId} ${line.day}`} className="min-w-0 text-pretty">
					<Link
						to="/plan/$month/income"
						params={{ month: monthOfDay(line.day) }}
						className="font-medium text-brand underline-offset-4 hover:underline max-lg:inline-flex max-lg:min-h-11 max-lg:items-center"
					>
						{latePayText(line)}
					</Link>{" "}
					<span className="text-muted-foreground">
						About {formatMoney(line.expected)} was due. If it has landed, say it’s {line.name}’s
						pay.
					</span>
				</li>
			))}
		</ul>
	);
}
