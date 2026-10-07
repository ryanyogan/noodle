import type { PurchasesGetIn } from "@noodle/domain";
import { queryOptions } from "@tanstack/react-query";
import { goalsQuery, monthsKey } from "./queries";
import { getBalanceChecksPutAway, getWalletQuestions } from "./server/card-kept";

// How a card's purchases get into Noodle (issue 136): the words for each answer, and the Wallet
// cards a Parent is asked about once.

export const purchasesName: Record<PurchasesGetIn, string> = {
	statements: "From its statements",
	hand: "I add them by hand",
	none: "They won’t",
};

export const purchasesHint: Record<PurchasesGetIn, string> = {
	statements: "You upload its statements. Paying the card is a Transfer, not spending.",
	hand: "For a card no bank reaches, like Apple Card. Quick Adds and Wallet captures on it are the record, and add to what’s owed.",
	none: "Noodle won’t see what’s bought on it, so its payment is the spending: plan it as a Commitment.",
};

/** The Wallet cards captures named that no Account is known for; under the months' key, so a capture refetches it. */
export const walletQuestionsQuery = () =>
	queryOptions({
		queryKey: [...monthsKey, "wallet-questions"],
		queryFn: () => getWalletQuestions(),
	});

/**
 * The Balance checks the Household said "Not now" to, each as `account:statement day`; under the
 * goals' key, so the other Parent's "Not now" (a `goals` change) refetches it.
 */
export const balanceChecksPutAwayQuery = () =>
	queryOptions({
		queryKey: [...goalsQuery().queryKey, "balance-checks-put-away"],
		queryFn: () => getBalanceChecksPutAway(),
	});
