import { MONEY_IN_KIND_LABELS, MONEY_IN_KINDS, suggestedMoneyInKind } from "@noodle/domain";
import { Button } from "@noodle/ui/components/button";
import { Checkbox } from "@noodle/ui/components/checkbox";
import { List, ListRow } from "@noodle/ui/components/list";
import { Section, SectionHeader } from "@noodle/ui/components/section";
import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useId, useState } from "react";
import { dayName, formatMoney } from "../format";
import {
	type MoneyInLine,
	moneyInAccountsQuery,
	moneyInFollowUp,
	moneyInKindText,
	moneyInLabel,
	moneyInReviewQuery,
	useMoneyInKindChange,
} from "../money-in";
import { AccountPairOffer } from "./money-in-rules";
import { PaidBackMatching } from "./owed-back";
import { RefundLinking } from "./refund-link";
import { WhosePayOffer } from "./whose-pay";

// Money in and its kind (issue 131, ADR-0057): a row of the Transactions table (issue 152,
// ADR-0061) whose opened row says its kind, and asked about in Review when it was sent person to
// person. Money in is green with its
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
	/** Called with the line as it is once its kind is changed and nothing more is asked of it. */
	onDone?: (line: MoneyInLine) => void;
	/** Called with the line as it is after every change of kind. */
	onChanged?: (line: MoneyInLine) => void;
}) {
	const id = useId();
	const change = useMoneyInKindChange();
	const accounts = useQuery(moneyInAccountsQuery()).data ?? [];
	const [always, setAlways] = useState(false);
	// While it waits in Review, wording that reads as a store's refund puts Refund first, and a
	// person's memo that says they're paying back puts Paid back first (issue 141). It is a
	// suggestion: the line is neither until the Parent presses it.
	// Money back through PayPal that matches something bought at the same shop through PayPal is a
	// shop's Refund, not a person paying back (issue 142).
	const suggested = line.needsReview
		? suggestedMoneyInKind(line.note, { shopPurchase: line.shopRefund === true })
		: null;
	const kinds = suggested
		? [suggested, ...MONEY_IN_KINDS.filter((kind) => kind !== suggested)]
		: MONEY_IN_KINDS;
	return (
		<div className="grid gap-3" data-testid="money-in-kind-choice">
			<p id={`${id}-q`} className="text-sm text-muted-foreground">
				What is this money? Only Income counts toward your Take-home pay and Extra income.
			</p>
			{/* biome-ignore lint/a11y/useSemanticElements: a fieldset's legend can't sit in this grid. */}
			<div role="group" aria-labelledby={`${id}-q`} className="flex flex-wrap gap-2">
				{kinds.map((kind) => {
					const current = !line.needsReview && line.kind === kind;
					return (
						<Button
							key={kind}
							type="button"
							size="sm"
							variant={current || kind === suggested ? "default" : "outline"}
							aria-pressed={current}
							{...(kind === suggested
								? { "aria-describedby": `${id}-suggested`, "data-suggested": "" }
								: {})}
							disabled={change.isPending}
							onClick={() =>
								// Awaited, not a callback of this call: the lists are refetched before a callback
								// would run, and in Review the line (and this choice with it) has gone by then.
								change
									.mutateAsync({ line, kind, always })
									.then((changed) => {
										onChanged?.(changed);
										// It stays open only while something more is asked (MoneyInFollowUpAsk).
										if (!moneyInFollowUp(changed, accounts)) onDone?.(changed);
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
			{suggested ? (
				<p
					id={`${id}-suggested`}
					className="text-sm text-muted-foreground"
					data-testid="money-in-suggested"
				>
					{suggested === "refund" && line.shopRefund
						? "This matches something you bought there through PayPal, so Refund is first. It isn’t one until you say so."
						: suggested === "paid-back"
							? "This reads as money Paid back, so it’s first. It isn’t until you say so."
							: `This reads as a ${MONEY_IN_KIND_LABELS[suggested]}, so it’s first. It isn’t one until you say so.`}
				</p>
			) : null}
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

/**
 * What is asked once a line's kind is said, with one "Done": whose pay Income is, what Paid back
 * pays back, which purchase a Refund is for, which Account a Transfer came from. Nothing when
 * nothing is asked, so no row stays open for no reason.
 */
export function MoneyInFollowUpAsk({
	line,
	today,
	onDone,
	more,
}: {
	line: MoneyInLine;
	today: string;
	/** Called when the Parent is done with it: "Done", or the offer was taken or declined. */
	onDone: () => void;
	/** Asked with it, above "Done": the pay day a paycheck is the pay for (issue 156). */
	more?: ReactNode;
}) {
	const accounts = useQuery(moneyInAccountsQuery()).data ?? [];
	const asked = moneyInFollowUp(line, accounts);
	if (!asked) return null;
	return (
		<div className="grid gap-3" data-testid="money-in-follow-up">
			{asked === "paid-back" ? (
				<PaidBackMatching line={line} today={today} />
			) : asked === "refund" ? (
				<RefundLinking line={line} today={today} />
			) : asked === "pair" ? (
				<AccountPairOffer line={line} onDone={onDone} />
			) : (
				<WhosePayOffer line={line} onDone={onDone} />
			)}
			{more}
			<Button
				type="button"
				variant="ghost"
				size="sm"
				className="justify-self-start"
				aria-label={`Done with ${moneyInLabel(line)}`}
				onClick={onDone}
			>
				Done
			</Button>
		</div>
	);
}

/** Money in is green with its "+" (issue 134); money out stays plain ink. */
const moneyInAmount = "font-semibold text-money-in tabular-nums";

/** Review: the money in that waits for a Parent to say what it is. Nothing when none waits. */
export function MoneyInReview({ today, className }: { today: string; className?: string }) {
	const id = useId();
	const lines = useQuery(moneyInReviewQuery()).data ?? [];
	const accounts = useQuery(moneyInAccountsQuery()).data ?? [];
	// A line a Parent has named has left Review: it stays here while what follows is asked (what
	// it pays back, which purchase a Refund is for, which Account a Transfer came from, whose pay
	// Income is).
	const [named, setNamed] = useState<MoneyInLine[]>([]);
	const asksMore = (line: MoneyInLine) => moneyInFollowUp(line, accounts) !== null;
	const forget = (lineId: string) => setNamed((was) => was.filter((one) => one.id !== lineId));
	const matching = named.filter(
		(said) => asksMore(said) && !lines.some((line) => line.id === said.id),
	);
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
					Money a person sent you, or that reads as a refund, isn’t counted as Income until you say
					what it is.
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
						below={<MoneyInFollowUpAsk line={line} today={today} onDone={() => forget(line.id)} />}
						belowFull
					/>
				))}
			</List>
		</Section>
	);
}
