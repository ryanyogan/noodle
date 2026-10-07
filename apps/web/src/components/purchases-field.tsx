import { PURCHASES_GET_IN, type PurchasesGetIn, suggestedPurchases } from "@noodle/domain";
import { Field } from "@noodle/ui/components/field";
import { OptionSelect } from "@noodle/ui/components/select";
import { useState } from "react";
import { purchasesHint, purchasesName } from "../card-kept";

// "How do its purchases get into Noodle?", asked wherever a credit card is added (issue 141):
// Accounts, Setup's Goal step and its statement upload, and a Commitment's "Pays down". Nothing is
// chosen to start with, so a Parent says it; only a name that reads as an Apple Card suggests one.

/** The answer as a form holds it: what's chosen (or suggested), and whether it was asked for in vain. */
export type PurchasesAnswer = {
	/** The Parent's choice, else what the card's name suggests, else `fallback`; null: not said yet. */
	value: PurchasesGetIn | null;
	/** The form was sent without an answer: the field says so. */
	missing: boolean;
	choose: (next: PurchasesGetIn) => void;
	/** For the form's submit: the answer, and from now on the field says when there is none. */
	check: () => PurchasesGetIn | null;
	/** After the card is added: the next one starts unanswered. */
	reset: () => void;
};

/**
 * The answer for the card being added under `name`. `fallback` is for a place that already knows
 * (Setup's statement upload: the card's statement is about to be read).
 */
export function usePurchasesAnswer(
	name: string,
	fallback: PurchasesGetIn | null = null,
): PurchasesAnswer {
	const [chosen, setChosen] = useState<PurchasesGetIn | null>(null);
	const [asked, setAsked] = useState(false);
	const value = chosen ?? suggestedPurchases(name) ?? fallback;
	return {
		value,
		missing: asked && value === null,
		choose: (next) => setChosen(next),
		check: () => {
			setAsked(true);
			return value;
		},
		reset: () => {
			setChosen(null);
			setAsked(false);
		},
	};
}

/** The question as a form field: a select with nothing chosen until the Parent (or the name) says. */
export function PurchasesField({
	id,
	answer,
	disabled,
	className,
}: {
	id: string;
	answer: PurchasesAnswer;
	disabled?: boolean;
	/** For the select's trigger, e.g. `bg-card` inside a card. */
	className?: string;
}) {
	return (
		<Field
			label="How do its purchases get into Noodle?"
			htmlFor={id}
			hint={
				answer.value
					? purchasesHint[answer.value]
					: "It decides whether paying the card is a Transfer or the spending itself."
			}
			error={answer.missing ? "Choose how this card’s purchases get into Noodle." : null}
		>
			<OptionSelect
				id={id}
				disabled={disabled}
				className={className}
				value={answer.value ?? ""}
				placeholder="Choose one"
				aria-invalid={answer.missing || undefined}
				aria-describedby={answer.missing ? `${id}-error` : undefined}
				onValueChange={(value) => answer.choose(value as PurchasesGetIn)}
				choices={PURCHASES_GET_IN.map((p) => ({ value: p, label: purchasesName[p] }))}
			/>
		</Field>
	);
}
