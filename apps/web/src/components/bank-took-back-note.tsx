import type { Cents, DayKey } from "@noodle/domain";
import { cn } from "@noodle/ui/lib/utils";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { bankTookBackText } from "../bank-took-back";
import { getBankTookBackMonths } from "../server/bank-took-back";

/** The row a kept line is: a Transaction, or a line of money in. */
type KeptRow = { transactionId: string } | { incomeId: string };

/** The months the money back on a kept line counted in, read when its detail is opened. */
export const bankTookBackMonthsQuery = (row: KeptRow) =>
	queryOptions({
		queryKey: ["bank-took-back-months", row],
		queryFn: () => getBankTookBackMonths({ data: row }),
	});

/**
 * "The bank took this back on Tue, Oct 6. It stays here so September and October don't change.",
 * on the opened detail of a line kept after the bank withdrew or changed it (issue 141). Nothing
 * on any other line. The months are the line's own and those its money back counted in, so it
 * waits for them rather than name one month and then another; if they can't be read it names
 * the line's own.
 */
export function BankTookBackNote({
	row,
	line,
	today,
	className,
}: {
	row: KeptRow;
	line: { date: DayKey; bankTookBackOn?: DayKey | null; bankAmount?: Cents | null };
	today: string;
	className?: string;
}) {
	const kept = Boolean(line.bankTookBackOn);
	const months = useQuery({ ...bankTookBackMonthsQuery(row), enabled: kept });
	if (!kept || months.isPending) return null;
	return (
		<p className={cn("text-sm text-muted-foreground", className)} data-testid="bank-took-back-note">
			{bankTookBackText(line, today, months.data ?? [])}
		</p>
	);
}
