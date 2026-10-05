import type { MemberSummary, MonthCloseRecord } from "@noodle/db";
import {
	addMonths,
	type MonthCloseProposal,
	type MonthEnd,
	type MonthKey,
	quietEnd,
} from "@noodle/domain";
import { Button } from "@noodle/ui/components/button";
import { List, ListRow } from "@noodle/ui/components/list";
import { Section, SectionHeader } from "@noodle/ui/components/section";
import { OptionSelect } from "@noodle/ui/components/select";
import { cn } from "@noodle/ui/lib/utils";
import { useHydrated } from "@tanstack/react-router";
import { useState } from "react";
import { formatMoney, monthName } from "../format";
import type { GoalView } from "../goals";
import { TermHelp } from "./term-help";

/** Where the Parents send a month's leftovers and Extra income, by Goal ID; unset ones stay put. */
export type MonthCloseChoice = {
	sweeps: Record<string, string>;
	windfallGoalId: string | null;
	/** The Extra income stays where it landed: counted as that month's Free to Spend (#86). */
	leaveExtraIncome: boolean;
};

/** The Extra income select's value for "Leave it in the account"; never a Goal's ID. */
const LEAVE_EXTRA_INCOME = "leave";

/**
 * A month that has ended, awaiting the Parents: each resetting Bucket's leftover to Sweep into
 * a Goal or leave, and the pending Extra income. Leftovers start on the emergency Goal, as the
 * defaults would send them; the Extra income is always left for a deliberate choice (ADR-0001).
 */
export function MonthCloseSection({
	proposal,
	goals,
	emergencyGoalId,
	pending,
	onClose,
}: {
	proposal: MonthCloseProposal;
	/** Active Goals. */
	goals: GoalView[];
	emergencyGoalId: string | null;
	pending: boolean;
	onClose: (choice: MonthCloseChoice) => void;
}) {
	const hydrated = useHydrated();
	const emergency = goals.find((g) => g.id === emergencyGoalId) ?? null;
	const [sweeps, setSweeps] = useState<Record<string, string>>(() =>
		Object.fromEntries(proposal.leftovers.map((l) => [l.bucketId, emergency?.id ?? ""])),
	);
	const [extraIncomeGoalId, setExtraIncomeGoalId] = useState("");
	const name = monthName(proposal.month);
	const goalChoices = goals.map((g) => ({ value: g.id, label: g.name }));
	return (
		<Section aria-labelledby="month-close">
			{/* From lg this sits in a To do row that already says "Close September" and holds its
			    help, so the heading is only for screen readers (#73). */}
			<div className="lg:sr-only">
				<SectionHeader
					id="month-close"
					title={`Close ${name}`}
					help={
						<span className="lg:hidden">
							<TermHelp term="month-close" />
						</span>
					}
				/>
			</div>
			<p className="px-1 pb-3 text-sm text-muted-foreground">
				{name} has ended.{" "}
				{proposal.leftovers.length > 0
					? goals.length > 0
						? "Sweep what’s left in Buckets that reset monthly into a Goal, or leave it."
						: "There’s no Goal to Sweep leftovers into yet, so they stay put."
					: null}{" "}
				{proposal.leftovers.length > 0
					? emergency
						? `If nobody decides within a week, leftovers go to ${emergency.name}.`
						: "If nobody decides within a week, they’re left as they are."
					: null}
			</p>
			{/* From lg the To do card is the card: the list loses its own and its rows run edge to
			    edge between the To do card's dividers (#73). */}
			<div className="lg:-mx-3 lg:border-y lg:*:rounded-none lg:*:border-0 lg:*:bg-transparent lg:*:shadow-none">
				<List aria-label={`${name} leftovers`}>
					{proposal.leftovers.map((leftover) => (
						<ListRow
							key={leftover.bucketId}
							title={leftover.name}
							meta={`${formatMoney(leftover.amount)} left`}
							className="max-sm:grid-cols-1"
							trailing={
								<OptionSelect
									className="w-48 max-sm:w-full"
									aria-label={`Where ${leftover.name}’s leftover goes`}
									value={sweeps[leftover.bucketId] ?? ""}
									disabled={!hydrated || pending}
									onValueChange={(goalId) =>
										setSweeps((current) => ({ ...current, [leftover.bucketId]: goalId }))
									}
									choices={[{ value: "", label: "Leave it" }, ...goalChoices]}
								/>
							}
						/>
					))}
					{proposal.windfall > 0 ? (
						<ListRow
							title="Extra income"
							meta={`${formatMoney(proposal.windfall)} came in above your usual take-home pay in ${name}`}
							className="max-sm:grid-cols-1 lg:grid-cols-1"
							trailing={
								<OptionSelect
									className="w-48 max-sm:w-full lg:w-full"
									aria-label="Where the Extra income goes"
									value={extraIncomeGoalId}
									disabled={!hydrated || pending}
									onValueChange={setExtraIncomeGoalId}
									choices={[
										{ value: "", label: "Decide later" },
										{ value: LEAVE_EXTRA_INCOME, label: "Leave it in the account" },
										...goalChoices,
									]}
								/>
							}
						/>
					) : null}
				</List>
			</div>
			<div className="flex justify-end pt-3">
				<Button
					disabled={!hydrated || pending}
					onClick={() =>
						onClose({
							sweeps,
							windfallGoalId:
								extraIncomeGoalId && extraIncomeGoalId !== LEAVE_EXTRA_INCOME
									? extraIncomeGoalId
									: null,
							leaveExtraIncome: extraIncomeGoalId === LEAVE_EXTRA_INCOME,
						})
					}
				>
					Close {name}
				</Button>
			</div>
		</Section>
	);
}

/**
 * How an ended month's money ended up, on that month: the leftovers Swept into Goals, the
 * Extra income sent to Goals, what each Bucket that carries over took into the next month, and who closed
 * it (or that the defaults did). Nothing when the month closed with nothing to tell.
 */
export function MonthEndSection({
	month,
	end,
	closed,
	parentId,
	goals,
	members,
}: {
	month: MonthKey;
	end: MonthEnd;
	closed: MonthCloseRecord | null;
	/** The Parent viewing. */
	parentId: string;
	/** Every Goal, active or not, to name where money went. */
	goals: Pick<GoalView, "id" | "name">[];
	members: Pick<MemberSummary, "id" | "name">[];
}) {
	if (quietEnd(end) && closed === null) return null;
	const name = monthName(month);
	const next = monthName(addMonths(month, 1));
	const goalName = (id: string) => goals.find((g) => g.id === id)?.name ?? "a Goal";
	const closedBy =
		closed === null
			? null
			: closed.decidedBy === null
				? "Closed by the defaults"
				: closed.decidedBy === parentId
					? "Closed by you"
					: `Closed by ${members.find((m) => m.id === closed.decidedBy)?.name ?? "the other Parent"}`;
	return (
		<Section aria-labelledby="month-end">
			<SectionHeader
				id="month-end"
				title={`How ${name} ended`}
				action={
					closedBy ? <span className="text-[13px] text-muted-foreground">{closedBy}</span> : null
				}
			/>
			{quietEnd(end) ? (
				<p className="rounded-xl border border-dashed px-(--card-pad) py-4 text-[13px] text-muted-foreground">
					Nothing was Swept or carried over.
				</p>
			) : (
				<List aria-label={`How ${name} ended`}>
					{end.sweeps.map((sweep) => (
						<ListRow
							key={`sweep:${sweep.bucketId}`}
							title={`${sweep.name} leftover`}
							meta={`Swept to ${goalName(sweep.goalId)}`}
							trailing={<Amount cents={sweep.amount} />}
						/>
					))}
					{end.windfall.map((extraIncome) => (
						<ListRow
							key={`windfall:${extraIncome.goalId}`}
							title="Extra income"
							meta={`Sent to ${goalName(extraIncome.goalId)}`}
							trailing={<Amount cents={extraIncome.amount} />}
						/>
					))}
					{end.rolledOver.map((rolled) => (
						<ListRow
							key={`rolled:${rolled.bucketId}`}
							title={rolled.name}
							meta={
								rolled.amount > 0
									? `Carried over into ${next}`
									: `Overspent, so ${next} starts short`
							}
							trailing={<Amount cents={rolled.amount} />}
						/>
					))}
				</List>
			)}
		</Section>
	);
}

function Amount({ cents }: { cents: number }) {
	return (
		<span className={cn("text-sm font-semibold tabular-nums", cents < 0 && "text-over")}>
			{formatMoney(cents)}
		</span>
	);
}
