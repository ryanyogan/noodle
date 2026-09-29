import {
	CADENCES,
	type Cadence,
	type CommitmentState,
	type DayKey,
	type MonthKey,
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
import { Pencil, Plus, X } from "lucide-react";
import { type FormEvent, useId, useState } from "react";
import { ulid } from "ulid";
import { monogram } from "../buckets";
import {
	type CommitmentVariables,
	cadenceNames,
	schedule,
	withCommitment,
	withNewCommitment,
} from "../commitments";
import { formatMoney, formatMoneyInput, monthName } from "../format";
import { usePlanChange } from "../plan-changes";
import { addCommitment, updateCommitment } from "../server/commitments";
import { AmountInput } from "./goals";
import { Confirm, SaveFailed } from "./plan-editing";
import { ChangedNote, PlanScopeField } from "./plan-scope-field";

const isCadence = (value: unknown): value is Cadence => CADENCES.includes(value as Cadence);
const isDay = (value: unknown): value is DayKey =>
	typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);

/**
 * A Commitment in the Plan: its amount, and an Edit sheet to change its terms or end it. `was`
 * is its amount the month before, when this month changed it.
 */
export function CommitmentEditor({
	month,
	commitment,
	editable,
	was,
	onEnd,
}: {
	month: MonthKey;
	commitment: CommitmentState;
	editable: boolean;
	was?: number;
	onEnd: (commitmentId: string) => void;
}) {
	const hydrated = useHydrated();
	const [open, setOpen] = useState(false);
	const change = usePlanChange(month, {
		save: (data: CommitmentVariables) => updateCommitment({ data }),
		apply: withCommitment,
	});
	return (
		<ListRow
			leading={<Tile>{monogram(commitment.name)}</Tile>}
			title={commitment.name}
			meta={
				<>
					<span>
						{schedule(commitment, month)}
						{commitment.dueDates.length > 1
							? ` · ${formatMoney(commitment.expected)} this month`
							: ""}
					</span>
					<ChangedNote was={was} />
				</>
			}
			trailing={
				<div className="flex items-center gap-1">
					<span className="text-sm font-medium tabular-nums">{formatMoney(commitment.amount)}</span>
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
					<Sheet open={open} onOpenChange={setOpen}>
						{open ? (
							<SheetContent>
								<SheetHeader title={commitment.name} description="Commitment" />
								<CommitmentDetails
									month={month}
									commitment={commitment}
									onSave={(terms) => {
										setOpen(false);
										change.mutate({ commitmentId: commitment.id, month, ...terms });
									}}
									onEnd={(commitmentId) => {
										setOpen(false);
										onEnd(commitmentId);
									}}
								/>
							</SheetContent>
						) : null}
					</Sheet>
				</div>
			}
			below={change.isError ? <SaveFailed change={change} /> : undefined}
		/>
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
	commitment: CommitmentState;
	onSave: (terms: Omit<CommitmentVariables, "commitmentId" | "month">) => void;
	onEnd: (commitmentId: string) => void;
}) {
	const hydrated = useHydrated();
	const id = useId();
	const [confirmEnd, setConfirmEnd] = useState(false);
	const [scope, setScope] = useState<PlanScope>("from-on");
	const [invalidAmount, setInvalidAmount] = useState(false);

	function save(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const values = new FormData(event.currentTarget);
		const name = String(values.get("name") ?? "").trim();
		const amountCents = parseDollars(String(values.get("amount") ?? ""));
		const cadence = values.get("cadence");
		const dueDate = values.get("dueDate");
		setInvalidAmount(amountCents === null);
		if (!name || amountCents === null || !isCadence(cadence) || !isDay(dueDate)) return;
		onSave({ name, amountCents, cadence, dueDate, scope });
	}

	return (
		<div className="grid gap-4">
			<form onSubmit={save} className="grid gap-4">
				<Field label="Amount" htmlFor={`${id}-amount`}>
					<AmountInput
						id={`${id}-amount`}
						name="amount"
						required
						placeholder="0"
						defaultValue={formatMoneyInput(commitment.amount)}
						aria-invalid={invalidAmount || undefined}
					/>
				</Field>
				{invalidAmount ? (
					<FormError>Enter the amount as a dollar amount, like 1,800 or 15.99.</FormError>
				) : null}
				<Field label="Name" htmlFor={`${id}-name`}>
					<Input
						id={`${id}-name`}
						name="name"
						required
						maxLength={40}
						defaultValue={commitment.name}
					/>
				</Field>
				<ScheduleFields
					id={id}
					cadence={commitment.cadence}
					dueDate={commitment.dueDate}
					inCard={false}
				/>
				<PlanScopeField
					month={month}
					current={commitment.amount}
					scope={scope}
					onScopeChange={setScope}
				/>
				<div className="flex flex-wrap items-center gap-2">
					<Button type="submit" disabled={!hydrated}>
						Save
					</Button>
					<Button
						type="button"
						variant="ghost"
						className="ms-auto"
						disabled={!hydrated}
						onClick={() => setConfirmEnd(true)}
					>
						<X />
						End
					</Button>
				</div>
			</form>
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
}: {
	id: string;
	cadence: Cadence;
	dueDate: DayKey;
	inCard?: boolean;
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
			<Field
				label="Due on"
				htmlFor={`${id}-due`}
				className="content-start"
				hint="Any day it’s due; the rest follow from it."
			>
				<Input
					id={`${id}-due`}
					name="dueDate"
					type="date"
					required
					defaultValue={dueDate}
					className={inCard ? "bg-card" : undefined}
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
	const [invalidAmount, setInvalidAmount] = useState(false);
	const add = usePlanChange(month, {
		save: (data: CommitmentVariables) => addCommitment({ data }),
		apply: withNewCommitment,
	});

	function onSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const form = event.currentTarget;
		const values = new FormData(form);
		const name = String(values.get("name") ?? "").trim();
		const amountCents = parseDollars(String(values.get("amount") ?? ""));
		const cadence = values.get("cadence");
		const dueDate = values.get("dueDate");
		setInvalidAmount(amountCents === null);
		if (!name || amountCents === null || !isCadence(cadence) || !isDay(dueDate)) return;
		add.mutate({ commitmentId, month, name, amountCents, cadence, dueDate });
		// The Commitment shows at once; the next one gets its own ID.
		setCommitmentId(ulid());
		form.reset();
	}

	return (
		<Card>
			<form onSubmit={onSubmit} aria-label="Add a Commitment" className="grid gap-3 p-(--card-pad)">
				<div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem]">
					<Field label="New Commitment" htmlFor={`${id}-name`}>
						<Input
							id={`${id}-name`}
							name="name"
							required
							maxLength={40}
							autoComplete="off"
							placeholder="Mortgage"
						/>
					</Field>
					<Field label="Amount due" htmlFor={`${id}-amount`}>
						<Input
							id={`${id}-amount`}
							name="amount"
							required
							inputMode="decimal"
							autoComplete="off"
							placeholder="0"
							className="tabular-nums"
							aria-invalid={invalidAmount || undefined}
						/>
					</Field>
				</div>
				<ScheduleFields
					id={id}
					cadence="monthly"
					dueDate={`${month}-01` as DayKey}
					inCard={false}
				/>
				{invalidAmount ? (
					<FormError>Enter the amount as a dollar amount, like 1,800 or 15.99.</FormError>
				) : null}
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
