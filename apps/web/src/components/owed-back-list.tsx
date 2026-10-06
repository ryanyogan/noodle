import { type MonthKey, monthOfDay, owedBackByPerson, owedBackLeft } from "@noodle/domain";
import { List, ListRow } from "@noodle/ui/components/list";
import { Section, SectionHeader } from "@noodle/ui/components/section";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { dayName, formatMoney } from "../format";
import {
	owedBackOnCommitmentText,
	owedBackOpenQuery,
	unmatchedPaidBackQuery,
	useOwedBackOnCommitment,
} from "../owed-back";

// The "Owed back" list (issue 132, ADR-0058): each person with what they still owe and the
// purchases it is for, and money Paid back that isn't matched to any of them yet. It sits on
// Transactions, above Money in, where a Paid back line is matched.

/** The list's place on Transactions, for links to it. */
export const OWED_BACK_LIST_ID = "owed-back-list";

/** A link to the "Owed back" list on a month's Transactions. */
export function OwedBackListLink({ month, children }: { month: MonthKey; children: string }) {
	return (
		<Link
			to="/transactions/$month"
			params={{ month }}
			hash={OWED_BACK_LIST_ID}
			className="text-[13px] font-medium underline underline-offset-2 hover:text-foreground"
		>
			{children}
		</Link>
	);
}

/** "Owed back": per person, what's outstanding. Nothing when nobody owes and nothing waits. */
export function OwedBackList({ today }: { today: string }) {
	const open = useQuery(owedBackOpenQuery()).data ?? [];
	const unmatched = useQuery(unmatchedPaidBackQuery()).data ?? [];
	const people = owedBackByPerson(open);
	if (people.length === 0 && unmatched.length === 0) return null;
	const total = people.reduce((sum, person) => sum + person.left, 0);
	return (
		<Section
			id={OWED_BACK_LIST_ID}
			aria-labelledby={`${OWED_BACK_LIST_ID}-heading`}
			data-testid="owed-back-list"
			className="scroll-mt-24"
		>
			<SectionHeader
				id={`${OWED_BACK_LIST_ID}-heading`}
				title="Owed back"
				action={
					total > 0 ? (
						<span className="text-[13px] text-muted-foreground tabular-nums">
							{formatMoney(total)} in all
						</span>
					) : undefined
				}
			/>
			{people.map((person) => (
				<div key={person.who} className="grid gap-2" data-testid="owed-back-person">
					<p className="flex items-baseline justify-between gap-3 px-1 text-[13px]">
						<span className="font-medium">{person.who}</span>
						<span className="text-muted-foreground tabular-nums">
							owes {formatMoney(person.left)}
						</span>
					</p>
					<List>
						{person.items.map((item) => (
							<ListRow
								key={item.id}
								data-testid="owed-back-item"
								title={
									<Link
										to="/transactions/$month/$transactionId"
										params={{ month: monthOfDay(item.date), transactionId: item.transactionId }}
										className="font-medium hover:underline"
									>
										{item.purchase ?? "A purchase"}
									</Link>
								}
								meta={
									<>
										<span>{dayName(item.date, today)}</span>
										<span aria-hidden="true">·</span>
										<span className="tabular-nums">
											{item.paid > 0
												? `${formatMoney(item.paid)} of ${formatMoney(item.owed)} Paid back`
												: `${formatMoney(item.owed)} of ${formatMoney(item.purchaseAmount)}`}
										</span>
									</>
								}
								trailing={
									<span className="text-sm font-semibold tabular-nums">
										{formatMoney(owedBackLeft(item))}
									</span>
								}
							/>
						))}
					</List>
				</div>
			))}
			{unmatched.length > 0 ? (
				<div className="grid gap-2" data-testid="paid-back-unmatched">
					<p className="px-1 text-[13px] font-medium">Paid back, not matched yet</p>
					<List>
						{unmatched.map((line) => (
							<ListRow
								key={line.id}
								title={line.note ?? "Money in"}
								meta={
									<span>
										{dayName(line.date, today)} · Change it under Money in to say what it pays back
									</span>
								}
								trailing={
									<span className="text-sm font-semibold tabular-nums">
										+{formatMoney(line.unmatched)}
									</span>
								}
							/>
						))}
					</List>
				</div>
			) : null}
		</Section>
	);
}

/**
 * On a Commitment's row or page: "$600 over · $600 owed back by Casey" until the money comes.
 * Nothing when nobody owes anything on what's filed in it. With `month`, it links to the list.
 */
export function OwedBackOnCommitment({
	commitment,
	month,
	className,
}: {
	commitment: { id: string; difference: number };
	month?: MonthKey;
	className?: string;
}) {
	const text = owedBackOnCommitmentText(
		commitment.difference,
		useOwedBackOnCommitment(commitment.id),
	);
	if (!text) return null;
	return (
		<span className={className} data-testid="owed-back-commitment">
			{text}
			{month ? (
				<>
					{" · "}
					<OwedBackListLink month={month}>See what’s Owed back</OwedBackListLink>
				</>
			) : null}
		</span>
	);
}
