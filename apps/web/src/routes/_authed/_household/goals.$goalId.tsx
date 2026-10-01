import { type DayKey, goalHistory, type MonthKey, parseDollars } from "@noodle/domain";
import { Badge } from "@noodle/ui/components/badge";
import { Button } from "@noodle/ui/components/button";
import { Card } from "@noodle/ui/components/card";
import { Field, FormError } from "@noodle/ui/components/field";
import { Input } from "@noodle/ui/components/input";
import { List, ListGroupLabel, ListRow } from "@noodle/ui/components/list";
import { PageHeader } from "@noodle/ui/components/page-header";
import { Section, SectionHeader } from "@noodle/ui/components/section";
import { Sheet, SheetContent, SheetHeader } from "@noodle/ui/components/sheet";
import { cn } from "@noodle/ui/lib/utils";
import { createFileRoute, Link, notFound, useHydrated } from "@tanstack/react-router";
import { Pencil } from "lucide-react";
import { type FormEvent, type ReactNode, useId, useState } from "react";
import { ulid } from "ulid";
import {
	AmountInput,
	AmountSheet,
	BackToGoals,
	FundGoalSheet,
	GoalProgressBar,
} from "../../../components/goals";
import { PayoffGoalDetails } from "../../../components/payoff-goal";
import { Confirm, SaveFailed } from "../../../components/plan-editing";
import { TermHelp } from "../../../components/term-help";
import { formatMoney, fullDay, monthName, shortDay } from "../../../format";
import {
	type AccountView,
	type GoalChange,
	GoalRefused,
	type GoalView,
	goalStatusName,
	useArchiveGoal,
	useClaimForGoal,
	useCompleteGoal,
	useGoalMoney,
	useGoals,
	useSetEmergencyGoal,
	useUpdateGoal,
} from "../../../goals";
import { accountImportsQuery, goalsQuery, monthQuery, useMonthState } from "../../../queries";

export const Route = createFileRoute("/_authed/_household/goals/$goalId")({
	loader: async ({ context, params }) => {
		const data = await context.queryClient.ensureQueryData(goalsQuery());
		const goal = data.goals.find((g) => g.id === params.goalId);
		if (!goal) throw notFound();
		// Funding comes out of this month's Free to Spend, which the Fund sheet shows; a payoff
		// Goal's page also offers its card's latest statement balance.
		await Promise.all([
			context.queryClient.ensureQueryData(monthQuery(data.month)),
			goal.kind === "payoff"
				? context.queryClient.ensureQueryData(accountImportsQuery(goal.accountId))
				: null,
		]);
	},
	component: GoalPage,
});

type OpenSheet = "fund" | "spend" | "claim" | "release" | "edit" | null;

function GoalPage() {
	const { goalId } = Route.useParams();
	const { goals, accounts, month, asOf, emergencyGoalId } = useGoals();
	const goal = goals.find((g) => g.id === goalId);
	const account = accounts.find((a) => a.id === goal?.accountId);
	// A Goal only goes away if another Parent's change removes it; the loader 404s on reload.
	if (!goal) return <PageHeader eyebrow="Goal" title="Goal" leading={<BackToGoals />} />;
	if (goal.kind === "payoff") {
		return <PayoffGoalDetails goal={goal} account={account} month={month} today={asOf} />;
	}
	return (
		<GoalDetails
			goal={goal}
			account={account}
			month={month}
			today={asOf}
			emergency={emergencyGoalId === goal.id}
		/>
	);
}

function GoalDetails({
	goal,
	account,
	month,
	today,
	emergency,
}: {
	goal: GoalView;
	account: AccountView | undefined;
	month: MonthKey;
	today: DayKey;
	/** It's the Household's emergency Goal. */
	emergency: boolean;
}) {
	const hydrated = useHydrated();
	const { freeToSpend } = useMonthState(month);
	const { fund, undo, spend } = useGoalMoney();
	const claim = useClaimForGoal();
	const update = useUpdateGoal();
	const complete = useCompleteGoal();
	const archive = useArchiveGoal();
	const setEmergency = useSetEmergencyGoal();
	const [sheet, setSheet] = useState<OpenSheet>(null);
	const [archiving, setArchiving] = useState(false);
	const { progress } = goal;
	const active = goal.state === "active";
	const archived = goal.state === "archived";
	const accountName = account?.name ?? "its Account";
	const close = (open: boolean) => {
		if (!open) setSheet(null);
	};

	return (
		<>
			<PageHeader
				eyebrow="Goal"
				title={goal.name}
				leading={<BackToGoals />}
				actions={
					archived ? undefined : (
						<Button
							type="button"
							variant="ghost"
							size="sm"
							disabled={!hydrated}
							onClick={() => setSheet("edit")}
						>
							<Pencil />
							Edit
						</Button>
					)
				}
			/>
			<div className="grid max-w-2xl gap-8">
				<Card role="region" aria-labelledby="goal-saved">
					<div className="grid gap-3 p-(--card-pad)">
						<div className="grid gap-1">
							<h2 id="goal-saved" className="text-[13px] font-medium text-muted-foreground">
								{archived ? "Was set aside" : "Set aside"}
							</h2>
							<p className="flex flex-wrap items-baseline gap-x-2">
								<span className="text-[2.25rem] font-[650] leading-[1.05] tracking-[-0.035em] tabular-nums">
									{formatMoney(progress.saved)}
								</span>
								<span className="text-sm text-muted-foreground tabular-nums">
									of {formatMoney(goal.target)}
								</span>
							</p>
						</div>
						{archived ? null : <GoalProgressBar share={progress.share} />}
						<p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-muted-foreground">
							<GoalStatus goal={goal} />
						</p>
					</div>
					{active && progress.monthly !== null && progress.leftThisMonth !== null ? (
						<dl className="grid grid-cols-[repeat(2,minmax(0,1fr))_auto] border-t">
							<Stat label="A month" value={formatMoney(progress.monthly)} />
							<Stat
								label="This month"
								value={
									progress.leftThisMonth > 0
										? `${formatMoney(progress.leftThisMonth)} left`
										: "Funded"
								}
							/>
							<Stat
								label="Target date"
								value={goal.targetDate ? fullDay(goal.targetDate) : "None"}
							/>
						</dl>
					) : null}
					{archived ? null : (
						<div className="flex flex-wrap gap-2 border-t p-(--card-pad)">
							{active ? (
								<Button type="button" disabled={!hydrated} onClick={() => setSheet("fund")}>
									Fund
								</Button>
							) : null}
							<Button
								type="button"
								variant="outline"
								disabled={!hydrated || progress.saved <= 0}
								onClick={() => setSheet("spend")}
							>
								Spend
							</Button>
						</div>
					)}
					<div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t px-(--card-pad) py-2.5 text-[13px] text-muted-foreground">
						<p className="py-1">
							{archived ? "Was set aside in " : "Set aside in "}
							{account ? (
								<Link
									to="/accounts/$accountId"
									params={{ accountId: account.id }}
									className="font-medium text-foreground underline-offset-4 hover:underline"
								>
									{account.name}
								</Link>
							) : (
								accountName
							)}
							{archived ? ". Archiving released it, so it’s no longer set aside." : null}{" "}
							<TermHelp term="set-aside" />
						</p>
						{archived ? null : (
							<div className="-me-2.5 flex gap-1">
								<Button
									type="button"
									variant="ghost"
									size="sm"
									disabled={!hydrated}
									onClick={() => setSheet("claim")}
								>
									Set aside
								</Button>
								<Button
									type="button"
									variant="ghost"
									size="sm"
									disabled={!hydrated || progress.saved <= 0}
									onClick={() => setSheet("release")}
								>
									Release
								</Button>
							</div>
						)}
					</div>
				</Card>
				<SaveFailed change={update} />
				{claim.error instanceof GoalRefused ? (
					<FormError>
						That’s more than is set aside for {goal.name} now, so nothing changed.
					</FormError>
				) : (
					<SaveFailed change={claim} />
				)}

				<Section aria-labelledby="goal-history">
					<SectionHeader id="goal-history" title="History" count={goal.changes.length} />
					{goal.changes.length > 0 ? (
						<List>
							{goalHistory(goal.changes).flatMap(({ month: changedIn, net, changes }) => [
								<ListGroupLabel key={changedIn} className="flex justify-between gap-3">
									<span>{monthLabel(changedIn, today)}</span>
									<span className="tabular-nums">
										{net >= 0 ? "+" : ""}
										{formatMoney(net)}
									</span>
								</ListGroupLabel>,
								...changes.map((change) => (
									<HistoryRow
										key={change.id}
										change={change}
										today={today}
										onUndo={
											active &&
											change.kind === "funding" &&
											change.from === undefined &&
											change.month === month
												? () =>
														undo.mutate({
															moveId: change.id,
															goalName: goal.name,
															month: change.month,
														})
												: undefined
										}
									/>
								)),
							])}
						</List>
					) : (
						<Card className="p-(--card-pad) text-sm text-muted-foreground">
							Nothing set aside yet. Fund it from Free to Spend, or set aside money already in{" "}
							{accountName}.
						</Card>
					)}
				</Section>

				{active ? (
					<Section aria-labelledby="goal-emergency">
						<SectionHeader
							id="goal-emergency"
							title="Emergencies"
							help={<TermHelp term="sweep" />}
						/>
						<Card className="grid gap-3 p-(--card-pad)">
							<FinishRow
								text={
									emergency
										? "This is your emergency Goal. Noodle suggests it for Extra income, and when nobody decides where last month’s leftovers go, they’re Swept into it."
										: "Keeping this for emergencies? Noodle will suggest it for Extra income, and when nobody decides where last month’s leftovers go, they’ll be Swept into it."
								}
								action={
									<Button
										type="button"
										variant="outline"
										size="sm"
										disabled={!hydrated}
										onClick={() => setEmergency.mutate({ goalId: emergency ? null : goal.id })}
									>
										{emergency ? "Stop using" : "Use for emergencies"}
									</Button>
								}
							/>
							<SaveFailed change={setEmergency} />
						</Card>
					</Section>
				) : null}

				{archived ? null : (
					<Section aria-labelledby="goal-finish">
						<SectionHeader id="goal-finish" title="Finish" />
						<Card className="grid gap-3 p-(--card-pad)">
							{active ? (
								<FinishRow
									text="Done saving? Completing it keeps the money set aside, ready to spend."
									action={
										<Button
											type="button"
											variant="outline"
											size="sm"
											disabled={!hydrated}
											onClick={() => complete.mutate({ goalId: goal.id })}
										>
											Complete
										</Button>
									}
								/>
							) : (
								<p className="text-sm text-muted-foreground">
									Completed. Its money stays set aside until it’s spent or released.
								</p>
							)}
							{archiving ? (
								<Confirm
									confirmLabel="Archive Goal"
									onCancel={() => setArchiving(false)}
									onConfirm={() => {
										setArchiving(false);
										archive.mutate({ goalId: goal.id });
									}}
								>
									Archiving {goal.name} releases
									{progress.saved > 0 ? ` the ${formatMoney(progress.saved)}` : " what"} it has set
									aside in {accountName}, so it’s free for other Goals.
								</Confirm>
							) : (
								<FinishRow
									text="No longer saving for it? Archiving releases what it has set aside."
									action={
										<Button
											type="button"
											variant="ghost"
											size="sm"
											disabled={!hydrated}
											onClick={() => setArchiving(true)}
										>
											Archive
										</Button>
									}
								/>
							)}
							<SaveFailed change={complete} />
							<SaveFailed change={archive} />
						</Card>
					</Section>
				)}
			</div>

			<FundGoalSheet
				goal={sheet === "fund" ? goal : null}
				freeToSpend={freeToSpend}
				onOpenChange={close}
				onFund={(g, amountCents) => {
					setSheet(null);
					fund.mutate({ moveId: ulid(), goalId: g.id, goalName: g.name, month, amountCents });
				}}
			/>
			<AmountSheet
				open={sheet === "spend"}
				onOpenChange={close}
				title={`Spend from ${goal.name}`}
				description="Records spending from what this Goal has set aside, never from a Bucket or Free to Spend."
				withNote
				submitLabel="Spend"
				check={(cents) =>
					cents !== null && cents > progress.saved
						? {
								hint: `That’s more than the ${formatMoney(progress.saved)} set aside.`,
								refused: true,
							}
						: { hint: `Up to ${formatMoney(progress.saved)}, what’s set aside.` }
				}
				onSave={(amountCents, note) => {
					setSheet(null);
					spend.mutate({
						transactionId: ulid(),
						goalId: goal.id,
						goalName: goal.name,
						accountId: goal.accountId,
						month,
						date: today,
						amountCents,
						note,
					});
				}}
			/>
			<AmountSheet
				open={sheet === "claim"}
				onOpenChange={close}
				title={`Set aside for ${goal.name}`}
				description={`Sets aside money already in ${accountName} for this Goal. It doesn’t change the Plan.`}
				submitLabel="Set aside"
				check={(cents) => {
					const notSetAside = account?.unclaimed ?? null;
					if (notSetAside === null) {
						return {
							hint: `${accountName} has no balance yet, so there’s nothing to set aside from.`,
						};
					}
					if (cents !== null && cents > notSetAside) {
						return {
							hint: `Only ${formatMoney(Math.max(0, notSetAside))} in ${accountName} isn’t set aside yet. Update its balance if there’s more.`,
							refused: true,
						};
					}
					return { hint: `${formatMoney(notSetAside)} in ${accountName} isn’t set aside yet.` };
				}}
				onSave={(amountCents) => {
					setSheet(null);
					claim.mutate({ claimId: ulid(), goalId: goal.id, amountCents });
				}}
			/>
			<AmountSheet
				open={sheet === "release"}
				onOpenChange={close}
				title={`Release from ${goal.name}`}
				description={`Stops keeping some of it for this Goal. It stays in ${accountName}, no longer set aside.`}
				initialCents={progress.saved}
				submitLabel="Release"
				check={(cents) =>
					cents !== null && cents > progress.saved
						? {
								hint: `That’s more than the ${formatMoney(progress.saved)} set aside.`,
								refused: true,
							}
						: { hint: `Up to ${formatMoney(progress.saved)}, what’s set aside.` }
				}
				onSave={(amountCents) => {
					setSheet(null);
					claim.mutate({ claimId: ulid(), goalId: goal.id, amountCents: -amountCents });
				}}
			/>
			<EditGoalSheet
				open={sheet === "edit"}
				onOpenChange={close}
				goal={goal}
				today={today}
				onSave={(details) => {
					setSheet(null);
					update.mutate({ goalId: goal.id, ...details });
				}}
			/>
		</>
	);
}

/**
 * How the Goal is doing, in words: on track, behind (Pace) or past due (over), and what's still
 * to go. The numbers beneath say the rest.
 */
function GoalStatus({ goal }: { goal: GoalView }) {
	const { progress } = goal;
	const parts: ReactNode[] = [];
	if (goal.state === "archived") parts.push("Archived");
	else if (goal.state === "completed") parts.push("Completed");
	else if (progress.status === "behind") {
		parts.push(<Badge variant="pace">{goalStatusName.behind}</Badge>);
	} else if (progress.status === "past-due") {
		parts.push(<Badge variant="over">{goalStatusName["past-due"]}</Badge>);
	} else {
		parts.push(goalStatusName[progress.status]);
	}
	if (goal.state !== "archived" && progress.remaining > 0) {
		parts.push(`${formatMoney(progress.remaining)} to go`);
	}
	if (goal.state === "active" && !goal.targetDate) parts.push("No target date");
	return (
		<>
			{parts.map((part, index) => (
				// The parts are fixed per state, so their positions are stable keys.
				// biome-ignore lint/suspicious/noArrayIndexKey: see above
				<span key={index} className="inline-flex items-center gap-1.5">
					{index > 0 ? <span aria-hidden="true">·</span> : null}
					{part}
				</span>
			))}
		</>
	);
}

function Stat({ label, value }: { label: string; value: string }) {
	return (
		<div className="grid gap-0.5 border-l px-(--card-pad) py-3 first:border-l-0">
			<dt className="text-xs text-muted-foreground">{label}</dt>
			<dd className="text-sm font-semibold whitespace-nowrap tabular-nums">{value}</dd>
		</div>
	);
}

function FinishRow({ text, action }: { text: string; action: ReactNode }) {
	return (
		<div className="flex items-center justify-between gap-4">
			<p className="text-sm text-muted-foreground">{text}</p>
			{action}
		</div>
	);
}

const changeTitle = (change: GoalChange) =>
	change.kind === "funding"
		? change.from === "windfall"
			? "From Extra income"
			: change.from === "sweep"
				? "Swept from a Bucket"
				: "Funded from Free to Spend"
		: change.kind === "spending"
			? "Spent"
			: change.amount >= 0
				? "Set aside from the Account"
				: "Released";

/** "September", or "September 2025" outside this year. */
const monthLabel = (month: MonthKey, today: DayKey) =>
	month.slice(0, 4) === today.slice(0, 4)
		? monthName(month)
		: `${monthName(month)} ${month.slice(0, 4)}`;

/** One change to what's set aside: what it was, when, and how much it moved. */
function HistoryRow({
	change,
	today,
	onUndo,
}: {
	change: GoalChange;
	today: DayKey;
	/** Present for this month's funding while it can still be undone. */
	onUndo?: () => void;
}) {
	const hydrated = useHydrated();
	const when = change.date
		? change.date.slice(0, 4) === today.slice(0, 4)
			? shortDay(change.date)
			: fullDay(change.date)
		: monthName(change.month);
	return (
		<ListRow
			title={changeTitle(change)}
			meta={change.note ? `${when} · ${change.note}` : when}
			trailing={
				<span className="flex items-center gap-2">
					<span
						className={cn(
							"text-sm font-semibold tabular-nums",
							change.amount < 0 && "text-muted-foreground",
						)}
					>
						{change.amount >= 0 ? "+" : ""}
						{formatMoney(change.amount)}
					</span>
					{onUndo ? (
						<Button
							type="button"
							variant="ghost"
							size="sm"
							className="-me-2.5"
							disabled={!hydrated}
							aria-label="Undo funding"
							onClick={onUndo}
						>
							Undo
						</Button>
					) : null}
				</span>
			}
		/>
	);
}

/** Changes a Goal's name, target, and target date. A past date can be kept, not newly set. */
function EditGoalSheet({
	open,
	onOpenChange,
	goal,
	today,
	onSave,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	goal: GoalView;
	today: DayKey;
	onSave: (details: { name: string; targetCents: number; targetDate: DayKey | null }) => void;
}) {
	return (
		<Sheet open={open} onOpenChange={onOpenChange}>
			{open ? (
				<SheetContent>
					<SheetHeader title={`Edit ${goal.name}`} />
					<EditGoalForm goal={goal} today={today} onSave={onSave} />
				</SheetContent>
			) : null}
		</Sheet>
	);
}

function EditGoalForm({
	goal,
	today,
	onSave,
}: {
	goal: GoalView;
	today: DayKey;
	onSave: (details: { name: string; targetCents: number; targetDate: DayKey | null }) => void;
}) {
	const hydrated = useHydrated();
	const id = useId();
	const [name, setName] = useState(goal.name);
	const [target, setTarget] = useState(formatMoney(goal.target).replace("$", ""));
	const [targetDate, setTargetDate] = useState<string>(goal.targetDate ?? "");
	const targetCents = parseDollars(target);
	const dateInvalid = targetDate !== "" && targetDate < today && targetDate !== goal.targetDate;
	const valid = name.trim() !== "" && targetCents !== null && targetCents > 0 && !dateInvalid;

	function onSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!valid || targetCents === null) return;
		onSave({
			name: name.trim(),
			targetCents,
			targetDate: targetDate === "" ? null : (targetDate as DayKey),
		});
	}

	return (
		<form onSubmit={onSubmit} className="grid gap-4">
			<Field label="Name" htmlFor={`${id}-name`}>
				<Input
					id={`${id}-name`}
					required
					maxLength={40}
					autoComplete="off"
					value={name}
					onChange={(event) => setName(event.currentTarget.value)}
				/>
			</Field>
			<div className="grid gap-4 sm:grid-cols-2">
				<Field label="Target" htmlFor={`${id}-target`}>
					<AmountInput
						id={`${id}-target`}
						required
						value={target}
						aria-invalid={!(targetCents && targetCents > 0) || undefined}
						onChange={(event) => setTarget(event.currentTarget.value)}
					/>
				</Field>
				<Field
					label="Target date"
					htmlFor={`${id}-date`}
					hint={dateInvalid ? "Pick today or a day ahead." : "Optional."}
				>
					<Input
						id={`${id}-date`}
						type="date"
						min={goal.targetDate && goal.targetDate < today ? goal.targetDate : today}
						value={targetDate}
						aria-invalid={dateInvalid || undefined}
						onChange={(event) => setTargetDate(event.currentTarget.value)}
					/>
				</Field>
			</div>
			<Button type="submit" disabled={!hydrated || !valid}>
				Save
			</Button>
		</form>
	);
}
