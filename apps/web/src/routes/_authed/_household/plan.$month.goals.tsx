import { monthOfDay } from "@noodle/domain";
import { Button } from "@noodle/ui/components/button";
import { Card } from "@noodle/ui/components/card";
import { createFileRoute, Link } from "@tanstack/react-router";
import { PlanGoals } from "../../../components/plan-goals";
import { PlanSubPage } from "../../../components/plan-page";
import { formatMoney } from "../../../format";
import { goalsQuery, useMonthState } from "../../../queries";

export const Route = createFileRoute("/_authed/_household/plan/$month/goals")({
	loader: ({ context }) => context.queryClient.ensureQueryData(goalsQuery()),
	component: PlanGoalsPage,
});

function PlanGoalsPage() {
	const { month } = Route.useRouteContext();
	const state = useMonthState(month);
	const current = monthOfDay(state.asOf);
	// Goal funding comes out of the current month's Free to Spend only.
	const funding = month === current && state.editable;
	return (
		<PlanSubPage
			page="goals"
			month={month}
			current={current}
			editable={state.editable}
			title="Goals"
			summary={
				state.fundedGoals > 0
					? `${formatMoney(state.fundedGoals)} funded from Free to Spend this month`
					: undefined
			}
		>
			{funding ? (
				<PlanGoals state={state} title="To fund this month" />
			) : (
				<Card className="flex items-center justify-between gap-4 p-(--card-pad) text-sm text-muted-foreground">
					Goals are funded from the current month’s Free to Spend.
					<Button variant="outline" size="sm" asChild>
						<Link to="/goals">See Goals</Link>
					</Button>
				</Card>
			)}
		</PlanSubPage>
	);
}
