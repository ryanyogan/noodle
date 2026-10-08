import { Button } from "@noodle/ui/components/button";
import { List, ListRow } from "@noodle/ui/components/list";
import { Section, SectionHeader } from "@noodle/ui/components/section";
import { Skeleton } from "@noodle/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { useHydrated } from "@tanstack/react-router";
import { useEffect, useId, useState } from "react";
import { ulid } from "ulid";
import {
	type CardPaymentFilingInput,
	cardPaymentCardsQuery,
	cardPaymentRulesQuery,
	onCardPaymentAsked,
	paymentAsSpending,
	takeAskedCardPayment,
	useCardPaymentFiling,
	useForgetCardPayment,
} from "../card-payments";
import type { TransactionRow } from "../transactions";
import { useMoneyChange } from "../transfers";

type CardPaymentLine = Pick<
	TransactionRow,
	"id" | "date" | "note" | "merchantName" | "amountCents"
>;

/** How the question was answered: a Transfer, or filed in a Commitment (the payment is the spending). */
export type CardPaymentAnswer = "transfer" | "commitment";

/**
 * "It's a card payment" for money out, as one choice (issue 136). It asks which card: a card
 * Noodle follows or keeps by statements makes the line a Transfer naming it; a card kept by hand
 * that a Commitment pays down files it in that Commitment; "A card that isn't in Noodle" asks
 * whether the payment counts as spending (a Commitment for the card, made in place) or is a
 * Transfer. The answer is remembered for the line's wording, and covers the lines already here
 * that say the same. Sits in a wrapping row of buttons; open, it takes the row.
 */
export function CardPaymentChoice({
	transaction,
	label,
	onDone,
}: {
	transaction: CardPaymentLine;
	label: string;
	/** Called once an answer is sent: the row may change or leave the list. */
	onDone: () => void;
}) {
	const hydrated = useHydrated();
	// The row's own menu may have asked already (askCardPayment): then it opens at the question.
	const [open, setOpen] = useState(() => takeAskedCardPayment(transaction.id));
	useEffect(() => onCardPaymentAsked(transaction.id, () => setOpen(true)), [transaction.id]);
	if (!open) {
		return (
			<Button
				type="button"
				variant="secondary"
				size="sm"
				disabled={!hydrated}
				onClick={() => setOpen(true)}
			>
				It’s a card payment
			</Button>
		);
	}
	return (
		<CardPaymentQuestion
			transaction={transaction}
			label={label}
			onDone={onDone}
			onCancel={() => setOpen(false)}
		/>
	);
}

/**
 * The question itself, already asked: "Which card does it pay?", then "Count this payment as
 * spending?" for a card that isn't in Noodle. Review gives its own `onTransfer` and `filing`, so
 * its stack follows the answer.
 */
export function CardPaymentQuestion({
	transaction,
	label,
	onDone,
	onCancel,
	onTransfer,
	filing,
	initialStep = "which",
}: {
	transaction: CardPaymentLine;
	label: string;
	onDone: (answer: CardPaymentAnswer) => void;
	onCancel: () => void;
	initialStep?: "which" | "spending";
	/** Marks the Transfer instead of this (Review's own mark); `id` null: a card not in Noodle. */
	onTransfer?: (card: { id: string | null; name: string | null }) => void;
	/** What follows an answer filed in a Commitment: its Undo, a failure, a line that stays. */
	filing?: Pick<
		CardPaymentFilingInput,
		"onFiled" | "undoBy" | "onUndo" | "onFail" | "onStays" | "review"
	>;
}) {
	const id = useId();
	const [step, setStep] = useState<"which" | "spending">(initialStep);
	const cards = useQuery(cardPaymentCardsQuery()).data;
	const change = useMoneyChange();
	const file = useCardPaymentFiling();

	const transfer = (card: { id: string | null; name: string | null }) => {
		if (onTransfer) onTransfer(card);
		else {
			change.mutate({
				kind: "mark",
				transferId: ulid(),
				transactionId: transaction.id,
				label,
				card: { ...card, ruleId: ulid() },
			});
		}
		onDone("transfer");
	};
	const fileIn = (commitment: { id: string; name: string }) => {
		file.mutate({ transactionId: transaction.id, ruleId: ulid(), label, commitment, ...filing });
		onDone("commitment");
	};
	const makeCommitment = () => {
		file.mutate({ ...paymentAsSpending(transaction, label), ...filing });
		onDone("commitment");
	};

	if (step === "spending" || cards?.length === 0) {
		return (
			<div data-testid="card-payment-choice" className="grid basis-full gap-2">
				<p id={id} className="text-sm font-medium">
					Count this payment as spending?
				</p>
				<p className="text-[13px] text-muted-foreground">
					Noodle can’t see what was bought on a card that isn’t here. Yes plans the payment as a
					Commitment, so it’s the spending. No marks it as a Transfer, which counts nowhere.
				</p>
				<div className="flex flex-wrap gap-2">
					<Button type="button" size="sm" onClick={makeCommitment}>
						Yes, make a Commitment
					</Button>
					<Button
						type="button"
						variant="secondary"
						size="sm"
						onClick={() => transfer({ id: null, name: null })}
					>
						No, it’s a Transfer
					</Button>
					<Button
						type="button"
						variant="ghost"
						size="sm"
						onClick={() => (cards?.length ? setStep("which") : onCancel())}
					>
						Back
					</Button>
				</div>
			</div>
		);
	}

	// Cards whose purchases aren't in Noodle and a Commitment pays down: the payment is the spending.
	const byHand = (cards ?? []).filter((card) => card.commitment);
	return (
		<div data-testid="card-payment-choice" className="grid basis-full gap-2">
			<p id={id} className="text-sm font-medium">
				Which card does it pay?
			</p>
			{byHand.map((card) => (
				<p key={card.id} className="text-[13px] text-muted-foreground">
					{card.name}’s purchases{" "}
					{card.kept === "none" ? "don’t come into Noodle" : "aren’t in Noodle"}, so its payment is
					the spending: it’s filed in {card.commitment?.name}.
				</p>
			))}
			<div className="flex flex-wrap gap-2">
				{cards === undefined ? <Skeleton className="h-8 w-40" /> : null}
				{(cards ?? []).map((card) => (
					<Button
						key={card.id}
						type="button"
						variant="outline"
						size="sm"
						onClick={() =>
							card.commitment ? fileIn(card.commitment) : transfer({ id: card.id, name: card.name })
						}
					>
						{card.name}
					</Button>
				))}
				<Button type="button" variant="outline" size="sm" onClick={() => setStep("spending")}>
					A card that isn’t in Noodle
				</Button>
				<Button type="button" variant="ghost" size="sm" onClick={onCancel}>
					Cancel
				</Button>
			</div>
		</div>
	);
}

/** The wordings remembered as card payments, on the Rules page: each can be removed. */
export function CardPaymentRules() {
	const id = useId();
	const rules = useQuery(cardPaymentRulesQuery()).data ?? [];
	const forget = useForgetCardPayment();
	if (rules.length === 0) return null;
	return (
		<Section aria-labelledby={id} data-testid="card-payment-rules">
			<SectionHeader id={id} title="Card payments" count={rules.length} />
			<List>
				{rules.map((rule) => (
					<ListRow
						key={rule.id}
						data-testid="card-payment-rule"
						title={`“${rule.pattern}”`}
						meta={
							<span>
								{rule.card
									? `Always a Transfer to ${rule.card}`
									: "Always a Transfer to a card that isn’t in Noodle"}
							</span>
						}
						trailing={
							<Button
								type="button"
								variant="ghost"
								size="sm"
								disabled={forget.isPending}
								aria-label={`Stop remembering ${rule.pattern} as a card payment`}
								onClick={() => forget.mutate(rule.pattern)}
							>
								Remove
							</Button>
						}
					/>
				))}
			</List>
		</Section>
	);
}
