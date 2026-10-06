import type { PaymentCase } from "@noodle/domain";
import { toast } from "@noodle/ui/components/toast";
import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { monthsKey, rulesQuery } from "./queries";
import { saveRule } from "./server/review";
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

/**
 * A payment to a card kept by hand: filed in the Commitment that pays the card down, by a Rule for
 * its wording, so later payments are filed there too.
 */
export function useCardPaymentCommitment() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (input: {
			ruleId: string;
			pattern: string;
			label: string;
			commitment: { id: string; name: string };
		}) =>
			saveRule({
				data: {
					ruleId: input.ruleId,
					pattern: input.pattern,
					bucketId: null,
					commitmentId: input.commitment.id,
					forMemberIds: [],
					apply: true,
				},
			}),
		onError: (_error, input) =>
			toast(`Couldn’t file ${input.label} in ${input.commitment.name}.`, { tone: "error" }),
		onSuccess: (_result, input) =>
			toast(
				`${input.label} filed in ${input.commitment.name}. Payments worded like it will be too.`,
				{ tone: "success" },
			),
		onSettled: () =>
			Promise.all([
				queryClient.invalidateQueries({ queryKey: monthsKey }),
				queryClient.invalidateQueries({ queryKey: rulesQuery().queryKey }),
			]),
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
