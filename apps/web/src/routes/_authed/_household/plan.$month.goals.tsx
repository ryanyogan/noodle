import { monthOfDay } from "@noodle/domain";
import { Button } from "@noodle/ui/components/button";
import { Card } from "@noodle/ui/components/card";
import { SplitLayout, SplitMain, SplitRail } from "@noodle/ui/components/layout";
import { Money } from "@noodle/ui/components/money";
import { Section, SectionHeader } from "@noodle/ui/components/section";
import { createFileRoute, Link } from "@tanstack/react-router";
import { PlanGoals } from "../../../components/plan-goals";
import { PlanSubPage, TotalsCard } from "../../../components/plan-page";
import { SectionPending } from "../../../components/section-layout";
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
	if (funding) {
		return (
			// The Goals to fund on the left; beside them, from lg, what funding has taken this month and
			// what it leaves, under a heading on the list's own line (#73). A phone keeps its one line
			// above the list.
			<SplitLayout stack="children" className="max-w-2xl lg:max-w-none">
				<SplitMain>
					<div className="grid min-w-0 gap-8">
						<PlanGoals state={state} title="To fund this month" />
						{/* Funding is this page's job; a Goal's target, progress and history are on Goals. */}
						<Link to="/goals" className={quietLink}>
							All Goals and their progress
						</Link>
					</div>
				</SplitMain>
				<SplitRail>
					{state.fundedGoals > 0 ? (
						<div className="grid gap-3 max-lg:order-first lg:hidden">
							<p className="px-1 text-sm text-muted-foreground tabular-nums">
								<Money cents={state.fundedGoals} /> funded from Free to Spend this month
							</p>
						</div>
					) : null}
					<Section aria-labelledby="goal-funding-month" className="max-lg:hidden">
						<SectionHeader id="goal-funding-month" title="This month" />
						<TotalsCard
							label="Goal funding this month"
							lines={[
								{ label: "Funded from Free to Spend", value: <Money cents={state.fundedGoals} /> },
								{
									label: "Free to Spend",
									value: <Money cents={state.freeToSpend} flagNegative />,
									tone: "strong",
								},
							]}
						/>
					</Section>
				</SplitRail>
			</SplitLayout>
		);
	}
	return (
		<PlanSubPage
			editable={state.editable}
			summary={
				state.fundedGoals > 0 ? (
					<>
						<Money cents={state.fundedGoals} /> funded from Free to Spend this month
					</>
				) : undefined
			}
		>
			<Card className="flex items-center justify-between gap-4 p-(--card-pad) text-sm text-muted-foreground">
				Goals are funded from the current month’s Free to Spend.
				<Button variant="outline" size="sm" asChild>
					<Link to="/goals">See Goals</Link>
				</Button>
			</Card>
		</PlanSubPage>
	);
}
