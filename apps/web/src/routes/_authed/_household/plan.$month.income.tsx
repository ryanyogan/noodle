import {
	countsOn,
	EXTRA_INCOME_FROM,
	lowerTakeHomePay,
	type MonthKey,
	monthOfDay,
	type PlanScope,
} from "@noodle/domain";
import { Button } from "@noodle/ui/components/button";
import { Card } from "@noodle/ui/components/card";
import { Sheet, SheetContent, SheetHeader } from "@noodle/ui/components/sheet";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useHydrated } from "@tanstack/react-router";
import { Pencil } from "lucide-react";
import { useState } from "react";
import { MonthIncome } from "../../../components/extra-income";
import { MoneyInNotIncome } from "../../../components/income-inbound";
import { CountOnOffer, IncomeTable } from "../../../components/income-table";
import { LeanMonthNote } from "../../../components/lean-month";
import { LowerTakeHomePayNote, useLowerTakeHomePay } from "../../../components/lower-take-home-pay";
import { PayDays } from "../../../components/pay-days";
import { PayHistories } from "../../../components/pay-history";
import { SaveFailed } from "../../../components/plan-editing";
import { PlanEnded } from "../../../components/plan-page";
import { ChangedNote, PlanAmountForm } from "../../../components/plan-scope-field";
import { SectionPending } from "../../../components/section-layout";
import { TermHelp } from "../../../components/term-help";
import { formatMoney } from "../../../format";
import { payHistoryQuery } from "../../../pay-history";
import { usePlanChange, usePlanChanges, withTakeHomePay } from "../../../plan-changes";
import { useMonthState } from "../../../queries";
import { setTakeHomePay } from "../../../server/plan";

export const Route = createFileRoute("/_authed/_household/plan/$month/income")({
	pendingComponent: SectionPending,
	component: PlanIncome,
});

/** Received pay first; schedules by person; planning detail stays out of the daily view. */
function PlanIncome() {
	const { month } = Route.useRouteContext();
	const state = useMonthState(month);
	const received = state.income.filter((i) => monthOfDay(countsOn(i)) === month);
	const total = received.reduce((sum, i) => sum + i.amount, 0);
	// A low month: always here for the current month, quietly; This Month says it in its last days.
	const lowering = useLowerTakeHomePay(month);
	// With six months of a Parent's pay to go on, what to plan on is said under their history
	// (ADR-0067), in place of the three-month figure here: never two figures for one press.
	const { data: histories } = useQuery(payHistoryQuery(month));
	const lower = state.editable
		? lowerTakeHomePay({ baseline: state.baseline, income: state.income, month, asOf: state.asOf })
		: null;
	return (
		<div className="grid min-w-0 gap-6">
			{state.editable ? null : <PlanEnded />}
			<IncomeSummary
				month={month}
				total={total}
				baseline={state.baseline}
				editable={state.editable}
			/>
			<PayDays month={month} />
			<MonthIncome
				showReceived={false}
				month={month}
				asOf={state.asOf}
				baseline={state.baseline}
				income={received}
				renderList={(actions) => <IncomeTable month={month} income={received} {...actions} />}
			/>
			<MoneyInNotIncome month={month} today={state.asOf} />
			<details className="group border-t pt-4" data-testid="income-planning">
				<summary className="cursor-pointer text-sm font-medium focus-visible:outline-2 focus-visible:outline-ring">
					Pay history & planning
				</summary>
				<div className="mt-5 grid gap-5">
					<LeanMonthNote month={month} className="rounded-xl bg-surface-2 px-3 py-2.5 text-sm" />
					<PayHistories month={month} />
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
					{state.editable && state.baseline !== null && histories && !histories.suggested ? (
						<CountOnOffer month={month} baseline={state.baseline} />
					) : null}
					<p className="text-sm text-muted-foreground">
						Your Plan uses one take-home pay amount for the household. When pay varies, plan on what
						you can count on. Payments still owed only count as income when they arrive.
					</p>
				</div>
			</details>
		</div>
	);
}

/** The planning amount is a reference, never a promise of another payment. */
function IncomeSummary({
	month,
	total,
	baseline,
	editable,
}: {
	month: MonthKey;
	total: number;
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
	// A few dollars over is the usual pay landing differently, not Extra income (CONTEXT.md).
	const extra = baseline !== null && total - baseline > EXTRA_INCOME_FROM;
	return (
		<div data-testid="income-summary" className="grid gap-3 border-b pb-6">
			<div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-4">
				<div className="grid gap-1">
					<h2 className="text-sm text-muted-foreground">Income so far</h2>
					<p className="text-4xl font-semibold tracking-tight tabular-nums sm:text-5xl">
						{formatMoney(total)}
					</p>
				</div>
				<div
					data-testid="take-home-pay"
					className="flex flex-wrap items-center gap-x-3 gap-y-1 sm:grid sm:text-right"
				>
					<div className="flex items-center gap-1 text-xs text-muted-foreground sm:justify-end">
						Planned take-home pay <TermHelp term="take-home-pay" />
					</div>
					<div className="flex items-center gap-1 sm:justify-end">
						<span className="text-lg font-medium tabular-nums">
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
					</div>
					<ChangedNote was={changes.baseline} />
				</div>
			</div>
			{baseline !== null ? (
				<p className="text-sm text-muted-foreground">
					{extra ? (
						<>
							{formatMoney(total - baseline)} above your Plan.{" "}
							<Link
								to="/month/$month"
								params={{ month }}
								className="underline underline-offset-2 hover:text-foreground"
							>
								Decide where the extra goes
							</Link>
						</>
					) : total < baseline ? (
						<>{formatMoney(baseline - total)} to reach your Plan’s income amount.</>
					) : (
						"Your Plan’s income amount is covered."
					)}
				</p>
			) : null}
			{change.isError ? <SaveFailed change={change} /> : null}
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
	);
}
