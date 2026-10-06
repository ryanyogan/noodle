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
	yearlyCost,
} from "@noodle/domain";
import { Badge } from "@noodle/ui/components/badge";
import { Button } from "@noodle/ui/components/button";
import { Card } from "@noodle/ui/components/card";
import { DatePicker } from "@noodle/ui/components/date-picker";
import { Field, FormError } from "@noodle/ui/components/field";
import { Input } from "@noodle/ui/components/input";
import { ListRow } from "@noodle/ui/components/list";
import { OptionSelect } from "@noodle/ui/components/select";
import {
	Sheet,
	SheetCancel,
	SheetContent,
	SheetFooter,
	SheetHeader,
} from "@noodle/ui/components/sheet";
import { Tile } from "@noodle/ui/components/tile";
import { useQueryClient } from "@tanstack/react-query";
import { useHydrated } from "@tanstack/react-router";
import { Pencil, Plus } from "lucide-react";
import { type FormEvent, type ReactNode, useId, useState } from "react";
import { ulid } from "ulid";
import { monogram } from "../buckets";
import {
	type CommitmentVariables,
	cadenceNames,
	costText,
	partPaid,
	readPaysDown,
	schedule,
	tellPaysDownRefusal,
	withCommitment,
	withNewCommitment,
	withoutCommitment,
} from "../commitments";
import { formatMoney, formatMoneyInput, fullDay, monthName, shortDay } from "../format";
import { usePlanChange } from "../plan-changes";
import { goalsQuery } from "../queries";
import { addCommitment, endCommitment, updateCommitment } from "../server/commitments";
import { AboutNote, CommitmentLink } from "./commitment-list";
import { AmountInput } from "./goals";
import { PaysDownField, PaysDownNote } from "./pays-down";
import { Confirm, SaveFailed } from "./plan-editing";
import { PlanHistoryDisclosure } from "./plan-history";
import { ChangedNote, PlanScopeField } from "./plan-scope-field";

const isCadence = (value: unknown): value is Cadence => CADENCES.includes(value as Cadence);
const isDay = (value: unknown): value is DayKey =>
	typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);

/**
 * A Commitment in the Plan: what it takes a month, and the Commitment sheet to change its terms
 * or end it, the same one its page opens. One due less often than monthly shows its monthly share
 * ("$566.67", with "A month’s share of $6,800 yearly" under its name), so a yearly bill doesn't read as due now. `was` is its amount the month before,
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
			// On the narrowest phones (under 360px) the letter tile goes: with it, "Monthly · due
			// Oct 1" broke onto two lines and every row was four lines tall (issue 115).
			className="max-[22.5rem]:grid-cols-[minmax(0,1fr)_auto]"
			leading={<Tile className="max-[22.5rem]:hidden">{monogram(commitment.name)}</Tile>}
			title={<CommitmentLink month={month} commitment={commitment} />}
			meta={
				<>
					<span>
						{monthly
							? schedule(commitment, month)
							: // The amount column holds the figure alone (issue 73), so this line says what it is.
								`A month’s share of ${formatMoney(commitment.amount)} ${cadenceNames[commitment.cadence].toLowerCase()} · ${
									commitment.dueDates.length > 0
										? `${formatMoney(commitment.expected)} this month`
										: `next due ${fullDay(nextDueDate(commitment, `${month}-01`))}`
								}`}
						{monthly && commitment.dueDates.length > 1
							? ` · ${formatMoney(commitment.expected)} this month`
							: ""}
					</span>
					<AboutNote commitment={commitment} />
					<ChangedNote was={was} />
					{commitment.accountId ? <PaysDownNote accountId={commitment.accountId} /> : null}
					{/* Beside a rail (a desktop window under 1440) the list has no room for the paid column:
					    what has been paid is said here instead of nowhere (issue 73). Phones keep their rows. */}
					{commitment.status === "paid" || commitment.status === "differs" ? (
						<span className="hidden @max-2xl:sm:inline-flex">
							<PaidState commitment={commitment} />
						</span>
					) : null}
					{monthly ? (
						// In a list wider than the pane beside an item, the yearly total is its own column instead.
						<span className="basis-full text-subtle-foreground @lg:sr-only">
							{costText(commitment)}
						</span>
					) : null}
				</>
			}
			trailing={
				<div className="flex items-center gap-1">
					<span className="me-2 hidden w-36 justify-end @2xl:flex">
						<PaidState commitment={commitment} />
					</span>
					<span
						aria-hidden={monthly || undefined}
						className="me-3 hidden w-32 text-end text-[13px] text-subtle-foreground @lg:block"
					>
						{formatMoney(yearlyCost(commitment))} a year
					</span>
					{/* In the wide list the amount keeps one width, so the columns before it line up down the list. */}
					<span className="text-end text-sm font-medium tabular-nums @lg:min-w-24">
						{formatMoney(monthly ? commitment.amount : monthlyEquivalent(commitment))}
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

/** Where a Commitment stands this month, for its column in a wide list. */
function PaidState({ commitment }: { commitment: CommitmentState }) {
	const { status, dueDates, charges, difference } = commitment;
	if (status === "not-due") {
		return <span className="text-[13px] text-subtle-foreground">Not due this month</span>;
	}
	if (status === "paid") return <Badge dot>Paid</Badge>;
	if (status === "differs") {
		// Partly paid, and it pays down a card or loan: several payments a month are the usual
		// thing there, so it says how far along it is rather than how far off (ADR-0050).
		const part = partPaid(commitment);
		if (part) {
			return <span className="text-[13px] text-muted-foreground tabular-nums">{part}</span>;
		}
		return (
			<Badge variant={difference > 0 ? "over" : "default"} dot>
				{difference > 0 ? `${formatMoney(difference)} more` : `${formatMoney(-difference)} less`}
			</Badge>
		);
	}
	const next = dueDates[charges];
	return (
		<span className="text-[13px] text-muted-foreground">
			{charges > 0
				? `${charges} of ${dueDates.length} paid`
				: next
					? `Due ${shortDay(next)}`
					: "Due"}
		</span>
	);
}

/**
 * The writes the Commitment sheet makes, kept by whatever opens it: ending a Commitment removes
 * its row, which must not take a failure with it.
 */
export function useCommitmentChanges(month: MonthKey) {
	const refreshOwed = useRefreshOwed();
	const update = usePlanChange(month, {
		save: (data: CommitmentVariables) =>
			tellPaysDownRefusal(updateCommitment({ data }), data.name).finally(() => refreshOwed(data)),
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

/** After a save that set what a Commitment pays down: what's owed on Accounts and Goals follows. */
function useRefreshOwed() {
	const queryClient = useQueryClient();
	return (data: CommitmentVariables) => {
		if (data.paysDown) void queryClient.invalidateQueries({ queryKey: goalsQuery().queryKey });
	};
}

/** What the Commitment sheet edits: its terms, and the card or loan it pays down. */
type SheetCommitment = Pick<CommitmentState, "id" | "name" | "amount" | "cadence" | "dueDate"> & {
	accountId?: string | null | undefined;
	carriedBalance?: boolean | undefined;
	about?: boolean | undefined;
};

/** The Commitment sheet: change its terms from this month on or just this month, or end it. */
export function CommitmentSheet({
	month,
	commitment,
	open,
	onOpenChange,
	changes,
}: {
	month: MonthKey;
	commitment: SheetCommitment;
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
						history={<PlanHistoryDisclosure month={month} targetId={commitment.id} />}
					/>
				</SheetContent>
			) : null}
		</Sheet>
	);
}

/** What's wrong with a Commitment's fields, each shown beside the form on submit. */
type CommitmentErrors = {
	name?: boolean;
	amount?: boolean;
	dueDate?: boolean;
	/** A card Noodle follows was chosen without "a balance I'm carrying". */
	carried?: boolean;
	/** A card or loan added in the form is still being saved. */
	busy?: boolean;
};

/**
 * The fields' values, checked; with the errors when any is missing or wrong. What it pays down
 * (`paysDown`) is in the terms only when it differs from `was` (readPaysDown).
 */
export function readCommitment(
	form: HTMLFormElement,
	was?: { accountId?: string | null | undefined; carriedBalance?: boolean | undefined },
) {
	const values = new FormData(form);
	const name = String(values.get("name") ?? "").trim();
	const amountCents = parseDollars(String(values.get("amount") ?? ""));
	const cadence = values.get("cadence");
	const dueDate = values.get("dueDate");
	const { paysDown, needsTick, busy } = readPaysDown(values, was);
	// A form without the choice (none today) leaves it as it is.
	const kind = values.get("amountKind");
	const about = kind === null ? undefined : kind === "about";
	const errors: CommitmentErrors = {
		name: name === "",
		amount: amountCents === null,
		dueDate: !isDay(dueDate),
		carried: needsTick,
		busy,
	};
	const ok =
		!errors.name &&
		amountCents !== null &&
		isCadence(cadence) &&
		isDay(dueDate) &&
		!errors.dueDate &&
		!errors.carried &&
		!errors.busy;
	return ok
		? {
				ok: true as const,
				errors,
				terms: {
					name,
					amountCents,
					cadence,
					dueDate,
					...(about === undefined ? {} : { about }),
					...(paysDown ? { paysDown } : {}),
				},
			}
		: { ok: false as const, errors };
}

export function CommitmentFormErrors({ errors }: { errors: CommitmentErrors }) {
	return (
		<>
			{errors.name ? <FormError>Give the Commitment a name, like Mortgage.</FormError> : null}
			{errors.amount ? (
				<FormError>Enter the amount as a dollar amount, like 1,800 or 15.99.</FormError>
			) : null}
			{errors.dueDate ? <FormError>Pick a day it’s due.</FormError> : null}
			{errors.carried ? (
				<FormError>
					Tick “This is a set payment on a balance I’m carrying”, or choose Nothing under Pays down.
				</FormError>
			) : null}
			{errors.busy ? (
				<FormError>The card or loan is still being added. Try again in a moment.</FormError>
			) : null}
		</>
	);
}

/** Change a Commitment's amount, name, or when it's due, from this month on or just this month; or end it. */
function CommitmentDetails({
	month,
	commitment,
	onSave,
	onEnd,
	history,
}: {
	month: MonthKey;
	commitment: SheetCommitment;
	onSave: (terms: Omit<CommitmentVariables, "commitmentId" | "month">) => void;
	onEnd: (commitmentId: string) => void;
	/** The Commitment's history: above the footer, so Save stays last. */
	history?: ReactNode;
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
		const read = readCommitment(event.currentTarget, commitment);
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
				<AmountKindField id={id} about={commitment.about === true} />
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
				<PaysDownField id={id} initial={commitment} invalid={errors.carried} />
				<PlanScopeField
					month={month}
					current={commitment.amount}
					scope={scope}
					onScopeChange={setScope}
				/>
				<CommitmentFormErrors errors={errors} />
				{history}
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
				<SheetFooter>
					<SheetCancel />
					<Button type="submit" disabled={!hydrated}>
						Save
					</Button>
				</SheetFooter>
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

/**
 * Whether a Commitment's amount is the same each time or "about" (it varies, as power and water
 * do), for its forms (issue 135). Read by readCommitment as `about`.
 */
export function AmountKindField({
	id,
	about = false,
	className,
}: {
	id: string;
	about?: boolean;
	className?: string | undefined;
}) {
	return (
		<Field
			label="The amount is"
			htmlFor={`${id}-kind`}
			hint="Pick “About” for a bill that varies, like power or water. Over or under comes out of, or adds to, what carries to the next month."
		>
			<OptionSelect
				id={`${id}-kind`}
				name="amountKind"
				defaultValue={about ? "about" : "same"}
				className={className}
				choices={[
					{ value: "same", label: "The same each time" },
					{ value: "about", label: "About: it varies" },
				]}
			/>
		</Field>
	);
}

/** How often a Commitment is due, and one day it's due. */
export function ScheduleFields({
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
				<OptionSelect
					id={`${id}-cadence`}
					name="cadence"
					defaultValue={cadence}
					className={inCard ? "bg-card" : undefined}
					choices={CADENCES.map((value) => ({ value, label: cadenceNames[value] }))}
				/>
			</Field>
			<Field label={dueLabel} htmlFor={`${id}-due`} className="content-start" hint={dueHint}>
				<DatePicker
					required
					id={`${id}-due`}
					name="dueDate"
					defaultValue={dueDate}
					className={inCard ? "bg-card" : undefined}
					aria-invalid={invalid || undefined}
				/>
			</Field>
		</div>
	);
}

/** What the add form opens with, from a payment in Review made into a Commitment (ADR-0050). */
export type CommitmentStart = {
	name?: string | undefined;
	/** Cents. */
	amount?: number | undefined;
	/** The card or loan it pays down, by ID, or "add" for one Noodle doesn't have yet. */
	paysDown?: string | undefined;
};

export function AddCommitment({ month, start }: { month: MonthKey; start?: CommitmentStart }) {
	const hydrated = useHydrated();
	const id = useId();
	// Only the first Commitment added starts from what Review passed.
	const [prefill, setPrefill] = useState(start);
	// A fresh ID per Commitment; a retry of the same attempt reuses it, so it's added once.
	const [commitmentId, setCommitmentId] = useState(() => ulid());
	const [errors, setErrors] = useState<CommitmentErrors>({});
	const refreshOwed = useRefreshOwed();
	const add = usePlanChange(month, {
		save: (data: CommitmentVariables) =>
			tellPaysDownRefusal(addCommitment({ data }), data.name).finally(() => refreshOwed(data)),
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
		setPrefill(undefined);
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
				{/* Keyed like "Pays down": the next one starts empty, not from Review's line again. */}
				<div
					key={commitmentId}
					className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem] lg:grid-cols-1"
				>
					<Field label="New Commitment" htmlFor={`${id}-name`}>
						<Input
							id={`${id}-name`}
							name="name"
							defaultValue={prefill?.name}
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
							defaultValue={
								prefill?.amount ? (prefill.amount / 100).toFixed(2).replace(/\.00$/, "") : undefined
							}
							inputMode="decimal"
							autoComplete="off"
							placeholder="0"
							className="tabular-nums"
							aria-invalid={errors.amount || undefined}
						/>
					</Field>
				</div>
				{/* Keyed like "Pays down": the next one starts at "The same each time" again. */}
				<AmountKindField key={`kind-${commitmentId}`} id={id} />
				<ScheduleFields
					id={id}
					cadence="monthly"
					dueDate={`${month}-01` as DayKey}
					inCard={false}
					invalid={errors.dueDate}
				/>
				{/* Keyed by the Commitment being added, so the next one starts from Nothing again. */}
				<PaysDownField
					key={commitmentId}
					id={id}
					invalid={errors.carried}
					initial={
						prefill?.paysDown && prefill.paysDown !== "add"
							? { accountId: prefill.paysDown }
							: undefined
					}
					startAdding={prefill?.paysDown === "add"}
					suggest
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
