import { monthOfDay } from "@noodle/domain";
import { Button } from "@noodle/ui/components/button";
import { Card } from "@noodle/ui/components/card";
import { createFileRoute, Link } from "@tanstack/react-router";
import { PlanGoals } from "../../../components/plan-goals";
import { PlanSubPage } from "../../../components/plan-page";
import { SectionPending } from "../../../components/section-layout";
import { formatMoney } from "../../../format";
import { goalsQuery, useMonthState } from "../../../queries";

export const Route = createFileRoute("/_authed/_household/plan/$month/goals")({
	loader: ({ context }) => context.queryClient.ensureQueryData(goalsQuery()),
	pendingComponent: SectionPending,
	component: PlanGoalsPage,
});

const quietLink =
	"inline-flex min-h-11 items-center justify-self-start px-1 text-[13px] font-medium text-muted-foreground underline decoration-border-strong underline-offset-3 hover:text-foreground hover:decoration-foreground lg:min-h-6";

function PlanGoalsPage() {
	const { month } = Route.useRouteContext();
	const state = useMonthState(month);
	const current = monthOfDay(state.asOf);
	// Goal funding comes out of the current month's Free to Spend only.
	const funding = month === current && state.editable;
	return (
		<PlanSubPage
			editable={state.editable}
			summary={
				state.fundedGoals > 0
					? `${formatMoney(state.fundedGoals)} funded from Free to Spend this month`
					: undefined
			}
		>
			{funding ? (
				<>
					<PlanGoals state={state} title="To fund this month" />
					{/* Funding is this page's job; a Goal's target, progress and history are on Goals. */}
					<Link to="/goals" className={quietLink}>
						All Goals and their progress
					</Link>
				</>
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
