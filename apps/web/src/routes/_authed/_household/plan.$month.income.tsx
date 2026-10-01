import { type MonthKey, monthOfDay, type PlanScope } from "@noodle/domain";
import { Button } from "@noodle/ui/components/button";
import { Card } from "@noodle/ui/components/card";
import { List, ListRow } from "@noodle/ui/components/list";
import { Section, SectionHeader } from "@noodle/ui/components/section";
import { Sheet, SheetContent, SheetHeader } from "@noodle/ui/components/sheet";
import { createFileRoute, Link, useHydrated } from "@tanstack/react-router";
import { Pencil } from "lucide-react";
import { useState } from "react";
import { SaveFailed } from "../../../components/plan-editing";
import { PlanSubPage } from "../../../components/plan-page";
import { ChangedNote, PlanAmountForm } from "../../../components/plan-scope-field";
import { formatMoney, shortDay } from "../../../format";
import { usePlanChange, usePlanChanges, withTakeHomePay } from "../../../plan-changes";
import { useMonthState } from "../../../queries";
import { setTakeHomePay } from "../../../server/plan";

export const Route = createFileRoute("/_authed/_household/plan/$month/income")({
	component: PlanIncome,
});

/** The Baseline the month's Plan is built on, and the income that's come in against it. */
function PlanIncome() {
	const { month } = Route.useRouteContext();
	const state = useMonthState(month);
	const current = monthOfDay(state.asOf);
	const received = state.income.filter((i) => monthOfDay(i.date) === month);
	const total = received.reduce((sum, i) => sum + i.amount, 0);
	return (
		<PlanSubPage month={month} current={current} editable={state.editable} title="Income">
			<TakeHomePayEditor month={month} baseline={state.baseline} editable={state.editable} />
			<Section aria-labelledby="plan-received">
				<SectionHeader id="plan-received" title="Received this month" count={received.length} />
				<p className="px-1 text-sm text-muted-foreground">
					<span className="font-medium text-foreground tabular-nums">{formatMoney(total)}</span>{" "}
					received
					{state.baseline === null ? "" : ` of the ${formatMoney(state.baseline)} Baseline`}
				</p>
				{received.length > 0 ? (
					<List>
						{received.map((entry) => (
							<ListRow
								key={entry.id}
								title={entry.note ?? "Income"}
								meta={shortDay(entry.date)}
								trailing={<span className="tabular-nums">{formatMoney(entry.amount)}</span>}
							/>
						))}
					</List>
				) : null}
				{/* Income is recorded as it arrives, on the month itself. */}
				{month === current ? (
					<Card className="flex items-center justify-between gap-4 p-(--card-pad) text-sm text-muted-foreground">
						Record a paycheck or other money in on This Month.
						<Button variant="outline" size="sm" asChild>
							<Link to="/month/$month" params={{ month }}>
								Record income
							</Link>
						</Button>
					</Card>
				) : null}
			</Section>
		</PlanSubPage>
	);
}

/** The Baseline, with an Edit sheet to set it from this month on or just this month. */
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
				title="Baseline"
				meta={
					<>
						<span>Your normal monthly take-home pay</span>
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
								aria-label="Edit Baseline"
								onClick={() => setOpen(true)}
							>
								<Pencil />
							</Button>
						) : null}
						<Sheet open={open} onOpenChange={setOpen}>
							{open ? (
								<SheetContent>
									<SheetHeader
										title="Baseline"
										description="Your normal monthly take-home pay, which the Plan is built on."
									/>
									<PlanAmountForm
										month={month}
										label="Baseline"
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
