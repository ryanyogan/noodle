import {
	addDays,
	comingUp,
	type DayKey,
	type Due,
	type Lump,
	type MonthKey,
	monthOfDay,
} from "@noodle/domain";
import { Badge } from "@noodle/ui/components/badge";
import { Button } from "@noodle/ui/components/button";
import { Card } from "@noodle/ui/components/card";
import { List, ListRow } from "@noodle/ui/components/list";
import { Tile } from "@noodle/ui/components/tile";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ChevronRight, Info } from "lucide-react";
import { useState } from "react";
import { dayName, formatMoney, monthName, shortDay } from "../format";
import { commitmentsQuery } from "../queries";

/** How far ahead Coming up looks, today included. */
export const COMING_UP_DAYS = 30;

/** "Today", "Tomorrow", or "Fri, Oct 2". */
export function dueDay(date: DayKey, today: DayKey) {
	return date === addDays(today, 1) ? "Tomorrow" : dayName(date, today);
}

/** "Paid", "$200 of $600 paid", or nothing while none of it is. */
export function dueStatus(due: Pick<Due, "status" | "paid" | "amount">) {
	if (due.status === "paid") return "Paid";
	if (due.status === "partly-paid")
		return `${formatMoney(due.paid)} of ${formatMoney(due.amount)} paid`;
	return null;
}

/** What the Commitments are due from today through the next 30 days, by date. */
export function useComingUp() {
	const data = useSuspenseQuery(commitmentsQuery()).data;
	const dues = comingUp(data, data.charges, data.asOf, COMING_UP_DAYS);
	const month = monthOfDay(data.asOf);
	const active = data.commitments.some(
		(c) => c.fromMonth <= month && (c.endedFromMonth === null || month < c.endedFromMonth),
	);
	return { dues, today: data.asOf, month, active };
}

/**
 * Coming up: what the Commitments are due from today through the next 30 days, by date, each
 * linking to its Commitment's page. Bills (This Month) holds it.
 */
/** How many Coming up shows before "See all". */
const COMING_UP_FIRST = 5;

export function ComingUpList() {
	const { dues, today } = useComingUp();
	// The first few, so a busy month doesn't push everything below it down (#47).
	const [all, setAll] = useState(false);
	const shown = all ? dues : dues.slice(0, COMING_UP_FIRST);
	return dues.length > 0 ? (
		<div className="grid gap-2">
			<List>
				{shown.map((due) => (
					<DueRow key={`${due.commitmentId}:${due.date}`} due={due} today={today} />
				))}
			</List>
			{dues.length > COMING_UP_FIRST ? (
				<Button
					type="button"
					variant="ghost"
					size="sm"
					className="justify-self-start"
					aria-expanded={all}
					onClick={() => setAll(!all)}
				>
					{all ? "Show fewer" : `See all ${dues.length}`}
				</Button>
			) : null}
		</div>
	) : (
		<Card className="p-(--card-pad) text-sm text-muted-foreground">
			Nothing is due in the next 30 days.
		</Card>
	);
}

/**
 * The Plan overview's line about Coming up: how many bills are due in the next 30 days and what
 * they come to, linking to This Month's Bills, which lists them. Nothing without Commitments.
 */
export function ComingUpSummary() {
	const { dues, month, active } = useComingUp();
	if (!active && dues.length === 0) return null;
	const unpaid = dues.filter((due) => due.status !== "paid");
	const total = unpaid.reduce((sum, due) => sum + due.amount - due.paid, 0);
	return (
		<Link
			to="/month/$month"
			params={{ month }}
			hash="bills"
			className="flex items-center justify-between gap-3 rounded-2xl bg-card px-(--card-pad) py-3.5 text-sm shadow-card ring-1 ring-border transition-colors duration-(--duration-fast) ease-standard hover:bg-surface-2/60"
		>
			<span>
				<span className="font-medium">Coming up</span>
				<span className="text-muted-foreground">
					{" · "}
					{unpaid.length === 0
						? "nothing due in the next 30 days"
						: `${unpaid.length === 1 ? "1 bill" : `${unpaid.length} bills`} due in the next 30 days, ${formatMoney(total)}`}
				</span>
			</span>
			<ChevronRight aria-hidden="true" className="size-4 shrink-0 text-subtle-foreground" />
		</Link>
	);
}

function DueRow({ due, today }: { due: Due; today: DayKey }) {
	const status = dueStatus(due);
	const day = dueDay(due.date, today);
	return (
		<ListRow
			aria-label={`${due.name}, due ${day}, ${formatMoney(due.amount)}${status ? `, ${status}` : ""}`}
			leading={<DateTile date={due.date} />}
			title={
				<Link
					to="/plan/commitments/$id"
					params={{ id: due.commitmentId }}
					className="hover:underline"
				>
					{due.name}
				</Link>
			}
			meta={
				<>
					<span>{day}</span>
					{status ? (
						<Badge variant={due.status === "paid" ? "default" : "pace"} dot>
							{status}
						</Badge>
					) : null}
				</>
			}
			trailing={<span className="text-sm font-medium tabular-nums">{formatMoney(due.amount)}</span>}
		/>
	);
}

/** A row's leading square showing a day: "OCT" over "2". */
export function DateTile({ date }: { date: DayKey }) {
	return (
		<Tile aria-hidden="true" className="content-center gap-0.5">
			<span className="text-[9px] leading-none font-semibold tracking-wide uppercase">
				{shortDay(date).split(" ")[0]}
			</span>
			<span className="text-sm leading-none font-semibold text-foreground tabular-nums">
				{Number(date.slice(8, 10))}
			</span>
		</Tile>
	);
}

const times = (count: number) => (count === 3 ? "three times" : `${count} times`);

/**
 * Why a month's Free to Spend is lower: "Car insurance $1,140 is due in March. That's why
 * March's Free to Spend is lower."
 */
export function lumpText(lumps: readonly Lump[], month: MonthKey): string {
	const name = monthName(month);
	const causes = lumps.map((lump) =>
		lump.cadence === "annual"
			? `${lump.name} ${formatMoney(lump.extra)} is due in ${name}.`
			: `${lump.name} is due ${times(lump.dueDates.length)} in ${name}, ${formatMoney(lump.extra)} more than most months.`,
	);
	return `${causes.join(" ")} That’s why ${name}’s Free to Spend is lower.`;
}

/** Explains a lumpy month's lower Free to Spend. Nothing when the month isn't lumpy. */
export function LumpCallout({ lumps, month }: { lumps: readonly Lump[]; month: MonthKey }) {
	if (lumps.length === 0) return null;
	return (
		<Card
			role="note"
			aria-label="Why Free to Spend is lower"
			className="flex gap-3 p-(--card-pad) text-sm text-muted-foreground"
		>
			<Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
			<p>{lumpText(lumps, month)}</p>
		</Card>
	);
}
