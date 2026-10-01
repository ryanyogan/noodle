import { type Cents, type DayKey, dayKeyAt, type MonthKey } from "@noodle/domain";
import { Badge } from "@noodle/ui/components/badge";
import { Button } from "@noodle/ui/components/button";
import { Card } from "@noodle/ui/components/card";
import { Field, FormError } from "@noodle/ui/components/field";
import { Input } from "@noodle/ui/components/input";
import { List, ListRow } from "@noodle/ui/components/list";
import { PageHeader } from "@noodle/ui/components/page-header";
import { Section, SectionHeader } from "@noodle/ui/components/section";
import {
	Sheet,
	SheetCancel,
	SheetContent,
	SheetFooter,
	SheetHeader,
} from "@noodle/ui/components/sheet";
import { cn } from "@noodle/ui/lib/utils";
import { Link, useHydrated, useRouteContext } from "@tanstack/react-router";
import { Pencil } from "lucide-react";
import { type FormEvent, type ReactNode, useId, useState } from "react";
import { ulid } from "ulid";
import { formatMoney, fullDay, monthName, shortDay } from "../format";
import {
	type AccountView,
	type GoalChange,
	GoalRefused,
	type GoalView,
	goalStatusName,
	useArchiveGoal,
	useCompleteGoal,
	useGoalMoney,
	useRestartPayoffGoal,
	useUpdateAccountBalance,
	useUpdateGoal,
} from "../goals";
import { useMonthState } from "../queries";
import { AmountSheet, BackToGoals, FundGoalSheet, GoalProgressBar } from "./goals";
import { Confirm, SaveFailed } from "./plan-editing";
import { StatementBalanceNote } from "./statements";
import { TermHelp } from "./term-help";

// A payoff Goal's page (ADR-0019): what's owed and how far it has come down since the Goal was
// added, its monthly plan, funding (planned extra payments), updating what's owed, and a history
// of both. There's no Spend, Set aside or Release: nothing is set aside for it.

type OpenSheet = "fund" | "owed" | "edit" | null;

export function PayoffGoalDetails({
	goal,
	account,
	month,
	today,
}: {
	goal: GoalView;
	account: AccountView | undefined;
	month: MonthKey;
	today: DayKey;
}) {
	const hydrated = useHydrated();
	const { freeToSpend } = useMonthState(month);
	const { fund, undo } = useGoalMoney();
	const updateOwed = useUpdateAccountBalance();
	const update = useUpdateGoal();
	const restart = useRestartPayoffGoal();
	const complete = useCompleteGoal();
	const archive = useArchiveGoal();
	const [sheet, setSheet] = useState<OpenSheet>(null);
	const [archiving, setArchiving] = useState(false);
	const { progress } = goal;
	const owed = goal.payoff?.owed ?? null;
	const active = goal.state === "active";
	const archived = goal.state === "archived";
	const paidOff = progress.status === "reached";
	// New charges took what's owed above where the Goal started.
	const above = owed !== null && owed > goal.target ? owed - goal.target : 0;
	const accountName = account?.name ?? "the card";
	const close = (open: boolean) => {
		if (!open) setSheet(null);
	};
	const saveOwed = (amountCents: Cents) =>
		updateOwed.mutate({ balanceId: ulid(), accountId: goal.accountId, amountCents });

	return (
		<>
			<PageHeader
				eyebrow="Paying off"
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
				<Card role="region" aria-labelledby="payoff-owed">
					<div className="grid gap-3 p-(--card-pad)">
						<div className="grid gap-1">
							<h2 id="payoff-owed" className="text-[13px] font-medium text-muted-foreground">
								Still owed
							</h2>
							<p className="flex flex-wrap items-baseline gap-x-2">
								<span className="text-[2.25rem] font-[650] leading-[1.05] tracking-[-0.035em] tabular-nums">
									{owed === null ? "—" : formatMoney(Math.max(0, owed))}
								</span>
								{paidOff ? <Badge variant="brand">Paid off</Badge> : null}
							</p>
						</div>
						{archived ? null : <GoalProgressBar share={progress.share} />}
						<p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-muted-foreground">
							<span className="tabular-nums">
								Paid down {formatMoney(progress.saved)} of {formatMoney(goal.target)}
							</span>
							<PayoffStatus goal={goal} />
						</p>
						{account ? (
							<StatementBalanceNote account={account} onUse={active ? saveOwed : undefined} />
						) : null}
					</div>
					{active && above > 0 ? (
						<div
							role="status"
							className="grid gap-2 border-t bg-pace-soft px-(--card-pad) py-3 text-[13px] text-pace-foreground"
						>
							<p>
								New charges took what’s owed {formatMoney(above)} above the{" "}
								{formatMoney(goal.target)} you started from, so nothing counts as paid down.
								Starting again from today’s balance makes {formatMoney(owed ?? 0)} the target.
							</p>
							<Button
								type="button"
								variant="outline"
								size="sm"
								className="justify-self-start"
								disabled={!hydrated}
								onClick={() => restart.mutate({ goalId: goal.id })}
							>
								Start again from today’s balance
							</Button>
						</div>
					) : null}
					{active && !paidOff && progress.monthly !== null && progress.leftThisMonth !== null ? (
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
								label="Paid off by"
								value={goal.targetDate ? fullDay(goal.targetDate) : "None"}
							/>
						</dl>
					) : null}
					{active ? (
						<div className="flex flex-wrap gap-2 border-t p-(--card-pad)">
							{paidOff ? (
								<Button
									type="button"
									disabled={!hydrated}
									onClick={() => complete.mutate({ goalId: goal.id })}
								>
									Complete
								</Button>
							) : (
								<Button type="button" disabled={!hydrated} onClick={() => setSheet("fund")}>
									Fund
								</Button>
							)}
							<Button
								type="button"
								variant="outline"
								disabled={!hydrated}
								onClick={() => setSheet("owed")}
							>
								Update what’s owed
							</Button>
						</div>
					) : null}
					<div className="border-t px-(--card-pad) py-2.5 text-[13px] text-muted-foreground">
						<p className="py-1">
							{archived ? "Was paying off " : "Paying off "}
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
							. Pay it from checking as usual: what’s owed shows the payment once the card’s balance
							does. <TermHelp term="payoff-goal" />
						</p>
					</div>
				</Card>
				<SaveFailed change={updateOwed} />
				<SaveFailed change={update} />
				{restart.error instanceof GoalRefused ? (
					<FormError>
						What’s owed changed meanwhile, so it didn’t start again. Try once more.
					</FormError>
				) : (
					<SaveFailed change={restart} />
				)}

				<PayoffHistory
					goal={goal}
					month={month}
					today={today}
					onUndo={(change) =>
						undo.mutate({ moveId: change.id, goalName: goal.name, month: change.month })
					}
				/>

				{archived ? null : (
					<Section aria-labelledby="goal-finish">
						<SectionHeader id="goal-finish" title="Finish" />
						<Card className="grid gap-3 p-(--card-pad)">
							{active ? (
								<p className="text-sm text-muted-foreground">
									{paidOff
										? "Paid off. Complete it to finish: it moves to Completed and stops asking for funding."
										: `When ${accountName} is down to $0, it’s paid off and you can complete it.`}
								</p>
							) : (
								<p className="text-sm text-muted-foreground">Completed. Nicely done.</p>
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
									Archiving {goal.name} stops planning payments for it. What’s owed on {accountName}{" "}
									stays as it is.
								</Confirm>
							) : (
								<div className="flex items-center justify-between gap-4">
									<p className="text-sm text-muted-foreground">
										Not paying it off now? Archiving stops planning for it.
									</p>
									<Button
										type="button"
										variant="ghost"
										size="sm"
										disabled={!hydrated}
										onClick={() => setArchiving(true)}
									>
										Archive
									</Button>
								</div>
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
				open={sheet === "owed"}
				onOpenChange={close}
				title="Update what’s owed"
				description={`What’s owed on ${accountName} today, from its website or app, pending charges included.`}
				label="Owed now"
				initialCents={owed}
				allowZero
				submitLabel="Save"
				check={() => ({ hint: "Replaces what was owed before. $0 means it’s paid off." })}
				onSave={(amountCents) => {
					setSheet(null);
					saveOwed(amountCents);
				}}
			/>
			<PayoffEditSheet
				open={sheet === "edit"}
				onOpenChange={close}
				goal={goal}
				today={today}
				onSave={(details) => {
					setSheet(null);
					update.mutate({ goalId: goal.id, targetCents: goal.target, ...details });
				}}
				onRestart={
					active && owed !== null && owed > 0 && owed !== goal.target
						? () => {
								setSheet(null);
								restart.mutate({ goalId: goal.id });
							}
						: undefined
				}
			/>
		</>
	);
}

/** On track, behind (Pace), past due (over) or paid off, and whether it has a date. */
function PayoffStatus({ goal }: { goal: GoalView }) {
	const { progress } = goal;
	const parts: ReactNode[] = [];
	if (goal.state === "archived") parts.push("Archived");
	else if (goal.state === "completed") parts.push("Completed");
	else if (progress.status === "behind") {
		parts.push(<Badge variant="pace">{goalStatusName.behind}</Badge>);
	} else if (progress.status === "past-due") {
		parts.push(<Badge variant="over">{goalStatusName["past-due"]}</Badge>);
	} else if (progress.status === "on-track") {
		parts.push(goalStatusName["on-track"]);
	}
	if (goal.state === "active" && !goal.targetDate && progress.status !== "reached") {
		parts.push("No target date");
	}
	return (
		<>
			{parts.map((part, index) => (
				// The parts are fixed per state, so their positions are stable keys.
				// biome-ignore lint/suspicious/noArrayIndexKey: see above
				<span key={index} className="inline-flex items-center gap-1.5">
					<span aria-hidden="true">·</span>
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

type HistoryItem =
	| { kind: "owed"; key: string; day: DayKey; amount: Cents }
	| { kind: "funding"; key: string; day: DayKey; change: GoalChange };

/**
 * What was owed over time and the funding planned for it, newest first. Funding belongs to its
 * whole month, so it sits at the month's start.
 */
function PayoffHistory({
	goal,
	month,
	today,
	onUndo,
}: {
	goal: GoalView;
	month: MonthKey;
	today: DayKey;
	onUndo: (change: GoalChange) => void;
}) {
	const hydrated = useHydrated();
	const { timeZone } = useRouteContext({ from: "/_authed/_household" }).household;
	const items: HistoryItem[] = [
		...(goal.payoff?.history ?? []).map(
			(point): HistoryItem => ({
				kind: "owed",
				key: `owed-${point.at}`,
				day: dayKeyAt(new Date(point.at), timeZone),
				amount: point.amount,
			}),
		),
		...goal.changes.map(
			(change): HistoryItem => ({
				kind: "funding",
				key: change.id,
				day: `${change.month}-01` as DayKey,
				change,
			}),
		),
	].sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0));
	const when = (day: DayKey) =>
		day.slice(0, 4) === today.slice(0, 4) ? shortDay(day) : fullDay(day);

	return (
		<Section aria-labelledby="goal-history">
			<SectionHeader id="goal-history" title="History" count={items.length} />
			{items.length > 0 ? (
				<List>
					{items.map((item) =>
						item.kind === "owed" ? (
							<ListRow
								key={item.key}
								title="What’s owed"
								meta={when(item.day)}
								trailing={
									<span className="text-sm font-semibold tabular-nums">
										{formatMoney(item.amount)}
									</span>
								}
							/>
						) : (
							<ListRow
								key={item.key}
								title={
									item.change.from === "windfall"
										? "Planned from Extra income"
										: item.change.from === "sweep"
											? "Planned from a Bucket’s leftover"
											: "Planned from Free to Spend"
								}
								meta={monthName(item.change.month)}
								trailing={
									<span className="flex items-center gap-2">
										<span className="text-sm font-semibold tabular-nums text-muted-foreground">
											{formatMoney(item.change.amount)}
										</span>
										{goal.state === "active" &&
										item.change.from === undefined &&
										item.change.month === month ? (
											<Button
												type="button"
												variant="ghost"
												size="sm"
												className="-me-2.5"
												disabled={!hydrated}
												aria-label="Undo funding"
												onClick={() => onUndo(item.change)}
											>
												Undo
											</Button>
										) : null}
									</span>
								}
							/>
						),
					)}
				</List>
			) : (
				<Card className="p-(--card-pad) text-sm text-muted-foreground">Nothing yet.</Card>
			)}
		</Section>
	);
}

/** A payoff Goal's name and date. Its target is what was owed; starting again resets it. */
function PayoffEditSheet({
	open,
	onOpenChange,
	goal,
	today,
	onSave,
	onRestart,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	goal: GoalView;
	today: DayKey;
	onSave: (details: { name: string; targetDate: DayKey | null }) => void;
	/** Offered while what's owed differs from the target. */
	onRestart?: () => void;
}) {
	return (
		<Sheet open={open} onOpenChange={onOpenChange}>
			{open ? (
				<SheetContent>
					<SheetHeader
						title={`Edit ${goal.name}`}
						description={`It started from ${formatMoney(goal.target)} owed.`}
					/>
					<PayoffEditForm goal={goal} today={today} onSave={onSave} onRestart={onRestart} />
				</SheetContent>
			) : null}
		</Sheet>
	);
}

function PayoffEditForm({
	goal,
	today,
	onSave,
	onRestart,
}: {
	goal: GoalView;
	today: DayKey;
	onSave: (details: { name: string; targetDate: DayKey | null }) => void;
	onRestart?: () => void;
}) {
	const hydrated = useHydrated();
	const id = useId();
	const [name, setName] = useState(goal.name);
	const [targetDate, setTargetDate] = useState<string>(goal.targetDate ?? "");
	const dateInvalid = targetDate !== "" && targetDate < today && targetDate !== goal.targetDate;
	const valid = name.trim() !== "" && !dateInvalid;

	function onSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!valid) return;
		onSave({ name: name.trim(), targetDate: targetDate === "" ? null : (targetDate as DayKey) });
	}

	return (
		<form onSubmit={onSubmit} className="grid gap-4">
			<div className="grid gap-4 sm:grid-cols-2">
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
				<Field
					label="Paid off by"
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
			<SheetFooter>
				<SheetCancel />
				<Button type="submit" disabled={!hydrated || !valid}>
					Save
				</Button>
			</SheetFooter>
			{onRestart ? (
				<div className={cn("grid gap-2 border-t pt-4 text-[13px] text-muted-foreground")}>
					<p>
						Start again from today’s balance: what’s owed now becomes the target, and the plan
						starts this month.
					</p>
					<Button
						type="button"
						variant="outline"
						className="justify-self-start"
						disabled={!hydrated}
						onClick={onRestart}
					>
						Start again from today’s balance
					</Button>
				</div>
			) : null}
		</form>
	);
}
