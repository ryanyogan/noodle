import { type For, type Plan, parseDollars, splitRemainder } from "@noodle/domain";
import { Button } from "@noodle/ui/components/button";
import { Field, FormError } from "@noodle/ui/components/field";
import { Input } from "@noodle/ui/components/input";
import { List, ListRow } from "@noodle/ui/components/list";
import { Sheet, SheetContent, SheetHeader } from "@noodle/ui/components/sheet";
import { cn } from "@noodle/ui/lib/utils";
import { useHydrated } from "@tanstack/react-router";
import { Plus, Split as SplitIcon, Trash2, X } from "lucide-react";
import { type FormEvent, type ReactNode, useState } from "react";
import { ulid } from "ulid";
import { dayName, formatMoney, formatMoneyInput } from "../format";
import { forLabel, type MemberSummary } from "../members";
import type {
	Assignment,
	SplitEdit,
	SplitRow,
	TransactionChange,
	TransactionRow,
} from "../transactions";
import { ForPicker } from "./for-picker";
import { MatchSection } from "./match-section";
import { NativeSelect } from "./native-select";
import { Confirm } from "./plan-editing";

/** An assignment as a select's value: "bucket:ID" or "commitment:ID". */
const assignmentValue = (row: Pick<SplitRow, "bucketId" | "commitmentId">) =>
	row.bucketId
		? `bucket:${row.bucketId}`
		: row.commitmentId
			? `commitment:${row.commitmentId}`
			: "";

function assignmentOf(value: string): Assignment | null {
	const [kind, id] = value.split(":");
	if (!id) return null;
	return kind === "bucket" ? { bucketId: id } : { commitmentId: id };
}

/** A Split being edited: its amount as typed, its assignment as a select's value, and For. */
type DraftSplit = { id: string; amount: string; assignment: string; for: For };

const draftOf = (split: SplitRow): DraftSplit => ({
	id: split.id,
	amount: formatMoneyInput(split.amountCents),
	assignment: assignmentValue(split),
	for: split.for,
});

const blankSplit = (amount = ""): DraftSplit => ({
	id: ulid(),
	amount,
	assignment: "",
	for: [],
});

/**
 * Edits a Transaction's amount, what it's assigned to, who it was For, and its note, or deletes
 * it. It can instead be split into Splits, each with its own amount, assignment, and For, which
 * must add up to the amount before it saves. Saving or deleting closes the sheet at once; the
 * change itself is applied optimistically by the caller. One partly in the other Parent's
 * Personal Allowance is theirs alone to change (ADR-0003), so it's only shown.
 */
export function TransactionEditor({
	transaction,
	today,
	plan,
	members,
	parentId,
	onChange,
	onClose,
}: {
	/** The Transaction being edited; the sheet is open while there is one. */
	transaction: TransactionRow | null;
	today: string;
	plan: Pick<Plan, "buckets" | "commitments">;
	members: MemberSummary[];
	/** The Parent looking. */
	parentId: string;
	onChange: (next: TransactionChange["next"]) => void;
	onClose: () => void;
}) {
	return (
		<Sheet open={transaction !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
			<SheetContent>
				{transaction?.partlyPrivate ? (
					<>
						<SheetHeader title="Transaction" description={dayName(transaction.date, today)} />
						<PartlyPrivate
							transaction={transaction}
							plan={plan}
							members={members}
							parentId={parentId}
						/>
					</>
				) : transaction ? (
					<>
						<SheetHeader title="Edit Transaction" description={dayName(transaction.date, today)} />
						<EditForm
							// A fresh form for each Transaction opened.
							key={transaction.id}
							transaction={transaction}
							plan={plan}
							members={members}
							onChange={onChange}
							onClose={onClose}
						/>
					</>
				) : null}
			</SheetContent>
		</Sheet>
	);
}

/**
 * A Transaction partly in the other Parent's Personal Allowance: the Splits this Parent may see,
 * and why they can't change it. Nothing about the private part, which never reached this client.
 */
function PartlyPrivate({
	transaction,
	plan,
	members,
	parentId,
}: {
	transaction: TransactionRow;
	plan: Pick<Plan, "buckets" | "commitments">;
	members: MemberSummary[];
	parentId: string;
}) {
	const owner =
		members.find((member) => member.kind === "parent" && member.id !== parentId)?.name ??
		"the other Parent";
	const assignedTo = (split: SplitRow) =>
		(split.bucketId && plan.buckets.find((bucket) => bucket.id === split.bucketId)?.name) ||
		(split.commitmentId &&
			plan.commitments.find((commitment) => commitment.id === split.commitmentId)?.name) ||
		split.goal?.name ||
		"Unassigned";
	return (
		<div className="grid gap-4">
			<p className="text-sm text-muted-foreground">
				Part of this is in {owner}’s Personal Allowance, so only {owner} can change it.
			</p>
			<List>
				{transaction.splits.map((split) => (
					<ListRow
						key={split.id}
						title={assignedTo(split)}
						meta={`For ${forLabel(members, split.for)}`}
						trailing={
							<span className="text-sm font-semibold tabular-nums">
								{formatMoney(split.amountCents)}
							</span>
						}
					/>
				))}
			</List>
		</div>
	);
}

function EditForm({
	transaction,
	plan,
	members,
	onChange,
	onClose,
}: {
	transaction: TransactionRow;
	plan: Pick<Plan, "buckets" | "commitments">;
	members: MemberSummary[];
	onChange: (next: TransactionChange["next"]) => void;
	onClose: () => void;
}) {
	const hydrated = useHydrated();
	const [amount, setAmount] = useState(formatMoneyInput(transaction.amountCents));
	const [assignment, setAssignment] = useState(assignmentValue(transaction));
	const [forMemberIds, setForMemberIds] = useState(transaction.for);
	// The Splits while it's split; null while it's assigned as a whole.
	const [splits, setSplits] = useState<DraftSplit[] | null>(
		transaction.splits.length > 0 ? transaction.splits.map(draftOf) : null,
	);
	const [invalid, setInvalid] = useState<"amount" | "assignment" | "splits" | null>(null);
	const [confirmDelete, setConfirmDelete] = useState(false);
	const amountCents = parseDollars(amount);
	const remainder =
		splits && amountCents
			? splitRemainder(
					amountCents,
					splits.map((split) => ({ amount: parseDollars(split.amount) ?? 0 })),
				)
			: null;

	function split() {
		// The whole assignment and For become the first Split's, to be given part of the amount.
		setSplits([{ ...blankSplit(), assignment, for: forMemberIds }, blankSplit()]);
		setInvalid(null);
	}

	function unsplit() {
		const [first] = splits ?? [];
		if (first) {
			setAssignment(first.assignment);
			setForMemberIds(first.for);
		}
		setSplits(null);
		setInvalid(null);
	}

	function changeSplit(index: number, change: Partial<DraftSplit>) {
		setSplits((current) =>
			current
				? current.map((split, i) => (i === index ? { ...split, ...change } : split))
				: current,
		);
	}

	function save(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const note = String(new FormData(event.currentTarget).get("note") ?? "").trim() || null;
		if (!amountCents) return setInvalid("amount");
		if (splits) {
			const edits: SplitEdit[] = [];
			for (const split of splits) {
				const splitCents = parseDollars(split.amount);
				const splitAssignment = assignmentOf(split.assignment);
				if (!splitCents || !splitAssignment) return setInvalid("splits");
				edits.push({
					id: split.id,
					amountCents: splitCents,
					assignment: splitAssignment,
					forMemberIds: [...split.for].sort(),
				});
			}
			if (remainder !== 0) return setInvalid("splits");
			return onChange({ amountCents, note, splits: edits });
		}
		const whole = assignmentOf(assignment);
		if (!whole) return setInvalid("assignment");
		onChange({ amountCents, assignment: whole, note, forMemberIds: [...forMemberIds].sort() });
	}

	const choices = (
		<>
			<optgroup label="Buckets">
				{plan.buckets.map((bucket) => (
					<option key={bucket.id} value={`bucket:${bucket.id}`}>
						{bucket.name}
					</option>
				))}
			</optgroup>
			{plan.commitments.length > 0 ? (
				<optgroup label="Commitments">
					{plan.commitments.map((commitment) => (
						<option key={commitment.id} value={`commitment:${commitment.id}`}>
							{commitment.name}
						</option>
					))}
				</optgroup>
			) : null}
		</>
	);

	return (
		<form onSubmit={save} className="grid gap-4">
			<div className="grid gap-3 sm:grid-cols-2">
				<Field label="Amount" htmlFor="transaction-amount">
					<Input
						id="transaction-amount"
						name="amount"
						inputMode="decimal"
						autoComplete="off"
						required
						disabled={!hydrated}
						value={amount}
						onChange={(event) => setAmount(event.currentTarget.value)}
						className="tabular-nums"
						aria-invalid={invalid === "amount" || undefined}
					/>
				</Field>
				{splits ? null : (
					<Field label="Assigned to" htmlFor="transaction-assignment">
						<NativeSelect
							id="transaction-assignment"
							name="assignment"
							required
							disabled={!hydrated}
							value={assignment}
							onChange={(event) => setAssignment(event.currentTarget.value)}
							aria-invalid={invalid === "assignment" || undefined}
						>
							{assignment === "" ? (
								<option value="" disabled>
									Choose a Bucket
								</option>
							) : null}
							{choices}
						</NativeSelect>
					</Field>
				)}
			</div>
			{invalid === "amount" ? (
				<FormError>Enter the amount in dollars, like 12 or 85.50.</FormError>
			) : null}
			{invalid === "assignment" ? (
				<FormError>Choose the Bucket or Commitment it belongs to.</FormError>
			) : null}
			{splits ? (
				<div className="grid gap-3">
					{splits.map((split, index) => (
						<SplitFields
							key={split.id}
							index={index}
							split={split}
							members={members}
							disabled={!hydrated}
							invalid={invalid === "splits"}
							onChange={(change) => changeSplit(index, change)}
							onRemove={
								splits.length > 2
									? () => setSplits(splits.filter((_, i) => i !== index))
									: undefined
							}
						>
							{choices}
						</SplitFields>
					))}
					<div className="flex flex-wrap items-center gap-2">
						<Button
							type="button"
							variant="secondary"
							size="sm"
							disabled={!hydrated}
							onClick={() =>
								setSplits([
									...splits,
									blankSplit(remainder && remainder > 0 ? formatMoneyInput(remainder) : ""),
								])
							}
						>
							<Plus />
							Add Split
						</Button>
						<Button type="button" variant="ghost" size="sm" disabled={!hydrated} onClick={unsplit}>
							Remove Splits
						</Button>
						<Remainder remainder={remainder} />
					</div>
					{invalid === "splits" ? (
						<FormError>
							{remainder === 0
								? "Give each Split an amount and choose what it belongs to."
								: "Splits must add up to the Transaction’s amount."}
						</FormError>
					) : null}
				</div>
			) : (
				<>
					<ForPicker members={members} value={forMemberIds} onChange={setForMemberIds} multiple />
					<Button
						type="button"
						variant="secondary"
						size="sm"
						className="justify-self-start"
						disabled={!hydrated}
						onClick={split}
					>
						<SplitIcon />
						Split
					</Button>
				</>
			)}
			<Field label="Note" htmlFor="transaction-note">
				<Input
					id="transaction-note"
					name="note"
					maxLength={80}
					autoComplete="off"
					placeholder="Add a note (optional)"
					defaultValue={transaction.note ?? ""}
				/>
			</Field>
			<MatchSection transaction={transaction} onDone={onClose} />
			{confirmDelete ? (
				<Confirm
					confirmLabel="Delete Transaction"
					onConfirm={() => onChange(null)}
					onCancel={() => setConfirmDelete(false)}
				>
					It comes out of this month’s spending everywhere.
				</Confirm>
			) : null}
			<div className="flex items-center gap-2">
				<Button type="button" variant="ghost" onClick={() => setConfirmDelete(true)}>
					<Trash2 />
					Delete
				</Button>
				<Button
					type="submit"
					className="ms-auto"
					disabled={!hydrated || (splits !== null && remainder !== 0)}
				>
					Save
				</Button>
			</div>
		</form>
	);
}

/** One Split's amount, assignment, and For. */
function SplitFields({
	index,
	split,
	members,
	disabled,
	invalid,
	onChange,
	onRemove,
	children,
}: {
	index: number;
	split: DraftSplit;
	members: MemberSummary[];
	disabled: boolean;
	/** Whether the form was refused for its Splits, so an incomplete one is flagged. */
	invalid: boolean;
	onChange: (change: Partial<DraftSplit>) => void;
	/** Removes this Split; absent while there are only two. */
	onRemove?: () => void;
	/** The select's options. */
	children: ReactNode;
}) {
	const id = `split-${split.id}`;
	const name = `Split ${index + 1}`;
	return (
		<fieldset className="relative grid gap-3 rounded-2xl border border-border p-3">
			<legend className="float-left h-7 text-xs leading-7 font-medium text-muted-foreground">
				{name}
			</legend>
			{onRemove ? (
				<Button
					type="button"
					variant="ghost"
					size="icon-sm"
					className="absolute top-3 right-3"
					aria-label={`Remove ${name}`}
					onClick={onRemove}
				>
					<X />
				</Button>
			) : null}
			<div className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-3">
				<Field label="Amount" htmlFor={`${id}-amount`}>
					<Input
						id={`${id}-amount`}
						inputMode="decimal"
						autoComplete="off"
						placeholder="0.00"
						disabled={disabled}
						value={split.amount}
						onChange={(event) => onChange({ amount: event.currentTarget.value })}
						className="tabular-nums"
						aria-invalid={(invalid && !parseDollars(split.amount)) || undefined}
					/>
				</Field>
				<Field label="Assigned to" htmlFor={`${id}-assignment`}>
					<NativeSelect
						id={`${id}-assignment`}
						disabled={disabled}
						value={split.assignment}
						onChange={(event) => onChange({ assignment: event.currentTarget.value })}
						aria-invalid={(invalid && !split.assignment) || undefined}
					>
						<option value="" disabled>
							Choose…
						</option>
						{children}
					</NativeSelect>
				</Field>
			</div>
			<ForPicker
				members={members}
				value={split.for}
				onChange={(value) => onChange({ for: value })}
				multiple
			/>
		</fieldset>
	);
}

/** How much of the amount the Splits leave to assign, updated as the Parent types. */
function Remainder({ remainder }: { remainder: number | null }) {
	return (
		<p
			role="status"
			className={cn(
				"ms-auto text-[13px] tabular-nums",
				remainder === 0 ? "text-muted-foreground" : "font-medium text-foreground",
				remainder !== null && remainder < 0 && "text-over",
			)}
		>
			{remainder === null
				? "Enter the amount first"
				: remainder === 0
					? "All assigned"
					: remainder > 0
						? `${formatMoney(remainder)} left to assign`
						: `${formatMoney(-remainder)} too much`}
		</p>
	);
}
