import { lowerTakeHomePay, type MonthKey, monthOfDay, type PlanScope } from "@noodle/domain";
import { BudgetBar } from "@noodle/ui/components/budget-bar";
import { Button } from "@noodle/ui/components/button";
import { Card } from "@noodle/ui/components/card";
import { List, ListRow } from "@noodle/ui/components/list";
import { Sheet, SheetContent, SheetHeader } from "@noodle/ui/components/sheet";
import { createFileRoute, useHydrated } from "@tanstack/react-router";
import { Pencil } from "lucide-react";
import { useState } from "react";
import { MonthIncome } from "../../../components/extra-income";
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
	const _current = monthOfDay(state.asOf);
	const received = state.income.filter((i) => monthOfDay(i.date) === month);
	// A low month: always here for the current month, quietly; This Month says it in its last days.
	const lowering = useLowerTakeHomePay(month);
	const lower = state.editable
		? lowerTakeHomePay({ baseline: state.baseline, income: state.income, month, asOf: state.asOf })
		: null;
	return (
		<PlanSubPage
			editable={state.editable}
			aside={<TakeHomePayNote baseline={state.baseline} received={received} />}
		>
			<TakeHomePayEditor month={month} baseline={state.baseline} editable={state.editable} />
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
			{/* The same income list as This Month's, with Add income and the same row actions. */}
			{state.baseline !== null ? (
				<MonthIncome month={month} asOf={state.asOf} baseline={state.baseline} income={received} />
			) : null}
		</PlanSubPage>
	);
}

/** What take-home pay is, and how much of it has come in so far this month. */
function TakeHomePayNote({
	baseline,
	received,
}: {
	baseline: number | null;
	received: { amount: number }[];
}) {
	const term = glossary["take-home-pay"];
	const total = received.reduce((sum, i) => sum + i.amount, 0);
	return (
		<Card className="grid gap-3 p-(--card-pad)">
			{baseline !== null && baseline > 0 ? (
				<div className="grid gap-2">
					<p className="text-sm">
						<span className="font-medium tabular-nums">{formatMoney(total)}</span>
						<span className="text-muted-foreground tabular-nums">
							{" "}
							received of {formatMoney(baseline)}
						</span>
					</p>
					<BudgetBar
						value={total}
						max={baseline}
						label="Received of take-home pay"
						valueText={`${formatMoney(total)} received of ${formatMoney(baseline)}`}
					/>
				</div>
			) : null}
			<div className="grid gap-1 text-[13px] text-muted-foreground">
				<h2 className="text-sm font-medium text-foreground">What’s take-home pay?</h2>
				<p>{term.short}</p>
				<p>{term.more}</p>
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
