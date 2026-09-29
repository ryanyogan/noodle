import type { MonthState } from "@noodle/domain";
import { Button } from "@noodle/ui/components/button";
import { Card } from "@noodle/ui/components/card";
import { List, ListRow } from "@noodle/ui/components/list";
import { Section, SectionHeader } from "@noodle/ui/components/section";
import { Link, useHydrated } from "@tanstack/react-router";
import { useState } from "react";
import { ulid } from "ulid";
import { formatMoney } from "../format";
import { type GoalView, useGoalMoney, useGoals } from "../goals";
import { FundGoalSheet } from "./goals";

/** This month's active Goals, what each still needs this month, and a way to fund it. */
export function PlanGoals({ state, title = "Goals" }: { state: MonthState; title?: string }) {
	const hydrated = useHydrated();
	const { goals } = useGoals();
	const { fund } = useGoalMoney();
	const [funding, setFunding] = useState<GoalView | null>(null);
	const active = goals.filter((g) => g.state === "active");
	return (
		<Section aria-labelledby="plan-goals">
			<SectionHeader id="plan-goals" title={title} count={active.length} />
			{active.length > 0 ? (
				<List>
					{active.map((goal) => (
						<ListRow
							key={goal.id}
							aria-label={goal.name}
							title={
								<Link
									to="/goals/$goalId"
									params={{ goalId: goal.id }}
									className="underline-offset-4 hover:underline"
								>
									{goal.name}
								</Link>
							}
							meta={goalThisMonth(goal)}
							trailing={
								<Button
									type="button"
									variant="outline"
									size="sm"
									disabled={!hydrated}
									aria-label={`Fund ${goal.name}`}
									onClick={() => setFunding(goal)}
								>
									Fund
								</Button>
							}
						/>
					))}
				</List>
			) : (
				<Card className="flex items-center justify-between gap-4 p-(--card-pad) text-sm text-muted-foreground">
					Goals set money aside for something ahead, funded from Free to Spend.
					<Button variant="outline" size="sm" asChild>
						<Link to="/goals">Goals</Link>
					</Button>
				</Card>
			)}
			<FundGoalSheet
				goal={funding}
				freeToSpend={state.freeToSpend}
				onOpenChange={(open) => {
					if (!open) setFunding(null);
				}}
				onFund={(goal, amountCents) => {
					setFunding(null);
					fund.mutate({
						moveId: ulid(),
						goalId: goal.id,
						goalName: goal.name,
						month: state.month,
						amountCents,
					});
				}}
			/>
		</Section>
	);
}

/** What a Goal still needs this month, in words. */
function goalThisMonth({ progress, target }: GoalView): string {
	if (progress.status === "reached") return "Reached";
	if (progress.leftThisMonth === null) {
		return `${formatMoney(progress.saved)} of ${formatMoney(target)} set aside`;
	}
	return progress.leftThisMonth > 0
		? `${formatMoney(progress.leftThisMonth)} left to fund this month`
		: "Funded for this month";
}
