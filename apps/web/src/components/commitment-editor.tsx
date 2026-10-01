import {
	CADENCES,
	type Cadence,
	type CommitmentState,
	type DayKey,
	type MonthKey,
	monthlyEquivalent,
	nextDueDate,
	type PlanScope,
	parseDollars,
} from "@noodle/domain";
import { Button } from "@noodle/ui/components/button";
import { Card } from "@noodle/ui/components/card";
import { Field, FormError } from "@noodle/ui/components/field";
import { Input } from "@noodle/ui/components/input";
import { ListRow } from "@noodle/ui/components/list";
import { NativeSelect } from "@noodle/ui/components/native-select";
import { Sheet, SheetContent, SheetHeader } from "@noodle/ui/components/sheet";
import { Tile } from "@noodle/ui/components/tile";
import { useHydrated } from "@tanstack/react-router";
import { Pencil, Plus } from "lucide-react";
import { type FormEvent, useId, useState } from "react";
import { ulid } from "ulid";
import { monogram } from "../buckets";
import {
	type CommitmentVariables,
	cadenceNames,
	costText,
	schedule,
	withCommitment,
	withNewCommitment,
	withoutCommitment,
} from "../commitments";
import { formatMoney, formatMoneyInput, fullDay, monthName } from "../format";
import { usePlanChange } from "../plan-changes";
import { addCommitment, endCommitment, updateCommitment } from "../server/commitments";
import { CommitmentLink } from "./commitment-list";
import { AmountInput } from "./goals";
import { Confirm, SaveFailed } from "./plan-editing";
import { PlanHistoryDisclosure } from "./plan-history";
import { ChangedNote, PlanScopeField } from "./plan-scope-field";

const isCadence = (value: unknown): value is Cadence => CADENCES.includes(value as Cadence);
const isDay = (value: unknown): value is DayKey =>
	typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);

/**
 * A Commitment in the Plan: what it takes a month, and the Commitment sheet to change its terms
 * or end it, the same one its page opens. One due less often than monthly shows its monthly share
 * ("$566.67/mo"), so a yearly bill doesn't read as due now. `was` is its amount the month before,
 * when this month changed it.
 */
export function CommitmentEditor({
	month,
	commitment,
	editable,
	was,
	changes,
}: {
	month: MonthKey;
	commitment: CommitmentState;
	editable: boolean;
	was?: number;
	changes: CommitmentChanges;
}) {
	const hydrated = useHydrated();
	const [open, setOpen] = useState(false);
	const monthly = commitment.cadence === "monthly";
	return (
		<ListRow
			leading={<Tile>{monogram(commitment.name)}</Tile>}
			title={<CommitmentLink commitment={commitment} />}
			meta={
				<>
					<span>
						{monthly
							? schedule(commitment, month)
							: `${formatMoney(commitment.amount)} ${cadenceNames[commitment.cadence].toLowerCase()} · ${
									commitment.dueDates.length > 0
										? `${formatMoney(commitment.expected)} this month`
										: `next due ${fullDay(nextDueDate(commitment, `${month}-01`))}`
								}`}
						{monthly && commitment.dueDates.length > 1
							? ` · ${formatMoney(commitment.expected)} this month`
							: ""}
					</span>
					<ChangedNote was={was} />
					{monthly ? (
						<span className="basis-full text-subtle-foreground">{costText(commitment)}</span>
					) : null}
				</>
			}
			trailing={
				<div className="flex items-center gap-1">
					<span className="text-sm font-medium tabular-nums">
						{monthly
							? formatMoney(commitment.amount)
							: `${formatMoney(monthlyEquivalent(commitment))}/mo`}
					</span>
					{editable ? (
						<Button
							variant="ghost"
							size="icon"
							type="button"
							disabled={!hydrated}
							aria-label={`Edit ${commitment.name}`}
							onClick={() => setOpen(true)}
						>
							<Pencil />
						</Button>
					) : null}
					<CommitmentSheet
						month={month}
						commitment={commitment}
						open={open}
						onOpenChange={setOpen}
						changes={changes}
					/>
				</div>
			}
		/>
	);
}

/**
 * The writes the Commitment sheet makes, kept by whatever opens it: ending a Commitment removes
 * its row, which must not take a failure with it.
 */
export function useCommitmentChanges(month: MonthKey) {
	const update = usePlanChange(month, {
		save: (data: CommitmentVariables) => updateCommitment({ data }),
		apply: withCommitment,
	});
	const end = usePlanChange(month, {
		save: (data: { commitmentId: string; month: MonthKey }) => endCommitment({ data }),
		apply: withoutCommitment,
	});
	const failed =
		update.isError || end.isError ? (
			<>
				<SaveFailed change={update} />
				<SaveFailed change={end} />
			</>
		) : null;
	return { update, end, failed };
}

export type CommitmentChanges = ReturnType<typeof useCommitmentChanges>;

/** The Commitment sheet: change its terms from this month on or just this month, or end it. */
export function CommitmentSheet({
	month,
	commitment,
	open,
	onOpenChange,
	changes,
}: {
	month: MonthKey;
	commitment: Pick<CommitmentState, "id" | "name" | "amount" | "cadence" | "dueDate">;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	changes: CommitmentChanges;
}) {
	return (
		<Sheet open={open} onOpenChange={onOpenChange}>
			{open ? (
				<SheetContent>
					<SheetHeader title={commitment.name} description="Commitment" />
					<CommitmentDetails
						month={month}
						commitment={commitment}
						onSave={(terms) => {
							onOpenChange(false);
							changes.update.mutate({ commitmentId: commitment.id, month, ...terms });
						}}
						onEnd={(commitmentId) => {
							onOpenChange(false);
							changes.end.mutate({ commitmentId, month });
						}}
					/>
					<PlanHistoryDisclosure month={month} targetId={commitment.id} />
				</SheetContent>
			) : null}
		</Sheet>
	);
}

/** What's wrong with a Commitment's fields, each shown beside the form on submit. */
type CommitmentErrors = { name?: boolean; amount?: boolean; dueDate?: boolean };

/** The fields' values, checked; with the errors when any is missing or wrong. */
function readCommitment(form: HTMLFormElement) {
	const values = new FormData(form);
	const name = String(values.get("name") ?? "").trim();
	const amountCents = parseDollars(String(values.get("amount") ?? ""));
	const cadence = values.get("cadence");
	const dueDate = values.get("dueDate");
	const errors: CommitmentErrors = {
		name: name === "",
		amount: amountCents === null,
		dueDate: !isDay(dueDate),
	};
	const ok =
		!errors.name && amountCents !== null && isCadence(cadence) && isDay(dueDate) && !errors.dueDate;
	return ok
		? { ok: true as const, errors, terms: { name, amountCents, cadence, dueDate } }
		: { ok: false as const, errors };
}

function CommitmentFormErrors({ errors }: { errors: CommitmentErrors }) {
	return (
		<>
			{errors.name ? <FormError>Give the Commitment a name, like Mortgage.</FormError> : null}
			{errors.amount ? (
				<FormError>Enter the amount as a dollar amount, like 1,800 or 15.99.</FormError>
			) : null}
			{errors.dueDate ? <FormError>Pick a day it’s due.</FormError> : null}
		</>
	);
}

/** Change a Commitment's amount, name, or when it's due, from this month on or just this month; or end it. */
function CommitmentDetails({
	month,
	commitment,
	onSave,
	onEnd,
}: {
	month: MonthKey;
	commitment: Pick<CommitmentState, "id" | "name" | "amount" | "cadence" | "dueDate">;
	onSave: (terms: Omit<CommitmentVariables, "commitmentId" | "month">) => void;
	onEnd: (commitmentId: string) => void;
}) {
	const hydrated = useHydrated();
	const id = useId();
	const [confirmEnd, setConfirmEnd] = useState(false);
	const [scope, setScope] = useState<PlanScope>("from-on");
	const [errors, setErrors] = useState<CommitmentErrors>({});
	// Shown as the next day it's due, not the first ever: the schedule is the same either way.
	const nextDue = nextDueDate(commitment, `${month}-01`);

	function save(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const read = readCommitment(event.currentTarget);
		setErrors(read.errors);
		if (!read.ok) return;
		const { terms } = read;
		// Left as the next due day, the schedule hasn't changed: keep the day it's kept by.
		const dueDate =
			terms.dueDate === nextDue && terms.cadence === commitment.cadence
				? commitment.dueDate
				: terms.dueDate;
		onSave({ ...terms, dueDate, scope });
	}

	return (
		<div className="grid gap-4">
			<form onSubmit={save} noValidate className="grid gap-4">
				<Field label="Amount" htmlFor={`${id}-amount`}>
					<AmountInput
						id={`${id}-amount`}
						name="amount"
						placeholder="0"
						defaultValue={formatMoneyInput(commitment.amount)}
						aria-invalid={errors.amount || undefined}
					/>
				</Field>
				<Field label="Name" htmlFor={`${id}-name`}>
					<Input
						id={`${id}-name`}
						name="name"
						maxLength={40}
						defaultValue={commitment.name}
						aria-invalid={errors.name || undefined}
					/>
				</Field>
				<ScheduleFields
					id={id}
					cadence={commitment.cadence}
					dueDate={nextDue}
					inCard={false}
					dueLabel="Next due"
					dueHint="The rest follow from it."
					invalid={errors.dueDate}
				/>
				<PlanScopeField
					month={month}
					current={commitment.amount}
					scope={scope}
					onScopeChange={setScope}
				/>
				<CommitmentFormErrors errors={errors} />
				<Button type="submit" disabled={!hydrated}>
					Save
				</Button>
			</form>
			{/* Apart from Save, as the Bucket sheet's Archive is: it asks first, in an AlertDialog. */}
			<div className="mt-2 flex items-center justify-between gap-3 border-t pt-4">
				<p className="text-[13px] text-muted-foreground">
					Ending takes it out of the Plan from {monthName(month)} on.
				</p>
				<Button
					type="button"
					variant="destructive"
					size="sm"
					disabled={!hydrated}
					onClick={() => setConfirmEnd(true)}
				>
					End
				</Button>
			</div>
			{confirmEnd ? (
				<Confirm
					onConfirm={() => onEnd(commitment.id)}
					onCancel={() => setConfirmEnd(false)}
					confirmLabel={`End ${commitment.name}`}
				>
					{commitment.name} leaves the Plan from {monthName(month)} on. Earlier months keep it.
				</Confirm>
			) : null}
		</div>
	);
}

/** How often a Commitment is due, and one day it's due. */
function ScheduleFields({
	id,
	cadence,
	dueDate,
	inCard = true,
	dueLabel = "Due on",
	dueHint = "Any day it’s due; the rest follow from it.",
	invalid = false,
}: {
	id: string;
	cadence: Cadence;
	dueDate: DayKey;
	inCard?: boolean;
	dueLabel?: string;
	dueHint?: string;
	invalid?: boolean;
}) {
	return (
		<div className="grid gap-3 sm:grid-cols-2">
			<Field label="How often" htmlFor={`${id}-cadence`} className="content-start">
				<NativeSelect
					id={`${id}-cadence`}
					name="cadence"
					defaultValue={cadence}
					className={inCard ? "[&>select]:bg-card" : undefined}
				>
					{CADENCES.map((value) => (
						<option key={value} value={value}>
							{cadenceNames[value]}
						</option>
					))}
				</NativeSelect>
			</Field>
			<Field label={dueLabel} htmlFor={`${id}-due`} className="content-start" hint={dueHint}>
				<Input
					id={`${id}-due`}
					name="dueDate"
					type="date"
					defaultValue={dueDate}
					className={inCard ? "bg-card" : undefined}
					aria-invalid={invalid || undefined}
				/>
			</Field>
		</div>
	);
}

export function AddCommitment({ month }: { month: MonthKey }) {
	const hydrated = useHydrated();
	const id = useId();
	// A fresh ID per Commitment; a retry of the same attempt reuses it, so it's added once.
	const [commitmentId, setCommitmentId] = useState(() => ulid());
	const [errors, setErrors] = useState<CommitmentErrors>({});
	const add = usePlanChange(month, {
		save: (data: CommitmentVariables) => addCommitment({ data }),
		apply: withNewCommitment,
	});

	function onSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const form = event.currentTarget;
		const read = readCommitment(form);
		setErrors(read.errors);
		if (!read.ok) return;
		add.mutate({ commitmentId, month, ...read.terms });
		// The Commitment shows at once; the next one gets its own ID.
		setCommitmentId(ulid());
		form.reset();
	}

	return (
		<Card>
			<form
				onSubmit={onSubmit}
				noValidate
				aria-label="Add a Commitment"
				className="grid gap-3 p-(--card-pad)"
			>
				<div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem]">
					<Field label="New Commitment" htmlFor={`${id}-name`}>
						<Input
							id={`${id}-name`}
							name="name"
							maxLength={40}
							autoComplete="off"
							placeholder="Mortgage"
							aria-invalid={errors.name || undefined}
						/>
					</Field>
					<Field label="Amount due" htmlFor={`${id}-amount`}>
						<Input
							id={`${id}-amount`}
							name="amount"
							inputMode="decimal"
							autoComplete="off"
							placeholder="0"
							className="tabular-nums"
							aria-invalid={errors.amount || undefined}
						/>
					</Field>
				</div>
				<ScheduleFields
					id={id}
					cadence="monthly"
					dueDate={`${month}-01` as DayKey}
					inCard={false}
					invalid={errors.dueDate}
				/>
				<CommitmentFormErrors errors={errors} />
				<SaveFailed change={add} />
				<Button
					type="submit"
					variant="secondary"
					className="justify-self-start"
					disabled={!hydrated}
				>
					<Plus />
					Add Commitment
				</Button>
			</form>
		</Card>
	);
}
