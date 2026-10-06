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
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@noodle/ui/components/collapsible";
import { Input } from "@noodle/ui/components/input";
import { List, ListRow } from "@noodle/ui/components/list";
import { Tile } from "@noodle/ui/components/tile";
import { Link, useHydrated } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { type FormEvent, useId, useState } from "react";
import { ulid } from "ulid";
import { monogram } from "../buckets";
import {
	cadenceNames,
	type PaymentVariables,
	partPaid,
	useCommitmentPayment,
} from "../commitments";
import { formatMoney, formatMoneyInput, fullDay, shortDay } from "../format";
import { masterDetailItem } from "./master-detail";
import { PaysDownNote } from "./pays-down";

const list = new Intl.ListFormat("en-US", { style: "long", type: "conjunction" });

/** How a Commitment's charge differs from what was expected, or null when it doesn't. */
const differsBy = (commitment: CommitmentState) =>
	commitment.difference > 0
		? `${formatMoney(commitment.difference)} more than expected`
		: commitment.difference < 0 && !partPaid(commitment)
			? `${formatMoney(-commitment.difference)} less than expected`
			: null;

/** "Due Oct 2, 16, and 30", "1 of 3 paid · next due Oct 16", "Paid", "$1,450 of $2,300 paid". */
function progress(commitment: CommitmentState) {
	const { dueDates, charges } = commitment;
	const part = partPaid(commitment);
	if (part) return part;
	if (charges === 0) return `Due ${list.format(dueDates.map(shortDay))}`;
	const next = dueDates[charges];
	return next ? `${charges} of ${dueDates.length} paid · next due ${shortDay(next)}` : "Paid";
}

/** What the month's Commitments have been paid, against what's expected: "$2,630 of $2,580 paid". */
export function commitmentsPaid(commitments: CommitmentState[]): string | null {
	if (commitments.length === 0) return null;
	const paid = commitments.reduce((sum, c) => sum + c.actual, 0);
	const expected = commitments.reduce((sum, c) => sum + c.expected, 0);
	return `${formatMoney(paid)} of ${formatMoney(expected)} paid`;
}

/**
 * The month's Commitments, each with what's been paid against what's expected. A charge that
 * differs from the expected amount is flagged. In the current month, a payment can be recorded.
 * Those not due this month are collapsed under "Not this month". Bills (This Month) holds it.
 */
export function CommitmentsList({
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
	return (
		<>
			{commitments.length > 0 ? (
				// Two columns of rows where the section is wide enough (#73): read across, in due order.
				<div className="@container">
					<List className="@2xl:grid @2xl:grid-cols-2 @2xl:[&>li:nth-child(2)]:border-t-0 @2xl:[&>li:nth-child(odd)]:border-e">
						{commitments.map((commitment) => (
							<CommitmentRow
								month={month}
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
				</div>
			) : null}
			{notDue.length > 0 ? <NotThisMonth month={month} commitments={notDue} /> : null}
		</>
	);
}

/** Commitments in the Plan but not due this month, collapsed, each with when it's next due. */
function NotThisMonth({ month, commitments }: { month: MonthKey; commitments: CommitmentState[] }) {
	return (
		<Collapsible className="group">
			<CollapsibleTrigger className="w-full text-start flex min-h-9 max-lg:min-h-11 items-center gap-1.5 px-1 text-[13px] text-muted-foreground hover:text-foreground">
				<ChevronRight
					aria-hidden="true"
					className="size-4 transition-transform group-data-[state=open]:rotate-90"
				/>
				Not this month
				<Badge variant="count">{commitments.length}</Badge>
			</CollapsibleTrigger>
			<CollapsibleContent>
				<List>
					{commitments.map((commitment) => (
						<ListRow
							key={commitment.id}
							leading={<Tile>{monogram(commitment.name)}</Tile>}
							title={<CommitmentLink month={month} commitment={commitment} />}
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
			</CollapsibleContent>
		</Collapsible>
	);
}

/** A Commitment's name, linking to its page. */
export function CommitmentLink({
	month,
	commitment,
}: {
	month: MonthKey;
	commitment: { id: string; name: string };
}) {
	return (
		<Link
			to="/plan/$month/commitments/$id"
			params={{ month, id: commitment.id }}
			className="hover:underline"
			{...masterDetailItem}
		>
			{commitment.name}
		</Link>
	);
}

function CommitmentRow({
	month,
	commitment,
	onPay,
}: {
	month: MonthKey;
	commitment: CommitmentState;
	onPay?: (amountCents: number) => void;
}) {
	const differs = differsBy(commitment);
	const hydrated = useHydrated();
	// The amount form opens under the row; until then "Record payment" sits on the bill's own line.
	const [paying, setPaying] = useState(false);
	return (
		<ListRow
			aria-label={`${commitment.name}: ${formatMoney(commitment.actual)} paid of ${formatMoney(
				commitment.expected,
			)} expected${differs ? `, ${differs}` : ""}`}
			leading={<Tile>{monogram(commitment.name)}</Tile>}
			title={<CommitmentLink month={month} commitment={commitment} />}
			meta={
				<>
					{progress(commitment)}
					{differs ? (
						<Badge variant={commitment.difference > 0 ? "over" : "default"} dot>
							{differs}
						</Badge>
					) : null}
					{onPay && !paying ? (
						// On a phone it always starts a line of its own, in line with the text above it
						// (issue 110: at 320 px it stayed beside the text in some rows and dropped in others).
						// From 375px the line a pays-down note is on comes before it (see the note below).
						<span className="max-sm:basis-full min-[375px]:max-sm:order-1">
							<Button
								type="button"
								variant="ghost"
								size="sm"
								className="-my-1 px-2 text-[13px] max-sm:-ml-[9px]"
								disabled={!hydrated}
								onClick={() => setPaying(true)}
							>
								Record payment
							</Button>
						</span>
					) : null}
					{/* Its own line under the rest, as on Plan › Commitments. On a phone from 375px it ends
					    the "Due" line instead, so the row is three lines and not four (issue 74). */}
					{commitment.accountId ? <PaysDownNote accountId={commitment.accountId} joined /> : null}
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
			below={
				onPay && paying ? (
					<RecordPayment commitment={commitment} onPay={onPay} onClose={() => setPaying(false)} />
				) : undefined
			}
		/>
	);
}

/** Records paying a Commitment today, for the expected amount unless the Parent changes it. */
function RecordPayment({
	commitment,
	onPay,
	onClose,
}: {
	commitment: CommitmentState;
	onPay: (amountCents: number) => void;
	onClose: () => void;
}) {
	const id = useId();
	const [invalid, setInvalid] = useState(false);

	function onSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const amountCents = parseDollars(String(new FormData(event.currentTarget).get("amount")));
		setInvalid(!amountCents);
		if (!amountCents) return;
		onPay(amountCents);
		onClose();
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
			<Button type="button" variant="ghost" size="sm" onClick={onClose}>
				Cancel
			</Button>
		</form>
	);
}
