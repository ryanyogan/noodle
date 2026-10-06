import { MONEY_IN_KIND_LABELS, MONEY_IN_KINDS, type MonthKey } from "@noodle/domain";
import { Button } from "@noodle/ui/components/button";
import { Checkbox } from "@noodle/ui/components/checkbox";
import { List, ListRow } from "@noodle/ui/components/list";
import { Section, SectionHeader } from "@noodle/ui/components/section";
import { useQuery } from "@tanstack/react-query";
import { useId, useState } from "react";
import { dayName, formatMoney } from "../format";
import {
	type MoneyInLine,
	moneyInKindText,
	moneyInLabel,
	moneyInQuery,
	moneyInReviewQuery,
	useMoneyInKindChange,
} from "../money-in";
import { PaidBackMatching } from "./owed-back";

// Money in and its kind (issue 131, ADR-0057): listed on Transactions with its kind in plain
// words, and asked about in Review when it was sent person to person. Colour and the "+" in green
// are issue 134's.

/**
 * The five kinds as buttons, the line's own pressed: a Parent says what a money-in line is, and
 * may say it for every line with the same wording from now on (a Rule).
 */
export function MoneyInKindChoice({
	line,
	onDone,
}: {
	line: MoneyInLine;
	/** Called with the line as it is once its kind is changed. */
	onDone?: (line: MoneyInLine) => void;
}) {
	const id = useId();
	const change = useMoneyInKindChange();
	const [always, setAlways] = useState(false);
	return (
		<div className="grid gap-3" data-testid="money-in-kind-choice">
			<p id={`${id}-q`} className="text-sm text-muted-foreground">
				What is this money? Only Income counts toward your Take-home pay and Extra income.
			</p>
			{/* biome-ignore lint/a11y/useSemanticElements: a fieldset's legend can't sit in this grid. */}
			<div role="group" aria-labelledby={`${id}-q`} className="flex flex-wrap gap-2">
				{MONEY_IN_KINDS.map((kind) => {
					const current = !line.needsReview && line.kind === kind;
					return (
						<Button
							key={kind}
							type="button"
							size="sm"
							variant={current ? "default" : "outline"}
							aria-pressed={current}
							disabled={change.isPending}
							onClick={() => change.mutate({ line, kind, always }, { onSuccess: onDone })}
						>
							{MONEY_IN_KIND_LABELS[kind]}
						</Button>
					);
				})}
			</div>
			{line.note ? (
				<div className="flex items-center gap-2">
					<Checkbox
						id={`${id}-always`}
						checked={always}
						onCheckedChange={(checked) => setAlways(checked === true)}
					/>
					<label htmlFor={`${id}-always`} className="text-sm">
						Always, for money in like this
					</label>
				</div>
			) : null}
		</div>
	);
}

/** A month's money in under its Transactions: each line with its kind, which a Parent can change. */
export function MoneyInSection({ month, today }: { month: MonthKey; today: string }) {
	const id = useId();
	const lines = useQuery(moneyInQuery(month)).data ?? [];
	const [open, setOpen] = useState<string | null>(null);
	if (lines.length === 0) return null;
	return (
		<Section aria-labelledby={id} data-testid="money-in">
			<SectionHeader id={id} title="Money in" count={lines.length} />
			<List>
				{lines.map((line) => (
					<ListRow
						key={line.id}
						data-testid="money-in-row"
						title={moneyInLabel(line)}
						meta={
							<>
								<span>{dayName(line.date, today)}</span>
								<span aria-hidden="true">·</span>
								<span data-testid="money-in-kind">{moneyInKindText(line)}</span>
							</>
						}
						trailing={
							<>
								<span>+{formatMoney(line.amount)}</span>
								<Button
									type="button"
									variant="ghost"
									size="sm"
									aria-expanded={open === line.id}
									aria-label={`Change what ${moneyInLabel(line)} is`}
									onClick={() => setOpen(open === line.id ? null : line.id)}
								>
									Change
								</Button>
							</>
						}
						below={
							open === line.id ? (
								<div className="grid gap-4">
									<MoneyInKindChoice
										line={line}
										// Paid back stays open: what it pays back is asked next (issue 132).
										onDone={(now) => (now.kind === "paid-back" ? undefined : setOpen(null))}
									/>
									{line.kind === "paid-back" && !line.needsReview ? (
										<PaidBackMatching line={line} today={today} />
									) : null}
								</div>
							) : undefined
						}
						belowFull
					/>
				))}
			</List>
		</Section>
	);
}

/** Review: the money in that waits for a Parent to say what it is. Nothing when none waits. */
export function MoneyInReview({ today, className }: { today: string; className?: string }) {
	const id = useId();
	const lines = useQuery(moneyInReviewQuery()).data ?? [];
	if (lines.length === 0) return null;
	return (
		<Section aria-labelledby={id} data-testid="money-in-review" className={className}>
			<SectionHeader id={id} title="Money in to look at" count={lines.length} />
			<p className="text-sm text-muted-foreground">
				Money a person sent you isn’t counted as Income until you say what it is.
			</p>
			<List>
				{lines.map((line) => (
					<ListRow
						key={line.id}
						data-testid="money-in-row"
						title={moneyInLabel(line)}
						meta={<span>{dayName(line.date, today)}</span>}
						trailing={<span>+{formatMoney(line.amount)}</span>}
						below={<MoneyInKindChoice line={line} />}
						belowFull
					/>
				))}
			</List>
		</Section>
	);
}
