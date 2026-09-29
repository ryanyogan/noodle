import {
	type CommitmentState,
	type DayKey,
	type MonthKey,
	monthOfDay,
	nextDueDate,
	parseDollars,
} from "@noodle/domain";
import { Badge } from "@noodle/ui/components/badge";
import { Button } from "@noodle/ui/components/button";
import { Input } from "@noodle/ui/components/input";
import { List, ListRow } from "@noodle/ui/components/list";
import { Section, SectionHeader } from "@noodle/ui/components/section";
import { Tile } from "@noodle/ui/components/tile";
import { Link, useHydrated } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { type FormEvent, useId, useState } from "react";
import { ulid } from "ulid";
import { monogram } from "../buckets";
import { cadenceNames, type PaymentVariables, useCommitmentPayment } from "../commitments";
import { formatMoney, formatMoneyInput, fullDay, shortDay } from "../format";

const list = new Intl.ListFormat("en-US", { style: "long", type: "conjunction" });

/** How a Commitment's charge differs from what was expected, or null when it doesn't. */
const differsBy = ({ difference }: CommitmentState) =>
	difference > 0
		? `${formatMoney(difference)} more than expected`
		: difference < 0
			? `${formatMoney(-difference)} less than expected`
			: null;

/** "Due Oct 2, 16, and 30", "1 of 3 paid · next due Oct 16", "Paid". */
function progress({ dueDates, charges }: CommitmentState) {
	if (charges === 0) return `Due ${list.format(dueDates.map(shortDay))}`;
	const next = dueDates[charges];
	return next ? `${charges} of ${dueDates.length} paid · next due ${shortDay(next)}` : "Paid";
}

/**
 * The month's Commitments, each with what's been paid against what's expected. A charge that
 * differs from the expected amount is flagged. In the current month, a payment can be recorded.
 * Those not due this month are collapsed under "Not this month".
 */
export function Commitments({
	month,
	asOf,
	commitments,
	notDue,
}: {
	month: MonthKey;
	/** Today; payments are recorded today, so only this month's can be. */
	asOf: DayKey;
	/** Due this month, or paid anyway. */
	commitments: CommitmentState[];
	notDue: CommitmentState[];
}) {
	// Owned here, not by a row, so a failed payment's Retry outlives the row's form.
	const payment = useCommitmentPayment();
	const canPay = monthOfDay(asOf) === month;
	const paid = commitments.reduce((sum, c) => sum + c.actual, 0);
	const expected = commitments.reduce((sum, c) => sum + c.expected, 0);
	return (
		<Section aria-labelledby="commitments">
			<SectionHeader
				id="commitments"
				title="Commitments"
				count={commitments.length}
				action={
					commitments.length > 0 ? (
						<span className="text-[13px] text-muted-foreground tabular-nums">
							{formatMoney(paid)} of {formatMoney(expected)} paid
						</span>
					) : undefined
				}
			/>
			{commitments.length > 0 ? (
				<List>
					{commitments.map((commitment) => (
						<CommitmentRow
							key={commitment.id}
							commitment={commitment}
							onPay={
								canPay && commitment.charges < commitment.dueDates.length
									? (amountCents) =>
											payment.mutate({
												transactionId: ulid(),
												commitmentId: commitment.id,
												commitmentName: commitment.name,
												amountCents,
												date: asOf,
											} satisfies PaymentVariables)
									: undefined
							}
						/>
					))}
				</List>
			) : null}
			{notDue.length > 0 ? <NotThisMonth month={month} commitments={notDue} /> : null}
		</Section>
	);
}

/** Commitments in the Plan but not due this month, collapsed, each with when it's next due. */
function NotThisMonth({ month, commitments }: { month: MonthKey; commitments: CommitmentState[] }) {
	return (
		<details className="group">
			<summary className="flex min-h-9 cursor-pointer list-none items-center gap-1.5 px-1 text-[13px] text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
				<ChevronRight
					aria-hidden="true"
					className="size-4 transition-transform group-open:rotate-90"
				/>
				Not this month
				<Badge variant="count">{commitments.length}</Badge>
			</summary>
			<List>
				{commitments.map((commitment) => (
					<ListRow
						key={commitment.id}
						leading={<Tile>{monogram(commitment.name)}</Tile>}
						title={<CommitmentLink commitment={commitment} />}
						meta={`${cadenceNames[commitment.cadence]} · next due ${fullDay(
							nextDueDate(commitment, `${month}-01`),
						)}`}
						trailing={
							<span className="text-sm font-medium tabular-nums">
								{formatMoney(commitment.amount)}
							</span>
						}
					/>
				))}
			</List>
		</details>
	);
}

/** A Commitment's name, linking to its page. */
export function CommitmentLink({ commitment }: { commitment: { id: string; name: string } }) {
	return (
		<Link to="/plan/commitments/$id" params={{ id: commitment.id }} className="hover:underline">
			{commitment.name}
		</Link>
	);
}

function CommitmentRow({
	commitment,
	onPay,
}: {
	commitment: CommitmentState;
	onPay?: (amountCents: number) => void;
}) {
	const differs = differsBy(commitment);
	return (
		<ListRow
			aria-label={`${commitment.name}: ${formatMoney(commitment.actual)} paid of ${formatMoney(
				commitment.expected,
			)} expected${differs ? `, ${differs}` : ""}`}
			leading={<Tile>{monogram(commitment.name)}</Tile>}
			title={<CommitmentLink commitment={commitment} />}
			meta={
				<>
					{progress(commitment)}
					{differs ? (
						<Badge variant={commitment.difference > 0 ? "over" : "default"} dot>
							{differs}
						</Badge>
					) : null}
				</>
			}
			trailing={
				<>
					<span className="text-sm font-semibold tabular-nums">
						{formatMoney(commitment.actual)}
					</span>
					<span className="text-xs text-subtle-foreground tabular-nums">
						of {formatMoney(commitment.expected)}
					</span>
				</>
			}
			below={onPay ? <RecordPayment commitment={commitment} onPay={onPay} /> : undefined}
		/>
	);
}

/** Records paying a Commitment today, for the expected amount unless the Parent changes it. */
function RecordPayment({
	commitment,
	onPay,
}: {
	commitment: CommitmentState;
	onPay: (amountCents: number) => void;
}) {
	const hydrated = useHydrated();
	const id = useId();
	const [open, setOpen] = useState(false);
	const [invalid, setInvalid] = useState(false);

	function onSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const amountCents = parseDollars(String(new FormData(event.currentTarget).get("amount")));
		setInvalid(!amountCents);
		if (!amountCents) return;
		onPay(amountCents);
		setOpen(false);
	}

	if (!open) {
		return (
			<Button
				type="button"
				variant="ghost"
				size="sm"
				className="-ms-2.5"
				disabled={!hydrated}
				onClick={() => setOpen(true)}
			>
				Record payment
			</Button>
		);
	}
	return (
		<form onSubmit={onSubmit} className="flex flex-wrap items-center gap-2">
			<label htmlFor={id} className="sr-only">
				Amount paid to {commitment.name}
			</label>
			<div className="relative w-32">
				<span
					aria-hidden="true"
					className="pointer-events-none absolute inset-y-0 left-3 grid place-items-center text-muted-foreground text-sm"
				>
					$
				</span>
				<Input
					id={id}
					name="amount"
					inputMode="decimal"
					autoComplete="off"
					enterKeyHint="done"
					autoFocus
					defaultValue={formatMoneyInput(commitment.amount)}
					className="pl-6 text-end tabular-nums"
					aria-invalid={invalid || undefined}
				/>
			</div>
			<Button type="submit" size="sm">
				Record
			</Button>
			<Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
				Cancel
			</Button>
		</form>
	);
}
