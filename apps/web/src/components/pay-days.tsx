import {
	type MonthKey,
	PAY_DAY_WINDOW_DAYS,
	PAY_SCHEDULE_KINDS,
	PAYCHECK_WITHIN,
	type PayScheduleKind,
	parseDollars,
	usualPayDays,
} from "@noodle/domain";
import { Badge } from "@noodle/ui/components/badge";
import { Button } from "@noodle/ui/components/button";
import { DatePicker } from "@noodle/ui/components/date-picker";
import { Field, FormError } from "@noodle/ui/components/field";
import { List, ListRow } from "@noodle/ui/components/list";
import { OptionSelect } from "@noodle/ui/components/select";
import { Sheet, SheetContent, SheetHeader } from "@noodle/ui/components/sheet";
import { toast } from "@noodle/ui/components/toast";
import { useQuery } from "@tanstack/react-query";
import { useHydrated } from "@tanstack/react-router";
import { Pencil } from "lucide-react";
import { type FormEvent, useId, useState } from "react";
import { ordinal } from "../commitments";
import { formatMoney, formatMoneyInput, monthName, shortDay } from "../format";
import {
	extraPayDayText,
	formDays,
	HOURLY_LABEL,
	notMovedText,
	PAY_SCHEDULE_LABELS,
	PAYCHECK_STATE_LABELS,
	type ParentPayDays,
	paycheckAmount,
	paycheckMeta,
	payDaysQuery,
	payText,
	scheduleOf,
	useSetParentPay,
} from "../pay-days";
import type { PayDayNotMoved } from "../server/pay-days";
import { AmountInput } from "./goals";

// "How you're paid" on Plan › Income (issue 156): each Parent on a salary or hourly, and a
// salaried Parent's expected paychecks for the month, each read as in once Income that is their
// pay has landed near its pay day. A paycheck counts in its pay day's month (ADR-0063); one the
// rule had to leave in the month it landed is said under the list, with why.

const SALARY = "salary";
const HOURLY = "hourly";

const dayChoices = Array.from({ length: 31 }, (_, i) => ({
	value: String(i + 1),
	label: ordinal(i + 1),
}));

/** Each Parent and how they are paid, then the month's expected paychecks of those on a salary. */
export function PayDays({ month }: { month: MonthKey }) {
	const hydrated = useHydrated();
	const { data: parents } = useQuery(payDaysQuery(month));
	const [editing, setEditing] = useState<string | null>(null);
	// Paychecks the last save left in the month they landed in, until the next one.
	const [notMoved, setNotMoved] = useState<PayDayNotMoved[]>([]);
	const edited = parents?.find((parent) => parent.memberId === editing);
	const salaried = (parents ?? []).filter((parent) => parent.pay);
	return (
		<section aria-labelledby="how-paid" data-testid="pay-days" className="grid gap-5">
			<div className="grid gap-1">
				<h2 id="how-paid" className="text-lg font-semibold">
					How you’re paid
				</h2>
				<p className="text-sm text-muted-foreground">
					On a salary, Noodle lists the paychecks to expect each month, says which are in, and
					counts each in its pay day’s month. Hourly pay, or pay that varies, counts as it arrives.
				</p>
			</div>
			{parents ? (
				<List>
					{parents.map((parent) => (
						<ListRow
							key={parent.memberId}
							data-testid="parent-pay"
							title={parent.name}
							meta={payText(parent.pay)}
							trailing={
								<Button
									variant="ghost"
									size="icon"
									type="button"
									disabled={!hydrated}
									aria-label={`Edit how ${parent.name} is paid`}
									onClick={() => setEditing(parent.memberId)}
								>
									<Pencil />
								</Button>
							}
						/>
					))}
				</List>
			) : null}
			{salaried.map((parent) => (
				<ExpectedPaychecks key={parent.memberId} month={month} parent={parent} />
			))}
			{notMoved.length > 0 ? (
				<section aria-labelledby="pay-not-moved" data-testid="pay-not-moved" className="grid gap-2">
					<h3 id="pay-not-moved" className="text-sm font-medium">
						Paychecks left in the month they landed
					</h3>
					<List>
						{notMoved.map((line) => (
							<ListRow
								key={line.lineId}
								title={line.note?.trim() || "Income"}
								meta={notMovedText(line)}
							/>
						))}
					</List>
				</section>
			) : null}
			<Sheet open={edited !== undefined} onOpenChange={(open) => !open && setEditing(null)}>
				{edited ? (
					<SheetContent>
						<SheetHeader
							title={`How ${edited.name} is paid`}
							description="On a salary, say what one paycheck usually is and when it’s due. A paycheck then counts in its pay day’s month; your take-home pay doesn’t change."
						/>
						<ParentPayForm
							parent={edited}
							onDone={(left) => {
								setNotMoved(left);
								setEditing(null);
							}}
						/>
					</SheetContent>
				) : null}
			</Sheet>
		</section>
	);
}

/** One salaried Parent's pay days in the month: "Pay for Oct 1", In with what came and when. */
function ExpectedPaychecks({ month, parent }: { month: MonthKey; parent: ParentPayDays }) {
	const id = useId();
	return (
		<section aria-labelledby={`${id}-title`} className="grid gap-2">
			<h3 id={`${id}-title`} className="text-sm font-medium">
				{parent.name}’s paychecks in {monthName(month)}
			</h3>
			<List>
				{parent.payDays.map((paycheck) => (
					<ListRow
						key={paycheck.day}
						data-testid="expected-paycheck"
						data-state={paycheck.state}
						title={`Pay for ${shortDay(paycheck.day)}`}
						badge={
							<Badge variant={paycheck.state === "in" ? "brand" : "default"}>
								{PAYCHECK_STATE_LABELS[paycheck.state]}
							</Badge>
						}
						meta={paycheckMeta(paycheck, parent.name)}
						trailing={
							<span
								className={
									paycheck.state === "in"
										? "text-sm font-semibold tabular-nums"
										: "text-sm text-muted-foreground tabular-nums"
								}
							>
								{formatMoney(paycheckAmount(paycheck))}
							</span>
						}
					/>
				))}
			</List>
			{parent.pay && parent.payDays.length > usualPayDays(parent.pay.schedule) ? (
				<p data-testid="extra-pay-day" className="text-sm">
					{extraPayDayText(month, parent.payDays.length)}
				</p>
			) : null}
			<p className="text-xs text-muted-foreground">
				A pay day reads In once Income marked as {parent.name}’s pay, within{" "}
				{formatMoney(PAYCHECK_WITHIN)} of the paycheck, lands up to {PAY_DAY_WINDOW_DAYS} days
				either side of it, and that paycheck counts in its pay day’s month, whatever day the bank
				posted it.
			</p>
		</section>
	);
}

/** Salary, with one paycheck and its pay days, or hourly; saved together. */
function ParentPayForm({
	parent,
	onDone,
}: {
	parent: ParentPayDays;
	/** With the paychecks the save left in the month they landed in. */
	onDone: (notMoved: PayDayNotMoved[]) => void;
}) {
	const id = useId();
	const hydrated = useHydrated();
	const change = useSetParentPay();
	const [how, setHow] = useState(parent.pay ? SALARY : HOURLY);
	const [amount, setAmount] = useState(() =>
		parent.pay ? formatMoneyInput(parent.pay.paycheck) : "",
	);
	const [kind, setKind] = useState<PayScheduleKind>(parent.pay?.schedule.kind ?? "twice-a-month");
	const [[first, second], setDays] = useState(() => formDays(parent.pay?.schedule));
	// Every two weeks or weekly: the one pay day the rest are counted from.
	const [anchor, setAnchor] = useState(() => {
		const from = parent.pay?.schedule;
		return from?.kind === "every-two-weeks" || from?.kind === "weekly" ? from.anchor : "";
	});
	const [tried, setTried] = useState(false);
	const cents = parseDollars(amount);
	const counted = kind === "every-two-weeks" || kind === "weekly";
	const schedule = scheduleOf(kind, first, second, anchor);
	const amountError = cents === null || cents <= 0 ? "Enter what one paycheck usually is" : null;
	const daysError = !counted && schedule === null ? "Pick two different days" : null;
	const anchorError = counted && schedule === null ? "Pick one of the pay days" : null;
	// A day some months don't have: said once, under the last day picked.
	const short =
		!counted && (first > 28 || (kind === "twice-a-month" && second > 28))
			? "In a month without that day, it’s the month’s last day."
			: undefined;

	const submit = (event: FormEvent) => {
		event.preventDefault();
		const salary = how === SALARY;
		if (salary && (cents === null || cents <= 0 || schedule === null)) {
			setTried(true);
			return;
		}
		const pay = salary && cents !== null && schedule ? { paycheck: cents, schedule } : null;
		change.mutate(
			{ memberId: parent.memberId, pay },
			{
				onSuccess: (saved) => {
					toast(
						pay
							? `${parent.name} is paid a salary: ${formatMoney(pay.paycheck)} a paycheck`
							: `${parent.name}’s pay is hourly, or varies`,
						{ tone: "success" },
					);
					onDone(saved.notMoved);
				},
			},
		);
	};

	return (
		<form className="grid gap-4" onSubmit={submit} noValidate>
			<Field label="Paid" htmlFor={`${id}-how`}>
				<OptionSelect
					id={`${id}-how`}
					value={how}
					choices={[
						{ value: SALARY, label: "Salary" },
						{ value: HOURLY, label: HOURLY_LABEL },
					]}
					onValueChange={setHow}
				/>
			</Field>
			{how === SALARY ? (
				<>
					<Field
						label="One paycheck"
						htmlFor={`${id}-amount`}
						hint="What usually lands in the account each pay day, after taxes."
						error={tried ? (amountError ?? undefined) : undefined}
					>
						<AmountInput
							id={`${id}-amount`}
							placeholder="0"
							value={amount}
							disabled={!hydrated}
							aria-invalid={(tried && amountError !== null) || undefined}
							onChange={(event) => setAmount(event.currentTarget.value)}
						/>
					</Field>
					<Field label="How often" htmlFor={`${id}-kind`}>
						<OptionSelect
							id={`${id}-kind`}
							value={kind}
							choices={PAY_SCHEDULE_KINDS.map((value) => ({
								value,
								label: PAY_SCHEDULE_LABELS[value],
							}))}
							onValueChange={(value) => setKind(value as PayScheduleKind)}
						/>
					</Field>
					{counted ? (
						<Field
							label="A pay day"
							htmlFor={`${id}-anchor`}
							hint={
								kind === "weekly"
									? "Any one pay day, past or coming up: it’s every week on that day."
									: "Any one pay day, past or coming up: the rest are counted from it, two weeks apart."
							}
							error={tried ? (anchorError ?? undefined) : undefined}
						>
							<DatePicker
								id={`${id}-anchor`}
								value={anchor}
								onChange={setAnchor}
								aria-invalid={(tried && anchorError !== null) || undefined}
							/>
						</Field>
					) : (
						<div className="grid grid-cols-[repeat(auto-fit,minmax(8rem,1fr))] gap-4">
							<Field
								label={kind === "monthly" ? "Pay day" : "First pay day"}
								htmlFor={`${id}-first`}
								hint={kind === "monthly" ? short : undefined}
							>
								<OptionSelect
									id={`${id}-first`}
									value={String(first)}
									choices={dayChoices}
									onValueChange={(value) => setDays([Number(value), second])}
								/>
							</Field>
							{kind === "twice-a-month" ? (
								<Field
									label="Second pay day"
									htmlFor={`${id}-second`}
									hint={daysError ? undefined : short}
									error={daysError ?? undefined}
								>
									<OptionSelect
										id={`${id}-second`}
										value={String(second)}
										choices={dayChoices}
										aria-invalid={daysError !== null || undefined}
										onValueChange={(value) => setDays([first, Number(value)])}
									/>
								</Field>
							) : null}
						</div>
					)}
				</>
			) : (
				<p className="text-sm text-muted-foreground">
					Nothing to set: {parent.name}’s Income counts as it arrives.
				</p>
			)}
			{change.isError ? (
				<FormError>We couldn’t save that, so nothing has changed. Try again.</FormError>
			) : null}
			<Button type="submit" disabled={!hydrated || change.isPending}>
				Save
			</Button>
		</form>
	);
}
