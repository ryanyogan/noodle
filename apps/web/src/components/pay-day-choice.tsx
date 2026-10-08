import { countsOn, monthOfDay } from "@noodle/domain";
import { Field } from "@noodle/ui/components/field";
import { OptionSelect } from "@noodle/ui/components/select";
import { toast } from "@noodle/ui/components/toast";
import { useQuery } from "@tanstack/react-query";
import { useHydrated } from "@tanstack/react-router";
import { useId } from "react";
import { monthName, shortDay } from "../format";
import { MoneyInRefused, refusedText } from "../money-in";
import { NOT_A_PAYCHECK, payDayChoicesQuery, useSetPayDay } from "../pay-days";
import type { MoneyInLine } from "../server/money-in";

/**
 * "This is the pay for…" on a line of Income that is a salaried Parent's pay (issue 156,
 * ADR-0063): that Parent's pay days near the day it landed, and "Not a paycheck for a pay day".
 * Said at once, like its kind and whose pay it is, and from then on the automatic rule leaves the
 * line alone. Nothing shows for Income that is nobody's paycheck.
 */
export function PayDayChoice({
	line,
	onChanged,
}: {
	line: MoneyInLine;
	onChanged: (line: MoneyInLine) => void;
}) {
	const id = useId();
	const hydrated = useHydrated();
	const { data: choices } = useQuery(payDayChoicesQuery(line));
	const change = useSetPayDay();
	const countsIn = monthOfDay(countsOn(line));
	// Another line's pay day already is not offered; this line's own always is.
	const days = (choices ?? []).filter((choice) => !choice.taken || choice.day === line.payDay);
	if (days.length === 0 && !line.payDay) return null;
	const offered = days.some((choice) => choice.day === line.payDay) || !line.payDay;
	return (
		<Field
			label="This is the pay for…"
			htmlFor={`${id}-pay-day`}
			hint={
				line.payDay
					? `It landed ${shortDay(line.date)} and counts in ${monthName(countsIn)}’s Income.`
					: `It counts in ${monthName(countsIn)}’s Income, the month it landed.`
			}
		>
			<OptionSelect
				id={`${id}-pay-day`}
				data-testid="pay-day-choice"
				value={line.payDay ?? NOT_A_PAYCHECK}
				disabled={!hydrated || change.isPending}
				choices={[
					...(offered || !line.payDay
						? []
						: [{ value: line.payDay, label: `Pay for ${shortDay(line.payDay)}` }]),
					...days.map((choice) => ({
						value: choice.day,
						label: `Pay for ${shortDay(choice.day)}`,
					})),
					{ value: NOT_A_PAYCHECK, label: "Not a paycheck for a pay day" },
				]}
				onValueChange={(value) =>
					change.mutate(
						{ line, payDay: value === NOT_A_PAYCHECK ? null : value },
						{
							onSuccess: (now) => {
								onChanged(now);
								toast(
									now.payDay
										? `Counts as the pay for ${shortDay(now.payDay)}`
										: `Counts in ${monthName(monthOfDay(now.date))}, the month it landed`,
									{ tone: "success" },
								);
							},
							onError: (error) =>
								toast(
									// Refused by the month it would leave (ADR-0052): said for a paycheck, which
									// stays Income either way.
									error instanceof MoneyInRefused && error.reason === "extra-income"
										? `Some of ${monthName(countsIn)}’s Extra income has gone somewhere already, so this still counts in ${monthName(countsIn)}.`
										: refusedText(error, "Couldn’t change it, so it’s as it was."),
									{ tone: "error" },
								),
						},
					)
				}
			/>
		</Field>
	);
}
