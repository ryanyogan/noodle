import { type Cents, type MonthKey, type MonthState, stillToFund } from "@noodle/domain";
import { Badge } from "@noodle/ui/components/badge";
import { Button } from "@noodle/ui/components/button";
import { EmptyState } from "@noodle/ui/components/empty-state";
import { List, ListRow } from "@noodle/ui/components/list";
import { Section, SectionHeader } from "@noodle/ui/components/section";
import { Link, useHydrated } from "@tanstack/react-router";
import { Target } from "lucide-react";
import { useState } from "react";
import { ulid } from "ulid";
import { formatMoney } from "../format";
import { type GoalView, goalStatusName, useGoalMoney, useGoals } from "../goals";
import { FundGoalSheet } from "./goals";

/** This month's active Goals, what each still needs this month, and a way to fund it. */
export function PlanGoals({ state, title = "Goals" }: { state: MonthState; title?: string }) {
	const hydrated = useHydrated();
	const { goals, accounts } = useGoals();
	// Checking or savings to save up in, or a card or loan to pay off.
	const canAddGoal = accounts.length > 0;
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
								// A paid-off card needs no more payments; it's completed on its page.
								goal.kind === "payoff" && goal.progress.status === "reached" ? (
									<Badge variant="brand">Paid off</Badge>
								) : (
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
								)
							}
						/>
					))}
				</List>
			) : (
				<EmptyState
					icon={<Target />}
					title="No Goals yet"
					description={
						canAddGoal
							? "A Goal sets money aside for something ahead, like braces or a trip, or pays down a credit card or loan, funded from Free to Spend a little each month."
							: "A Goal sets money aside for something ahead, like braces or a trip, or pays down a credit card or loan. It starts from an Account, so add that Account first."
					}
					action={
						<Button variant="outline" size="sm" asChild>
							{canAddGoal ? (
								<Link to="/goals">Add a Goal</Link>
							) : (
								<Link to="/accounts">Add an Account first</Link>
							)}
						</Button>
					}
				/>
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

/**
 * The Goals on This Month: each one's on track or behind, the months to its target date, and what
 * it's been funded this month against what it needs. The header totals the month's Goal funding
 * (`funded`, as the Free to Spend breakdown counts it) and what dated Goals still need. Each row
 * funds its Goal here, as the Plan's Goals page does.
 */
export function GoalsThisMonth({
	month,
	goals,
	funded,
	freeToSpend,
}: {
	month: MonthKey;
	goals: GoalView[];
	/** This month's Goal funding from Free to Spend, every Goal (MonthState.fundedGoals). */
	funded: Cents;
	/** What the Fund sheet can take from. */
	freeToSpend: Cents;
}) {
	const { fund } = useGoalMoney();
	const [funding, setFunding] = useState<GoalView | null>(null);
	const needed = stillToFund(goals.map((g) => g.progress));
	const summary = [
		funded > 0 || needed === 0 ? `${formatMoney(funded)} funded` : null,
		needed > 0 ? `${formatMoney(needed)} still needed` : null,
	].filter((part) => part !== null);
	return (
		<Section aria-labelledby="goals-this-month">
			<SectionHeader
				id="goals-this-month"
				title="Goals"
				count={goals.length}
				action={
					funded > 0 || needed > 0 ? (
						<span className="text-[13px] text-muted-foreground tabular-nums">
							{summary.join(" · ")}
						</span>
					) : undefined
				}
			/>
			<List>
				{goals.map((goal) => (
					<GoalThisMonthRow key={goal.id} goal={goal} onFund={() => setFunding(goal)} />
				))}
			</List>
			<Link
				to="/plan/$month/goals"
				params={{ month }}
				className="justify-self-start px-1 text-[13px] font-medium text-muted-foreground underline decoration-border-strong underline-offset-3 hover:text-foreground hover:decoration-foreground"
			>
				Goals in the Plan
			</Link>
			<FundGoalSheet
				goal={funding}
				freeToSpend={freeToSpend}
				onOpenChange={(open) => {
					if (!open) setFunding(null);
				}}
				onFund={(goal, amountCents) => {
					setFunding(null);
					fund.mutate({
						moveId: ulid(),
						goalId: goal.id,
						goalName: goal.name,
						month,
						amountCents,
					});
				}}
			/>
		</Section>
	);
}

function GoalThisMonthRow({ goal, onFund }: { goal: GoalView; onFund: () => void }) {
	const hydrated = useHydrated();
	const { progress } = goal;
	const payoff = goal.kind === "payoff";
	const status =
		payoff && progress.status === "reached" ? (
			<Badge variant="brand">Paid off</Badge>
		) : progress.status === "behind" ? (
			<Badge variant="pace" dot>
				{goalStatusName.behind}
			</Badge>
		) : progress.status === "past-due" ? (
			<Badge variant="over" dot>
				{goalStatusName["past-due"]}
			</Badge>
		) : null;
	const meta = [
		// A payoff Goal says what's still owed (ADR-0019); paid off is its badge.
		payoff && progress.status !== "reached"
			? `${formatMoney(progress.remaining)} still owed`
			: null,
		progress.status === "on-track" || (progress.status === "reached" && !payoff)
			? goalStatusName[progress.status]
			: progress.status === "saving"
				? "No target date"
				: null,
		// A past-due Goal has no months left, and a reached one needs none.
		!progress.monthsLeft || progress.status === "reached"
			? null
			: progress.monthsLeft === 1
				? "Due this month"
				: `${progress.monthsLeft} months left`,
	].filter((part) => part !== null);
	return (
		<ListRow
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
			badge={status}
			meta={meta.length > 0 ? meta.join(" · ") : undefined}
			trailing={
				<div className="flex flex-col items-end gap-2 sm:flex-row sm:items-center sm:gap-4">
					{progress.monthly !== null && progress.status !== "reached" ? (
						<span className="grid justify-items-end gap-0.5">
							<span className="text-sm font-semibold tabular-nums">
								{formatMoney(progress.fundedThisMonth)}
							</span>
							<span className="text-xs text-subtle-foreground tabular-nums">
								of {formatMoney(progress.monthly)} this month
							</span>
						</span>
					) : progress.fundedThisMonth > 0 ? (
						<span className="grid justify-items-end gap-0.5">
							<span className="text-sm font-semibold tabular-nums">
								{formatMoney(progress.fundedThisMonth)}
							</span>
							<span className="text-xs text-subtle-foreground">funded this month</span>
						</span>
					) : null}
					{/* A paid-off card needs no more payments; it's completed on its page. */}
					{payoff && progress.status === "reached" ? null : (
						<Button
							type="button"
							variant="outline"
							size="sm"
							disabled={!hydrated}
							aria-label={`Fund ${goal.name}`}
							onClick={onFund}
						>
							Fund
						</Button>
					)}
				</div>
			}
		/>
	);
}

/** What a Goal still needs this month, in words. */
function goalThisMonth({ kind, progress, target, account }: GoalView): string {
	if (progress.status === "reached") return kind === "payoff" ? "Paid off" : "Reached";
	if (progress.leftThisMonth === null) {
		return kind === "payoff"
			? `Paid down ${formatMoney(progress.saved)} of ${formatMoney(target)}${account ? ` on ${account.name}` : ""}`
			: `${formatMoney(progress.saved)} of ${formatMoney(target)} set aside`;
	}
	return progress.leftThisMonth > 0
		? `${formatMoney(progress.leftThisMonth)} left to fund this month`
		: "Funded for this month";
}
