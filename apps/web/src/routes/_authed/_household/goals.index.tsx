import { Button } from "@noodle/ui/components/button";
import { Card } from "@noodle/ui/components/card";
import { EmptyState } from "@noodle/ui/components/empty-state";
import { List } from "@noodle/ui/components/list";
import { PageHeader } from "@noodle/ui/components/page-header";
import { Section, SectionHeader } from "@noodle/ui/components/section";
import { Tile } from "@noodle/ui/components/tile";
import { cn } from "@noodle/ui/lib/utils";
import { createFileRoute, Link, useHydrated } from "@tanstack/react-router";
import { Plus, Target, Telescope } from "lucide-react";
import { useState } from "react";
import {
	AddAccountForm,
	AddAccountSheet,
	AddGoalSheet,
	accountIcons,
	accountSplitText,
	balanceLabel,
	GoalProgressBar,
	GoalSummary,
	LinkRow,
} from "../../../components/goals";
import { SaveFailed } from "../../../components/plan-editing";
import { formatMoney } from "../../../format";
import {
	type AccountView,
	accountKindName,
	type GoalView,
	useAddAccount,
	useAddGoal,
	useGoals,
} from "../../../goals";
import { goalsQuery } from "../../../queries";

export const Route = createFileRoute("/_authed/_household/goals/")({
	loader: ({ context }) => context.queryClient.ensureQueryData(goalsQuery()),
	component: GoalsPage,
});

function GoalsPage() {
	const hydrated = useHydrated();
	const { accounts, goals, asOf } = useGoals();
	const [adding, setAdding] = useState(false);
	const [addingAccount, setAddingAccount] = useState(false);
	const addGoal = useAddGoal();
	const addAccount = useAddAccount();
	const canAddGoal = accounts.some((a) => a.holdsMoney);
	const active = goals.filter((g) => g.state === "active");
	const completed = goals.filter((g) => g.state === "completed");
	const archived = goals.filter((g) => g.state === "archived");

	const addGoalButton = (
		<Button type="button" size="sm" disabled={!hydrated} onClick={() => setAdding(true)}>
			<Plus />
			Add Goal
		</Button>
	);

	if (accounts.length === 0) {
		return (
			<>
				<PageHeader title="Goals" />
				<div className="grid max-w-2xl gap-4">
					<EmptyState
						icon={<Target />}
						title="Goals are money set aside in an Account"
						description="Each Goal is an Earmark on a checking or savings Account: money there that’s spoken for, like braces or a trip. Add the Account first, with what’s in it now."
					/>
					<AddAccountForm onAdd={(account) => addAccount.mutate(account)} />
					<SaveFailed change={addAccount} />
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
				<Section aria-labelledby="active-goals">
					<SectionHeader id="active-goals" title="Saving for" count={active.length} />
					<SaveFailed change={addGoal} />
					{active.length > 0 ? (
						<List>
							{active.map((goal) => (
								<GoalItem key={goal.id} goal={goal} />
							))}
						</List>
					) : (
						<Card className="p-(--card-pad) text-sm text-muted-foreground">
							{canAddGoal
								? "No Goals yet. Add one to start setting money aside for it, a little each month."
								: "Goals are set aside in a checking or savings Account. Add one below to start a Goal."}
						</Card>
					)}
				</Section>
				<Section aria-labelledby="accounts">
					<SectionHeader
						id="accounts"
						title="Accounts"
						count={accounts.length}
						action={
							<Button
								type="button"
								variant="ghost"
								size="sm"
								disabled={!hydrated}
								onClick={() => setAddingAccount(true)}
							>
								<Plus />
								Add Account
							</Button>
						}
					/>
					<SaveFailed change={addAccount} />
					<List>
						{accounts.map((account) => (
							<AccountItem key={account.id} account={account} />
						))}
					</List>
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
				open={adding}
				onOpenChange={setAdding}
				accounts={accounts}
				today={asOf}
				onAdd={(goal) => {
					addGoal.mutate(goal);
					setAdding(false);
				}}
			/>
			<AddAccountSheet
				open={addingAccount}
				onOpenChange={setAddingAccount}
				onAdd={(account) => {
					addAccount.mutate(account);
					setAddingAccount(false);
				}}
			/>
		</>
	);
}

/** A Goal: its name, how it's doing, and saved of target with a quiet bar. */
function GoalItem({ goal, quiet = false }: { goal: GoalView; quiet?: boolean }) {
	const { progress } = goal;
	return (
		<LinkRow
			link={(props) => <Link to="/goals/$goalId" params={{ goalId: goal.id }} {...props} />}
			label={`${goal.name}, ${formatMoney(progress.saved)} of ${formatMoney(goal.target)}`}
			title={<span className={cn(quiet && "text-muted-foreground")}>{goal.name}</span>}
			meta={<GoalSummary goal={goal} />}
			trailing={
				<>
					<span className="text-sm font-semibold tabular-nums">{formatMoney(progress.saved)}</span>
					<span className="text-xs text-subtle-foreground tabular-nums">
						of {formatMoney(goal.target)}
					</span>
				</>
			}
			below={goal.state === "archived" ? undefined : <GoalProgressBar share={progress.share} />}
		/>
	);
}

/** An Account: its kind and balance, and for money-holding ones how it splits. */
function AccountItem({ account }: { account: AccountView }) {
	const Icon = accountIcons[account.kind];
	const split = accountSplitText(account);
	return (
		<LinkRow
			link={(props) => (
				<Link to="/goals/accounts/$accountId" params={{ accountId: account.id }} {...props} />
			)}
			label={`${account.name}, ${accountKindName[account.kind]}, ${balanceLabel(account)}`}
			leading={
				<Tile aria-hidden="true">
					<Icon />
				</Tile>
			}
			title={account.name}
			meta={
				// One run of text, so it wraps like a sentence on a phone.
				<span>
					{accountKindName[account.kind]}
					{split ? (
						<>
							{" · "}
							<span className={cn(split.over && "text-over")}>{split.text}</span>
						</>
					) : null}
				</span>
			}
			trailing={
				<span
					className={cn(
						"text-sm tabular-nums",
						account.balance === null ? "text-subtle-foreground" : "font-semibold",
					)}
				>
					{balanceLabel(account)}
				</span>
			}
		/>
	);
}
