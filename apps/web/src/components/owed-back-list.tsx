import { type MonthKey, monthOfDay, owedBackByPerson, owedBackLeft } from "@noodle/domain";
import { Button } from "@noodle/ui/components/button";
import { Section } from "@noodle/ui/components/section";
import { cn } from "@noodle/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "@tanstack/react-router";
import { ChevronDown } from "lucide-react";
import { useEffect, useState } from "react";
import { dayName, formatMoney } from "../format";
import {
	owedBackOnCommitmentText,
	owedBackOpenQuery,
	unmatchedPaidBackQuery,
	useOwedBackOnCommitment,
} from "../owed-back";

// The "Owed back" list (issue 132, ADR-0058): each person with what they still owe and the
// purchases it is for, and money Paid back that isn't matched to any of them yet. It sits on
// Transactions, where a Paid back line is matched.

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

/** More lines than this and they wait behind the summary, so the section stays a few lines tall. */
const SHOWN_AT_ONCE = 3;

/**
 * "Owed back", kept small (issue 152): one line saying who owes how much, then each purchase on a
 * line of its own, which opens it. More than three lines fold behind "Show all". Nothing when
 * nobody owes and nothing waits.
 */
export function OwedBackList({ today }: { today: string }) {
	const open = useQuery(owedBackOpenQuery()).data ?? [];
	const unmatched = useQuery(unmatchedPaidBackQuery()).data ?? [];
	const hash = useLocation({ select: (location) => location.hash });
	// What the Parent chose; until they do, a few lines show and more than a few fold.
	const [chosen, setChosen] = useState<boolean | null>(null);
	// Arriving by a link to the list ("See what’s Owed back") shows all of it.
	useEffect(() => {
		if (hash === OWED_BACK_LIST_ID) setChosen(true);
	}, [hash]);
	const people = owedBackByPerson(open);
	if (people.length === 0 && unmatched.length === 0) return null;
	const total = people.reduce((sum, person) => sum + person.left, 0);
	const waiting = unmatched.reduce((sum, line) => sum + line.unmatched, 0);
	const lines = open.length + unmatched.length;
	const folds = lines > SHOWN_AT_ONCE;
	const shown = chosen ?? !folds;
	const [only] = people;
	const one = people.length === 1 && only ? only : null;
	const owes = (person: { who: string; left: number }) => (
		<>
			<span className="font-medium text-foreground">{person.who}</span> owes{" "}
			{formatMoney(person.left)}
		</>
	);
	return (
		<Section
			id={OWED_BACK_LIST_ID}
			aria-labelledby={`${OWED_BACK_LIST_ID}-heading`}
			data-testid="owed-back-list"
			className="scroll-mt-24 gap-0 rounded-xl border bg-card px-3 py-2 text-[13px] sm:px-4"
		>
			<div className="flex min-h-7 flex-wrap items-center gap-x-3">
				<h2 id={`${OWED_BACK_LIST_ID}-heading`} className="text-sm font-semibold">
					Owed back
				</h2>
				<p className="min-w-0 flex-1 text-muted-foreground tabular-nums">
					{one ? (
						<span data-testid="owed-back-person">{owes(one)}</span>
					) : total > 0 ? (
						`${formatMoney(total)} in all`
					) : null}
					{waiting > 0 ? (
						<span>
							{total > 0 ? " · " : ""}
							{formatMoney(waiting)} Paid back, not matched yet
						</span>
					) : null}
				</p>
				{folds ? (
					<Button
						type="button"
						variant="ghost"
						size="sm"
						aria-expanded={shown}
						aria-controls={`${OWED_BACK_LIST_ID}-lines`}
						onClick={() => setChosen(!shown)}
						className="-mr-1 shrink-0 gap-1 px-1 text-muted-foreground"
					>
						{shown ? "Hide" : `Show all ${lines}`}
						<ChevronDown
							aria-hidden="true"
							className={cn("size-3.5 transition-transform", shown && "rotate-180")}
						/>
					</Button>
				) : null}
			</div>
			<div id={`${OWED_BACK_LIST_ID}-lines`} hidden={!shown && people.length < 2}>
				{people.map((person) => (
					<div key={person.who} className="grid">
						{one ? null : (
							<p className="pt-1 text-muted-foreground tabular-nums" data-testid="owed-back-person">
								{owes(person)}
							</p>
						)}
						{shown ? (
							<ul className={cn("grid", one ? "mt-1 border-t pt-1" : "pl-3")}>
								{person.items.map((item) => (
									<li
										key={item.id}
										data-testid="owed-back-item"
										className="flex min-w-0 items-baseline gap-2"
									>
										<Link
											to="/transactions/$month/$transactionId"
											params={{ month: monthOfDay(item.date), transactionId: item.transactionId }}
											className="min-w-0 truncate py-1 font-medium hover:underline max-sm:py-2"
										>
											{item.purchase ?? "A purchase"}
										</Link>
										<span className="shrink-0 text-muted-foreground tabular-nums">
											<span className="max-sm:hidden">{dayName(item.date, today)}</span>
											{item.paid > 0 ? (
												<>
													<span className="max-sm:hidden"> · </span>
													{formatMoney(item.paid)} of {formatMoney(item.owed)} Paid back
												</>
											) : item.owed < item.purchaseAmount ? (
												<>
													<span className="max-sm:hidden"> · </span>
													{formatMoney(item.owed)} of {formatMoney(item.purchaseAmount)}
												</>
											) : null}
										</span>
										<span className="ml-auto shrink-0 font-semibold tabular-nums">
											{formatMoney(owedBackLeft(item))}
										</span>
									</li>
								))}
							</ul>
						) : null}
					</div>
				))}
				{shown && unmatched.length > 0 ? (
					<div className="mt-1 grid border-t pt-1" data-testid="paid-back-unmatched">
						<p className="py-0.5 text-muted-foreground">
							<span className="font-medium text-foreground">Paid back, not matched yet.</span> Open
							it in the list to say what it pays back.
						</p>
						<ul className="grid">
							{unmatched.map((line) => (
								<li key={line.id} className="flex min-w-0 items-baseline gap-2 py-1">
									<span className="min-w-0 truncate font-medium">{line.note ?? "Money in"}</span>
									<span className="shrink-0 text-muted-foreground">
										{dayName(line.date, today)}
									</span>
									<span className="ml-auto shrink-0 font-semibold tabular-nums">
										+{formatMoney(line.unmatched)}
									</span>
								</li>
							))}
						</ul>
					</div>
				) : null}
			</div>
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
