import {
	type Cents,
	type DayKey,
	goalBehindBy,
	goalHistory,
	type MonthKey,
	parseDollars,
} from "@noodle/domain";
import { Badge } from "@noodle/ui/components/badge";
import { Button } from "@noodle/ui/components/button";
import { Card } from "@noodle/ui/components/card";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@noodle/ui/components/collapsible";
import { DatePicker } from "@noodle/ui/components/date-picker";
import { Field, FormError } from "@noodle/ui/components/field";
import { Input } from "@noodle/ui/components/input";
import { List, ListGroupLabel, ListRow } from "@noodle/ui/components/list";
import { MetaParts } from "@noodle/ui/components/meta-parts";
import { Section, SectionHeader } from "@noodle/ui/components/section";
import {
	Sheet,
	SheetCancel,
	SheetContent,
	SheetFooter,
	SheetHeader,
} from "@noodle/ui/components/sheet";
import { ToggleGroup, ToggleGroupItem } from "@noodle/ui/components/toggle-group";
import { cn } from "@noodle/ui/lib/utils";
import { createFileRoute, Link, notFound, useHydrated } from "@tanstack/react-router";
import { ChevronDown, Pencil } from "lucide-react";
import { type FormEvent, type ReactNode, useId, useState } from "react";
import { ulid } from "ulid";
import {
	AmountInput,
	AmountSheet,
	BackToGoals,
	GoalPager,
	GoalProgressBar,
} from "../../../components/goals";
import { DetailHeader, DetailPending } from "../../../components/master-detail";
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
	pendingComponent: DetailPending,
	component: GoalPage,
});

type OpenSheet = "add" | "spend" | "release" | "edit" | null;

/** Where money added to a Goal comes from: this month's Free to Spend, or already in its Account. */
type AddFrom = "plan" | "account";

function GoalPage() {
	const { goalId } = Route.useParams();
	const { goals, accounts, month, asOf, emergencyGoalId } = useGoals();
	const goal = goals.find((g) => g.id === goalId);
	const account = accounts.find((a) => a.id === goal?.accountId);
	// A Goal only goes away if another Parent's change removes it; the loader 404s on reload.
	if (!goal) return <DetailHeader eyebrow="Goal" title="Goal" leading={<BackToGoals />} />;
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

/** How many months of a Goal's History show before "Show older". */
const HISTORY_MONTHS = 12;

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
	const [addFrom, setAddFrom] = useState<AddFrom>("plan");
	// The latest year of History at first; a long-lived Goal's older months on request.
	const history = goalHistory(goal.changes);
	const [showAll, setShowAll] = useState(false);
	const [archiving, setArchiving] = useState(false);
	const { progress } = goal;
	const active = goal.state === "active";
	const archived = goal.state === "archived";
	const accountName = account?.name ?? "its Account";
	const close = (open: boolean) => {
		if (!open) setSheet(null);
	};
	const addMoney = (from: AddFrom) => {
		setAddFrom(from);
		setSheet("add");
	};
	const completed = goal.state === "completed";

	return (
		<>
			<DetailHeader
				eyebrow="Goal"
				title={goal.name}
				leading={<BackToGoals />}
				pager={<GoalPager id={goal.id} />}
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
			<div className="grid gap-8 @3xl:grid-cols-[minmax(0,1fr)_320px] @3xl:items-start">
				{/* Right from a laptop up: the progress card and what to do; on a phone, History comes before Emergencies and Finish. */}
				<div className="grid gap-8 @max-3xl:contents @3xl:sticky @3xl:top-6 @3xl:col-start-2 @3xl:row-start-1 @3xl:-m-1 @3xl:max-h-[calc(100dvh-3rem)] @3xl:overflow-y-auto @3xl:overscroll-contain @3xl:p-1">
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
							{archived || completed ? null : <GoalProgressBar share={progress.share} />}
							<p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-muted-foreground">
								<GoalStatus goal={goal} month={month} />
							</p>
						</div>
						{active && progress.monthly !== null && progress.leftThisMonth !== null ? (
							<div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t px-(--card-pad) py-3 text-sm">
								<p className="text-muted-foreground">
									To reach {formatMoney(goal.target)}
									{goal.targetDate ? ` by ${fullDay(goal.targetDate)}` : ""} you need{" "}
									<span className="font-medium text-foreground tabular-nums">
										{formatMoney(progress.monthly)} a month
									</span>
									.{" "}
									{progress.leftThisMonth === 0
										? "This month’s is funded."
										: progress.fundedThisMonth > 0
											? `${formatMoney(progress.fundedThisMonth)} funded this month.`
											: "Nothing funded this month yet."}
								</p>
								{progress.leftThisMonth > 0 ? (
									<Button
										type="button"
										size="sm"
										variant="outline"
										disabled={!hydrated}
										onClick={() => addMoney("plan")}
									>
										Fund {formatMoney(progress.leftThisMonth)}
									</Button>
								) : null}
							</div>
						) : null}
						{archived ? null : (
							<div className="flex flex-wrap gap-2 border-t p-(--card-pad)">
								<Button
									type="button"
									disabled={!hydrated}
									onClick={() => addMoney(active ? "plan" : "account")}
								>
									Add money
								</Button>
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
								<Button
									type="button"
									variant="ghost"
									size="sm"
									className="-me-2.5"
									disabled={!hydrated || progress.saved <= 0}
									onClick={() => setSheet("release")}
								>
									Take money back
								</Button>
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

					<div className="grid gap-8 @max-3xl:order-2">
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
											{progress.saved > 0 ? ` the ${formatMoney(progress.saved)}` : " what"} it has
											set aside in {accountName}, so it’s free for other Goals.
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
				</div>
				<div className="grid min-w-0 gap-8 @max-3xl:order-1 @3xl:col-start-1 @3xl:row-start-1">
					<Section aria-labelledby="goal-history">
						<SectionHeader id="goal-history" title="History" count={goal.changes.length} />
						{goal.changes.length > 0 ? (
							<List>
								{history
									.slice(0, showAll ? undefined : HISTORY_MONTHS)
									.flatMap(({ month: changedIn, net, changes }) => [
										<ListGroupLabel key={changedIn} className="flex justify-between gap-3">
											<span>{monthLabel(changedIn, today)}</span>
											<span className="tabular-nums">
												{net >= 0 ? "+" : ""}
												{formatMoney(net)}
											</span>
										</ListGroupLabel>,
										...groupSweeps(changes).map((change) =>
											Array.isArray(change) ? (
												<SweepsRow key={change[0]?.id} sweeps={change} />
											) : (
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
											),
										),
									])}
							</List>
						) : null}
						{history.length > HISTORY_MONTHS && !showAll ? (
							<Button
								type="button"
								variant="ghost"
								size="sm"
								className="justify-self-start"
								onClick={() => setShowAll(true)}
							>
								Show {history.length - HISTORY_MONTHS} older{" "}
								{history.length - HISTORY_MONTHS === 1 ? "month" : "months"}
							</Button>
						) : null}
						{goal.changes.length > 0 ? null : (
							<Card className="p-(--card-pad) text-sm text-muted-foreground">
								Nothing set aside yet. Add money from this month’s plan, or money already in{" "}
								{accountName}.
							</Card>
						)}
					</Section>
				</div>
			</div>

			<AddMoneySheet
				open={sheet === "add"}
				onOpenChange={close}
				goal={goal}
				account={account}
				from={addFrom}
				onFromChange={setAddFrom}
				freeToSpend={freeToSpend}
				onFund={(amountCents) => {
					setSheet(null);
					fund.mutate({ moveId: ulid(), goalId: goal.id, goalName: goal.name, month, amountCents });
				}}
				onSetAside={(amountCents) => {
					setSheet(null);
					claim.mutate({ claimId: ulid(), goalId: goal.id, amountCents });
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
				open={sheet === "release"}
				onOpenChange={close}
				title={`Take money back from ${goal.name}`}
				description={`Stops keeping some of it for this Goal. It stays in ${accountName}, no longer set aside, free for other Goals.`}
				initialCents={progress.saved}
				submitLabel="Take it back"
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
function GoalStatus({ goal, month }: { goal: GoalView; month: MonthKey }) {
	const { progress } = goal;
	const parts: ReactNode[] = [];
	if (goal.state === "archived") parts.push("Archived");
	else if (goal.state === "completed") {
		// Done: what it was spent on, not what it never reached.
		parts.push("Completed");
		const spent = spentFrom(goal);
		if (spent > 0) parts.push(`spent ${formatMoney(spent)}`);
		parts.push(`${formatMoney(progress.saved)} still set aside`);
	} else if (progress.status === "behind") {
		parts.push(
			<Badge variant="pace">
				{goalStatusName.behind} by {formatMoney(goalBehindBy(goal, progress.saved, month))}
			</Badge>,
		);
	} else if (progress.status === "past-due") {
		parts.push(<Badge variant="over">{goalStatusName["past-due"]}</Badge>);
	} else {
		parts.push(goalStatusName[progress.status]);
	}
	if (goal.state === "active" && progress.remaining > 0) {
		parts.push(`${formatMoney(progress.remaining)} to go`);
	}
	if (goal.state === "active" && !goal.targetDate) parts.push("No target date");
	return <MetaParts parts={parts} />;
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
				? change.fromBucket
					? `Leftover from ${change.fromBucket}`
					: "Leftover from a Bucket"
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

/** What's been spent from a Goal over its life. */
const spentFrom = (goal: GoalView) =>
	-goal.changes.filter((c) => c.kind === "spending").reduce((sum, c) => sum + c.amount, 0);

/** A month's changes, with two or more Sweeps gathered into one entry where the first was. */
function groupSweeps(changes: GoalChange[]): (GoalChange | GoalChange[])[] {
	const sweeps = changes.filter((c) => c.kind === "funding" && c.from === "sweep");
	if (sweeps.length < 2) return changes;
	const out: (GoalChange | GoalChange[])[] = [];
	for (const change of changes) {
		if (change === sweeps[0]) out.push(sweeps);
		else if (!sweeps.includes(change)) out.push(change);
	}
	return out;
}

/** A month's Sweeps as one row: their total, opening to each Bucket's leftover. */
function SweepsRow({ sweeps }: { sweeps: GoalChange[] }) {
	const total = sweeps.reduce((sum, c) => sum + c.amount, 0);
	return (
		<li className="px-(--card-pad) py-3">
			<Collapsible className="group">
				<CollapsibleTrigger className="w-full text-start flex max-lg:min-h-11 items-center justify-between gap-3">
					<span className="grid gap-0.5">
						<span className="text-sm font-medium">
							Leftovers from {sweeps.length} Buckets
							<ChevronDown
								aria-hidden="true"
								className="ms-1 inline size-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180"
							/>
						</span>
						<span className="text-[13px] text-muted-foreground">
							{monthName(sweeps[0]?.month ?? "")} · Swept when the month closed
						</span>
					</span>
					<span className="text-sm font-semibold tabular-nums">+{formatMoney(total)}</span>
				</CollapsibleTrigger>
				<CollapsibleContent>
					<ul className="mt-2 grid gap-1 border-t pt-2 text-[13px] text-muted-foreground">
						{sweeps.map((sweep) => (
							<li key={sweep.id} className="flex justify-between gap-3">
								<span>{changeTitle(sweep)}</span>
								<span className="tabular-nums">+{formatMoney(sweep.amount)}</span>
							</li>
						))}
					</ul>
				</CollapsibleContent>
			</Collapsible>
		</li>
	);
}

/**
 * Adding money to a Goal, one sheet for both ways: from this month's plan (Goal funding, out of
 * Free to Spend), or money already in its Account (set aside, which changes nothing in the Plan).
 * A completed Goal only takes money already there.
 */
function AddMoneySheet({
	open,
	onOpenChange,
	goal,
	account,
	from,
	onFromChange,
	freeToSpend,
	onFund,
	onSetAside,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	goal: GoalView;
	account: AccountView | undefined;
	from: AddFrom;
	onFromChange: (from: AddFrom) => void;
	freeToSpend: Cents;
	onFund: (cents: Cents) => void;
	onSetAside: (cents: Cents) => void;
}) {
	const hydrated = useHydrated();
	const name = useId();
	const accountName = account?.name ?? "its Account";
	const active = goal.state === "active";
	const left = goal.progress.leftThisMonth ?? 0;
	const options = [
		...(active ? [{ from: "plan" as const, label: "From this month’s plan" }] : []),
		{ from: "account" as const, label: `Already in ${accountName}` },
	];
	return (
		<AmountSheet
			open={open}
			onOpenChange={onOpenChange}
			title={`Add money to ${goal.name}`}
			description={
				from === "plan"
					? "Plans some of this month’s Free to Spend for it, and sets it aside."
					: `Sets aside money that’s already in ${accountName}. It doesn’t change the Plan.`
			}
			above={
				options.length > 1 ? (
					<div className="grid gap-1.5">
						<p id={name} className="mb-1.5 text-sm font-medium">
							Where’s it from?
						</p>
						<ToggleGroup
							type="single"
							variant="segmented"
							aria-labelledby={name}
							value={from}
							disabled={!hydrated}
							onValueChange={(value) => onFromChange(value as typeof from)}
							className="grid w-full grid-cols-1 sm:grid-cols-2"
						>
							{options.map((option) => (
								<ToggleGroupItem key={option.from} value={option.from} size="wrap">
									{option.label}
								</ToggleGroupItem>
							))}
						</ToggleGroup>
					</div>
				) : null
			}
			initialCents={from === "plan" ? left : null}
			submitLabel={from === "plan" ? "Fund" : "Set aside"}
			check={(cents) => {
				if (from === "plan") {
					if (cents !== null && cents > freeToSpend) {
						return {
							hint: `Free to Spend has only ${formatMoney(Math.max(0, freeToSpend))} this month.`,
							refused: true,
						};
					}
					return {
						hint:
							left > 0
								? `${goal.name} needs ${formatMoney(left)} more this month. Free to Spend has ${formatMoney(freeToSpend)}.`
								: `Free to Spend has ${formatMoney(freeToSpend)} this month.`,
					};
				}
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
			onSave={(cents) => (from === "plan" ? onFund(cents) : onSetAside(cents))}
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
					<DatePicker
						id={`${id}-date`}
						min={goal.targetDate && goal.targetDate < today ? goal.targetDate : today}
						value={targetDate}
						aria-invalid={dateInvalid || undefined}
						onChange={setTargetDate}
					/>
				</Field>
			</div>
			<SheetFooter>
				<SheetCancel />
				<Button type="submit" disabled={!hydrated || !valid}>
					Save
				</Button>
			</SheetFooter>
		</form>
	);
}
