import {
	type AboutAmount,
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
import { Info } from "lucide-react";
import { useState } from "react";
import { useAboutAmount } from "../commitments";
import { dayName, formatMoney, formatWholeMoney, monthName, shortDay } from "../format";
import { commitmentsQuery } from "../queries";

/** How far ahead Coming up looks, today included. */
export const COMING_UP_DAYS = 30;

/** "Today", "Tomorrow", or "Fri, Oct 2". */
export function dueDay(date: DayKey, today: DayKey) {
	return date === addDays(today, 1) ? "Tomorrow" : dayName(date, today);
}

/**
 * "Paid", "$200 of $600 paid", or nothing while none of it is. A bill that varies is paid by its
 * charge whatever that came to, and says it beside its "About" amount: "Paid · $125.00".
 */
export function dueStatus(due: Pick<Due, "status" | "paid" | "amount" | "about">) {
	if (due.about) return due.status === "due" ? null : `Paid · ${formatMoney(due.paid)}`;
	if (due.status === "paid") return "Paid";
	if (due.status === "partly-paid")
		return `${formatMoney(due.paid)} of ${formatMoney(due.amount)} paid`;
	return null;
}

/**
 * What a due date shows as its amount: "$2,300.00", or "About $160" for a bill that varies (the
 * average of its charges, else what the Plan sets aside before its first).
 */
export const dueAmount = (due: Pick<Due, "amount" | "about">, about: AboutAmount | null) =>
	due.about ? `About ${formatWholeMoney(about?.average ?? due.amount)}` : formatMoney(due.amount);

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
					// On a phone its words start on the cards' edge, as the lines around it do (issue 74).
					className="justify-self-start max-sm:-ms-2.5"
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

function DueRow({ due, today }: { due: Due; today: DayKey }) {
	const status = dueStatus(due);
	const day = dueDay(due.date, today);
	const amount = dueAmount(due, useAboutAmount({ id: due.commitmentId, about: due.about }));
	return (
		<ListRow
			aria-label={`${due.name}, due ${day}, ${amount}${status ? `, ${status}` : ""}`}
			leading={<DateTile date={due.date} />}
			title={
				<Link
					to="/plan/$month/commitments/$id"
					params={{ month: monthOfDay(today), id: due.commitmentId }}
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
			trailing={<span className="text-sm font-medium tabular-nums">{amount}</span>}
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
