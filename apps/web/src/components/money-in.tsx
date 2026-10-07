import { MONEY_IN_KIND_LABELS, MONEY_IN_KINDS, type MonthKey } from "@noodle/domain";
import { Badge } from "@noodle/ui/components/badge";
import { Button } from "@noodle/ui/components/button";
import { Checkbox } from "@noodle/ui/components/checkbox";
import { List, ListRow } from "@noodle/ui/components/list";
import { Section, SectionHeader } from "@noodle/ui/components/section";
import { useQuery } from "@tanstack/react-query";
import { useId, useState } from "react";
import { dayName, formatMoney } from "../format";
import {
	type MoneyInLine,
	moneyInAccountsQuery,
	moneyInKindText,
	moneyInLabel,
	moneyInQuery,
	moneyInReviewQuery,
	pairOffered,
	useMoneyInKindChange,
	whosePayOffered,
} from "../money-in";
import { moneyInShown, type TransactionShow } from "../transaction-summary";
import { AccountPairOffer } from "./money-in-rules";
import { PaidBackMatching } from "./owed-back";
import { WhosePayOffer } from "./whose-pay";

// Money in and its kind (issue 131, ADR-0057): listed on Transactions with its kind in plain
// words, and asked about in Review when it was sent person to person. Money in is green with its
// "+" and its kind is one word in a badge (issue 134).

/**
 * The five kinds as buttons, the line's own pressed: a Parent says what a money-in line is, and
 * may say it for every line with the same wording from now on (a Rule).
 */
export function MoneyInKindChoice({
	line,
	onDone,
	onChanged,
}: {
	line: MoneyInLine;
	/** Called with the line as it is once its kind is changed and nothing more is asked here. */
	onDone?: (line: MoneyInLine) => void;
	/** Called with the line as it is after every change of kind. */
	onChanged?: (line: MoneyInLine) => void;
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
							onClick={() =>
								// Awaited, not a callback of this call: the lists are refetched before a callback
								// would run, and in Review the line (and this choice with it) has gone by then.
								change
									.mutateAsync({ line, kind, always })
									.then((changed) => {
										onChanged?.(changed);
										// A Transfer stays open to ask which Account it came from, and Income whose pay.
										if (!pairOffered(changed) && !whosePayOffered(changed)) onDone?.(changed);
									})
									// Said by the change itself (its toast).
									.catch(() => undefined)
							}
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
			{pairOffered(line) ? <AccountPairOffer line={line} /> : null}
			{whosePayOffered(line) ? <WhosePayOffer line={line} onDone={() => onDone?.(line)} /> : null}
		</div>
	);
}

/** Money in is green with its "+" (issue 134); money out stays plain ink. */
const moneyInAmount = "font-semibold text-money-in tabular-nums";

/** A month's money in under its Transactions: each line with its kind, which a Parent can change. */
export function MoneyInSection({
	month,
	today,
	show,
}: {
	month: MonthKey;
	today: string;
	/** The page's summary filter (issue 134): none of it for money out, what waits for review. */
	show?: TransactionShow;
}) {
	const id = useId();
	const query = useQuery(moneyInQuery(month));
	const lines = moneyInShown(query.data ?? [], show);
	const [open, setOpen] = useState<string | null>(null);
	if (lines.length === 0) {
		// Asked for alone and there is none: say so, rather than an empty page.
		return show === "in" && query.data ? (
			<p className="px-1 text-sm text-muted-foreground" data-testid="money-in-none">
				No money in this month yet.
			</p>
		) : null;
	}
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
								<Badge
									data-testid="money-in-kind"
									variant={line.needsReview ? "pace" : "default"}
									className="h-4.5 px-1.5 text-[11px]"
								>
									{moneyInKindText(line)}
								</Badge>
							</>
						}
						trailing={
							<>
								<span className={moneyInAmount}>+{formatMoney(line.amount)}</span>
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
	const accounts = useQuery(moneyInAccountsQuery()).data ?? [];
	// A line a Parent has named has left Review: it stays here while what follows is asked (what
	// it pays back, which Account a Transfer came from, whose pay Income is).
	const [named, setNamed] = useState<MoneyInLine[]>([]);
	const asksMore = (line: MoneyInLine) =>
		line.kind === "paid-back" ||
		whosePayOffered(line) ||
		(pairOffered(line) && accounts.some((account) => account.id !== line.accountId));
	const forget = (lineId: string) => setNamed((was) => was.filter((one) => one.id !== lineId));
	const matching = named.filter((said) => !lines.some((line) => line.id === said.id));
	if (lines.length === 0 && matching.length === 0) return null;
	return (
		<Section aria-labelledby={id} data-testid="money-in-review" className={className}>
			<SectionHeader
				id={id}
				title="Money in to look at"
				{...(lines.length > 0 ? { count: lines.length } : {})}
			/>
			{lines.length > 0 ? (
				<p className="text-sm text-muted-foreground">
					Money a person sent you isn’t counted as Income until you say what it is.
				</p>
			) : null}
			<List>
				{lines.map((line) => (
					<ListRow
						key={line.id}
						data-testid="money-in-row"
						title={moneyInLabel(line)}
						meta={<span>{dayName(line.date, today)}</span>}
						trailing={<span className={moneyInAmount}>+{formatMoney(line.amount)}</span>}
						below={
							<MoneyInKindChoice
								line={line}
								onChanged={(now) =>
									setNamed((was) => [
										...was.filter((one) => one.id !== now.id),
										...(asksMore(now) ? [now] : []),
									])
								}
							/>
						}
						belowFull
					/>
				))}
				{matching.map((line) => (
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
						trailing={<span className={moneyInAmount}>+{formatMoney(line.amount)}</span>}
						below={
							line.kind === "paid-back" ? (
								<PaidBackMatching line={line} today={today} />
							) : (
								<div className="grid justify-items-start gap-3">
									{line.kind === "transfer" ? (
										<AccountPairOffer line={line} onDone={() => forget(line.id)} />
									) : (
										<WhosePayOffer line={line} onDone={() => forget(line.id)} />
									)}
									<Button
										type="button"
										variant="ghost"
										size="sm"
										aria-label={`Done with ${moneyInLabel(line)}`}
										onClick={() => forget(line.id)}
									>
										Done
									</Button>
								</div>
							)
						}
						belowFull
					/>
				))}
			</List>
		</Section>
	);
}
