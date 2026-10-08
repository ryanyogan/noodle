import {
	cleanMerchant,
	type DayKey,
	type For,
	type Plan,
	parseDollars,
	splitRemainder,
} from "@noodle/domain";
import { Button } from "@noodle/ui/components/button";
import { Combobox } from "@noodle/ui/components/combobox";
import { DatePicker } from "@noodle/ui/components/date-picker";
import { Field, FormError } from "@noodle/ui/components/field";
import { Input } from "@noodle/ui/components/input";
import { List, ListRow } from "@noodle/ui/components/list";
import type { Choices } from "@noodle/ui/components/select";
import {
	Sheet,
	SheetCancel,
	SheetContent,
	SheetFooter,
	SheetHeader,
} from "@noodle/ui/components/sheet";
import { cn } from "@noodle/ui/lib/utils";
import { useHydrated } from "@tanstack/react-router";
import { Clock, Plus, Sparkles, Split as SplitIcon, Trash2, X } from "lucide-react";
import { type FormEvent, type ReactNode, useRef, useState } from "react";
import { ulid } from "ulid";
import { cantSaveSentence, isUnassigned, noSplitSentence, nothingToFileIn } from "../before-plan";
import { dayName, formatMoney, formatMoneyInput, shortDay } from "../format";
import { forLabel, type MemberSummary } from "../members";
import type { ReviewItem } from "../review";
import { PENDING_MEANS } from "../transaction-row";
import type {
	Assignment,
	SplitEdit,
	SplitRow,
	TransactionEdit,
	TransactionRow,
} from "../transactions";
import { monthOfTransaction, nameGiven, nameOf, useEditFormKey } from "../transactions";
import { BankTookBackNote } from "./bank-took-back-note";
import { ForPicker } from "./for-picker";
import { AmountInput } from "./goals";
import { MatchSection } from "./match-section";
import { MoneyDetail, TransferSection } from "./money-sections";
import { NoBuckets, useFileWithout } from "./no-buckets";
import { Confirm } from "./plan-editing";
import { ReceiptSection } from "./receipt-section";
import { TransactionTreatment } from "./transaction-treatment";

/** Why an imported Transaction is in its Bucket, when categorization put it there. */
const AUTO_FILED: Record<NonNullable<TransactionRow["autoFiled"]>, string> = {
	rule: "Filed automatically by a Rule.",
	similar: "Filed automatically, like this merchant before.",
	model: "Filed automatically, as a best guess.",
};

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
 * Personal Allowance is theirs alone to change (ADR-0003), so it's only shown. A side of a
 * Transfer, or money back, shows its Transfer and Refund link instead.
 */
export function TransactionEditor({
	transaction,
	today,
	plan,
	members,
	parentId,
	onChange,
	onDate,
	onClose,
	splitting = false,
	layout = "side",
	paymentOptions = false,
	review,
}: {
	/** The Transaction being edited; the sheet is open while there is one. */
	transaction: TransactionRow | null;
	today: DayKey;
	plan: Pick<Plan, "buckets" | "commitments">;
	members: MemberSummary[];
	/** The Parent looking. */
	parentId: string;
	onChange: (next: TransactionEdit | null) => void;
	/**
	 * Moves it to another day (issue 148); without this the form has no Date field. `alone`: the
	 * date is all that changed, so nothing else was sent and closing the editor is left to this.
	 */
	onDate?: (date: DayKey, alone: boolean) => void;
	onClose: () => void;
	/** Opens on splitting it, as Review's card's Split does. */
	splitting?: boolean;
	/**
	 * How the sheet sits from lg: down the right edge, beside the list it was opened from, or a
	 * centred dialog where there is no list to keep in view (Review, issue 107).
	 */
	layout?: "side" | "wide";
	paymentOptions?: boolean;
	review?: Pick<ReviewItem, "merchant" | "guess" | "for">;
}) {
	return (
		<Sheet open={transaction !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
			<SheetContent layout={layout}>
				{transaction ? (
					<TransactionBody
						transaction={transaction}
						today={today}
						plan={plan}
						members={members}
						parentId={parentId}
						onChange={onChange}
						onDate={onDate}
						onClose={onClose}
						splitting={splitting}
						paymentOptions={paymentOptions}
						review={review}
						heading={(title, description) => (
							<SheetHeader title={title} description={description} />
						)}
					/>
				) : null}
			</SheetContent>
		</Sheet>
	);
}

/**
 * What the editor holds, under the heading its place gives it: the sheet's header, or the detail
 * pane's beside the Transactions list (`inline`, where Cancel closes the pane itself).
 */
export function TransactionBody({
	transaction,
	today,
	plan,
	members,
	parentId,
	onChange,
	onDate,
	onClose,
	heading,
	inline = false,
	wide = false,
	paymentOptions = false,
	review,
	splitting = false,
}: {
	transaction: TransactionRow;
	today: DayKey;
	plan: Pick<Plan, "buckets" | "commitments">;
	members: MemberSummary[];
	parentId: string;
	onChange: (next: TransactionEdit | null) => void;
	onDate?: (date: DayKey, alone: boolean) => void;
	onClose: () => void;
	heading: (title: string, description: string) => ReactNode;
	inline?: boolean;
	/** Under its row in the Transactions table (issue 99): two columns once there is room. */
	wide?: boolean;
	paymentOptions?: boolean;
	review?: Pick<ReviewItem, "merchant" | "guess" | "for">;
	/** Opens on splitting it, as Review's card's Split does. */
	splitting?: boolean;
}) {
	const day = dayName(transaction.date, today);
	// Starts the form again, on the fresh values, when another screen changes it meanwhile (#85).
	const formKey = useEditFormKey(transaction);
	if (transaction.partlyPrivate) {
		return (
			<>
				{heading("Transaction", day)}
				<PartlyPrivate
					transaction={transaction}
					plan={plan}
					members={members}
					parentId={parentId}
				/>
			</>
		);
	}
	if (transaction.transfer || transaction.amountCents < 0) {
		return (
			<>
				{heading(transaction.transfer ? "Transfer" : "Money back", day)}
				<BankTookBackNote
					row={{ transactionId: transaction.id }}
					line={transaction}
					today={today}
					className="mb-4"
				/>
				<MoneyDetail key={transaction.id} transaction={transaction} onDone={onClose} />
			</>
		);
	}
	// The type tiles hold the Transfer choices then, so the form doesn't offer them a second time.
	const typed = paymentOptions && !!transaction.importedFrom && transaction.splits.length === 0;
	const editor = (
		<EditForm
			// A fresh form for each Transaction opened.
			key={formKey}
			transaction={transaction}
			plan={plan}
			members={members}
			onChange={onChange}
			onDate={onDate}
			onClose={onClose}
			inline={inline}
			wide={wide}
			today={today}
			splitting={splitting}
			typeChosenAbove={typed}
		/>
	);
	return (
		<>
			{heading("Edit Transaction", day)}
			<BankTookBackNote
				row={{ transactionId: transaction.id }}
				line={transaction}
				today={today}
				className="mb-4"
			/>
			{typed ? (
				<TransactionTreatment
					key={formKey}
					transaction={transaction}
					onDone={onClose}
					review={review}
				>
					{editor}
				</TransactionTreatment>
			) : (
				editor
			)}
		</>
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
	onDate,
	onClose,
	inline,
	wide,
	splitting,
	today,
	typeChosenAbove,
}: {
	transaction: TransactionRow;
	plan: Pick<Plan, "buckets" | "commitments">;
	members: MemberSummary[];
	onChange: (next: TransactionEdit | null) => void;
	onDate?: (date: DayKey, alone: boolean) => void;
	onClose: () => void;
	/** The type tiles are above the form: they offer Transfer and Between us, so it doesn't. */
	typeChosenAbove: boolean;
	/** In a pane, not a sheet: Cancel closes the pane. */
	inline: boolean;
	/** Room for two columns (the row open in the table): the fields, and beside them the rest. */
	wide: boolean;
	splitting: boolean;
	/** The Household's today, for the Match section's Waiting for bank line. */
	today: DayKey;
}) {
	const hydrated = useHydrated();
	// A month before the first Plan has nothing to file in (issue 117): the field says so.
	const ownMonth = monthOfTransaction(transaction);
	const current = today.slice(0, 7) as typeof ownMonth;
	const none = nothingToFileIn(plan, ownMonth, current);
	const fileWithout = useFileWithout();
	const [amount, setAmount] = useState(formatMoneyInput(transaction.amountCents));
	const [assignment, setAssignment] = useState(assignmentValue(transaction));
	const [forMemberIds, setForMemberIds] = useState(transaction.for);
	// The Splits while it's split; null while it's assigned as a whole.
	const [splits, setSplits] = useState<DraftSplit[] | null>(
		transaction.splits.length > 0
			? transaction.splits.map(draftOf)
			: splitting && !none
				? [
						{ ...blankSplit(), assignment: assignmentValue(transaction), for: transaction.for },
						blankSplit(),
					]
				: null,
	);
	const [invalid, setInvalid] = useState<"amount" | "assignment" | "splits" | null>(null);
	const [confirmDelete, setConfirmDelete] = useState(false);
	// One from a bank or a statement has a name apart from the bank's wording (its note), which
	// is kept and shown under it (#95). A by-hand one's name is its note, as the Parent typed it.
	const fromBank = transaction.importedFrom !== null;
	const banksWording = fromBank ? (transaction.note ?? "").trim() : "";
	const banksName = banksWording ? cleanMerchant(banksWording).name : "";
	const calledNow = nameOf(transaction);
	// What the Parent typed as its name; null until they touch the field, which then shows what the
	// line is called now, so a name background naming gives it while the form is open is never
	// taken for theirs (issue 147).
	const [typedName, setName] = useState<string | null>(null);
	const name = typedName ?? calledNow;
	// The day it counts on. One from a bank or a statement keeps the bank's own day, said under the
	// field whenever the two differ, with the way back to it (issue 148).
	const [date, setDate] = useState(transaction.date as DayKey);
	const banksDay = fromBank ? ((transaction.bankDate ?? transaction.date) as DayKey) : null;
	const redated = date !== transaction.date;
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

	const form = useRef<HTMLFormElement>(null);

	/** What the form says now, or null after flagging what's wrong with it. */
	function edited(): TransactionEdit | null {
		const typed = String(form.current ? (new FormData(form.current).get("note") ?? "") : "").trim();
		// The bank's wording is never edited; an emptied name goes back to the bank's.
		const renamed = fromBank ? nameGiven(typedName, calledNow, banksName) : null;
		const note = fromBank ? transaction.note : typed || null;
		const naming = renamed ? { name: renamed } : {};
		if (!amountCents) {
			setInvalid("amount");
			return null;
		}
		if (splits) {
			const edits: SplitEdit[] = [];
			for (const split of splits) {
				const splitCents = parseDollars(split.amount);
				const splitAssignment = assignmentOf(split.assignment);
				if (!splitCents || !splitAssignment) {
					setInvalid("splits");
					return null;
				}
				edits.push({
					id: split.id,
					amountCents: splitCents,
					assignment: splitAssignment,
					forMemberIds: [...split.for].sort(),
				});
			}
			if (remainder !== 0) {
				setInvalid("splits");
				return null;
			}
			return { amountCents, note, ...naming, splits: edits };
		}
		const whole = assignmentOf(assignment);
		if (!whole) {
			setInvalid("assignment");
			return null;
		}
		return {
			amountCents,
			assignment: whole,
			note,
			...naming,
			forMemberIds: [...forMemberIds].sort(),
		};
	}

	/** Whether anything was changed in the form since it opened. */
	function dirty(): boolean {
		const note = String(form.current ? (new FormData(form.current).get("note") ?? "") : "").trim();
		return (
			amount !== formatMoneyInput(transaction.amountCents) ||
			(fromBank
				? nameGiven(typedName, calledNow, banksName) !== null
				: note !== (transaction.note ?? "")) ||
			(splits === null
				? transaction.splits.length > 0 ||
					assignment !== assignmentValue(transaction) ||
					[...forMemberIds].sort().join() !== [...transaction.for].sort().join()
				: transaction.splits.length !== splits.length ||
					splits.some((split, i) => {
						const was = transaction.splits[i];
						return (
							!was ||
							split.amount !== formatMoneyInput(was.amountCents) ||
							split.assignment !== assignmentValue(was) ||
							[...split.for].sort().join() !== [...was.for].sort().join()
						);
					}))
		);
	}

	/**
	 * Before a Match or unmatch, which closes the editor: what was typed is saved with it, so
	 * nothing is lost. False, with what's wrong flagged, when what was typed can't be saved.
	 */
	function saveBeforeMatch(): boolean {
		if (!dirty()) return true;
		const next = edited();
		if (!next) return false;
		onChange(next);
		return true;
	}

	function save(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		// Only its day: nothing else is sent, not its name and not where it's filed, so a line that
		// isn't filed anywhere yet can be moved too (issue 148).
		if (redated && onDate && !dirty()) return onDate(date, true);
		const next = edited();
		if (!next) return;
		onChange(next);
		// After the rest, so the day is changed on the version the edit leaves.
		if (redated) onDate?.(date, false);
	}

	const choices: Choices = [
		{
			label: "Buckets",
			choices: plan.buckets.map((bucket) => ({ value: `bucket:${bucket.id}`, label: bucket.name })),
		},
		...(plan.commitments.length > 0
			? [
					{
						label: "Commitments",
						choices: plan.commitments.map((commitment) => ({
							value: `commitment:${commitment.id}`,
							label: commitment.name,
						})),
					},
				]
			: []),
	];

	return (
		// Checked on Save, with what's wrong said beside it, rather than by the browser's own bubble.
		<form
			ref={form}
			onSubmit={save}
			noValidate
			className={cn(
				"grid gap-4",
				// Under its row, 48rem wide or more: the fields, and beside them the receipt, the match
				// and the Transfer choices, so the form is no taller than it needs to be.
				wide && "@3xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] @3xl:items-start @3xl:gap-x-8",
				// With nothing for the second column (no receipt, match or Transfer to offer) the
				// fields take the table's whole width.
				wide && "@3xl:has-[>[data-slot=editor-more]:empty]:grid-cols-1",
			)}
		>
			<div
				data-slot="editor-fields"
				className={cn(
					"grid min-w-0 gap-4",
					// Wide enough (56rem of table): Name beside Amount and Assigned to, on one line;
					// everything after them (For, Split) runs the fields' whole width under it.
					wide &&
						"@4xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] @4xl:items-start @4xl:gap-x-4 @4xl:*:col-span-full @4xl:[&>*:nth-child(-n+2)]:col-span-1",
				)}
			>
				<div className="grid gap-1.5">
					<Field
						label="Name"
						htmlFor="transaction-name"
						// The line under a field is its hint, here as under Assigned to beside it: the same
						// words, size and distance, so the two fields and their lines sit level (issue 147).
						hint={
							banksWording && name.trim() !== banksWording ? (
								<span className="block min-w-0 break-words">From your bank: {banksWording}</span>
							) : undefined
						}
					>
						{fromBank ? (
							<Input
								id="transaction-name"
								maxLength={80}
								autoComplete="off"
								placeholder={banksName || "Give it a name"}
								value={name}
								onChange={(event) => setName(event.target.value)}
							/>
						) : (
							<Input
								id="transaction-name"
								name="note"
								maxLength={80}
								autoComplete="off"
								placeholder="Add a name (optional)"
								defaultValue={transaction.note ?? ""}
							/>
						)}
					</Field>
					{banksName && name.trim() !== banksName ? (
						<Button
							type="button"
							variant="ghost"
							size="sm"
							// Its words start under the line above, not a button's padding further in.
							className="-ml-2.5 justify-self-start"
							disabled={!hydrated}
							onClick={() => setName(banksName)}
						>
							Use the bank’s name
						</Button>
					) : null}
				</div>
				<div
					// Each field keeps its own height from the top: a hint under one (why it was filed
					// automatically), or the sentence of a month with no Buckets (issue 117), never moves
					// the label or the box of the field beside it (issue 147).
					className="grid items-start gap-4 sm:grid-cols-2"
				>
					<Field
						label="Amount"
						htmlFor="transaction-amount"
						// A pending Transaction says so in words here: the row's clock explains itself only
						// on hover, which a phone doesn't have. Under the Amount, since that is what may
						// still change (issue 147).
						hint={
							transaction.pending ? (
								<span className="inline-flex items-center gap-1" data-testid="pending-hint">
									<Clock aria-hidden="true" className="size-3 shrink-0" />
									{PENDING_MEANS}
								</span>
							) : undefined
						}
					>
						<AmountInput
							id="transaction-amount"
							name="amount"
							required
							disabled={!hydrated}
							value={amount}
							onChange={(event) => setAmount(event.currentTarget.value)}
							aria-invalid={invalid === "amount" || undefined}
						/>
					</Field>
					{splits ? null : (
						<Field
							label="Assigned to"
							htmlFor="transaction-assignment"
							hint={
								transaction.autoFiled && assignment === assignmentValue(transaction) ? (
									<span className="inline-flex items-center gap-1" data-testid="auto-filed-hint">
										<Sparkles aria-hidden="true" className="size-3 shrink-0" />
										{AUTO_FILED[transaction.autoFiled]} Change it if it’s wrong.
									</span>
								) : undefined
							}
						>
							{none ? (
								<NoBuckets
									id="transaction-assignment"
									month={ownMonth}
									current={current}
									onFileWithout={
										isUnassigned(transaction)
											? () => {
													fileWithout.mutate(transaction);
													onClose();
												}
											: undefined
									}
								/>
							) : (
								<Combobox
									id="transaction-assignment"
									name="assignment"
									disabled={!hydrated}
									value={assignment}
									onValueChange={setAssignment}
									placeholder="Choose a Bucket or Commitment"
									searchPlaceholder="Search Buckets and Commitments…"
									aria-invalid={invalid === "assignment" || undefined}
									choices={choices}
								/>
							)}
						</Field>
					)}
					{onDate ? (
						<Field
							label="Date"
							htmlFor="transaction-date"
							hint={
								banksDay && date !== banksDay ? (
									<span
										className="flex flex-wrap items-baseline gap-x-2"
										data-testid="bank-date-hint"
									>
										<span>From your bank: {shortDay(banksDay)}</span>
										<Button
											type="button"
											variant="link"
											size="inline"
											disabled={!hydrated}
											onClick={() => setDate(banksDay)}
										>
											Put it back
										</Button>
									</span>
								) : undefined
							}
						>
							<DatePicker
								id="transaction-date"
								required
								max={today}
								value={date}
								onChange={(day) => (day ? setDate(day as DayKey) : undefined)}
							/>
						</Field>
					) : null}
				</div>
				{invalid === "amount" ? (
					<FormError>Enter the amount in dollars, like 12 or 85.50.</FormError>
				) : null}
				{invalid === "assignment" ? (
					<FormError>
						{none
							? cantSaveSentence(ownMonth, current)
							: "Choose the Bucket or Commitment it belongs to."}
					</FormError>
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
								choices={choices}
							/>
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
							<Button
								type="button"
								variant="ghost"
								size="sm"
								disabled={!hydrated}
								onClick={unsplit}
							>
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
						<ForPicker
							members={members}
							value={forMemberIds}
							onChange={setForMemberIds}
							multiple
							field
							className={wide ? "max-w-2xl" : undefined}
						/>
						{none ? (
							// Nothing to split between (issue 117): said, not found out on Save.
							<p className="text-muted-foreground text-sm" data-testid="no-split">
								{noSplitSentence(ownMonth, current)}
							</p>
						) : (
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
						)}
					</>
				)}
			</div>
			<div data-slot="editor-more" className="grid min-w-0 content-start gap-4 empty:hidden">
				<ReceiptSection
					transaction={transaction}
					plan={plan}
					members={members}
					onChange={onChange}
				/>
				<MatchSection
					transaction={transaction}
					beforeChange={saveBeforeMatch}
					onDone={onClose}
					today={today}
				/>
				{transaction.importedFrom && !typeChosenAbove ? (
					<TransferSection transaction={transaction} onDone={onClose} />
				) : null}
			</div>
			{/* In the sheet the actions are the form's own children, as they were before the editor had
			    columns: the sheet's footer stays at its foot, above a phone's keyboard, only as a child
			    of what scrolls (issue 99). Under a row they run across both columns. */}
			<div className={inline ? "col-span-full grid gap-4" : "contents"}>
				{confirmDelete ? (
					<Confirm
						confirmLabel="Delete Transaction"
						onConfirm={() => onChange(null)}
						onCancel={() => setConfirmDelete(false)}
					>
						{transaction.importedFrom
							? "It comes out of this month’s spending everywhere, and it won’t come back when your bank syncs or a statement is uploaded again."
							: "It comes out of this month’s spending everywhere."}
					</Confirm>
				) : null}
				<EditorActions inline={inline}>
					<Button type="button" variant="ghost" onClick={() => setConfirmDelete(true)}>
						<Trash2 />
						Delete
					</Button>
					{inline ? (
						<Button type="button" variant="outline" className="ms-auto" onClick={onClose}>
							Cancel
						</Button>
					) : (
						<SheetCancel className="ms-auto" />
					)}
					<Button
						type="submit"
						className="max-lg:ms-auto"
						disabled={!hydrated || (splits !== null && remainder !== 0)}
					>
						Save
					</Button>
				</EditorActions>
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
	choices,
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
	choices: Choices;
}) {
	const id = `split-${split.id}`;
	const name = `Split ${index + 1}`;
	return (
		<fieldset className="relative grid gap-3 rounded-2xl border border-border p-3 max-[22.5rem]:p-2.5">
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
			<div className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] items-start gap-3">
				<Field label="Amount" htmlFor={`${id}-amount`}>
					<AmountInput
						id={`${id}-amount`}
						placeholder="0.00"
						disabled={disabled}
						value={split.amount}
						onChange={(event) => onChange({ amount: event.currentTarget.value })}
						aria-invalid={(invalid && !parseDollars(split.amount)) || undefined}
					/>
				</Field>
				<Field label="Assigned to" htmlFor={`${id}-assignment`}>
					<Combobox
						id={`${id}-assignment`}
						disabled={disabled}
						value={split.assignment}
						onValueChange={(assignment) => onChange({ assignment })}
						searchPlaceholder="Search"
						aria-invalid={(invalid && !split.assignment) || undefined}
						choices={choices}
					/>
				</Field>
			</div>
			<ForPicker
				members={members}
				value={split.for}
				onChange={(value) => onChange({ for: value })}
				multiple
				field
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

/**
 * Delete, Cancel and Save in one row. In the sheet they're its footer, so on a phone Save stays in
 * view at the bottom while the form scrolls, the keyboard up or not (#52 row 147).
 */
function EditorActions({ inline, children }: { inline: boolean; children: ReactNode }) {
	if (inline) return <div className="flex flex-wrap items-center gap-2">{children}</div>;
	return <SheetFooter className="flex items-center gap-2">{children}</SheetFooter>;
}
