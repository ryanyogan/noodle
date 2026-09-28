import { type Plan, parseDollars } from "@noodle/domain";
import { Button } from "@noodle/ui/components/button";
import { Field, FormError } from "@noodle/ui/components/field";
import { Input } from "@noodle/ui/components/input";
import { Sheet, SheetContent, SheetHeader } from "@noodle/ui/components/sheet";
import { Trash2 } from "lucide-react";
import { type FormEvent, useState } from "react";
import { dayName, formatMoneyInput } from "../format";
import type { MemberSummary } from "../members";
import type { Assignment, TransactionChange, TransactionRow } from "../transactions";
import { ForPicker } from "./for-picker";
import { NativeSelect } from "./native-select";
import { Confirm } from "./plan-editing";

/** An assignment as a select's value: "bucket:ID" or "commitment:ID". */
const assignmentValue = (row: Pick<TransactionRow, "bucketId" | "commitmentId">) =>
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

/**
 * Edits a Transaction's amount, what it's assigned to, who it was For, and its note, or deletes
 * it. Saving or deleting closes the sheet at once; the change itself is applied optimistically by
 * the caller.
 */
export function TransactionEditor({
	transaction,
	today,
	plan,
	members,
	onChange,
	onClose,
}: {
	/** The Transaction being edited; the sheet is open while there is one. */
	transaction: TransactionRow | null;
	today: string;
	plan: Pick<Plan, "buckets" | "commitments">;
	members: MemberSummary[];
	onChange: (next: TransactionChange["next"]) => void;
	onClose: () => void;
}) {
	return (
		<Sheet open={transaction !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
			<SheetContent>
				{transaction ? (
					<>
						<SheetHeader title="Edit Transaction" description={dayName(transaction.date, today)} />
						<EditForm
							// A fresh form for each Transaction opened.
							key={transaction.id}
							transaction={transaction}
							plan={plan}
							members={members}
							onChange={onChange}
						/>
					</>
				) : null}
			</SheetContent>
		</Sheet>
	);
}

function EditForm({
	transaction,
	plan,
	members,
	onChange,
}: {
	transaction: TransactionRow;
	plan: Pick<Plan, "buckets" | "commitments">;
	members: MemberSummary[];
	onChange: (next: TransactionChange["next"]) => void;
}) {
	const [forMemberIds, setForMemberIds] = useState(transaction.for);
	const [invalid, setInvalid] = useState<"amount" | "assignment" | null>(null);
	const [confirmDelete, setConfirmDelete] = useState(false);

	function save(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const values = new FormData(event.currentTarget);
		const amountCents = parseDollars(String(values.get("amount") ?? ""));
		const assignment = assignmentOf(String(values.get("assignment") ?? ""));
		if (!amountCents) return setInvalid("amount");
		if (!assignment) return setInvalid("assignment");
		const note = String(values.get("note") ?? "").trim() || null;
		onChange({ amountCents, assignment, note, forMemberIds: [...forMemberIds].sort() });
	}

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
						defaultValue={formatMoneyInput(transaction.amountCents)}
						className="tabular-nums"
						aria-invalid={invalid === "amount" || undefined}
					/>
				</Field>
				<Field label="Assigned to" htmlFor="transaction-assignment">
					<NativeSelect
						id="transaction-assignment"
						name="assignment"
						required
						defaultValue={assignmentValue(transaction)}
						aria-invalid={invalid === "assignment" || undefined}
					>
						{assignmentValue(transaction) === "" ? (
							<option value="" disabled>
								Choose a Bucket
							</option>
						) : null}
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
					</NativeSelect>
				</Field>
			</div>
			{invalid === "amount" ? (
				<FormError>Enter the amount in dollars, like 12 or 85.50.</FormError>
			) : null}
			{invalid === "assignment" ? (
				<FormError>Choose the Bucket or Commitment it belongs to.</FormError>
			) : null}
			<ForPicker members={members} value={forMemberIds} onChange={setForMemberIds} multiple />
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
				<Button type="submit" className="ms-auto">
					Save
				</Button>
			</div>
		</form>
	);
}
