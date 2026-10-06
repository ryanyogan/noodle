import { type MonthKey, merchantKey } from "@noodle/domain";
import { Button } from "@noodle/ui/components/button";
import { List, ListRow } from "@noodle/ui/components/list";
import { Section, SectionHeader } from "@noodle/ui/components/section";
import { Skeleton } from "@noodle/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { Link, useHydrated } from "@tanstack/react-router";
import { useId, useState } from "react";
import { ulid } from "ulid";
import {
	cardPaymentCardsQuery,
	cardPaymentRulesQuery,
	useCardPaymentCommitment,
	useForgetCardPayment,
} from "../card-payments";
import type { TransactionRow } from "../transactions";
import { useMoneyChange } from "../transfers";

/**
 * "It's a card payment" for money out, as one choice (issue 136). It asks which card: a card
 * Noodle follows or keeps by statements makes the line a Transfer naming it; a card kept by hand
 * that a Commitment pays down files it in that Commitment; "A card that isn't in Noodle" asks
 * whether the payment counts as spending (a Commitment for the card) or is a Transfer. The answer
 * is remembered for the line's wording. Sits in a wrapping row of buttons; open, it takes the row.
 */
export function CardPaymentChoice({
	transaction,
	label,
	onDone,
}: {
	transaction: Pick<TransactionRow, "id" | "date" | "note" | "merchantName" | "amountCents">;
	label: string;
	/** Called once an answer is sent: the row may change or leave the list. */
	onDone: () => void;
}) {
	const hydrated = useHydrated();
	const id = useId();
	const [step, setStep] = useState<"closed" | "which" | "spending">("closed");
	const cards = useQuery({ ...cardPaymentCardsQuery(), enabled: step !== "closed" }).data;
	const change = useMoneyChange();
	const file = useCardPaymentCommitment();
	const pattern = merchantKey(transaction.note || transaction.merchantName || "");

	const transfer = (card: { id: string | null; name: string | null }) => {
		change.mutate({
			kind: "mark",
			transferId: ulid(),
			transactionId: transaction.id,
			label,
			card: { ...card, ruleId: ulid() },
		});
		onDone();
	};

	if (step === "closed") {
		return (
			<Button
				type="button"
				variant="secondary"
				size="sm"
				disabled={!hydrated}
				onClick={() => setStep("which")}
			>
				It’s a card payment
			</Button>
		);
	}

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
					<Button size="sm" asChild>
						<Link
							to="/plan/$month/commitments"
							params={{ month: transaction.date.slice(0, 7) as MonthKey }}
							search={{
								name: label.slice(0, 40),
								amount: transaction.amountCents,
								paysDown: "add",
							}}
						>
							Yes, make a Commitment
						</Link>
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
						onClick={() => setStep(cards?.length ? "which" : "closed")}
					>
						Back
					</Button>
				</div>
			</div>
		);
	}

	const byHand = (cards ?? []).filter((card) => card.commitment);
	return (
		<div data-testid="card-payment-choice" className="grid basis-full gap-2">
			<p id={id} className="text-sm font-medium">
				Which card does it pay?
			</p>
			{byHand.map((card) => (
				<p key={card.id} className="text-[13px] text-muted-foreground">
					{card.name} is kept by hand, so its payment is the spending: it’s filed in{" "}
					{card.commitment?.name}.
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
						disabled={card.commitment !== null && !pattern}
						onClick={() => {
							if (!card.commitment) return transfer({ id: card.id, name: card.name });
							file.mutate({
								ruleId: ulid(),
								pattern: pattern.slice(0, 64),
								label,
								commitment: card.commitment,
							});
							onDone();
						}}
					>
						{card.name}
					</Button>
				))}
				<Button type="button" variant="outline" size="sm" onClick={() => setStep("spending")}>
					A card that isn’t in Noodle
				</Button>
				<Button type="button" variant="ghost" size="sm" onClick={() => setStep("closed")}>
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
