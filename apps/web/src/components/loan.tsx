import {
	addMonths,
	type Cents,
	type DayKey,
	endsAfter,
	type LoanFacts,
	loanInStep,
	loanPaid,
	loanPaidOffOn,
	MAX_SCHEDULED_PAYMENTS,
	monthOfDay,
	NO_LOAN_FACTS,
	parseDollars,
	paymentSchedule,
	paymentsUntil,
	type SchedulePayment,
} from "@noodle/domain";
import { Badge } from "@noodle/ui/components/badge";
import { Button } from "@noodle/ui/components/button";
import { Card } from "@noodle/ui/components/card";
import { Field } from "@noodle/ui/components/field";
import { Input } from "@noodle/ui/components/input";
import { List, ListRow } from "@noodle/ui/components/list";
import { Section, SectionHeader } from "@noodle/ui/components/section";
import {
	Sheet,
	SheetCancel,
	SheetContent,
	SheetFooter,
	SheetHeader,
} from "@noodle/ui/components/sheet";
import { Stat, StatGrid } from "@noodle/ui/components/stat";
import { Switch } from "@noodle/ui/components/switch";
import { toast } from "@noodle/ui/components/toast";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { Link, useHydrated } from "@tanstack/react-router";
import { Pencil, Plus } from "lucide-react";
import { type FormEvent, useId, useRef, useState } from "react";
import { ulid } from "ulid";
import { formatMoney, formatMoneyInput, fullDay, monthName, shortDay } from "../format";
import {
	type AccountView,
	type PaymentCommitmentVariables,
	useAddPaymentCommitment,
	useGoals,
	useSetLoanFacts,
} from "../goals";
import { commitmentsQuery, followedCardsQuery, goalsQuery } from "../queries";
import { AmountInput } from "./goals";
import { SaveFailed } from "./plan-editing";

// A loan's facts, its payments made and still to come against the schedule, the day it was paid
// off, and the monthly Commitment for an Account's payments (issue 153): the fields the
// add-Account form and the loan's own page share.

/** The choice's words, wherever it is offered. */
export const PAYMENT_COMMITMENT = "Add a monthly Commitment for its payments";

/** "the 1st", "the 22nd", "the 31st". */
export function dayOfMonth(day: number): string {
	const tens = day % 100;
	const suffix = tens >= 11 && tens <= 13 ? "th" : (["th", "st", "nd", "rd"][day % 10] ?? "th");
	return `the ${day}${suffix}`;
}

const blank = (text: string) => text.trim() === "";
const wholeNumber = (text: string, max: number) => {
	const value = Number(text.trim());
	return /^\d+$/.test(text.trim()) && value >= 1 && value <= max ? value : null;
};

/**
 * What a Parent has typed about a loan: what was borrowed, the payment, its due day and how many
 * payments are left. The day it ends is what's kept (the last of that many payments from today);
 * how many are left is worked out from it again, so the two can't disagree.
 */
export function useLoanFields(initial: LoanFacts, today: DayKey, alone = false) {
	// `alone`: the form is only for the Commitment, so there is no choice below to turn off.
	const orOff = alone ? "." : ", or turn off the Commitment below.";
	const leftAtFirst =
		initial.endsOn !== null && initial.dueDay !== null
			? paymentsUntil(initial.endsOn, initial.dueDay, today)
			: 0;
	const first = {
		borrowed: initial.borrowed === null ? "" : formatMoneyInput(initial.borrowed),
		payment: initial.payment === null ? "" : formatMoneyInput(initial.payment),
		dueDay: initial.dueDay === null ? "" : String(initial.dueDay),
		left: leftAtFirst > 0 ? String(leftAtFirst) : "",
	};
	const [text, setText] = useState(first);
	const [tried, setTried] = useState(false);
	const amount = (value: string) => {
		const cents = blank(value) ? null : parseDollars(value);
		return cents !== null && cents > 0 ? cents : null;
	};
	const borrowed = amount(text.borrowed);
	const payment = amount(text.payment);
	const dueDay = wholeNumber(text.dueDay, 31);
	const left = wholeNumber(text.left, MAX_SCHEDULED_PAYMENTS);
	const badAmount = "Enter an amount above $0, like 50 or 49.99.";
	return {
		text,
		set: (field: keyof typeof first, value: string) => setText({ ...text, [field]: value }),
		reset: () => {
			setText(first);
			setTried(false);
		},
		payment,
		dueDay,
		/**
		 * What stops the form saving, by field, once it was tried. `commitment`: the payment and
		 * its due day are needed, since a Commitment is being added for them.
		 */
		errors: (commitment: boolean) => {
			if (!tried) return {};
			return {
				borrowed: !blank(text.borrowed) && borrowed === null ? badAmount : null,
				payment:
					!blank(text.payment) && payment === null
						? badAmount
						: commitment && payment === null
							? `Say what one payment is${orOff}`
							: null,
				dueDay:
					!blank(text.dueDay) && dueDay === null
						? "A day of the month, 1 to 31."
						: commitment && dueDay === null
							? `Say the day it’s due${orOff}`
							: left !== null && dueDay === null
								? "Say the day it’s due, so Noodle can date the payments left."
								: null,
				left: !blank(text.left) && left === null ? "A whole number of payments, 1 or more." : null,
			};
		},
		/** The facts as typed, or null (and the errors show) when something stops them saving. */
		check: (commitment: boolean): LoanFacts | null => {
			setTried(true);
			const bad =
				(!blank(text.borrowed) && borrowed === null) ||
				(!blank(text.payment) && payment === null) ||
				(!blank(text.dueDay) && dueDay === null) ||
				(!blank(text.left) && left === null) ||
				(left !== null && dueDay === null) ||
				(commitment && (payment === null || dueDay === null));
			if (bad) return null;
			return {
				borrowed,
				payment,
				dueDay,
				// Untouched, the day it ends stays the day that was said.
				endsOn:
					text.left === first.left && text.dueDay === first.dueDay
						? initial.endsOn
						: left !== null && dueDay !== null
							? endsAfter(left, dueDay, today)
							: null,
			};
		},
	};
}

export type LoanFields = ReturnType<typeof useLoanFields>;

/**
 * The loan's fields: what was borrowed, the payment, its due day and the payments left. `only`
 * "payment" keeps to the payment and its due day, for a card's Commitment.
 */
export function LoanFieldset({
	id,
	fields,
	commitment,
	only,
	disabled,
}: {
	id: string;
	fields: LoanFields;
	/** A Commitment is being added for its payments: the payment and due day are needed. */
	commitment: boolean;
	only?: "payment";
	disabled?: boolean;
}) {
	const errors = fields.errors(commitment);
	const described = (field: keyof typeof errors) =>
		errors[field] ? { "aria-invalid": true, "aria-describedby": `${id}-${field}-error` } : {};
	return (
		<div className="grid gap-3 sm:grid-cols-2">
			{only ? null : (
				<Field
					label="Borrowed"
					htmlFor={`${id}-borrowed`}
					hint="What the loan was at the start. Optional."
					error={errors.borrowed}
				>
					<AmountInput
						id={`${id}-borrowed`}
						disabled={disabled}
						value={fields.text.borrowed}
						placeholder="0"
						{...described("borrowed")}
						onChange={(event) => fields.set("borrowed", event.currentTarget.value)}
					/>
				</Field>
			)}
			<Field
				label="Payment"
				htmlFor={`${id}-payment`}
				hint="What one monthly payment is."
				error={errors.payment}
			>
				<AmountInput
					id={`${id}-payment`}
					disabled={disabled}
					value={fields.text.payment}
					placeholder="0"
					{...described("payment")}
					onChange={(event) => fields.set("payment", event.currentTarget.value)}
				/>
			</Field>
			<Field
				label="Due day"
				htmlFor={`${id}-dueDay`}
				hint="The day of the month, 1 to 31."
				error={errors.dueDay}
			>
				<Input
					id={`${id}-dueDay`}
					type="text"
					inputMode="numeric"
					autoComplete="off"
					maxLength={2}
					disabled={disabled}
					value={fields.text.dueDay}
					placeholder="15"
					{...described("dueDay")}
					onChange={(event) => fields.set("dueDay", event.currentTarget.value)}
				/>
			</Field>
			{only ? null : (
				<Field
					label="Payments left"
					htmlFor={`${id}-left`}
					hint="How many are still to come. Optional: Noodle works it out from what’s owed and the payment."
					error={errors.left}
				>
					<Input
						id={`${id}-left`}
						type="text"
						inputMode="numeric"
						autoComplete="off"
						maxLength={3}
						disabled={disabled}
						value={fields.text.left}
						{...described("left")}
						onChange={(event) => fields.set("left", event.currentTarget.value)}
					/>
				</Field>
			)}
		</div>
	);
}

/** The choice itself: a switch with what turning it on does. */
export function PaymentCommitmentSwitch({
	id,
	checked,
	onCheckedChange,
	group,
	disabled,
}: {
	id: string;
	checked: boolean;
	onCheckedChange: (checked: boolean) => void;
	/** The group it lands in on Plan › Commitments. */
	group: "Loans" | "Credit cards";
	disabled?: boolean;
}) {
	return (
		<div className="flex items-start gap-3">
			<Switch
				id={id}
				className="mt-0.5"
				checked={checked}
				onCheckedChange={onCheckedChange}
				disabled={disabled}
				aria-describedby={`${id}-about`}
			/>
			<div className="grid min-w-0 gap-0.5">
				<label htmlFor={id} className="text-sm font-medium">
					{PAYMENT_COMMITMENT}
				</label>
				<p id={`${id}-about`} className="text-[13px] text-muted-foreground">
					It goes in the Plan under {group}, named after the Account. Each payment filed in it
					brings what’s owed down.
				</p>
			</div>
		</div>
	);
}

/** The Commitments still in the Plan that pay an Account down; undefined until they are read. */
function usePaying(accountId: string) {
	const { month } = useGoals();
	const commitments = useQuery(commitmentsQuery()).data?.commitments;
	return commitments?.filter(
		(c) => c.accountId === accountId && (c.endedFromMonth === null || c.endedFromMonth > month),
	);
}

/** How many of a loan's payments to come, and of those made, its page lists before "Show all". */
const PAYMENTS_TO_COME = 6;
const PAYMENTS_MADE = 6;

/**
 * A loan as its page reads it (issue 153, phase d): its facts in step with the monthly Commitment
 * that pays it down, every payment that moved what's owed held against the schedule, and the day
 * it was paid off. `listsEvery` says the schedule shows every payment the Payments section would,
 * so that section needn't list them again.
 */
export function useLoan(
	account: AccountView,
	balanceDay: DayKey | null,
	connected: boolean,
	/** A payment and due day just saved: shown at once, until the Commitment's terms are read again. */
	saved?: { payment: Cents; dueDay: number } | null,
) {
	const data = useGoals();
	const records = useSuspenseQuery(goalsQuery()).data;
	const plan = useQuery(commitmentsQuery()).data;
	const linked = plan?.commitments.filter((c) => c.accountId === account.id) ?? [];
	const paying = linked.filter(
		(c) =>
			c.fromMonth <= data.month && (c.endedFromMonth === null || c.endedFromMonth > data.month),
	);
	// The terms in force this month of the first monthly Commitment paying it down.
	const inStep = paying
		.map((commitment) => ({
			commitment,
			terms: plan?.commitmentTerms
				.filter((t) => t.commitmentId === commitment.id && t.month <= data.month)
				.reduce<(typeof plan.commitmentTerms)[number] | null>(
					(latest, t) => (latest === null || t.month > latest.month ? t : latest),
					null,
				),
		}))
		.find(({ terms }) => terms?.cadence === "monthly");
	const inForce = loanInStep(account.loan ?? NO_LOAN_FACTS, inStep?.terms);
	const loan = saved && inStep ? { ...inForce, ...saved } : inForce;
	const filed = records.payments.filter((p) => p.accountId === account.id);
	// A payment marked as a Transfer counts where it moved what's owed: the bank's own figure
	// has it on a connected loan, and by hand only one that came off.
	const sent = (records.sent ?? []).filter((p) => p.accountId === account.id);
	const moved = sent.filter((p) => connected || p.comesOff);
	const schedule = paymentSchedule({
		owed: account.owed,
		payment: loan.payment,
		dueDay: loan.dueDay,
		endsOn: loan.endsOn,
		today: data.asOf,
		payments: [...filed, ...moved],
	});
	const paidOffOn =
		account.latestBalance && balanceDay
			? loanPaidOffOn({ amount: account.latestBalance.amount, day: balanceDay }, filed, connected)
			: null;
	const made = schedule?.payments.filter((p) => p.paid > 0 || p.state === "missed") ?? [];
	return {
		loan,
		/** The Commitment whose terms are the loan's payment and due day, when one is. */
		commitment: inStep?.commitment ?? null,
		/** The Commitment that left the Plan because the loan was paid off. */
		ended:
			paidOffOn === null
				? null
				: (linked.find(
						(c) => c.paidOffOn && c.endedFromMonth === addMonths(monthOfDay(c.paidOffOn), 1),
					) ?? null),
		schedule,
		made,
		toCome: schedule?.payments.filter((p) => p.state === "due" || p.state === "to-come") ?? [],
		paidOffOn,
		listsEvery: made.length > 0 && moved.length === sent.length,
	};
}

const STATE_NAMES = { paid: "Paid", partly: "Partly paid", missed: "Missed" } as const;

/** A payment made, or missed, against the schedule: its state, then what was really paid and when. */
function MadeRow({ payment, year }: { payment: SchedulePayment; year: string }) {
	const when = (day: DayKey) => (day.slice(0, 4) === year ? shortDay(day) : fullDay(day));
	const state = payment.state === "paid" || payment.state === "partly" ? payment.state : "missed";
	const paidOn = payment.paidOn
		? payment.payments > 1
			? `${payment.payments} payments, the last ${when(payment.paidOn)}`
			: `Paid ${when(payment.paidOn)}`
		: "Nothing paid that month";
	return (
		<ListRow
			data-payment-state={state}
			title={`Due ${when(payment.date)}`}
			badge={
				<Badge dot={state === "paid"} variant={state === "paid" ? "default" : "pace"}>
					{STATE_NAMES[state]}
				</Badge>
			}
			meta={
				state === "partly"
					? `${paidOn} · ${formatMoney(payment.paid)} of ${formatMoney(payment.amount)}`
					: paidOn
			}
			trailing={
				<span className="text-sm font-semibold tabular-nums">{formatMoney(payment.paid)}</span>
			}
		/>
	);
}

/**
 * A loan's own section on its Account page: what was borrowed and paid so far, the payment and
 * its due day, each payment made held against the schedule, the payments still to come with the
 * day it is paid off (or the day it was), and, while no Commitment pays it down, the offer to add
 * one. What's owed is the Account's, shown above it.
 */
export function LoanSection({
	account,
	balanceDay,
	connected,
}: {
	account: AccountView;
	/** The day its latest balance was true, and whether its bank keeps what's owed. */
	balanceDay: DayKey | null;
	connected: boolean;
}) {
	const hydrated = useHydrated();
	const data = useGoals();
	const [editing, setEditing] = useState(false);
	const [showAll, setShowAll] = useState(false);
	const [showAllMade, setShowAllMade] = useState(false);
	// The payment and due day last saved here, which are the Commitment's terms from this month
	// on: shown at once, without waiting for every Commitment to be read again.
	const [saved, setSaved] = useState<{ payment: Cents; dueDay: number } | null>(null);
	const { loan, commitment, ended, schedule, made, toCome, paidOffOn } = useLoan(
		account,
		balanceDay,
		connected,
		saved,
	);
	// What the Commitment's terms become with the facts being saved, said once they have.
	const changing = useRef<string | null>(null);
	const setFacts = useSetLoanFacts({
		onSuccess: () => {
			if (changing.current) toast(changing.current);
			changing.current = null;
		},
		onError: () => setSaved(null),
	});
	const said = Object.values(loan).some((fact) => fact !== null);
	const paid = loanPaid(loan.borrowed, account.owed);
	const paidOff = account.owed !== null && account.owed <= 0;
	const lastDay = schedule?.paidOffOn ?? null;
	const shown = toCome.slice(0, showAll ? undefined : PAYMENTS_TO_COME);
	const shownMade = showAllMade ? made : made.slice(-PAYMENTS_MADE);
	// Past the day a Parent said it ends with money still owed: said plainly, and its Commitment
	// stays in the Plan until it is paid off (ADR-0050).
	const pastEnd =
		!paidOff && loan.endsOn !== null && loan.endsOn < data.asOf && account.owed !== null
			? loan.endsOn
			: null;
	// The end a Parent gave and the one the payment makes are different months: say both.
	const saidEnd =
		pastEnd === null && lastDay && loan.payment !== null && loan.endsOn !== null
			? monthOfDay(lastDay) === monthOfDay(loan.endsOn)
				? null
				: loan.endsOn
			: null;
	// Its payoff Goal counts from what was owed when the Goal began, the loan from what was borrowed.
	const goal = data.goals.find((g) => g.id === account.payoffGoal?.id && g.state === "active");
	const goalDiffers = goal && paid !== null && goal.progress.saved !== paid ? goal : null;
	return (
		<Section aria-labelledby="account-loan">
			<SectionHeader
				id="account-loan"
				title="Loan"
				action={
					said ? (
						<Button
							type="button"
							variant="ghost"
							size="sm"
							disabled={!hydrated}
							aria-label={`Edit ${account.name}’s loan`}
							onClick={() => setEditing(true)}
						>
							<Pencil />
							Edit
						</Button>
					) : null
				}
			/>
			<Card className="grid gap-3 p-(--card-pad)">
				{said ? (
					<StatGrid className="grid-cols-[repeat(auto-fit,minmax(min(100%,8.5rem),1fr))]">
						{loan.borrowed !== null ? (
							<Stat label="Borrowed" value={formatMoney(loan.borrowed)} />
						) : null}
						{paid !== null ? <Stat label="Paid so far" value={formatMoney(paid)} /> : null}
						{loan.payment !== null || loan.dueDay !== null ? (
							<Stat
								label="Payment"
								value={loan.payment !== null ? formatMoney(loan.payment) : "Not said"}
								note={loan.dueDay !== null ? `Due on ${dayOfMonth(loan.dueDay)}` : undefined}
							/>
						) : null}
						{schedule && schedule.left > 0 ? (
							<Stat label="Payments left" value={String(schedule.left)} />
						) : null}
						{lastDay ? <Stat label="Paid off on" value={fullDay(lastDay)} /> : null}
						{paidOff && paidOffOn ? <Stat label="Paid off" value={fullDay(paidOffOn)} /> : null}
					</StatGrid>
				) : (
					<>
						<p className="text-sm text-muted-foreground">
							Say what was borrowed, the payment and the day it’s due, and Noodle lists the payments
							still to come and the day it’s paid off.
						</p>
						<Button
							type="button"
							variant="outline"
							className="justify-self-start"
							disabled={!hydrated}
							onClick={() => setEditing(true)}
						>
							<Plus />
							Add the loan’s facts
						</Button>
					</>
				)}
				{paidOff ? (
					<p data-slot="loan-paid-off" className="text-sm font-medium">
						{paidOffOn
							? `Paid off ${fullDay(paidOffOn)}.`
							: "Nothing is owed on it: it’s paid off."}
						{ended && paidOffOn ? (
							<span className="font-normal text-muted-foreground">
								{" "}
								{ended.name}, its Commitment, is in the Plan through{" "}
								{monthName(monthOfDay(paidOffOn))} and not after. A payment taken back, or what’s
								owed set above $0, plans it again.
							</span>
						) : null}
					</p>
				) : said && schedule === null ? (
					<p className="text-[13px] text-muted-foreground">
						{account.owed === null
							? "Add what’s owed and Noodle lists the payments still to come."
							: "Add the payment and the day it’s due and Noodle lists the payments still to come."}
					</p>
				) : null}
				{pastEnd && account.owed !== null ? (
					<p data-slot="loan-past-end" className="text-sm font-medium">
						Its last payment was to be {fullDay(pastEnd)}, and {formatMoney(account.owed)} is still
						owed.
						<span className="font-normal text-muted-foreground">
							{" "}
							{commitment
								? `${commitment.name} stays in the Plan until it’s paid off.`
								: "The payments to come are worked out from what’s owed."}
						</span>
					</p>
				) : null}
				{saidEnd && lastDay && loan.payment !== null ? (
					<p className="text-[13px] text-muted-foreground">
						You said its last payment is {fullDay(saidEnd)}. At {formatMoney(loan.payment)} a month
						with no interest, what’s owed is paid off {fullDay(lastDay)}.
					</p>
				) : null}
				{goalDiffers ? (
					<p data-slot="loan-goal" className="text-[13px] text-muted-foreground">
						Paid so far counts from what was borrowed. {goalDiffers.name}, its payoff Goal, counts
						from the {formatMoney(goalDiffers.target)} owed when it began: both read the same what’s
						owed.
					</p>
				) : null}
			</Card>
			{made.length > 0 ? (
				<>
					<p className="px-1 text-[13px] font-medium text-muted-foreground">
						Payments made · each month’s against the schedule
					</p>
					{made.length > PAYMENTS_MADE && !showAllMade ? (
						<Button
							type="button"
							variant="ghost"
							size="sm"
							className="justify-self-start"
							disabled={!hydrated}
							onClick={() => setShowAllMade(true)}
						>
							Show all {made.length} months
						</Button>
					) : null}
					<List aria-label={`Payments made on ${account.name}`}>
						{shownMade.map((payment) => (
							<MadeRow key={payment.date} payment={payment} year={data.asOf.slice(0, 4)} />
						))}
					</List>
				</>
			) : null}
			{toCome.length > 0 && schedule ? (
				<>
					<p className="px-1 text-[13px] font-medium text-muted-foreground">
						Payments to come · no interest counted; what the lender takes is what counts
					</p>
					<List aria-label={`Payments to come on ${account.name}`}>
						{shown.map((payment, index) => (
							<ListRow
								key={payment.date}
								data-payment-state={payment.state}
								title={fullDay(payment.date)}
								badge={payment.state === "due" ? <Badge variant="pace">Due</Badge> : undefined}
								meta={
									index === schedule.left - 1
										? "Last payment"
										: `Payment ${index + 1} of ${schedule.left}`
								}
								trailing={
									<span className="text-sm font-semibold tabular-nums">
										{formatMoney(payment.amount)}
									</span>
								}
							/>
						))}
					</List>
					{toCome.length > PAYMENTS_TO_COME && !showAll ? (
						<Button
							type="button"
							variant="ghost"
							size="sm"
							className="justify-self-start"
							disabled={!hydrated}
							onClick={() => setShowAll(true)}
						>
							Show all {toCome.length} payments
						</Button>
					) : null}
				</>
			) : null}
			{paidOff ? null : <PaymentCommitmentOffer account={account} />}
			<SaveFailed change={setFacts} />
			<Sheet open={editing} onOpenChange={setEditing}>
				{editing ? (
					<SheetContent>
						<SheetHeader
							title={`${account.name}’s loan`}
							description={
								commitment
									? `A new payment or due day changes ${commitment.name}, its Commitment, from ${monthName(data.month)} on.`
									: "All optional. What’s owed is updated above, on the Account."
							}
						/>
						<LoanFactsForm
							loan={loan}
							today={data.asOf}
							paidDown={commitment !== null}
							onSave={(facts) => {
								setEditing(false);
								const payment = facts.payment ?? loan.payment;
								const dueDay = facts.dueDay ?? loan.dueDay;
								const changed =
									commitment !== null &&
									payment !== null &&
									dueDay !== null &&
									(payment !== loan.payment || dueDay !== loan.dueDay)
										? { name: commitment.name, payment, dueDay }
										: null;
								changing.current = changed
									? `${changed.name} is ${formatMoney(changed.payment)} on ${dayOfMonth(changed.dueDay)} of each month from ${monthName(data.month)} on.`
									: null;
								if (changed) setSaved({ payment: changed.payment, dueDay: changed.dueDay });
								setFacts.mutate({ accountId: account.id, ...facts });
							}}
						/>
					</SheetContent>
				) : null}
			</Sheet>
		</Section>
	);
}

function LoanFactsForm({
	loan,
	today,
	paidDown,
	onSave,
}: {
	loan: LoanFacts;
	today: DayKey;
	/** A monthly Commitment pays it down: its payment and due day are that Commitment's, so needed. */
	paidDown: boolean;
	onSave: (facts: LoanFacts) => void;
}) {
	const hydrated = useHydrated();
	const id = useId();
	const fields = useLoanFields(loan, today, paidDown);
	function onSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const facts = fields.check(paidDown);
		if (facts) onSave(facts);
	}
	return (
		<form onSubmit={onSubmit} noValidate className="grid gap-4">
			<LoanFieldset id={id} fields={fields} commitment={paidDown} disabled={!hydrated} />
			<SheetFooter>
				<SheetCancel />
				<Button type="submit" disabled={!hydrated}>
					Save
				</Button>
			</SheetFooter>
		</form>
	);
}

/**
 * "Add a monthly Commitment for its payments", on the page of a loan, or of a credit card Noodle
 * doesn't follow, while no Commitment in the Plan pays it down. With the loan's payment and due
 * day known it is added at once; otherwise a sheet asks for them first.
 */
export function PaymentCommitmentOffer({ account }: { account: AccountView }) {
	const hydrated = useHydrated();
	const { month } = useGoals();
	const paying = usePaying(account.id);
	const followed = useQuery(followedCardsQuery()).data;
	const [asking, setAsking] = useState(false);
	const add = useAddPaymentCommitment({
		onSuccess: (commitment) =>
			toast(
				`${account.name} is a Commitment in the Plan now: ${formatMoney(commitment.amountCents)} on ${dayOfMonth(commitment.dueDay)} of each month.`,
			),
	});
	const isLoan = account.kind === "loan";
	// A card is offered it only when its purchases don't get into Noodle: paying any other is a
	// Transfer, and a Commitment for it would count its purchases twice (ADR-0050).
	const mayHave =
		isLoan ||
		(account.kind === "credit-card" &&
			account.purchases === "none" &&
			followed !== undefined &&
			!followed.includes(account.id));
	if (!mayHave || paying === undefined) return null;
	if (paying.length > 0) {
		// Just added: say where it went, in the Section a card has no Payments line for.
		return add.isSuccess && paying[0] ? (
			<p className="px-1 text-sm text-muted-foreground">
				Its payments are planned in{" "}
				<Link
					to="/plan/$month/commitments/$id"
					params={{ month, id: paying[0].id }}
					className="font-medium text-foreground underline underline-offset-3"
				>
					{paying[0].name}
				</Link>
				.
			</p>
		) : null;
	}
	const loan = account.loan ?? NO_LOAN_FACTS;
	const save = (commitment: PaymentCommitmentVariables) =>
		add.mutate({ accountId: account.id, ...commitment });
	return (
		<>
			<Card data-slot="payment-commitment-offer" className="grid gap-2 p-(--card-pad)">
				<p className="text-sm text-muted-foreground">
					No Commitment in the Plan pays {account.name} down yet. Add a monthly one for its
					payments, and each payment filed in it brings what’s owed down.
				</p>
				<Button
					type="button"
					variant="outline"
					className="min-h-11 justify-self-start"
					disabled={!hydrated || add.isPending}
					onClick={() => {
						if (loan.payment !== null && loan.dueDay !== null) {
							save({ commitmentId: ulid(), amountCents: loan.payment, dueDay: loan.dueDay });
						} else setAsking(true);
					}}
				>
					<Plus />
					Add a monthly Commitment
				</Button>
			</Card>
			<SaveFailed change={add} />
			<Sheet open={asking} onOpenChange={setAsking}>
				{asking ? (
					<SheetContent>
						<SheetHeader
							title={PAYMENT_COMMITMENT}
							description={`It goes in the Plan under ${isLoan ? "Loans" : "Credit cards"}, named ${account.name}. Each payment filed in it brings what’s owed down.`}
						/>
						<PaymentCommitmentForm
							loan={loan}
							onSave={(amountCents, dueDay) => {
								setAsking(false);
								save({ commitmentId: ulid(), amountCents, dueDay });
							}}
						/>
					</SheetContent>
				) : null}
			</Sheet>
		</>
	);
}

function PaymentCommitmentForm({
	loan,
	onSave,
}: {
	loan: LoanFacts;
	onSave: (amountCents: Cents, dueDay: number) => void;
}) {
	const hydrated = useHydrated();
	const id = useId();
	const { asOf } = useGoals();
	const fields = useLoanFields(loan, asOf, true);
	function onSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const facts = fields.check(true);
		if (facts?.payment && facts.dueDay) onSave(facts.payment, facts.dueDay);
	}
	return (
		<form onSubmit={onSubmit} noValidate className="grid gap-4">
			<LoanFieldset id={id} fields={fields} commitment only="payment" disabled={!hydrated} />
			<SheetFooter>
				<SheetCancel />
				<Button type="submit" disabled={!hydrated}>
					Add Commitment
				</Button>
			</SheetFooter>
		</form>
	);
}
