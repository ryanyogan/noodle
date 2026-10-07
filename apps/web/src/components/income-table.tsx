import type { IncomeRecord } from "@noodle/db";
import {
	type Cents,
	countOnOffer,
	type DayKey,
	MONEY_IN_KIND_LABELS,
	MONEY_IN_KINDS,
	type MoneyInKind,
	type MonthKey,
	type PayRange,
	type PlanScope,
	parseDollars,
} from "@noodle/domain";
import { Button } from "@noodle/ui/components/button";
import { Card } from "@noodle/ui/components/card";
import { Checkbox } from "@noodle/ui/components/checkbox";
import { DataTable, type DataTableColumn } from "@noodle/ui/components/data-table";
import { DatePicker } from "@noodle/ui/components/date-picker";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@noodle/ui/components/dropdown-menu";
import { Field } from "@noodle/ui/components/field";
import { Input } from "@noodle/ui/components/input";
import { List, ListRow } from "@noodle/ui/components/list";
import { Money } from "@noodle/ui/components/money";
import { OptionSelect } from "@noodle/ui/components/select";
import { Sheet, SheetContent, SheetHeader } from "@noodle/ui/components/sheet";
import { toast } from "@noodle/ui/components/toast";
import { useQuery } from "@tanstack/react-query";
import { useHydrated } from "@tanstack/react-router";
import { ArrowLeftRight, Ellipsis, Pencil, Trash2 } from "lucide-react";
import { type FormEvent, useId, useState } from "react";
import { formatMoney, monthName, shortDay } from "../format";
import { useGoals } from "../goals";
import {
	type MoneyInEdit,
	type MoneyInLine,
	moneyInQuery,
	payRangesQuery,
	useAlwaysWhosePay,
	useMoneyInEdit,
	useMoneyInKindChange,
} from "../money-in";
import { usePlanChange, withTakeHomePay } from "../plan-changes";
import { setTakeHomePay } from "../server/plan";
import type { IncomeListActions } from "./extra-income";
import { AmountInput } from "./goals";
import { useParents } from "./whose-pay";

// Plan › Income as a table a Parent works in (issue 133, ADR-0051, ADR-0057): Date · From ·
// Whose pay · Account · Amount, a total per Parent with the range of one whose pay varies, and
// an Edit sheet. Whose pay, the note and the kind can always be changed; amount and date only on
// Income typed in by hand. Every edit is made on the line's version and waits its turn in the
// outbox (ADR-0041, ADR-0056).

/** The Household in the "Whose pay" picker: Radix keeps "" for nothing chosen. */
const HOUSEHOLD = "";
const HOUSEHOLD_LABEL = "The Household";

type Parent = ReturnType<typeof useParents>[number];

const whoLabel = (parents: Parent[], whosePay: string | null) =>
	whosePay === null
		? HOUSEHOLD_LABEL
		: (parents.find((parent) => parent.id === whosePay)?.name ?? "A Parent");

const whoChoices = (parents: Parent[]) => [
	...parents.map((parent) => ({ value: parent.id, label: parent.name })),
	{ value: HOUSEHOLD, label: HOUSEHOLD_LABEL },
];

/** "$1,840 so far · usually $2,100–$2,900" for a Parent whose pay varies. */
export const payRangeText = (soFar: Cents, usual: NonNullable<PayRange["usual"]>) =>
	`${formatMoney(soFar)} so far · usually ${formatMoney(usual.low)}–${formatMoney(usual.high)}`;

/** An Income entry of the month, with what the money-in read knows of it once it has loaded. */
type Row = IncomeRecord & { line: MoneyInLine | null };

/** After whose pay became a Parent's: says so, and offers to remember the sender. */
function useWhosePay(month: MonthKey, parents: Parent[]) {
	const edit = useMoneyInEdit();
	const always = useAlwaysWhosePay();
	const remember = (line: MoneyInLine, whosePay: string) => {
		const who = whoLabel(parents, whosePay);
		always.mutate(
			{ line, payMemberId: whosePay },
			{
				onSuccess: (stated) => {
					if (!stated) return;
					toast(
						stated.changed > 0
							? `Deposits from ${line.note} are ${who}’s pay from now on, and ${stated.changed} already here ${stated.changed === 1 ? "is" : "are"} too`
							: `Deposits from ${line.note} are ${who}’s pay from now on`,
						{ tone: "success" },
					);
				},
			},
		);
	};
	const set = (line: MoneyInLine, whosePay: string | null) => {
		if (whosePay === line.whosePay) return;
		edit.mutate(
			{ line, edit: { whosePay }, month },
			{
				onSuccess: (saved) => {
					const who = whoLabel(parents, whosePay);
					toast(
						whosePay === null
							? `${formatMoney(saved.amount)} is the Household’s`
							: `${formatMoney(saved.amount)} is ${who}’s pay`,
						{
							tone: "success",
							// Only a line with wording can be recognised again (ADR-0057).
							action:
								whosePay !== null && saved.note
									? {
											label: `Always treat deposits from ${saved.note} as ${who}’s pay`,
											onClick: () => remember(saved, whosePay),
										}
									: undefined,
						},
					);
				},
			},
		);
	};
	return { set, remember, edit };
}

/** The month's Income as a table, with a total per Parent under it. */
export function IncomeTable({
	month,
	income,
	canRecord,
	onRemove,
	onBetweenUs,
}: IncomeListActions & { month: MonthKey; income: IncomeRecord[] }) {
	const hydrated = useHydrated();
	const parents = useParents();
	const { accounts } = useGoals();
	const { data: lines } = useQuery(moneyInQuery(month));
	const { data: ranges } = useQuery(payRangesQuery(month));
	const whose = useWhosePay(month, parents);
	const [editing, setEditing] = useState<string | null>(null);

	// Newest first, as money in is listed everywhere else. What the money-in read has (an edit
	// shows there at once) wins over the month's own copy.
	const rows: Row[] = income
		.map((entry) => {
			const line = lines?.find((candidate) => candidate.id === entry.id) ?? null;
			return line
				? { ...entry, amount: line.amount, date: line.date, note: line.note, line }
				: { ...entry, line };
		})
		.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.id < b.id ? 1 : -1));
	const total = rows.reduce((sum, row) => sum + row.amount, 0) as Cents;
	const open = rows.find((row) => row.id === editing)?.line ?? null;
	const choices = whoChoices(parents);
	// Until the month's money-in read arrives nothing is known of whose pay a row is or where it
	// landed: say that it's coming, never "The Household" or "Typed in".
	const waiting = lines === undefined;
	const coming = (what: string) => (
		<span className="text-muted-foreground" data-testid="income-coming">
			<span aria-hidden="true">…</span>
			<span className="sr-only">Loading {what}</span>
		</span>
	);
	const accountOf = (row: Row) =>
		row.line?.accountId
			? (accounts.find((account) => account.id === row.line?.accountId)?.name ?? "An Account")
			: "Typed in";

	const columns: DataTableColumn<Row>[] = [
		{
			id: "date",
			header: "Date",
			min: 4.5,
			width: "4.5rem",
			priority: 2,
			stacked: "secondary",
			cell: (row) => (
				<>
					{shortDay(row.date)}
					{/* Stacked (a phone), the Account has no column of its own: it follows the day. */}
					{waiting ? null : <span className="@2xl/dt:hidden"> · {accountOf(row)}</span>}
				</>
			),
		},
		{
			id: "from",
			header: "From",
			min: 7,
			width: "minmax(0,2fr)",
			stacked: "title",
			cell: (row) => row.note ?? "Income",
			footer: "Total",
		},
		{
			id: "whose",
			header: "Whose pay",
			min: 9,
			width: "minmax(9rem,1fr)",
			stacked: "secondary",
			cell: (row) =>
				row.line ? (
					<OptionSelect
						size="sm"
						aria-label={`Whose pay is ${formatMoney(row.amount)} from ${row.note ?? "Income"}`}
						value={row.line.whosePay ?? HOUSEHOLD}
						choices={choices}
						disabled={!hydrated}
						onValueChange={(value) => row.line && whose.set(row.line, value || null)}
					/>
				) : waiting ? (
					coming("whose pay")
				) : (
					<span className="text-muted-foreground">{HOUSEHOLD_LABEL}</span>
				),
		},
		{
			id: "account",
			header: "Account",
			// Narrow enough that it shows wherever the table is in columns (42rem and up).
			min: 6,
			width: "minmax(6rem,1fr)",
			priority: 3,
			stacked: "hidden",
			cell: (row) =>
				waiting ? (
					coming("the Account")
				) : (
					<span className="text-muted-foreground">{accountOf(row)}</span>
				),
		},
		{
			id: "amount",
			header: "Amount",
			min: 6,
			width: "6.5rem",
			align: "end",
			stacked: "value",
			cell: (row) => <Money cents={row.amount} />,
			footer: <Money cents={total} />,
		},
		{
			id: "actions",
			header: "Actions",
			headerClassName: "sr-only",
			min: 2.5,
			width: "2.5rem",
			align: "end",
			stacked: "trailing",
			cell: (row) => (
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button
							variant="ghost"
							size="icon"
							disabled={!hydrated}
							aria-label={`Actions for ${formatMoney(row.amount)} of income`}
						>
							<Ellipsis className="size-4" />
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent>
						{row.line ? (
							<DropdownMenuItem onSelect={() => setEditing(row.id)}>
								<Pencil />
								Edit
							</DropdownMenuItem>
						) : null}
						{onBetweenUs ? (
							<DropdownMenuItem onSelect={() => onBetweenUs(row)}>
								<ArrowLeftRight />
								It’s between us · not Income
							</DropdownMenuItem>
						) : null}
						{canRecord ? (
							<DropdownMenuItem variant="destructive" onSelect={() => onRemove(row)}>
								<Trash2 />
								Remove income
							</DropdownMenuItem>
						) : null}
					</DropdownMenuContent>
				</DropdownMenu>
			),
		},
	];

	if (rows.length === 0)
		return (
			<Card className="p-5 text-sm text-muted-foreground">
				No income recorded this month. Add income, or mark a deposit below as income.
			</Card>
		);
	return (
		<div className="grid gap-4">
			<DataTable
				label={`Income in ${monthName(month)}`}
				columns={columns}
				data={rows}
				getRowId={(row) => row.id}
			/>
			<WhosePayTotals rows={rows} parents={parents} ranges={ranges ?? []} />
			<Sheet open={open !== null} onOpenChange={(next) => (next ? null : setEditing(null))}>
				{open ? (
					<SheetContent>
						<SheetHeader
							title="Edit income"
							description={
								open.typed
									? "You typed this in, so everything about it can be changed."
									: "This came from your bank, so its amount and date stay as the bank has them."
							}
						/>
						<IncomeEditForm
							key={`${open.id}:${open.version}`}
							line={open}
							month={month}
							parents={parents}
							whose={whose}
							onDone={() => setEditing(null)}
						/>
					</SheetContent>
				) : null}
			</Sheet>
		</div>
	);
}

/** What each Parent (and the Household) brought in this month; a varying pay says its range. */
function WhosePayTotals({
	rows,
	parents,
	ranges,
}: {
	rows: Row[];
	parents: Parent[];
	ranges: PayRange[];
}) {
	const totals = new Map<string | null, number>();
	for (const row of rows) {
		const who = row.line?.whosePay ?? null;
		totals.set(who, (totals.get(who) ?? 0) + row.amount);
	}
	// A Parent with nothing in yet this month still shows, when their pay usually varies.
	for (const range of ranges)
		if (range.varies && !totals.has(range.whosePay)) totals.set(range.whosePay, 0);
	const order = [...parents.map((parent) => parent.id), null].filter((who) => totals.has(who));
	if (order.length === 0) return null;
	return (
		<section aria-label="Whose pay" className="grid gap-2">
			<List>
				{order.map((who) => {
					const soFar = (totals.get(who) ?? 0) as Cents;
					const range = ranges.find((candidate) => candidate.whosePay === who);
					return (
						<ListRow
							key={who ?? "household"}
							title={who === null ? HOUSEHOLD_LABEL : `${whoLabel(parents, who)}’s pay`}
							meta={
								range?.varies && range.usual
									? payRangeText(soFar, range.usual)
									: who === null
										? "Interest, a tax refund, or pay nobody has said is theirs"
										: undefined
							}
							trailing={
								<span className="text-sm font-semibold tabular-nums">{formatMoney(soFar)}</span>
							}
						/>
					);
				})}
			</List>
		</section>
	);
}

/** Edits one Income entry: what it's from, whose pay, its kind, and (typed in) amount and date. */
function IncomeEditForm({
	line,
	month,
	parents,
	whose,
	onDone,
}: {
	line: MoneyInLine;
	month: MonthKey;
	parents: Parent[];
	whose: ReturnType<typeof useWhosePay>;
	onDone: () => void;
}) {
	const id = useId();
	const kindChange = useMoneyInKindChange();
	const [note, setNote] = useState(line.note ?? "");
	const [who, setWho] = useState(line.whosePay ?? HOUSEHOLD);
	const [kind, setKind] = useState<MoneyInKind>(line.kind);
	const [amount, setAmount] = useState((line.amount / 100).toFixed(2));
	const [date, setDate] = useState<string>(line.date);
	const [always, setAlways] = useState(false);
	const cents = parseDollars(amount);
	const amountError = line.typed && (cents === null || cents <= 0) ? "Enter an amount" : null;
	const whoName = who === HOUSEHOLD ? null : whoLabel(parents, who);
	const wording = note.trim() || null;

	const submit = (event: FormEvent) => {
		event.preventDefault();
		if (amountError) return;
		const edit: MoneyInEdit = {};
		if (wording !== line.note) edit.note = wording;
		if ((who || null) !== line.whosePay) edit.whosePay = who || null;
		if (line.typed && cents !== null && cents !== line.amount) edit.amountCents = cents;
		if (line.typed && date && date !== line.date) edit.date = date as DayKey;
		const remember = (saved: MoneyInLine) => {
			if (always && who && saved.note) whose.remember(saved, who);
		};
		const edited = Object.keys(edit).length > 0;
		onDone();
		if (edited)
			whose.edit.mutate(
				{ line, edit, month },
				{
					onSuccess: (saved) => {
						toast("Saved your change to this Income", { tone: "success" });
						remember(saved);
					},
				},
			);
		else remember(line);
		// The kind is its own change, waiting its turn behind the edit: it goes on the version the
		// edit leaves, and isn't lost when the edit can't be saved. A line nobody had touched, saved
		// as it is, is confirmed: a Parent has decided it, and the October pass leaves it alone.
		const confirmed = !edited && line.version === 0 && !line.needsReview;
		if (kind !== line.kind || confirmed) kindChange.mutate({ line, kind });
	};

	return (
		<form className="grid gap-4" onSubmit={submit}>
			<Field label="From" htmlFor={`${id}-note`}>
				<Input
					id={`${id}-note`}
					value={note}
					maxLength={200}
					placeholder="e.g. Paycheck"
					onChange={(event) => setNote(event.target.value)}
				/>
			</Field>
			<Field label="Whose pay" htmlFor={`${id}-who`}>
				<OptionSelect
					id={`${id}-who`}
					value={who}
					choices={whoChoices(parents)}
					onValueChange={setWho}
				/>
			</Field>
			{whoName && wording ? (
				<label className="flex items-start gap-2 text-sm" htmlFor={`${id}-always`}>
					<Checkbox
						id={`${id}-always`}
						checked={always}
						onCheckedChange={(checked) => setAlways(checked === true)}
					/>
					<span>
						Always treat deposits from {wording} as {whoName}’s pay
					</span>
				</label>
			) : null}
			<Field
				label="Kind"
				htmlFor={`${id}-kind`}
				hint="Only Income counts toward your take-home pay and Extra income."
			>
				<OptionSelect
					id={`${id}-kind`}
					value={kind}
					choices={MONEY_IN_KINDS.map((value) => ({ value, label: MONEY_IN_KIND_LABELS[value] }))}
					onValueChange={(value) => setKind(value as MoneyInKind)}
				/>
			</Field>
			{line.typed ? (
				<>
					<Field label="Amount" htmlFor={`${id}-amount`} error={amountError ?? undefined}>
						<AmountInput
							id={`${id}-amount`}
							value={amount}
							aria-invalid={amountError ? true : undefined}
							onChange={(event) => setAmount(event.target.value)}
						/>
					</Field>
					<Field label="Date" htmlFor={`${id}-date`}>
						<DatePicker id={`${id}-date`} value={date} onChange={setDate} required />
					</Field>
				</>
			) : null}
			<Button type="submit">Save</Button>
		</form>
	);
}

/**
 * "Use $X as what you can count on": when a Parent's pay varies and the low ends of the last
 * three full months no longer add up to the Take-home pay. A Plan change from this month on; the
 * Take-home pay stays one Household figure (ADR-0040).
 */
export function CountOnOffer({ month, baseline }: { month: MonthKey; baseline: Cents }) {
	const hydrated = useHydrated();
	const { data: ranges } = useQuery(payRangesQuery(month));
	const change = usePlanChange(month, {
		save: (data: { month: MonthKey; amountCents: number; scope: PlanScope }) =>
			setTakeHomePay({ data }),
		apply: withTakeHomePay,
	});
	const offer = ranges ? countOnOffer({ baseline, ranges }) : null;
	if (offer === null) return null;
	const use = (amountCents: Cents, back: Cents | null) =>
		change.mutate(
			{ month, amountCents, scope: "from-on" },
			{
				onSuccess: () =>
					toast(`Take-home pay is ${formatMoney(amountCents)} from ${monthName(month)} on`, {
						tone: "success",
						undo: back === null ? undefined : () => use(back, null),
					}),
				onError: () =>
					toast("Couldn’t change your take-home pay, so it’s as it was.", { tone: "error" }),
			},
		);
	return (
		<Card className="grid gap-3 p-(--card-pad)">
			<p className="text-sm text-muted-foreground">
				Over the last three months, the least your pay came to adds up to{" "}
				<span className="font-medium text-foreground tabular-nums">{formatMoney(offer)}</span>. Your
				Plan counts on {formatMoney(baseline)}.
			</p>
			<div>
				<Button
					variant="outline"
					size="sm"
					disabled={!hydrated || change.isPending}
					onClick={() => use(offer, baseline)}
				>
					Use {formatMoney(offer)} as what you can count on
				</Button>
			</div>
		</Card>
	);
}
