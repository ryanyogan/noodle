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
import { createFileRoute, Link, useHydrated } from "@tanstack/react-router";
import { Pencil } from "lucide-react";
import { useState } from "react";
import { MonthIncome } from "../../../components/extra-income";
import { MoneyInNotIncome } from "../../../components/income-inbound";
import { CountOnOffer, IncomeTable } from "../../../components/income-table";
import { LowerTakeHomePayNote, useLowerTakeHomePay } from "../../../components/lower-take-home-pay";
import { PayDays } from "../../../components/pay-days";
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

/**
 * Take-home pay the month's Plan is built on, and the month's money in against it. Each figure is
 * said once and each deposit is listed once (issue 145): the three figures at the top, then the
 * month's money in by what it counts as: Income, not counted, and waiting in Review.
 */
function PlanIncome() {
	const { month } = Route.useRouteContext();
	const state = useMonthState(month);
	const received = state.income.filter((i) => monthOfDay(countsOn(i)) === month);
	const total = received.reduce((sum, i) => sum + i.amount, 0);
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
			<IncomeSummary
				month={month}
				total={total}
				baseline={state.baseline}
				editable={state.editable}
			/>
			{/* This Month's Income section, with Add income and the same row actions; here the
			    entries are a table a Parent works in (issue 133). The total is said above. */}
			<MonthIncome
				showReceived={false}
				month={month}
				asOf={state.asOf}
				baseline={state.baseline}
				income={received}
				renderList={(actions) => <IncomeTable month={month} income={received} {...actions} />}
			/>
			<MoneyInNotIncome month={month} today={state.asOf} />
			{/* How each Parent is paid and a salaried Parent's expected paychecks (issue 156): a
			    Household setting, not a Plan change, so it is there for an ended month too. */}
			<PayDays month={month} />
		</PlanSubPage>
	);
}

const statLabel = "flex items-center gap-1 text-xs font-medium text-muted-foreground";
const statValue = "text-2xl font-semibold tracking-tight tabular-nums";
const statNote = "text-xs text-muted-foreground";

/**
 * The page's three figures, each said here and nowhere else on it: the Income so far, the
 * Take-home pay (changed here, with Edit take-home pay) and what is still expected, or the Extra
 * income once more than the usual pay has come in.
 */
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
		<div data-testid="income-summary" className="grid gap-5">
			<div className="grid gap-1">
				<h2 className="text-lg font-semibold">Income this month</h2>
				<p className="text-sm text-muted-foreground">
					What has come in, what counts as Income, and how it compares with your take-home pay.
				</p>
			</div>
			<Card className="overflow-hidden">
				<dl className="grid grid-cols-2 divide-x divide-y sm:grid-cols-3 sm:divide-y-0">
					<div className="col-span-2 grid content-start gap-1 p-(--card-pad) sm:col-span-1">
						<dt className={statLabel}>Income so far</dt>
						<dd className={statValue}>{formatMoney(total)}</dd>
						<p className={statNote}>Money in that counts as Income</p>
					</div>
					<div className="grid content-start gap-1 p-(--card-pad)" data-testid="take-home-pay">
						<dt className={statLabel}>
							Take-home pay
							<TermHelp term="take-home-pay" />
						</dt>
						<dd className={`flex flex-wrap items-center gap-1 ${statValue}`}>
							{baseline === null ? "Not set" : formatMoney(baseline)}
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
						</dd>
						<p className={`flex flex-wrap gap-x-1 ${statNote}`}>
							<span>Your usual monthly pay</span>
							<ChangedNote was={changes.baseline} />
						</p>
					</div>
					<div className="grid content-start gap-1 p-(--card-pad)">
						<dt className={statLabel}>{extra ? "Extra income" : "Still expected"}</dt>
						<dd className={statValue}>
							{baseline === null
								? "—"
								: formatMoney(extra ? total - baseline : Math.max(0, baseline - total))}
						</dd>
						<p className={statNote}>
							{extra ? (
								<Link
									to="/month/$month"
									params={{ month }}
									className="underline underline-offset-2 hover:text-foreground"
								>
									Decide where it goes on This Month
								</Link>
							) : (
								"Left to reach your take-home pay"
							)}
						</p>
					</div>
				</dl>
			</Card>
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

/** What take-home pay is. The figure itself is said once, at the top of the page (issue 145). */
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
