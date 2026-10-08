import { type Cents, countsOn, type DayKey, monthOfDay, parseDollars } from "@noodle/domain";
import { Button } from "@noodle/ui/components/button";
import { DatePicker } from "@noodle/ui/components/date-picker";
import { Field } from "@noodle/ui/components/field";
import { Input } from "@noodle/ui/components/input";
import { toast } from "@noodle/ui/components/toast";
import { cn } from "@noodle/ui/lib/utils";
import { type InfiniteData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useHydrated } from "@tanstack/react-router";
import { Trash2 } from "lucide-react";
import { type FormEvent, type ReactNode, useId, useState } from "react";
import { useIncome } from "../extra-income";
import {
	type MoneyInEdit,
	type MoneyInLine,
	moneyInAccountsQuery,
	moneyInFollowUp,
	useMoneyInEdit,
} from "../money-in";
import type { TransactionsPage } from "../server/transactions";
import { rangeTransactionsKey, type TransactionRow, transactionsKey } from "../transactions";
import { BankTookBackNote } from "./bank-took-back-note";
import { AmountInput } from "./goals";
import { MoneyInFollowUpAsk, MoneyInKindChoice } from "./money-in";
import { PayDayChoice } from "./pay-day-choice";
import { Confirm } from "./plan-editing";
import { PageKeyboard } from "./transaction-editor";
import { WhosePayOffer } from "./whose-pay";

// Money in opened from the Transactions table (issue 152, ADR-0061): the same place a Transaction
// opens, with the same fields where it has them (Name, Amount, Date) and Delete, Cancel and Save
// where a Transaction's are. Beside them, everything a Parent can say about money in: its kind,
// whose pay Income is, which Account a Transfer came from, which purchase a Refund is for and
// what Paid back pays back. The name can always be changed; the amount and the date only on
// money in a Parent typed in (ADR-0057).

/** A row of the Transactions table that is a money-in line. */
export type MoneyInTableRow = TransactionRow & { moneyIn: MoneyInLine };

/** The row as it reads once its line has changed, before the list has read it again. */
const withLine = (row: TransactionRow, line: MoneyInLine): TransactionRow => {
	const moves = line.kind === "transfer" || line.kind === "between-us";
	return {
		...row,
		date: line.date,
		amountCents: -line.amount as Cents,
		note: line.note,
		waits: line.needsReview,
		version: line.version,
		transfer: moves
			? {
					from: row.transfer?.from ?? null,
					to: row.importedFrom,
					reason: line.kind === "between-us" ? "between-us" : null,
				}
			: null,
		moneyIn: line,
	};
};

/** Shows a changed line in every loaded list of Transactions at once; the lists are read again after. */
function useShowInLists() {
	const queryClient = useQueryClient();
	return (was: MoneyInLine, line: MoneyInLine) => {
		const patch = (data: InfiniteData<TransactionsPage> | TransactionRow | null | undefined) =>
			data && typeof data === "object" && "pages" in data
				? {
						...data,
						pages: data.pages.map((page) => ({
							...page,
							transactions: page.transactions.map((row) =>
								row.id === line.id && row.moneyIn ? withLine(row, line) : row,
							),
						})),
					}
				: data;
		for (const queryKey of [transactionsKey(monthOfDay(was.date)), rangeTransactionsKey])
			queryClient.setQueriesData({ queryKey }, patch);
	};
}

export function MoneyInBody({
	row,
	today,
	heading,
	onClose,
	onLeave,
}: {
	row: MoneyInTableRow;
	today: DayKey;
	/** The pane's header, given the words that say what this is. */
	heading: (title: string) => ReactNode;
	/** Cancel, and Save: the pane closes and its row stays. */
	onClose: () => void;
	/** Its row has left the list (removed, or dated into another month): nothing to close slowly. */
	onLeave: (toMonth?: string) => void;
}) {
	const id = useId();
	const hydrated = useHydrated();
	// The line as this pane last heard it from the server, until the list has it too.
	const [said, setSaid] = useState<MoneyInLine | null>(null);
	const line =
		said && said.id === row.id && said.version >= row.moneyIn.version ? said : row.moneyIn;
	const edit = useMoneyInEdit();
	const { remove } = useIncome();
	const show = useShowInLists();
	const accounts = useQuery(moneyInAccountsQuery()).data ?? [];
	const [name, setName] = useState(line.note ?? "");
	const [amount, setAmount] = useState((line.amount / 100).toFixed(2));
	const [date, setDate] = useState<string>(line.date);
	const [confirmDelete, setConfirmDelete] = useState(false);
	const cents = parseDollars(amount);
	const amountError = line.typed && (cents === null || cents <= 0) ? "Enter an amount" : null;
	const month = monthOfDay(line.date);
	// The month it counts in: its pay day's when it is the pay for one (ADR-0063).
	const countsIn = monthOfDay(countsOn(line));
	// Only Income can be removed: that is what removing it is refused or allowed by (ADR-0052).
	const removable = line.kind === "income" && !line.needsReview;
	const changed = (now: MoneyInLine) => {
		setSaid(now);
		show(line, now);
	};

	const save = (event: FormEvent) => {
		event.preventDefault();
		if (amountError) return;
		const wording = name.trim() || null;
		const next: MoneyInEdit = {};
		if (wording !== line.note) next.note = wording;
		if (line.typed && cents !== null && cents !== line.amount) next.amountCents = cents;
		if (line.typed && date && date !== line.date) next.date = date;
		if (Object.keys(next).length > 0) {
			show(line, {
				...line,
				...(next.note !== undefined ? { note: next.note } : {}),
				...(next.amountCents !== undefined ? { amount: next.amountCents as Cents } : {}),
				...(next.date !== undefined ? { date: next.date as DayKey } : {}),
			});
			// Awaited, not a callback of this call: the pane closes at once, and a callback given to
			// a call made from a component that has gone is never run.
			edit
				.mutateAsync({ line, edit: next, month })
				.then(() => toast("Saved your change to this money in", { tone: "success" }))
				// Said by the change itself (its toast).
				.catch(() => undefined);
		}
		// Dated into another month: its row has left this list.
		if (next.date && monthOfDay(next.date as DayKey) !== month)
			onLeave(monthOfDay(next.date as DayKey));
		else onClose();
	};

	const follows = moneyInFollowUp(line, accounts) !== null;
	// Only Income that counts has a pay day to say.
	const payDay = line.kind === "income" && !line.needsReview;
	return (
		<>
			{heading("Edit money in")}
			<BankTookBackNote row={{ incomeId: line.id }} line={line} today={today} className="mb-4" />
			<form
				onSubmit={save}
				noValidate
				data-testid="money-in-editor"
				className="grid gap-4 @3xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] @3xl:items-start @3xl:gap-x-8"
			>
				<div data-slot="editor-fields" className="grid min-w-0 gap-4">
					<Field
						label="Name"
						htmlFor={`${id}-name`}
						hint={
							line.accountId
								? `Came into ${row.importedFrom ?? "an Account"}.`
								: "You typed this in."
						}
					>
						<Input
							id={`${id}-name`}
							maxLength={200}
							autoComplete="off"
							placeholder="Give it a name"
							value={name}
							onChange={(event) => setName(event.target.value)}
						/>
					</Field>
					<div className="grid items-start gap-4 sm:grid-cols-2">
						<Field
							label="Amount"
							htmlFor={`${id}-amount`}
							error={amountError ?? undefined}
							hint={
								line.typed
									? undefined
									: "From your bank, so the amount and the date stay as it has them."
							}
						>
							<AmountInput
								id={`${id}-amount`}
								value={amount}
								disabled={!hydrated || !line.typed}
								aria-invalid={amountError ? true : undefined}
								onChange={(event) => setAmount(event.currentTarget.value)}
							/>
						</Field>
						<Field label="Date" htmlFor={`${id}-date`}>
							<DatePicker
								id={`${id}-date`}
								value={date}
								onChange={setDate}
								max={today}
								disabled={!line.typed}
								required
							/>
						</Field>
					</div>
				</div>
				<div data-slot="editor-more" className="grid min-w-0 gap-4">
					{/* Said at once, as it is everywhere money in is asked about: not part of Save. */}
					<MoneyInKindChoice line={line} onChanged={changed} />
					{follows ? (
						// The pay day is asked with whose pay it is, both above "Done" (issue 156).
						<MoneyInFollowUpAsk
							line={line}
							today={today}
							onDone={onClose}
							more={payDay ? <PayDayChoice line={line} onChanged={changed} /> : null}
						/>
					) : payDay ? (
						<>
							{/* Income with no wording to remember its sender by still has whose pay it is. */}
							<WhosePayOffer line={line} />
							<PayDayChoice line={line} onChanged={changed} />
						</>
					) : null}
				</div>
				<div
					data-slot="editor-actions"
					className={cn(
						"col-span-full grid gap-4",
						// On a phone's page they stay in view while the form scrolls, as a Transaction's do.
						"max-lg:sticky max-lg:z-1 max-lg:-mx-(--card-pad) max-lg:border-t max-lg:bg-card max-lg:px-(--card-pad) max-lg:py-3",
						"max-lg:bottom-[max(calc(var(--tabbar-height)+var(--safe-bottom)),var(--keyboard-inset,0px))]",
					)}
				>
					<PageKeyboard />
					{confirmDelete ? (
						<Confirm
							confirmLabel="Remove income"
							onConfirm={() => {
								remove.mutate({
									incomeId: line.id,
									month: countsIn,
									date: line.date,
									amountCents: line.amount,
									note: line.note,
								});
								onLeave();
							}}
							onCancel={() => setConfirmDelete(false)}
						>
							It comes out of this month’s Income everywhere.
						</Confirm>
					) : null}
					<div className="flex flex-wrap items-center gap-2">
						{removable ? (
							<Button type="button" variant="ghost" onClick={() => setConfirmDelete(true)}>
								<Trash2 />
								Delete
							</Button>
						) : null}
						<Button type="button" variant="outline" className="ms-auto" onClick={onClose}>
							Cancel
						</Button>
						<Button type="submit" className="max-lg:ms-auto" disabled={!hydrated}>
							Save
						</Button>
					</div>
				</div>
			</form>
		</>
	);
}
