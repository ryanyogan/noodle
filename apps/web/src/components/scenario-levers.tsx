import {
	addMonths,
	type Cents,
	canAssign,
	type DayKey,
	type Lever,
	lastDayOf,
	MAX_PROJECTION_MONTHS,
	type MonthKey,
	monthOfDay,
	monthsBetween,
	type Plan,
	type ProjectionGoal,
} from "@noodle/domain";
import { Card } from "@noodle/ui/components/card";
import { List, ListRow } from "@noodle/ui/components/list";
import { Section, SectionHeader } from "@noodle/ui/components/section";
import { Tile } from "@noodle/ui/components/tile";
import { cn } from "@noodle/ui/lib/utils";
import { type ComponentProps, memo } from "react";
import { asBucketColor, monogram } from "../buckets";
import { formatMoney, fullDay, monthName } from "../format";
import { leverTarget, withLever, withoutLever } from "../scenarios";
import { MoneyInput } from "./money-input";
import { NativeSelect } from "./native-select";

// The Levers of a Scenario: each Bucket's allowance, each Commitment cancelled or not, and each
// Goal's date and target. Every control changes the Scenario's Levers at once; the projection
// catches up in a deferred render, so a slider never waits for the chart.

const cadenceName = { monthly: "a month", biweekly: "every two weeks", annual: "a year" } as const;

/** "Aug 2027" for a month. */
export const shortMonth = (month: MonthKey) =>
	`${monthName(month).slice(0, 3)} ${month.slice(0, 4)}`;

/** Where an allowance slider goes up to: well past the allowance, in round $50s. */
const sliderMax = (allowance: Cents) => Math.ceil(Math.max(allowance * 2, 50_000) / 5_000) * 5_000;

export const ScenarioLevers = memo(function ScenarioLevers({
	month,
	plan,
	goals,
	levers,
	parentId,
	onChange,
}: {
	/** The Household's current month: the Scenario's first. */
	month: MonthKey;
	/** This month's Plan. */
	plan: Plan;
	goals: (ProjectionGoal & { name: string })[];
	levers: Lever[];
	parentId: string;
	onChange: (change: (levers: Lever[]) => Lever[]) => void;
}) {
	const byTarget = new Map(levers.map((l) => [leverTarget(l), l]));

	return (
		<div className="grid gap-8">
			<Section aria-labelledby="lever-buckets">
				<SectionHeader id="lever-buckets" title="Buckets" />
				{plan.buckets.length > 0 ? (
					<List>
						{plan.buckets.map((bucket) => {
							const lever = byTarget.get(`bucket:${bucket.id}`);
							const amount = lever?.kind === "allowance" ? lever.amount : bucket.allowance;
							const mine = canAssign(bucket, parentId);
							const set = (value: Cents) =>
								onChange((current) =>
									value === bucket.allowance
										? withoutLever(current, `bucket:${bucket.id}`)
										: withLever(current, { kind: "allowance", bucketId: bucket.id, amount: value }),
								);
							return (
								<ListRow
									key={bucket.id}
									leading={
										<Tile bucket={asBucketColor(bucket.color)} aria-hidden="true">
											{monogram(bucket.name)}
										</Tile>
									}
									title={bucket.name}
									meta={
										mine
											? `Plan ${formatMoney(bucket.allowance)} a month`
											: "Only its Parent can change it"
									}
									trailing={<Changed value={formatMoney(amount)} changed={lever !== undefined} />}
									below={
										mine ? (
											<Slider
												aria-label={`${bucket.name} allowance`}
												aria-valuetext={formatMoney(amount)}
												min={0}
												max={Math.max(sliderMax(bucket.allowance), amount)}
												step={1_000}
												value={amount}
												onChange={(event) => set(Number(event.currentTarget.value))}
											/>
										) : undefined
									}
								/>
							);
						})}
					</List>
				) : (
					<Empty>No Buckets in the Plan yet.</Empty>
				)}
			</Section>

			<Section aria-labelledby="lever-commitments">
				<SectionHeader id="lever-commitments" title="Commitments" />
				{plan.commitments.length > 0 ? (
					<List>
						{plan.commitments.map((commitment) => {
							const target = `commitment:${commitment.id}`;
							const lever = byTarget.get(target);
							const from = lever?.kind === "end-commitment" ? lever.fromMonth : null;
							const end = (fromMonth: MonthKey) =>
								onChange((current) =>
									withLever(current, {
										kind: "end-commitment",
										commitmentId: commitment.id,
										fromMonth,
									}),
								);
							return (
								<ListRow
									key={commitment.id}
									title={commitment.name}
									meta={`${formatMoney(commitment.amount)} ${cadenceName[commitment.cadence]}`}
									trailing={
										<label className="flex items-center gap-2 text-[13px] text-muted-foreground">
											<input
												type="checkbox"
												className="size-4 accent-(--brand)"
												checked={from !== null}
												onChange={(event) =>
													event.currentTarget.checked
														? end(month)
														: onChange((current) => withoutLever(current, target))
												}
											/>
											Cancel
										</label>
									}
									below={
										from !== null ? (
											<div className="flex items-center justify-between gap-3 text-[13px] text-muted-foreground">
												<span aria-hidden="true">Cancelled from</span>
												<NativeSelect
													className="w-auto"
													aria-label={`${commitment.name} cancelled from`}
													value={from}
													onChange={(event) => end(event.currentTarget.value as MonthKey)}
												>
													{Array.from({ length: 12 }, (_, i) => addMonths(month, i)).map((m) => (
														<option key={m} value={m}>
															{monthName(m)} {m.slice(0, 4)}
														</option>
													))}
												</NativeSelect>
											</div>
										) : undefined
									}
								/>
							);
						})}
					</List>
				) : (
					<Empty>No Commitments in the Plan yet.</Empty>
				)}
			</Section>

			<Section aria-labelledby="lever-goals">
				<SectionHeader id="lever-goals" title="Goals" />
				{goals.length > 0 ? (
					<List>
						{goals.map((goal) => {
							const target = `goal:${goal.id}`;
							const lever = byTarget.get(target);
							const current =
								lever?.kind === "goal"
									? lever
									: { target: goal.target, targetDate: goal.targetDate };
							const set = (next: { target: Cents; targetDate: DayKey | null }) =>
								onChange((levers) =>
									next.target === goal.target && next.targetDate === goal.targetDate
										? withoutLever(levers, target)
										: withLever(levers, { kind: "goal", goalId: goal.id, ...next }),
								);
							const offset =
								current.targetDate === null
									? null
									: Math.max(0, monthsBetween(month, monthOfDay(current.targetDate)));
							// A Goal's own day in its own month; otherwise the end of the month chosen.
							const dateIn = (m: MonthKey): DayKey =>
								goal.targetDate && monthOfDay(goal.targetDate) === m
									? goal.targetDate
									: lastDayOf(m);
							return (
								<ListRow
									key={goal.id}
									title={goal.name}
									meta={
										goal.targetDate
											? `Plan ${formatMoney(goal.target)} by ${fullDay(goal.targetDate)}`
											: `Plan ${formatMoney(goal.target)}, no date`
									}
									trailing={
										<Changed
											value={
												current.targetDate ? shortMonth(monthOfDay(current.targetDate)) : "No date"
											}
											changed={lever !== undefined}
										/>
									}
									below={
										<div className="grid gap-3">
											<Slider
												aria-label={`${goal.name} reached by`}
												aria-valuetext={
													current.targetDate
														? `${monthName(monthOfDay(current.targetDate))} ${current.targetDate.slice(0, 4)}`
														: "No date"
												}
												min={0}
												max={MAX_PROJECTION_MONTHS - 1}
												step={1}
												value={offset ?? 11}
												onChange={(event) =>
													set({
														target: current.target,
														targetDate: dateIn(addMonths(month, Number(event.currentTarget.value))),
													})
												}
											/>
											<div className="flex items-center justify-between gap-3 text-[13px] text-muted-foreground">
												<span aria-hidden="true">Target</span>
												<MoneyInput
													className="w-32 text-end"
													aria-label={`${goal.name} target`}
													value={current.target}
													onCommit={(cents) => {
														if (cents > 0) set({ target: cents, targetDate: current.targetDate });
													}}
												/>
											</div>
										</div>
									}
								/>
							);
						})}
					</List>
				) : (
					<Empty>No Goals yet.</Empty>
				)}
			</Section>
		</div>
	);
});

/** The Scenario's value for a Lever, marked when it differs from the Plan's. */
function Changed({ value, changed }: { value: string; changed: boolean }) {
	return (
		<span
			className={cn(
				"text-sm tabular-nums",
				changed ? "font-semibold text-foreground" : "text-muted-foreground",
			)}
		>
			{value}
			{changed ? <span className="sr-only"> (changed)</span> : null}
		</span>
	);
}

function Slider({ className, ...props }: Omit<ComponentProps<"input">, "type">) {
	return (
		<input
			type="range"
			className={cn("h-6 w-full cursor-pointer accent-(--brand) touch-pan-y", className)}
			{...props}
		/>
	);
}

function Empty({ children }: { children: string }) {
	return <Card className="p-(--card-pad) text-sm text-muted-foreground">{children}</Card>;
}
