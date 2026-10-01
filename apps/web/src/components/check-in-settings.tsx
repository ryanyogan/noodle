import { isWeekday, type Weekday } from "@noodle/domain";
import { Button } from "@noodle/ui/components/button";
import { Card } from "@noodle/ui/components/card";
import { Section, SectionHeader } from "@noodle/ui/components/section";
import { OptionSelect } from "@noodle/ui/components/select";
import { Tile } from "@noodle/ui/components/tile";
import { toast } from "@noodle/ui/components/toast";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Link, useHydrated } from "@tanstack/react-router";
import { CalendarCheck } from "lucide-react";
import { weekdayNames } from "../check-in";
import { checkInQuery } from "../queries";
import { setCheckInDay } from "../server/check-in";

/** The Household's Check-in day, which both Parents share, and a way into this week's. */
export function CheckInSettings() {
	const view = useSuspenseQuery(checkInQuery()).data;
	const queryClient = useQueryClient();
	const hydrated = useHydrated();
	const change = useMutation({
		mutationFn: (day: Weekday) => setCheckInDay({ data: { day } }),
		onError: () => toast("Couldn’t change the Check-in day.", { tone: "error" }),
		// The day decides which week this is, so the whole Check-in is read again.
		onSettled: () => queryClient.invalidateQueries({ queryKey: checkInQuery().queryKey }),
	});
	const day =
		change.isPending && change.variables !== undefined ? change.variables : view.checkInDay;
	return (
		<Section aria-labelledby="check-in">
			<SectionHeader id="check-in" title="Check-in" />
			<Card className="grid gap-3 p-(--card-pad) sm:flex sm:items-center">
				<div className="flex flex-1 items-center gap-3 text-sm">
					<Tile>
						<CalendarCheck />
					</Tile>
					<p className="text-muted-foreground">
						Once a week, each Parent gets a Nudge at 9 AM and an email with what needs them.
					</p>
				</div>
				<div className="flex gap-2">
					<OptionSelect
						className="flex-1 sm:w-36"
						aria-label="Check-in day"
						value={String(day)}
						disabled={!hydrated}
						onValueChange={(value) => {
							const chosen = Number(value);
							if (isWeekday(chosen)) change.mutate(chosen);
						}}
						choices={weekdayNames.map((name, index) => ({ value: String(index), label: name }))}
					/>
					<Button asChild variant="outline">
						<Link to="/check-in">Start</Link>
					</Button>
				</div>
			</Card>
		</Section>
	);
}
