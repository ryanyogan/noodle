import type { Cents, MonthKey } from "@noodle/domain";
import { Badge } from "@noodle/ui/components/badge";
import { Button } from "@noodle/ui/components/button";
import { Card } from "@noodle/ui/components/card";
import { DataTable, type DataTableColumn } from "@noodle/ui/components/data-table";
import { Money } from "@noodle/ui/components/money";
import { Section, SectionHeader } from "@noodle/ui/components/section";
import { Sheet, SheetContent, SheetHeader } from "@noodle/ui/components/sheet";
import { useQuery } from "@tanstack/react-query";
import { Link, useHydrated } from "@tanstack/react-router";
import { Pencil } from "lucide-react";
import { type ReactNode, useState } from "react";
import { formatMoney, monthName, shortDay } from "../format";
import { useGoals } from "../goals";
import { type MoneyInLine, moneyInKindText, moneyInLabel, moneyInQuery } from "../money-in";
import { MoneyInFollowUpAsk, MoneyInKindChoice } from "./money-in";

// The month's money in that isn't Income, under the Income table on Plan › Income (issue 145).
// A deposit is in one group only: what a Parent said isn't Income (a Refund or Paid back), or what
// nobody has named yet, which is named in Review and not here. A Transfer or money between the
// Parents is neither: that money was the Household's already and only moved (issue 152), so it
// is listed on Transactions alone.
// The columns are the Income table's, so the three lists read as one.

/** The Income table's columns, for money in that isn't Income; `last` is the row's one control. */
const columnsFor = ({
	accountOf,
	total,
	last,
}: {
	accountOf: (line: MoneyInLine) => string;
	total: Cents;
	last: (line: MoneyInLine) => ReactNode;
}): DataTableColumn<MoneyInLine>[] => [
	{
		id: "date",
		header: "Date",
		min: 4.5,
		width: "4.5rem",
		priority: 2,
		stacked: "secondary",
		cell: (line) => (
			<>
				{shortDay(line.date)}
				{/* Stacked (a phone), the Account has no column of its own: it follows the day. */}
				<span className="@2xl/dt:hidden"> · {accountOf(line)}</span>
			</>
		),
	},
	{
		id: "from",
		header: "From",
		min: 7,
		width: "minmax(0,2fr)",
		stacked: "title",
		cell: (line) => moneyInLabel(line),
		footer: "Total",
	},
	{
		id: "kind",
		header: "Counted as",
		min: 9,
		width: "minmax(9rem,1fr)",
		stacked: "secondary",
		cell: (line) => (
			<Badge variant={line.needsReview ? "pace" : "default"}>{moneyInKindText(line)}</Badge>
		),
	},
	{
		id: "account",
		header: "Account",
		min: 6,
		width: "minmax(6rem,1fr)",
		priority: 3,
		stacked: "hidden",
		cell: (line) => <span className="text-muted-foreground">{accountOf(line)}</span>,
	},
	{
		id: "amount",
		header: "Amount",
		min: 6,
		width: "6.5rem",
		align: "end",
		stacked: "value",
		cell: (line) => <Money cents={line.amount} />,
		footer: <Money cents={total} />,
	},
	{
		id: "actions",
		header: "Actions",
		headerClassName: "sr-only",
		min: 2.5,
		width: "2.5rem",
		align: "end",
		stacked: "trailing",
		cell: last,
	},
];

const sum = (lines: MoneyInLine[]) =>
	lines.reduce((total, line) => total + line.amount, 0) as Cents;

/** The month's money in that doesn't count as Income: what was said not to, and what waits in Review. */
export function MoneyInNotIncome({ month, today }: { month: MonthKey; today: string }) {
	const hydrated = useHydrated();
	const query = useQuery(moneyInQuery(month));
	const { accounts } = useGoals();
	const [editing, setEditing] = useState<MoneyInLine | null>(null);
	const open = query.data?.find((line) => line.id === editing?.id) ?? editing;
	const lines = (query.data ?? []).filter((line) => line.amount > 0);
	const waiting = lines.filter((line) => line.needsReview);
	const notCounted = lines.filter(
		(line) => !line.needsReview && (line.kind === "refund" || line.kind === "paid-back"),
	);
	const accountOf = (line: MoneyInLine) =>
		line.accountId
			? (accounts.find((account) => account.id === line.accountId)?.name ?? "An Account")
			: "Typed in";

	if (query.isError)
		return (
			<Card className="p-(--card-pad) text-sm" role="alert">
				Couldn’t load the month’s other money in.{" "}
				<Button size="sm" variant="ghost" onClick={() => void query.refetch()}>
					Try again
				</Button>
			</Card>
		);
	if (query.isPending)
		return (
			<p role="status" className="text-sm text-muted-foreground">
				Loading the month’s other money in…
			</p>
		);
	return (
		<>
			{notCounted.length > 0 ? (
				<Section aria-labelledby="money-in-not-counted">
					<SectionHeader
						id="money-in-not-counted"
						title="Other money in"
						count={notCounted.length}
					/>
					<p className="text-sm text-muted-foreground">
						Refunds and money Paid back: not counted as Income. If one of them is pay, change what
						it is.
					</p>
					<DataTable
						label={`Money in that isn’t Income in ${monthName(month)}`}
						columns={columnsFor({
							accountOf,
							total: sum(notCounted),
							last: (line) => (
								<Button
									type="button"
									variant="ghost"
									size="icon"
									disabled={!hydrated}
									aria-label={`Change what ${moneyInLabel(line)} is`}
									onClick={() => setEditing(line)}
								>
									<Pencil className="size-4" />
								</Button>
							),
						})}
						data={notCounted}
						getRowId={(line) => line.id}
					/>
				</Section>
			) : null}
			{waiting.length > 0 ? (
				<Section aria-labelledby="money-in-waiting">
					<SectionHeader
						id="money-in-waiting"
						title="Waiting in Review"
						count={waiting.length}
						action={
							<Button asChild variant="outline" size="sm">
								<Link to="/review">Open Review</Link>
							</Button>
						}
					/>
					<p className="text-sm text-muted-foreground">
						Nobody has said what these are yet, so they aren’t counted. Say what each one is in
						Review.
					</p>
					<DataTable
						label={`Money in waiting in Review in ${monthName(month)}`}
						columns={columnsFor({ accountOf, total: sum(waiting), last: () => null })}
						data={waiting}
						getRowId={(line) => line.id}
					/>
				</Section>
			) : null}
			<Sheet
				open={open !== null}
				onOpenChange={(value) => {
					if (!value) setEditing(null);
				}}
			>
				{open ? (
					<SheetContent>
						<SheetHeader
							title={moneyInLabel(open)}
							description={`${formatMoney(open.amount)} · ${shortDay(open.date)}`}
						/>
						<div className="grid gap-5">
							<MoneyInKindChoice
								line={open}
								// Only while it is still open: the answer may come after "Done" was pressed,
								// and must not open the sheet again.
								onChanged={(line) => setEditing((current) => (current ? line : current))}
								onDone={() => setEditing(null)}
							/>
							<MoneyInFollowUpAsk line={open} today={today} onDone={() => setEditing(null)} />
						</div>
					</SheetContent>
				) : null}
			</Sheet>
		</>
	);
}
