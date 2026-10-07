import type { MonthKey, PaymentCase } from "@noodle/domain";
import { toast } from "@noodle/ui/components/toast";
import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { monthsKey, rulesQuery } from "./queries";
import { fileCardPayment, undoCardPaymentFiling } from "./server/card-payments";
import { forgetCardPayment, getCardPaymentCards, getCardPaymentRules } from "./server/transfers";

// "It's a card payment" (issue 136): one named choice that asks which card. A card Noodle follows
// or keeps by statements makes it a Transfer naming the card; a card kept by hand that a
// Commitment pays down files it in that Commitment; a card that isn't in Noodle asks whether the
// payment counts as spending. The answer is remembered for the line's wording.

export type { CardPaymentCard, CardPaymentRule } from "./server/transfers";

/** The Household's cards, each with the Commitment its payment is filed in when kept by hand. */
export const cardPaymentCardsQuery = () =>
	queryOptions({
		queryKey: [...monthsKey, "card-payment-cards"],
		queryFn: () => getCardPaymentCards(),
	});

/** The wordings remembered as card payments; under the Rules' key, so a change refetches it. */
export const cardPaymentRulesQuery = () =>
	queryOptions({
		queryKey: [...rulesQuery().queryKey, "card-payments"],
		queryFn: () => getCardPaymentRules(),
	});

/** Forgets a remembered card-payment wording. */
export function useForgetCardPayment() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (pattern: string) => forgetCardPayment({ data: { pattern } }),
		onError: () => toast("Couldn’t remove it, so it’s still remembered.", { tone: "error" }),
		onSuccess: () =>
			toast("No longer remembered. Transfers already marked stay as they are.", {
				tone: "success",
			}),
		onSettled: () => queryClient.invalidateQueries({ queryKey: rulesQuery().queryKey }),
	});
}

/** An answer where the payment is the spending: the Commitment it's filed in, made here or not. */
export type CardPaymentFilingInput = {
	transactionId: string;
	ruleId: string;
	label: string;
	commitment: { id: string; name: string };
	/** Set when the Commitment is made by this answer: its first month, amount and due day. */
	create?: { month: MonthKey; amountCents: number; dueDate: string };
	/** After the Undo has put everything back (Review puts its card back). */
	onUndo?: () => void;
	/** When it couldn't be filed. */
	onFail?: () => void;
};

/**
 * A payment that is the card's spending: filed in the Commitment (made first, for a card that
 * isn't in Noodle), with the lines already here that say the same, by a Rule for its wording, so
 * later payments are filed there too. One Undo takes all of it back.
 */
export function useCardPaymentFiling() {
	const queryClient = useQueryClient();
	const navigate = useNavigate();
	const refetch = () =>
		Promise.all([
			queryClient.invalidateQueries({ queryKey: monthsKey }),
			queryClient.invalidateQueries({ queryKey: rulesQuery().queryKey }),
		]);
	const couldnt = (input: CardPaymentFilingInput) => {
		toast(`Couldn’t file ${input.label} in ${input.commitment.name}.`, { tone: "error" });
		input.onFail?.();
	};
	return useMutation({
		mutationFn: (input: CardPaymentFilingInput) =>
			fileCardPayment({
				data: {
					transactionId: input.transactionId,
					commitmentId: input.commitment.id,
					ruleId: input.ruleId,
					create: input.create && { ...input.create, name: input.commitment.name },
				},
			}),
		onError: (_error, input) => couldnt(input),
		onSuccess: (result, input) => {
			if (!result.ok) return couldnt(input);
			const more = result.filed > 1 ? `, with ${result.filed - 1} more worded like it` : "";
			const later = result.ruleId ? " Payments worded like it will be too." : "";
			const created = input.create && {
				commitmentId: input.commitment.id,
				month: input.create.month,
			};
			toast(
				input.create
					? `${input.commitment.name} is now a Commitment, and this payment is filed in it${more}.${later}`
					: `${input.label} filed in ${input.commitment.name}${more}.${later}`,
				{
					tone: "success",
					undo: () => {
						dropEdit?.();
						void undoCardPaymentFiling({
							data: { undo: result.undo, ruleId: result.ruleId, months: result.months, created },
						})
							.then(() => input.onUndo?.())
							.catch(() => toast("Couldn’t undo that.", { tone: "error" }))
							.finally(refetch);
					},
				},
			);
			// A toast has one button, and that one is Undo: the way to its form is a second toast.
			const dropEdit = input.create
				? toast("It’s planned monthly, at this payment’s amount.", {
						tone: "success",
						action: {
							label: "Edit",
							onClick: () =>
								void navigate({
									to: "/plan/$month/commitments/$id",
									params: {
										month: (input.create as { month: MonthKey }).month,
										id: input.commitment.id,
									},
								}),
						},
					})
				: undefined;
		},
		onSettled: refetch,
	});
}

/**
 * The card Review's reading of a line (paymentCase) names, for "It's a card payment" there: one of
 * the Household's credit cards, or `id` null for a card that isn't in Noodle. Undefined when the
 * reading names no card for sure (a loan, or a followed card it couldn't tell apart): the line is
 * then marked as a plain Transfer and nothing is remembered.
 */
export function cardNamedBy(
	payment: PaymentCase | null | undefined,
	accounts: { id: string; name: string; kind: string }[],
): { id: string | null; name: string | null } | undefined {
	if (!payment || payment.kind === "commitment") return undefined;
	const cards = accounts.filter((account) => account.kind === "credit-card");
	if (payment.kind === "not-followed" && payment.accountId === null)
		return { id: null, name: null };
	const card =
		payment.kind === "not-followed"
			? cards.find((account) => account.id === payment.accountId)
			: cards.find((account) => account.name === payment.card);
	return card ? { id: card.id, name: card.name } : undefined;
}

// The Transactions row's own "It's a card payment" opens the row with the question already asked.
// Which line was asked about waits here until its detail is drawn; one already open hears the event.
let asked: string | null = null;
const ASKED = "noodle:card-payment";

/** Asks "Which card does it pay?" for a line, wherever its choice is (or is about to be) drawn. */
export function askCardPayment(transactionId: string) {
	asked = transactionId;
	window.dispatchEvent(new CustomEvent(ASKED, { detail: transactionId }));
}

/** Whether `transactionId` was just asked about; asking is used up by the answer "yes". */
export function takeAskedCardPayment(transactionId: string) {
	if (asked !== transactionId) return false;
	asked = null;
	return true;
}

/** Calls `open` when `transactionId` is asked about while its choice is on screen. */
export function onCardPaymentAsked(transactionId: string, open: () => void) {
	const heard = (event: Event) => {
		if (
			(event as CustomEvent<string>).detail === transactionId &&
			takeAskedCardPayment(transactionId)
		)
			open();
	};
	window.addEventListener(ASKED, heard);
	return () => window.removeEventListener(ASKED, heard);
}
