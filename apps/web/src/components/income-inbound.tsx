import type { MonthKey } from "@noodle/domain";
import { Badge } from "@noodle/ui/components/badge";
import { Button } from "@noodle/ui/components/button";
import { Card } from "@noodle/ui/components/card";
import { DataTable, type DataTableColumn } from "@noodle/ui/components/data-table";
import { Section, SectionHeader } from "@noodle/ui/components/section";
import { Sheet, SheetContent, SheetHeader } from "@noodle/ui/components/sheet";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { formatMoney, shortDay } from "../format";
import {
	type MoneyInLine,
	moneyInKindText,
	moneyInLabel,
	moneyInQuery,
	useMoneyInKindChange,
} from "../money-in";
import { MoneyInFollowUpAsk, MoneyInKindChoice } from "./money-in";

/** All inbound deposits remain reachable here, even when they don't currently count as income. */
export function OtherMoneyIn({ month, today }: { month: MonthKey; today: string }) {
	const query = useQuery(moneyInQuery(month));
	const change = useMoneyInKindChange();
	const [editing, setEditing] = useState<MoneyInLine | null>(null);
	const open = query.data?.find((line) => line.id === editing?.id) ?? editing;
	const lines = (query.data ?? []).filter(
		(line) => line.amount > 0 && (line.needsReview || line.kind !== "income"),
	);
	const columns: DataTableColumn<MoneyInLine>[] = [
		{
			id: "from",
			header: "From",
			min: 9,
			width: "minmax(0,2fr)",
			stacked: "title",
			cell: (line) => (
				<Button
					type="button"
					variant="link"
					size="inline"
					className="text-start font-medium text-foreground no-underline hover:underline"
					onClick={() => setEditing(line)}
					aria-label={`Change what ${moneyInLabel(line)} is`}
				>
					{moneyInLabel(line)}
				</Button>
			),
		},
		{
			id: "date",
			header: "Date",
			min: 5,
			width: "5rem",
			priority: 2,
			stacked: "secondary",
			cell: (line) => shortDay(line.date),
		},
		{
			id: "kind",
			header: "Counted as",
			min: 7,
			width: "minmax(0,1fr)",
			stacked: "secondary",
			cell: (line) => (
				<Badge variant={line.needsReview ? "pace" : "default"}>{moneyInKindText(line)}</Badge>
			),
		},
		{
			id: "amount",
			header: "Amount",
			min: 6,
			width: "minmax(0,1fr)",
			align: "end",
			stacked: "value",
			cell: (line) => (
				<span className="font-medium text-money-in">+{formatMoney(line.amount)}</span>
			),
		},
		{
			id: "action",
			header: "Actions",
			headerHidden: true,
			min: 8,
			width: "8rem",
			stacked: "trailing",
			cell: (line) => (
				<Button
					size="sm"
					variant="outline"
					disabled={change.isPending}
					aria-label={`Mark ${moneyInLabel(line)} as income`}
					onClick={() =>
						void change
							.mutateAsync({ line, kind: "income", always: false })
							.then(setEditing)
							.catch(() => undefined)
					}
				>
					Mark as income
				</Button>
			),
		},
	];
	return (
		<Section aria-labelledby="other-money-in">
			<SectionHeader id="other-money-in" title="Other money in" count={lines.length} />
			<p className="text-sm text-muted-foreground">
				These deposits aren’t counted in your income total. Mark any deposit as income, or open it
				to choose a different type.
			</p>
			{query.isError ? (
				<Card className="p-4 text-sm" role="alert">
					Couldn’t load money in.{" "}
					<Button size="sm" variant="ghost" onClick={() => void query.refetch()}>
						Try again
					</Button>
				</Card>
			) : query.isPending ? (
				<p role="status" className="text-sm text-muted-foreground">
					Loading money in…
				</p>
			) : lines.length ? (
				<DataTable
					label="Other money in"
					columns={columns}
					data={lines}
					getRowId={(line) => line.id}
				/>
			) : (
				<Card className="p-5 text-sm text-muted-foreground">
					No other deposits this month. Any transfers, refunds, or money waiting for review will
					appear here.
				</Card>
			)}
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
							description={`+${formatMoney(open.amount)} · ${shortDay(open.date)}`}
						/>
						<div className="grid gap-5">
							<MoneyInKindChoice
								line={open}
								onChanged={setEditing}
								onDone={() => setEditing(null)}
							/>
							<MoneyInFollowUpAsk line={open} today={today} onDone={() => setEditing(null)} />
						</div>
					</SheetContent>
				) : null}
			</Sheet>
		</Section>
	);
}
