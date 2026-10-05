import { Button } from "@noodle/ui/components/button";
import { Input } from "@noodle/ui/components/input";
import type { ChoiceGroup } from "@noodle/ui/components/select";
import { ChevronDown, Pencil } from "lucide-react";
import { useEffect, useRef } from "react";
import { assignedValue, cellName, NAME_MAX } from "../transaction-cells";
import { type TransactionRow, useEditFormKey } from "../transactions";
import { BucketPicker } from "./bucket-picker";

// Editing in a cell of the Transactions table (issue 99). A cell is plain words and a quiet
// button until it is asked for, so a long month's rows stay cheap; one cell edits at a time
// (the table keeps which). Only where the table shows columns: stacked rows (a phone) edit in
// the row's sheet as before.

/** The cell being edited: which Transaction's, and which column. */
export type CellEditing = { id: string; column: "name" | "assigned" } | null;

/** What the cells need from the table. */
export type CellEdits = {
	editing: CellEditing;
	start: (transaction: TransactionRow, column: "name" | "assigned") => void;
	/** The edit is over. `refocus`: it ended from the keyboard, so focus goes back to the cell. */
	stop: (refocus: boolean) => void;
	rename: (transaction: TransactionRow, typed: string) => void;
	refile: (transaction: TransactionRow, value: string) => void;
	/** "Create Bucket" in the picker: asks for a new Bucket to file the Transaction in. */
	create: (transaction: TransactionRow, name: string) => void;
	/** The month's Buckets and Commitments this Parent can assign to. */
	choices: ChoiceGroup[];
};

// Quiet until the row is pointed at or holds focus; always there where nothing hovers (a tablet).
const quiet =
	"opacity-0 focus-visible:opacity-100 [[data-slot=list-row]:hover_&]:opacity-100 [[data-slot=list-row]:focus-within_&]:opacity-100 [@media(hover:none)]:opacity-100";

/** The pencil at the end of a Name cell: starts the rename. Not on stacked rows. */
export function RenameButton({ title, onClick }: { title: string; onClick: () => void }) {
	return (
		<Button
			type="button"
			variant="ghost"
			size="icon-sm"
			data-cell="name"
			aria-label={`Rename ${title}`}
			className={`hidden shrink-0 text-subtle-foreground @2xl/dt:inline-flex ${quiet}`}
			onClick={onClick}
		>
			<Pencil aria-hidden="true" className="size-3.5" />
		</Button>
	);
}

/**
 * The Name cell's field: Enter or leaving it saves, Esc gives up. If another screen changes the
 * Transaction meanwhile it starts again from the fresh name (and says so), as the row's form does.
 */
export function NameEditor({
	transaction,
	title,
	onSave,
	onCancel,
}: {
	transaction: TransactionRow;
	title: string;
	/** `byKey`: Enter, not leaving the field. */
	onSave: (typed: string, byKey: boolean) => void;
	onCancel: () => void;
}) {
	const key = useEditFormKey(transaction);
	return (
		<NameField
			key={key}
			label={`Name of ${title}`}
			value={cellName(transaction)}
			onSave={onSave}
			onCancel={onCancel}
		/>
	);
}

function NameField({
	label,
	value,
	onSave,
	onCancel,
}: {
	label: string;
	value: string;
	onSave: (typed: string, byKey: boolean) => void;
	onCancel: () => void;
}) {
	const field = useRef<HTMLInputElement>(null);
	// Enter and Esc take the field away, which may or may not blur it first: one ending only.
	const over = useRef(false);
	const end = (run: () => void) => {
		if (over.current) return;
		over.current = true;
		run();
	};
	useEffect(() => {
		field.current?.focus();
		field.current?.select();
	}, []);
	return (
		<Input
			ref={field}
			data-cell-editor=""
			aria-label={label}
			defaultValue={value}
			maxLength={NAME_MAX}
			autoComplete="off"
			className="min-w-0 flex-1"
			onKeyDown={(event) => {
				const typed = event.currentTarget.value;
				if (event.key === "Enter") {
					event.preventDefault();
					end(() => onSave(typed, true));
				} else if (event.key === "Escape") {
					event.preventDefault();
					event.stopPropagation();
					end(onCancel);
				}
			}}
			onBlur={(event) => {
				const typed = event.currentTarget.value;
				end(() => onSave(typed, false));
			}}
		/>
	);
}

/**
 * The Assigned to cell of a row that can be refiled here: its words as a quiet button, and once
 * pressed the Bucket picker, open, in its place.
 */
export function AssignedCell({
	transaction,
	title,
	assigned,
	cells,
}: {
	transaction: TransactionRow;
	title: string;
	assigned: string;
	cells: CellEdits;
}) {
	const editing = cells.editing?.id === transaction.id && cells.editing.column === "assigned";
	if (editing) {
		return (
			// biome-ignore lint/a11y/noStaticElementInteractions: it takes no clicks of its own, it only keeps the list's from the row
			// biome-ignore lint/a11y/useKeyWithClickEvents: as above: nothing here is pressed
			<span
				data-cell-editor=""
				className="min-w-0 flex-1"
				// The list is drawn outside the row, but its clicks still come up through it: a
				// choice made there is not a click on the row.
				onClick={(event) => event.stopPropagation()}
			>
				<BucketPicker
					defaultOpen
					value={assignedValue(transaction)}
					className="w-full"
					placeholder="Unassigned"
					searchPlaceholder="Search or create"
					aria-label={`File ${title} in`}
					choices={cells.choices}
					onClose={() => cells.stop(true)}
					onValueChange={(value) => cells.refile(transaction, value)}
					onCreate={(name) => cells.create(transaction, name)}
				/>
			</span>
		);
	}
	return (
		<Button
			type="button"
			variant="ghost"
			size="sm"
			data-cell="assigned"
			aria-label={`Refile ${title}, now ${assigned}`}
			aria-haspopup="dialog"
			className="-mx-2 max-w-full min-w-0 justify-start gap-1 px-2 font-normal max-lg:min-w-0"
			onClick={() => cells.start(transaction, "assigned")}
		>
			<span className="truncate">{assigned}</span>
			<ChevronDown
				aria-hidden="true"
				className={`size-3.5 shrink-0 text-subtle-foreground ${quiet}`}
			/>
		</Button>
	);
}
