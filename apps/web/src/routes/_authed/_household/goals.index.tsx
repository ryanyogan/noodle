import { GOAL_KINDS, type GoalKind } from "@noodle/domain";
import { Badge } from "@noodle/ui/components/badge";
import { Button } from "@noodle/ui/components/button";
import { Card } from "@noodle/ui/components/card";
import { EmptyState } from "@noodle/ui/components/empty-state";
import { FormError } from "@noodle/ui/components/field";
import { List } from "@noodle/ui/components/list";
import { PageHeader } from "@noodle/ui/components/page-header";
import { Section, SectionHeader } from "@noodle/ui/components/section";
import { cn } from "@noodle/ui/lib/utils";
import { createFileRoute, Link, useHydrated } from "@tanstack/react-router";
import { Landmark, Plus, Target, Telescope } from "lucide-react";
import { useState } from "react";
import { z } from "zod";
import { AddGoalSheet, GoalProgressBar, GoalSummary, LinkRow } from "../../../components/goals";
import { SaveFailed } from "../../../components/plan-editing";
import { TermHelp } from "../../../components/term-help";
import { formatMoney } from "../../../format";
import { GoalRefused, type GoalView, useAddGoal, useGoals } from "../../../goals";
import { goalsQuery } from "../../../queries";

export const Route = createFileRoute("/_authed/_household/goals/")({
	// `?add=payoff` opens Add Goal on paying off a card or loan (from the Plan's pages).
	validateSearch: z.object({ add: z.enum(GOAL_KINDS).optional().catch(undefined) }),
	loader: ({ context }) => context.queryClient.ensureQueryData(goalsQuery()),
	component: GoalsPage,
});

function GoalsPage() {
	const hydrated = useHydrated();
	const { accounts, goals, asOf } = useGoals();
	const { add } = Route.useSearch();
	const navigate = Route.useNavigate();
	const [adding, setAdding] = useState<GoalKind | null>(null);
	const addKind = adding ?? add ?? null;
	const closeAdding = () => {
		setAdding(null);
		if (add) void navigate({ search: {}, replace: true });
	};
	const addGoal = useAddGoal();
	// Any Account will do: checking or savings for saving up, a card or loan for paying off.
	const canAddGoal = accounts.length > 0;
	const active = goals.filter((g) => g.state === "active" && g.kind === "save");
	const payingOff = goals.filter((g) => g.state === "active" && g.kind === "payoff");
	const completed = goals.filter((g) => g.state === "completed");
	const archived = goals.filter((g) => g.state === "archived");

	const addGoalButton = (
		<Button type="button" size="sm" disabled={!hydrated} onClick={() => setAdding("save")}>
			<Plus />
			Add Goal
		</Button>
	);

	if (goals.length === 0 && !canAddGoal) {
		return (
			<>
				<PageHeader title="Goals" />
				<div className="grid max-w-2xl gap-4">
					<EmptyState
						icon={<Target />}
						title="Goals start from an Account"
						description="A Goal is money in a checking or savings Account that you’re keeping for something, like braces or a trip, or a plan to pay off a credit card or loan. Add the Account first, with what’s in it or owed on it now."
					/>
					<AccountsLink />
				</div>
			</>
		);
	}

	return (
		<>
			<PageHeader
				title="Goals"
				actions={
					<>
						{/* On phones Explore lives here; the sidebar has its own link. */}
						<Button variant="outline" size="sm" asChild className="lg:hidden">
							<Link to="/explore">
								<Telescope />
								Explore
							</Link>
						</Button>
						{canAddGoal ? addGoalButton : null}
					</>
				}
			/>
			<div className="grid max-w-2xl gap-8">
				{addGoal.error instanceof GoalRefused && addGoal.variables?.kind === "payoff" ? (
					<FormError>
						That card or loan owes nothing now, or is already being paid off, so no Goal was added.
					</FormError>
				) : (
					<SaveFailed change={addGoal} />
				)}
				{payingOff.length > 0 ? (
					<Section aria-labelledby="paying-off-goals">
						<SectionHeader
							id="paying-off-goals"
							title="Paying off"
							count={payingOff.length}
							help={<TermHelp term="payoff-goal" />}
						/>
						<List>
							{payingOff.map((goal) => (
								<GoalItem key={goal.id} goal={goal} />
							))}
						</List>
					</Section>
				) : null}
				<Section aria-labelledby="active-goals">
					<SectionHeader id="active-goals" title="Saving for" count={active.length} />
					{active.length > 0 ? (
						<List>
							{active.map((goal) => (
								<GoalItem key={goal.id} goal={goal} />
							))}
						</List>
					) : canAddGoal ? (
						<Card className="p-(--card-pad) text-sm text-muted-foreground">
							No savings Goals yet. Add one to start setting money aside for it, a little each
							month.
						</Card>
					) : (
						<Card className="grid justify-items-start gap-3 p-(--card-pad) text-sm text-muted-foreground">
							Goals are set aside in a checking or savings Account. Add one to start a new Goal.
							<AccountsLink />
						</Card>
					)}
				</Section>
				{completed.length > 0 ? (
					<Section aria-labelledby="completed-goals">
						<SectionHeader id="completed-goals" title="Completed" count={completed.length} />
						<List>
							{completed.map((goal) => (
								<GoalItem key={goal.id} goal={goal} quiet />
							))}
						</List>
					</Section>
				) : null}
				{archived.length > 0 ? (
					<Section aria-labelledby="archived-goals">
						<SectionHeader id="archived-goals" title="Archived" count={archived.length} />
						<List>
							{archived.map((goal) => (
								<GoalItem key={goal.id} goal={goal} quiet />
							))}
						</List>
					</Section>
				) : null}
			</div>
			<AddGoalSheet
				// Keyed so it opens on the kind asked for.
				key={addKind ?? "closed"}
				open={addKind !== null}
				onOpenChange={(open) => {
					if (!open) closeAdding();
				}}
				accounts={accounts}
				goals={goals}
				today={asOf}
				kind={addKind ?? "save"}
				onAdd={(goal) => {
					addGoal.mutate(goal);
					closeAdding();
				}}
			/>
		</>
	);
}

/** A Goal: its name, how it's doing, and saved of target with a quiet bar. */
function GoalItem({ goal, quiet = false }: { goal: GoalView; quiet?: boolean }) {
	const { progress } = goal;
	if (goal.kind === "payoff") return <PayoffGoalItem goal={goal} quiet={quiet} />;
	return (
		<LinkRow
			link={(props) => <Link to="/goals/$goalId" params={{ goalId: goal.id }} {...props} />}
			label={`${goal.name}, ${formatMoney(progress.saved)} of ${formatMoney(goal.target)}${goal.account ? `, in ${goal.account.name}` : ""}`}
			title={<span className={cn(quiet && "text-muted-foreground")}>{goal.name}</span>}
			meta={
				<>
					<GoalSummary goal={goal} />
					{goal.account ? (
						<span className="inline-flex items-center gap-1.5">
							<span aria-hidden="true">·</span>in {goal.account.name}
						</span>
					) : null}
				</>
			}
			trailing={
				<>
					<span className="text-sm font-semibold tabular-nums">{formatMoney(progress.saved)}</span>
					<span className="text-xs text-subtle-foreground tabular-nums">
						of {formatMoney(goal.target)}
					</span>
				</>
			}
			below={goal.state === "active" ? <GoalProgressBar share={progress.share} /> : undefined}
		/>
	);
}

/**
 * A payoff Goal (ADR-0019): paid down so far and how it's doing, with what's still owed on the
 * right and the bar filling as what's owed comes down.
 */
function PayoffGoalItem({ goal, quiet }: { goal: GoalView; quiet: boolean }) {
	const { progress } = goal;
	const paidOff = progress.status === "reached";
	return (
		<LinkRow
			link={(props) => <Link to="/goals/$goalId" params={{ goalId: goal.id }} {...props} />}
			label={`${goal.name}, paid down ${formatMoney(progress.saved)} of ${formatMoney(goal.target)}, ${paidOff ? "paid off" : `${formatMoney(progress.remaining)} still owed`}${goal.account ? `, on ${goal.account.name}` : ""}`}
			title={<span className={cn(quiet && "text-muted-foreground")}>{goal.name}</span>}
			meta={
				<>
					<span>Paid down {formatMoney(progress.saved)}</span>
					<span aria-hidden="true">·</span>
					<GoalSummary goal={goal} />
				</>
			}
			trailing={
				paidOff ? (
					<Badge variant="brand">Paid off</Badge>
				) : (
					<>
						<span className="text-sm font-semibold tabular-nums">
							{formatMoney(progress.remaining)}
						</span>
						<span className="text-xs text-muted-foreground">still owed</span>
					</>
				)
			}
			below={goal.state === "archived" ? undefined : <GoalProgressBar share={progress.share} />}
		/>
	);
}

/** Where Accounts are added: Goals are set aside in one. */
function AccountsLink() {
	return (
		<Button variant="outline" size="sm" asChild>
			<Link to="/accounts">
				<Landmark />
				Go to Accounts
			</Link>
		</Button>
	);
}
