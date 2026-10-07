import { lowerTakeHomePay, type MonthKey, monthOfDay, type PlanScope } from "@noodle/domain";
import { Button } from "@noodle/ui/components/button";
import { Card } from "@noodle/ui/components/card";
import { List, ListRow } from "@noodle/ui/components/list";
import { Sheet, SheetContent, SheetHeader } from "@noodle/ui/components/sheet";
import { createFileRoute, useHydrated } from "@tanstack/react-router";
import { Pencil } from "lucide-react";
import { useState } from "react";
import { MonthIncome } from "../../../components/extra-income";
import { OtherMoneyIn } from "../../../components/income-inbound";
import { CountOnOffer, IncomeTable } from "../../../components/income-table";
import { LowerTakeHomePayNote, useLowerTakeHomePay } from "../../../components/lower-take-home-pay";
import { SaveFailed } from "../../../components/plan-editing";
import { PlanSubPage } from "../../../components/plan-page";
import { ChangedNote, PlanAmountForm } from "../../../components/plan-scope-field";
import { SectionPending } from "../../../components/section-layout";
import { TermHelp } from "../../../components/term-help";
import { formatMoney } from "../../../format";
import { glossary } from "../../../glossary";
import { usePlanChange, usePlanChanges, withTakeHomePay } from "../../../plan-changes";
import { useMonthState } from "../../../queries";
import { setTakeHomePay } from "../../../server/plan";

export const Route = createFileRoute("/_authed/_household/plan/$month/income")({
	pendingComponent: SectionPending,
	component: PlanIncome,
});

/** Take-home pay the month's Plan is built on, and the income that's come in against it. */
function PlanIncome() {
	const { month } = Route.useRouteContext();
	const state = useMonthState(month);
	const total = state.income
		.filter((i) => monthOfDay(i.date) === month)
		.reduce((sum, i) => sum + i.amount, 0);
	const received = state.income.filter((i) => monthOfDay(i.date) === month);
	// A low month: always here for the current month, quietly; This Month says it in its last days.
	const lowering = useLowerTakeHomePay(month);
	const lower = state.editable
		? lowerTakeHomePay({ baseline: state.baseline, income: state.income, month, asOf: state.asOf })
		: null;
	return (
		<PlanSubPage
			wide
			editable={state.editable}
			aside={
				<>
					<TakeHomePayEditor month={month} baseline={state.baseline} editable={state.editable} />
					<TakeHomePayNote />
					{lower ? (
						<Card className="p-(--card-pad)">
							<LowerTakeHomePayNote
								quiet
								month={month}
								step={lower}
								freeToSpend={state.freeToSpend}
								pending={lowering.pending}
								onLower={() => lowering.lower(lower, state.freeToSpend)}
							/>
						</Card>
					) : null}
					{/* When a Parent's pay varies and its low end has moved: one Household figure still. */}
					{state.editable && state.baseline !== null ? (
						<CountOnOffer month={month} baseline={state.baseline} />
					) : null}
				</>
			}
		>
			<div className="grid gap-5">
				<div className="grid gap-1">
					<h2 className="text-lg font-semibold">Income this month</h2>
					<p className="text-sm text-muted-foreground">
						See what’s arrived, what counts as income, and how it compares with your plan.
					</p>
				</div>
				<Card className="overflow-hidden">
					<dl className="grid grid-cols-2 divide-x divide-y sm:grid-cols-3 sm:divide-y-0">
						{[
							{ label: "Received", value: formatMoney(total), note: "Money counted as income" },
							{
								label: "Planned income",
								value: state.baseline === null ? "Not set" : formatMoney(state.baseline),
								note: "Your usual take-home pay",
							},
							{
								label:
									state.baseline !== null && total > state.baseline
										? "Above plan"
										: "Still expected",
								value:
									state.baseline === null ? "—" : formatMoney(Math.abs(state.baseline - total)),
								note:
									state.baseline !== null && total > state.baseline
										? "Extra income to give a purpose"
										: "Remaining to reach your plan",
							},
						].map((stat, index) => (
							<div
								key={stat.label}
								className={
									index === 0 ? "col-span-2 grid gap-1 p-5 sm:col-span-1" : "grid gap-1 p-5"
								}
							>
								<dt className="text-xs font-medium text-muted-foreground">{stat.label}</dt>
								<dd className="text-2xl font-semibold tracking-tight tabular-nums">{stat.value}</dd>
								<p
									className={
										index === 0
											? "text-xs text-muted-foreground"
											: "hidden text-xs text-muted-foreground sm:block"
									}
								>
									{stat.note}
								</p>
							</div>
						))}
					</dl>
				</Card>
			</div>
			{/* This Month's Income section, with Add income and the same row actions; here the
			    entries are a table a Parent works in (issue 133). */}
			<MonthIncome
				showBetweenUs={false}
				month={month}
				asOf={state.asOf}
				baseline={state.baseline}
				income={received}
				renderList={(actions) => <IncomeTable month={month} income={received} {...actions} />}
			/>
			<OtherMoneyIn month={month} today={state.asOf} />
		</PlanSubPage>
	);
}

/**
 * What take-home pay is. How much of it has come in is said once, over the Income list beside
 * this (issue 73): the rail used to repeat that line.
 */
function TakeHomePayNote() {
	const term = glossary["take-home-pay"];
	return (
		<Card className="grid gap-3 p-(--card-pad)">
			<div className="grid gap-1 text-[13px] text-muted-foreground">
				<h2 className="text-sm font-medium text-foreground">What’s take-home pay?</h2>
				<p>{term.short}</p>
				{/* Said on this very page (issue 73): "on Plan › Income" would point at itself. */}
				<p>{term.more.replace("on Plan › Income", "here, with Edit take-home pay")}</p>
			</div>
		</Card>
	);
}

/** Take-home pay, with an Edit sheet to set it from this month on or just this month. */
function TakeHomePayEditor({
	month,
	baseline,
	editable,
}: {
	month: MonthKey;
	baseline: number | null;
	editable: boolean;
}) {
	const hydrated = useHydrated();
	const [open, setOpen] = useState(false);
	const changes = usePlanChanges(month);
	const change = usePlanChange(month, {
		save: (data: { month: MonthKey; amountCents: number; scope: PlanScope }) =>
			setTakeHomePay({ data }),
		apply: withTakeHomePay,
	});
	return (
		<List>
			<ListRow
				title="Take-home pay"
				badge={<TermHelp term="take-home-pay" />}
				meta={
					<>
						<span>Your usual monthly pay, after taxes and deductions</span>
						<ChangedNote was={changes.baseline} />
					</>
				}
				trailing={
					<div className="flex items-center gap-1">
						<span className="text-sm font-medium tabular-nums">
							{baseline === null ? "Not set" : formatMoney(baseline)}
						</span>
						{editable ? (
							<Button
								variant="ghost"
								size="icon"
								type="button"
								disabled={!hydrated}
								aria-label="Edit take-home pay"
								onClick={() => setOpen(true)}
							>
								<Pencil />
							</Button>
						) : null}
						<Sheet open={open} onOpenChange={setOpen}>
							{open ? (
								<SheetContent>
									<SheetHeader
										title="Take-home pay"
										description="Your usual monthly pay after taxes and deductions: what lands in your account. If someone’s pay varies, enter the amount you can count on (the lowest it usually is); more than that shows up as Extra income."
									/>
									<PlanAmountForm
										month={month}
										label="Take-home pay"
										value={baseline}
										withScope={baseline !== null}
										onSave={(amountCents, scope) => {
											setOpen(false);
											if (amountCents !== baseline) change.mutate({ month, amountCents, scope });
										}}
									/>
								</SheetContent>
							) : null}
						</Sheet>
					</div>
				}
				below={change.isError ? <SaveFailed change={change} /> : undefined}
			/>
		</List>
	);
}
