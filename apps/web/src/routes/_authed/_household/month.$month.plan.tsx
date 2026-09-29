import {
	type MonthKey,
	type MonthState,
	monthKeyAt,
	type PlanBucket,
	parseDollars,
} from "@noodle/domain";
import { Button } from "@noodle/ui/components/button";
import { Card } from "@noodle/ui/components/card";
import { Field, FormError } from "@noodle/ui/components/field";
import { Input } from "@noodle/ui/components/input";
import { List, ListRow } from "@noodle/ui/components/list";
import { PageHeader } from "@noodle/ui/components/page-header";
import { Section, SectionHeader } from "@noodle/ui/components/section";
import { Tile } from "@noodle/ui/components/tile";
import { cn } from "@noodle/ui/lib/utils";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useHydrated } from "@tanstack/react-router";
import { Archive, ArrowDown, ArrowUp, ChevronLeft, Pencil, Plus } from "lucide-react";
import { type FormEvent, useId, useState } from "react";
import { ulid } from "ulid";
import { asBucketColor, bucketColors, monogram, nextBucketColor } from "../../../buckets";
import { withoutCommitment } from "../../../commitments";
import { AddCommitment, CommitmentEditor } from "../../../components/commitment-editor";
import { FundGoalSheet } from "../../../components/goals";
import { MoneyInput } from "../../../components/money-input";
import { Confirm, SaveFailed } from "../../../components/plan-editing";
import { formatMoney, monthName } from "../../../format";
import { type GoalView, useGoalMoney, useGoals } from "../../../goals";
import {
	usePlanChange,
	withAllowance,
	withBaseline,
	withBucketDetails,
	withNewBucket,
	withNewPersonalAllowance,
	withOrder,
	withoutBucket,
	withRolling,
} from "../../../plan-changes";
import { goalsQuery, membersQuery, useMonthState } from "../../../queries";
import { endCommitment } from "../../../server/commitments";
import {
	addBucket,
	addPersonalAllowance,
	archiveBucket,
	reorderBuckets,
	setAllowance,
	setBaseline,
	setRolling,
	updateBucket,
} from "../../../server/plan";

export const Route = createFileRoute("/_authed/_household/month/$month/plan")({
	// This month's Plan lists the Goals, to fund them from its Free to Spend.
	loader: ({ context }) =>
		context.month === monthKeyAt(new Date(), context.household.timeZone)
			? context.queryClient.ensureQueryData(goalsQuery())
			: undefined,
	component: PlanPage,
});

function PlanPage() {
	const { month, parentId, household } = Route.useRouteContext();
	// Goal funding comes out of the current month's Free to Spend only.
	const current = month === monthKeyAt(new Date(), household.timeZone);
	const state = useMonthState(month);
	const buckets = state.buckets.filter((b) => b.owner === undefined);
	const allowances = state.buckets.filter((b) => b.owner !== undefined);
	// Owned here: archiving removes the Bucket's row, which must not take the error with it.
	const archive = usePlanChange(month, {
		save: (data: { bucketId: string; month: MonthKey }) => archiveBucket({ data }),
		apply: withoutBucket,
	});
	// Owned here for the same reason: ending a Commitment removes its row.
	const end = usePlanChange(month, {
		save: (data: { commitmentId: string; month: MonthKey }) => endCommitment({ data }),
		apply: withoutCommitment,
	});
	return (
		<>
			<PageHeader
				eyebrow={monthName(month)}
				title="Plan"
				leading={
					<Button variant="ghost" size="icon" asChild>
						<Link to="/month/$month" params={{ month }} aria-label="Back to This Month">
							<ChevronLeft className="size-5" />
						</Link>
					</Button>
				}
			/>
			<div className="grid max-w-2xl gap-8">
				{state.editable ? null : (
					<Card className="p-(--card-pad) text-sm text-muted-foreground">
						This month has ended, so its Plan can no longer change.
					</Card>
				)}
				<Summary state={state} />
				<Section aria-labelledby="plan-commitments">
					<SectionHeader
						id="plan-commitments"
						title="Commitments"
						count={state.commitments.length}
					/>
					<SaveFailed change={end} />
					{state.commitments.length > 0 ? (
						<List>
							{state.commitments.map((commitment) => (
								<CommitmentEditor
									key={commitment.id}
									month={month}
									commitment={commitment}
									editable={state.editable}
									onEnd={(commitmentId) => end.mutate({ commitmentId, month })}
								/>
							))}
						</List>
					) : null}
					{state.editable ? <AddCommitment month={month} /> : null}
				</Section>
				<Section aria-labelledby="plan-buckets">
					<SectionHeader id="plan-buckets" title="Buckets" count={buckets.length} />
					<SaveFailed change={archive} />
					{buckets.length > 0 ? (
						<List>
							{buckets.map((bucket, index) => (
								<BucketEditor
									key={bucket.id}
									month={month}
									bucket={bucket}
									order={buckets.map((b) => b.id)}
									index={index}
									editable={state.editable}
									onArchive={(bucketId) => archive.mutate({ bucketId, month })}
								/>
							))}
						</List>
					) : null}
					{state.editable ? <AddBucket month={month} buckets={state.buckets} /> : null}
				</Section>
				<Section aria-labelledby="plan-personal-allowances">
					<SectionHeader
						id="plan-personal-allowances"
						title="Personal Allowances"
						count={allowances.length}
					/>
					{allowances.length > 0 ? (
						<List>
							{allowances.map((bucket) => (
								<BucketEditor
									key={bucket.id}
									month={month}
									bucket={bucket}
									order={[bucket.id]}
									index={0}
									// Each Parent sets their own; the other's shows its amount.
									editable={state.editable && bucket.owner === parentId}
									onArchive={() => undefined}
								/>
							))}
						</List>
					) : null}
					{state.editable && !allowances.some((b) => b.owner === parentId) ? (
						<AddPersonalAllowance month={month} parentId={parentId} buckets={state.buckets} />
					) : null}
				</Section>
				{current && state.editable ? <PlanGoals state={state} /> : null}
			</div>
		</>
	);
}

/**
 * Baseline, less what the Commitments and Buckets take, is Free to Spend. Over-planning is
 * said out loud.
 */
function Summary({ state }: { state: MonthState & { editable: boolean } }) {
	const hydrated = useHydrated();
	const change = usePlanChange(state.month, {
		save: (data: { month: MonthKey; amountCents: number }) => setBaseline({ data }),
		apply: withBaseline,
	});
	const overBy = -state.freeToSpend;
	return (
		<Section aria-labelledby="plan-summary">
			<SectionHeader id="plan-summary" title="Free to Spend" />
			<Card>
				<div className="grid gap-3 p-(--card-pad)">
					<div className="flex items-center justify-between gap-4">
						<div className="grid gap-0.5">
							<label htmlFor="baseline" className="text-sm font-medium">
								Baseline
							</label>
							<span className="text-[13px] text-muted-foreground">
								Your normal monthly take-home pay
							</span>
						</div>
						<MoneyInput
							id="baseline"
							className="w-36 shrink-0"
							value={state.baseline ?? 0}
							readOnly={!hydrated || !state.editable}
							onCommit={(amountCents) => change.mutate({ month: state.month, amountCents })}
						/>
					</div>
					<SaveFailed change={change} />
				</div>
				<dl className="grid gap-2 border-t p-(--card-pad) text-sm">
					{state.commitments.length > 0 ? (
						<SummaryRow label="Commitments" value={`−${formatMoney(state.committed)}`} />
					) : null}
					<SummaryRow label="In Buckets" value={`−${formatMoney(state.planned)}`} />
					{state.movedToBuckets > 0 ? (
						<SummaryRow label="Covers" value={`−${formatMoney(state.movedToBuckets)}`} />
					) : null}
					{state.fundedGoals > 0 ? (
						<SummaryRow label="Goal funding" value={`−${formatMoney(state.fundedGoals)}`} />
					) : null}
					<SummaryRow
						label="Free to Spend"
						value={formatMoney(state.freeToSpend)}
						className={cn("font-semibold", overBy > 0 && "text-over")}
					/>
				</dl>
				{overBy > 0 ? (
					<p
						role="status"
						className="border-t bg-over-soft px-(--card-pad) py-3 text-[13px] text-over"
					>
						{state.commitments.length > 0
							? `Your Commitments and Buckets add up to ${formatMoney(overBy)} more than your Baseline. Lower an amount or raise the Baseline.`
							: `Your Buckets add up to ${formatMoney(overBy)} more than your Baseline. Lower an allowance or raise the Baseline.`}
					</p>
				) : null}
			</Card>
		</Section>
	);
}

/** This month's active Goals, what each still needs this month, and a way to fund it. */
function PlanGoals({ state }: { state: MonthState }) {
	const hydrated = useHydrated();
	const { goals } = useGoals();
	const { fund } = useGoalMoney();
	const [funding, setFunding] = useState<GoalView | null>(null);
	const active = goals.filter((g) => g.state === "active");
	return (
		<Section aria-labelledby="plan-goals">
			<SectionHeader id="plan-goals" title="Goals" count={active.length} />
			{active.length > 0 ? (
				<List>
					{active.map((goal) => (
						<ListRow
							key={goal.id}
							aria-label={goal.name}
							title={
								<Link
									to="/goals/$goalId"
									params={{ goalId: goal.id }}
									className="underline-offset-4 hover:underline"
								>
									{goal.name}
								</Link>
							}
							meta={goalThisMonth(goal)}
							trailing={
								<Button
									type="button"
									variant="outline"
									size="sm"
									disabled={!hydrated}
									aria-label={`Fund ${goal.name}`}
									onClick={() => setFunding(goal)}
								>
									Fund
								</Button>
							}
						/>
					))}
				</List>
			) : (
				<Card className="flex items-center justify-between gap-4 p-(--card-pad) text-sm text-muted-foreground">
					Goals set money aside for something ahead, funded from Free to Spend.
					<Button variant="outline" size="sm" asChild>
						<Link to="/goals">Goals</Link>
					</Button>
				</Card>
			)}
			<FundGoalSheet
				goal={funding}
				freeToSpend={state.freeToSpend}
				onOpenChange={(open) => {
					if (!open) setFunding(null);
				}}
				onFund={(goal, amountCents) => {
					setFunding(null);
					fund.mutate({
						moveId: ulid(),
						goalId: goal.id,
						goalName: goal.name,
						month: state.month,
						amountCents,
					});
				}}
			/>
		</Section>
	);
}

/** What a Goal still needs this month, in words. */
function goalThisMonth({ progress, target }: GoalView): string {
	if (progress.status === "reached") return "Reached";
	if (progress.leftThisMonth === null) {
		return `${formatMoney(progress.saved)} of ${formatMoney(target)} set aside`;
	}
	return progress.leftThisMonth > 0
		? `${formatMoney(progress.leftThisMonth)} left to fund this month`
		: "Funded for this month";
}

function SummaryRow({
	label,
	value,
	className,
}: {
	label: string;
	value: string;
	className?: string;
}) {
	return (
		<div className={cn("flex items-center justify-between gap-4", className)}>
			<dt>{label}</dt>
			<dd className="tabular-nums">{value}</dd>
		</div>
	);
}

function BucketEditor({
	month,
	bucket,
	order,
	index,
	editable,
	onArchive,
}: {
	month: MonthKey;
	bucket: PlanBucket;
	order: string[];
	index: number;
	editable: boolean;
	onArchive: (bucketId: string) => void;
}) {
	const hydrated = useHydrated();
	const [open, setOpen] = useState(false);
	const detailsId = useId();
	const color = asBucketColor(bucket.color);
	const allowance = usePlanChange(month, {
		save: (data: { bucketId: string; month: MonthKey; amountCents: number }) =>
			setAllowance({ data }),
		apply: withAllowance,
	});
	return (
		<ListRow
			leading={<Tile bucket={color}>{monogram(bucket.name)}</Tile>}
			title={bucket.name}
			meta={bucket.rolling ? "Rolling" : "Fresh-start"}
			trailing={
				<div className="flex items-center gap-1.5">
					<MoneyInput
						className="w-32"
						aria-label={`${bucket.name} allowance`}
						value={bucket.allowance}
						readOnly={!hydrated || !editable}
						onCommit={(amountCents) =>
							allowance.mutate({ bucketId: bucket.id, month, amountCents })
						}
					/>
					{editable ? (
						<Button
							variant="ghost"
							size="icon"
							type="button"
							disabled={!hydrated}
							aria-label={`Edit ${bucket.name}`}
							aria-expanded={open}
							aria-controls={detailsId}
							onClick={() => setOpen(!open)}
						>
							<Pencil />
						</Button>
					) : null}
				</div>
			}
			below={
				allowance.isError || open ? (
					<div id={detailsId} className="grid gap-3">
						<SaveFailed change={allowance} />
						{open ? (
							<BucketDetails
								month={month}
								bucket={bucket}
								order={order}
								index={index}
								onArchive={onArchive}
							/>
						) : null}
					</div>
				) : undefined
			}
		/>
	);
}

/** Rename, recolour, set Rolling or Fresh-start, move, or archive a Bucket. */
function BucketDetails({
	month,
	bucket,
	order,
	index,
	onArchive,
}: {
	month: MonthKey;
	bucket: PlanBucket;
	order: string[];
	index: number;
	onArchive: (bucketId: string) => void;
}) {
	const nameId = useId();
	const [confirmArchive, setConfirmArchive] = useState(false);
	// The colour just picked, shown until the cache catches up (or rolls back).
	const [pickedColor, setPickedColor] = useState<number | null>(null);
	const [pickedRolling, setPickedRolling] = useState<boolean | null>(null);
	const details = usePlanChange(month, {
		save: (data: { bucketId: string; name?: string; color?: number }) => updateBucket({ data }),
		apply: withBucketDetails,
	});
	const reorder = usePlanChange(month, {
		save: (data: { bucketIds: string[] }) => reorderBuckets({ data }),
		apply: withOrder,
	});
	const rolling = usePlanChange(month, {
		save: (data: { bucketId: string; month: MonthKey; rolling: boolean }) => setRolling({ data }),
		apply: withRolling,
	});

	function move(by: -1 | 1) {
		const bucketIds = [...order];
		const [moved] = bucketIds.splice(index, 1);
		if (moved) bucketIds.splice(index + by, 0, moved);
		reorder.mutate({ bucketIds });
	}

	function rename(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const name = String(new FormData(event.currentTarget).get("name") ?? "").trim();
		if (name && name !== bucket.name) details.mutate({ bucketId: bucket.id, name });
	}

	return (
		<div className="grid gap-4 rounded-xl bg-surface-2 p-3">
			<SaveFailed change={details} />
			<SaveFailed change={reorder} />
			<SaveFailed change={rolling} />
			<form onSubmit={rename}>
				<Field label="Name" htmlFor={nameId}>
					<div className="flex gap-2">
						<Input
							id={nameId}
							name="name"
							required
							maxLength={40}
							defaultValue={bucket.name}
							className="bg-card"
						/>
						<Button type="submit" variant="outline">
							Rename
						</Button>
					</div>
				</Field>
			</form>
			<fieldset className="grid gap-2">
				<legend className="mb-2 text-sm font-medium">Colour</legend>
				<div className="flex flex-wrap gap-2">
					{bucketColors.map((option) => (
						<label key={option.value} className="relative">
							<input
								type="radio"
								name={`color-${bucket.id}`}
								value={option.value}
								checked={(pickedColor ?? bucket.color) === option.value}
								onChange={() => {
									setPickedColor(option.value);
									details.mutate(
										{ bucketId: bucket.id, color: option.value },
										{ onSettled: () => setPickedColor(null) },
									);
								}}
								className="peer absolute inset-0 z-10 size-full cursor-pointer appearance-none rounded-full opacity-0"
							/>
							<span className="sr-only">{option.name}</span>
							<span
								aria-hidden="true"
								className={cn(
									"block size-8 rounded-full ring-offset-2 ring-offset-surface-2 transition-shadow duration-(--duration-fast)",
									"peer-checked:ring-2 peer-checked:ring-foreground peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-ring",
								)}
								style={{ background: `var(--bucket-${option.value})` }}
							/>
						</label>
					))}
				</div>
			</fieldset>
			<fieldset className="grid gap-2">
				<legend className="mb-2 text-sm font-medium">At the end of the month</legend>
				{rollingOptions.map((option) => (
					<label
						key={option.label}
						className="flex cursor-pointer items-start gap-3 rounded-lg bg-card px-3 py-2.5"
					>
						<input
							type="radio"
							name={`rolling-${bucket.id}`}
							checked={(pickedRolling ?? bucket.rolling) === option.rolling}
							onChange={() => {
								setPickedRolling(option.rolling);
								rolling.mutate(
									{ bucketId: bucket.id, month, rolling: option.rolling },
									{ onSettled: () => setPickedRolling(null) },
								);
							}}
							className="mt-0.5 size-4 shrink-0 accent-foreground"
						/>
						<span className="grid gap-0.5">
							<span className="text-sm font-medium">{option.label}</span>
							<span className="text-[13px] text-muted-foreground">{option.description}</span>
						</span>
					</label>
				))}
			</fieldset>
			{/* A Personal Allowance has its own section, and stays in the Plan: its Parent sets it to
			    zero rather than archiving it. */}
			{bucket.owner === undefined ? (
				<div className="flex flex-wrap items-center gap-2">
					<Button
						type="button"
						variant="outline"
						size="sm"
						disabled={index === 0}
						onClick={() => move(-1)}
					>
						<ArrowUp />
						Move up
					</Button>
					<Button
						type="button"
						variant="outline"
						size="sm"
						disabled={index === order.length - 1}
						onClick={() => move(1)}
					>
						<ArrowDown />
						Move down
					</Button>
					<Button
						type="button"
						variant="ghost"
						size="sm"
						className="ms-auto"
						onClick={() => setConfirmArchive(true)}
					>
						<Archive />
						Archive
					</Button>
				</div>
			) : null}
			{confirmArchive ? (
				<Confirm
					onConfirm={() => onArchive(bucket.id)}
					onCancel={() => setConfirmArchive(false)}
					confirmLabel={`Archive ${bucket.name}`}
				>
					{bucket.name} leaves the Plan from {monthName(month)} on. Earlier months keep it.
				</Confirm>
			) : null}
		</div>
	);
}

const rollingOptions = [
	{
		rolling: false,
		label: "Fresh-start",
		description: "Starts each month at its allowance.",
	},
	{
		rolling: true,
		label: "Rolling",
		description:
			"What’s left carries into next month, and so does overspending that isn’t Covered.",
	},
];

/**
 * Sets up the signed-in Parent's Personal Allowance: a Bucket of their own, counted in the Plan,
 * whose Transactions only they see.
 */
function AddPersonalAllowance({
	month,
	parentId,
	buckets,
}: {
	month: MonthKey;
	parentId: string;
	buckets: PlanBucket[];
}) {
	const hydrated = useHydrated();
	const members = useSuspenseQuery(membersQuery()).data;
	const firstName = members.find((m) => m.id === parentId)?.name.split(/\s+/)[0];
	// Reused by a retry of the same attempt, so it's added once.
	const [bucketId] = useState(() => ulid());
	const [invalidAmount, setInvalidAmount] = useState(false);
	const add = usePlanChange(month, {
		save: (data: {
			bucketId: string;
			month: MonthKey;
			name: string;
			color: number;
			allowanceCents: number;
		}) => addPersonalAllowance({ data }),
		apply: (data, variables) => withNewPersonalAllowance(data, { ...variables, owner: parentId }),
	});

	function onSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const allowanceCents = parseDollars(
			String(new FormData(event.currentTarget).get("allowance") ?? ""),
		);
		setInvalidAmount(allowanceCents === null);
		if (allowanceCents === null) return;
		add.mutate({
			bucketId,
			month,
			name: firstName ? `${firstName}’s Personal Allowance` : "Personal Allowance",
			color: nextBucketColor(buckets.map((b) => b.color)),
			allowanceCents,
		});
	}

	return (
		<Card>
			<form onSubmit={onSubmit} className="grid gap-3 p-(--card-pad)">
				<p className="text-[13px] text-muted-foreground">
					Money that’s yours to spend each month. It counts in the Plan like any Bucket; the other
					Parent sees only its totals, never what you spent it on.
				</p>
				<Field label="Your Personal Allowance" htmlFor="new-personal-allowance">
					<Input
						id="new-personal-allowance"
						name="allowance"
						required
						inputMode="decimal"
						autoComplete="off"
						placeholder="0"
						className="tabular-nums sm:w-40"
						aria-invalid={invalidAmount || undefined}
					/>
				</Field>
				{invalidAmount ? (
					<FormError>Enter the allowance as a dollar amount, like 250 or 85.50.</FormError>
				) : null}
				<SaveFailed change={add} />
				<Button
					type="submit"
					variant="secondary"
					className="justify-self-start"
					disabled={!hydrated}
				>
					<Plus />
					Set up Personal Allowance
				</Button>
			</form>
		</Card>
	);
}

function AddBucket({ month, buckets }: { month: MonthKey; buckets: PlanBucket[] }) {
	const hydrated = useHydrated();
	// A fresh ID per Bucket; a retry of the same attempt reuses it, so it's added once.
	const [bucketId, setBucketId] = useState(() => ulid());
	const [invalidAmount, setInvalidAmount] = useState(false);
	const add = usePlanChange(month, {
		save: (data: {
			bucketId: string;
			month: MonthKey;
			name: string;
			color: number;
			allowanceCents: number;
		}) => addBucket({ data }),
		apply: withNewBucket,
	});

	function onSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const form = event.currentTarget;
		const values = new FormData(form);
		const name = String(values.get("name") ?? "").trim();
		const allowanceCents = parseDollars(String(values.get("allowance") ?? ""));
		setInvalidAmount(allowanceCents === null);
		if (!name || allowanceCents === null) return;
		add.mutate({
			bucketId,
			month,
			name,
			color: nextBucketColor(buckets.map((b) => b.color)),
			allowanceCents,
		});
		// The Bucket shows at once; the next one gets its own ID.
		setBucketId(ulid());
		form.reset();
	}

	return (
		<Card>
			<form onSubmit={onSubmit} className="grid gap-3 p-(--card-pad)">
				<div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem]">
					<Field label="New Bucket" htmlFor="new-bucket-name">
						<Input
							id="new-bucket-name"
							name="name"
							required
							maxLength={40}
							autoComplete="off"
							placeholder="Gifts"
						/>
					</Field>
					<Field label="Monthly allowance" htmlFor="new-bucket-allowance">
						<Input
							id="new-bucket-allowance"
							name="allowance"
							required
							inputMode="decimal"
							autoComplete="off"
							placeholder="0"
							className="tabular-nums"
							aria-invalid={invalidAmount || undefined}
						/>
					</Field>
				</div>
				{invalidAmount ? (
					<FormError>Enter the allowance as a dollar amount, like 250 or 85.50.</FormError>
				) : null}
				<SaveFailed change={add} />
				<Button
					type="submit"
					variant="secondary"
					className="justify-self-start"
					disabled={!hydrated}
				>
					<Plus />
					Add Bucket
				</Button>
			</form>
		</Card>
	);
}
