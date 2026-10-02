import { GOAL_KINDS, type GoalKind, type MonthKey } from "@noodle/domain";
import { Badge } from "@noodle/ui/components/badge";
import { Button } from "@noodle/ui/components/button";
import { Card } from "@noodle/ui/components/card";
import { EmptyState } from "@noodle/ui/components/empty-state";
import { FormError } from "@noodle/ui/components/field";
import { List } from "@noodle/ui/components/list";
import { PageHeader } from "@noodle/ui/components/page-header";
import { Section, SectionHeader } from "@noodle/ui/components/section";
import { cn } from "@noodle/ui/lib/utils";
import { createFileRoute, Link, useHydrated, useParams } from "@tanstack/react-router";
import { Landmark, Plus, Target, Telescope } from "lucide-react";
import { useState } from "react";
import { z } from "zod";
import { AddGoalSheet, GoalProgressBar, GoalSummary, LinkRow } from "../../../components/goals";
import { ListBesideDetail, masterDetailItem } from "../../../components/master-detail";
import { SaveFailed } from "../../../components/plan-editing";
import { TermHelp } from "../../../components/term-help";
import { formatMoney } from "../../../format";
import { GoalRefused, type GoalView, useAddGoal, useGoals } from "../../../goals";
import { goalsQuery } from "../../../queries";

export const Route = createFileRoute("/_authed/_household/goals")({
	// `?add=payoff` opens Add Goal on paying off a card or loan (from the Plan's pages).
	validateSearch: z.object({ add: z.enum(GOAL_KINDS).optional().catch(undefined) }),
	loader: ({ context }) => context.queryClient.ensureQueryData(goalsQuery()),
	component: GoalsPage,
});

function GoalsPage() {
	const hydrated = useHydrated();
	const { accounts, goals, asOf, month, emergencyGoalId } = useGoals();
	const { add } = Route.useSearch();
	const navigate = Route.useNavigate();
	const [adding, setAdding] = useState<GoalKind | null>(null);
	const addKind = adding ?? add ?? null;
	const closeAdding = () => {
		setAdding(null);
		if (add) void navigate({ search: {}, replace: true });
	};
	const picked = useParams({ strict: false, select: (params) => params.goalId });
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
			<ListBesideDetail
				picked={picked !== undefined}
				noun="Goal"
				listLabel="Goals"
				hint="Pick a Goal to see it here."
				aside={
					active.length + payingOff.length > 0 ? (
						<GoalsSummary
							goals={[...active, ...payingOff]}
							emergency={
								goals.find((g) => g.id === emergencyGoalId && g.state === "active") ?? null
							}
						/>
					) : undefined
				}
				list={
					<>
						{addGoal.error instanceof GoalRefused && addGoal.variables?.kind === "payoff" ? (
							<FormError>
								That card or loan owes nothing now, or is already being paid off, so no Goal was
								added.
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
										<GoalItem
											key={goal.id}
											goal={goal}
											month={month}
											emergency={goal.id === emergencyGoalId}
										/>
									))}
								</List>
							</Section>
						) : null}
						<Section aria-labelledby="active-goals">
							<SectionHeader id="active-goals" title="Saving for" count={active.length} />
							{active.length > 0 ? (
								<>
									<List>
										{active.map((goal) => (
											<GoalItem
												key={goal.id}
												goal={goal}
												month={month}
												emergency={goal.id === emergencyGoalId}
											/>
										))}
									</List>
									{/* What each Goal is and how far along lives here; deciding how much of this
								    month's Free to Spend goes to them is the Plan's Goal funding page. */}
									<Link
										to="/plan/$month/goals"
										params={{ month }}
										className="inline-flex min-h-11 items-center justify-self-start px-1 text-[13px] font-medium text-muted-foreground underline decoration-border-strong underline-offset-3 hover:text-foreground hover:decoration-foreground lg:min-h-6"
									>
										Fund Goals from this month’s Plan
									</Link>
								</>
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
					</>
				}
			/>
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
function GoalItem({
	goal,
	month,
	quiet = false,
	emergency = false,
}: {
	goal: GoalView;
	month?: MonthKey;
	quiet?: boolean;
	emergency?: boolean;
}) {
	const { progress } = goal;
	if (goal.kind === "payoff") return <PayoffGoalItem goal={goal} quiet={quiet} />;
	return (
		<LinkRow
			link={(props) => (
				<Link to="/goals/$goalId" params={{ goalId: goal.id }} {...masterDetailItem} {...props} />
			)}
			label={`${goal.name}, ${formatMoney(progress.saved)} of ${formatMoney(goal.target)}${goal.account ? `, in ${goal.account.name}` : ""}`}
			title={
				// Inline, not flex, so a long name wraps and clamps with an ellipsis (LinkRow).
				<>
					<span className={cn(quiet && "text-muted-foreground")}>{goal.name}</span>
					{emergency ? (
						<Badge variant="brand" className="ms-2 align-middle">
							Emergency fund
						</Badge>
					) : null}
				</>
			}
			meta={
				<GoalSummary
					goal={goal}
					month={month}
					after={goal.account ? `in ${goal.account.name}` : null}
				/>
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
			link={(props) => (
				<Link to="/goals/$goalId" params={{ goalId: goal.id }} {...masterDetailItem} {...props} />
			)}
			label={`${goal.name}, paid down ${formatMoney(progress.saved)} of ${formatMoney(goal.target)}, ${paidOff ? "paid off" : `${formatMoney(progress.remaining)} still owed`}${goal.account ? `, on ${goal.account.name}` : ""}`}
			title={<span className={cn(quiet && "text-muted-foreground")}>{goal.name}</span>}
			meta={<GoalSummary goal={goal} before={`Paid down ${formatMoney(progress.saved)}`} />}
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

/**
 * What the active Goals add up to: set aside across them, and what dated Goals need each month
 * to stay on track. In the right pane from a laptop up while no Goal is picked, above the lists on a phone.
 */
function GoalsSummary({ goals, emergency }: { goals: GoalView[]; emergency: GoalView | null }) {
	const saving = goals.filter((g) => g.kind === "save");
	const setAside = saving.reduce((sum, g) => sum + g.progress.saved, 0);
	const monthly = goals.reduce((sum, g) => sum + (g.progress.monthly ?? 0), 0);
	return (
		<Card aria-label="Goals summary" className="grid gap-4 p-(--card-pad)">
			<dl className="grid grid-cols-2 gap-4">
				<div className="grid gap-1">
					<dt className="text-xs text-muted-foreground">
						Set aside across {saving.length} Goal{saving.length === 1 ? "" : "s"}
					</dt>
					<dd className="text-xl font-semibold tabular-nums">{formatMoney(setAside)}</dd>
				</div>
				<div className="grid gap-1">
					<dt className="text-xs text-muted-foreground">A month to stay on track</dt>
					<dd className="text-xl font-semibold tabular-nums">{formatMoney(monthly)}</dd>
				</div>
			</dl>
			{emergency ? (
				<p className="text-[13px] text-muted-foreground">
					Your emergency fund is{" "}
					<Link
						to="/goals/$goalId"
						params={{ goalId: emergency.id }}
						className="font-medium text-foreground hover:underline"
					>
						{emergency.name}
					</Link>
					.
				</p>
			) : null}
		</Card>
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
