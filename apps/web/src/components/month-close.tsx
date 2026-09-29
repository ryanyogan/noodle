import type { MonthCloseProposal } from "@noodle/domain";
import { Button } from "@noodle/ui/components/button";
import { List, ListRow } from "@noodle/ui/components/list";
import { Section, SectionHeader } from "@noodle/ui/components/section";
import { useHydrated } from "@tanstack/react-router";
import { useState } from "react";
import { formatMoney, monthName } from "../format";
import type { GoalView } from "../goals";
import { NativeSelect } from "./native-select";

/** Where the Parents send a month's leftovers and Windfall, by Goal ID; unset ones stay put. */
export type MonthCloseChoice = {
	sweeps: Record<string, string>;
	windfallGoalId: string | null;
};

/**
 * A month that has ended, awaiting the Parents: each Fresh-start Bucket's leftover to Sweep into
 * a Goal or leave, and the pending Windfall. Leftovers start on the emergency Goal, as the
 * defaults would send them; the Windfall is always left for a deliberate choice (ADR-0001).
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
	const [windfallGoalId, setWindfallGoalId] = useState("");
	const name = monthName(proposal.month);
	const goalOptions = goals.map((g) => (
		<option key={g.id} value={g.id}>
			{g.name}
		</option>
	));
	return (
		<Section aria-labelledby="month-close">
			<SectionHeader id="month-close" title={`Close ${name}`} />
			<p className="px-1 pb-3 text-sm text-muted-foreground">
				{name} has ended.{" "}
				{proposal.leftovers.length > 0
					? goals.length > 0
						? "Sweep what’s left in Fresh-start Buckets into a Goal, or leave it."
						: "There’s no Goal to Sweep leftovers into yet, so they stay put."
					: null}{" "}
				{proposal.leftovers.length > 0
					? emergency
						? `If nobody decides within a week, leftovers go to ${emergency.name}.`
						: "If nobody decides within a week, they’re left as they are."
					: null}
			</p>
			<List aria-label={`${name} leftovers`}>
				{proposal.leftovers.map((leftover) => (
					<ListRow
						key={leftover.bucketId}
						title={leftover.name}
						meta={`${formatMoney(leftover.amount)} left`}
						trailing={
							<NativeSelect
								className="w-40"
								aria-label={`Where ${leftover.name}’s leftover goes`}
								value={sweeps[leftover.bucketId] ?? ""}
								disabled={!hydrated || pending}
								onChange={(event) => {
									const goalId = event.currentTarget.value;
									setSweeps((current) => ({ ...current, [leftover.bucketId]: goalId }));
								}}
							>
								<option value="">Leave it</option>
								{goalOptions}
							</NativeSelect>
						}
					/>
				))}
				{proposal.windfall > 0 ? (
					<ListRow
						title="Windfall"
						meta={`${formatMoney(proposal.windfall)} beyond the Baseline`}
						trailing={
							<NativeSelect
								className="w-40"
								aria-label="Where the Windfall goes"
								value={windfallGoalId}
								disabled={!hydrated || pending}
								onChange={(event) => setWindfallGoalId(event.currentTarget.value)}
							>
								<option value="">Decide later</option>
								{goalOptions}
							</NativeSelect>
						}
					/>
				) : null}
			</List>
			<div className="flex justify-end pt-3">
				<Button
					disabled={!hydrated || pending}
					onClick={() => onClose({ sweeps, windfallGoalId: windfallGoalId || null })}
				>
					Close {name}
				</Button>
			</div>
		</Section>
	);
}
