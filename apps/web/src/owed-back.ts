import { type Cents, owedBackSummary } from "@noodle/domain";
import { toast } from "@noodle/ui/components/toast";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ulid } from "ulid";
import { formatMoney } from "./format";
import { monthChangeKey } from "./plan-changes";
import { monthsKey } from "./queries";
import {
	clearOwedBack,
	confirmPaidBackMatches,
	forgetOwedBackRule,
	getOwedBack,
	getOwedBackRule,
	getPaidBackOffer,
	getUnmatchedPaidBack,
	type OwedBackItem,
	rememberOwedBackRule,
	setOwedBack,
} from "./server/owed-back";

export type { OwedBackItem, PaidBackOffered } from "./server/owed-back";

// Paid back and Owed back (issue 132, ADR-0058). The reads sit under the months' key, so whatever
// refetches a month (a change of kind, the other Parent's write) refetches them too.

const owedBackKey = [...monthsKey, "owed-back"] as const;

/** What's Owed back on one purchase (and on its Splits). */
export const owedBackOnQuery = (transactionId: string) =>
	queryOptions({
		queryKey: [...owedBackKey, "on", transactionId],
		queryFn: () => getOwedBack({ data: { transactionId } }),
	});

/** Everything still Owed back, oldest first: the "Owed back" list, grouped with owedBackByPerson. */
export const owedBackOpenQuery = () =>
	queryOptions({
		queryKey: [...owedBackKey, "open"],
		queryFn: () => getOwedBack({ data: { open: true } }),
	});

/** Paid back lines with money that isn't matched to anything Owed back yet, newest first. */
export const unmatchedPaidBackQuery = () =>
	queryOptions({
		queryKey: [...owedBackKey, "unmatched"],
		queryFn: () => getUnmatchedPaidBack(),
	});

const names = new Intl.ListFormat("en", { style: "long", type: "conjunction" });

/**
 * "$600 over · $600 owed back by Casey": a Commitment someone shares, until the money comes
 * (ADR-0058). Just "$600 owed back by Casey" when it isn't over. Null with nothing owed back.
 */
export function owedBackOnCommitmentText(
	difference: number,
	summary: { left: number; who: readonly string[] } | null,
): string | null {
	if (!summary || summary.left <= 0) return null;
	const owed = `${formatMoney(summary.left)} owed back by ${names.format(summary.who)}`;
	return difference > 0 ? `${formatMoney(difference)} over · ${owed}` : owed;
}

/** What's still Owed back on purchases filed in a Commitment, and by whom; null when nothing is. */
export function useOwedBackOnCommitment(commitmentId: string) {
	const { data } = useQuery(owedBackOpenQuery());
	if (!data) return null;
	return owedBackSummary(data.filter((item) => item.commitmentId === commitmentId));
}

/** A Paid back line offered against what's still Owed back. */
export const paidBackOfferQuery = (incomeId: string) =>
	queryOptions({
		queryKey: [...owedBackKey, "offer", incomeId],
		queryFn: () => getPaidBackOffer({ data: { incomeId } }),
	});

/** "Owed back $600 · Casey": what's still owed on an item, and who owes it. */
export const owedBackText = (item: Pick<OwedBackItem, "owed" | "paid" | "who">) =>
	item.paid >= item.owed
		? `Paid back ${formatMoney(item.owed)} · ${item.who}`
		: `Owed back ${formatMoney(item.owed - item.paid)} · ${item.who}`;

class Refused extends Error {
	constructor(readonly reason: string) {
		super(reason);
	}
}

const reasonOf = (error: unknown) => (error instanceof Refused ? error.reason : null);

export type OwedBackSaid = {
	transactionId: string;
	/** One Split of the purchase, instead of the whole of it. */
	splitId?: string | null;
	who: string;
	/** A Child, instead of a name. */
	memberId?: string | null;
	/** Half the purchase when not said. */
	amountCents?: Cents;
};

/** A Parent says someone's paying part of a purchase back, or changes who and how much. */
export function useSayOwedBack() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationKey: monthChangeKey,
		mutationFn: async (said: OwedBackSaid) => {
			const result = await setOwedBack({ data: { owedBackId: ulid(), ...said } });
			if (!result.ok) throw new Refused(result.reason);
			return result.item;
		},
		onError: (error) => {
			const reason = reasonOf(error);
			toast(
				reason === "no-name"
					? "Say who’s paying it back."
					: reason === "too-much"
						? "That’s more than the purchase."
						: reason === "paid-back"
							? "More than that has been Paid back on it already."
							: "Couldn’t save it, so it’s as it was.",
				{ tone: "error" },
			);
		},
		onSuccess: (item) => toast(owedBackText(item), { tone: "success" }),
		onSettled: () => queryClient.invalidateQueries({ queryKey: owedBackKey }),
	});
}

/** A Parent takes the Owed back off a purchase. */
export function useClearOwedBack() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationKey: monthChangeKey,
		mutationFn: async (owedBackId: string) => {
			const result = await clearOwedBack({ data: { owedBackId } });
			if (!result.ok) throw new Refused(result.reason);
		},
		onError: (error) =>
			toast(
				reasonOf(error) === "month-ended"
					? "Money Paid back on this counted in a month that has ended, so it stays."
					: "Couldn’t take it off, so it’s as it was.",
				{ tone: "error" },
			),
		onSuccess: () => toast("Nobody’s paying this back", { tone: "success" }),
		onSettled: () => queryClient.invalidateQueries({ queryKey: monthsKey }),
	});
}

/** A Parent confirms what a Paid back line settles. */
export function useConfirmPaidBack() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationKey: monthChangeKey,
		mutationFn: async (input: {
			incomeId: string;
			matches: { owedBackId: string; amount: Cents }[];
		}) => {
			const result = await confirmPaidBackMatches({
				data: {
					incomeId: input.incomeId,
					matches: input.matches.map((match) => ({ ...match, id: ulid() })),
				},
			});
			if (!result.ok) throw new Refused(result.reason);
			return result;
		},
		onError: (error) => {
			const reason = reasonOf(error);
			toast(
				reason === "more-than-paid"
					? "That adds up to more than was Paid back."
					: reason === "more-than-owed"
						? "That’s more than is still owed on one of these."
						: reason === "changed-elsewhere"
							? "These were changed on another screen. Here’s how they look now."
							: "Couldn’t match it, so it’s as it was.",
				{ tone: "error" },
			);
		},
		onSuccess: (result) =>
			toast(
				result.unmatched > 0
					? `Matched. ${formatMoney(result.unmatched)} is Paid back, not matched yet`
					: "Matched to what was Owed back",
				{ tone: "success" },
			),
		onSettled: () => queryClient.invalidateQueries({ queryKey: monthsKey }),
	});
}

/** The Rule a purchase goes by, and what it remembers about Owed back. */
export const owedBackRuleQuery = (transactionId: string) =>
	queryOptions({
		queryKey: [...owedBackKey, "rule", transactionId],
		queryFn: () => getOwedBackRule({ data: { transactionId } }),
	});

/** A Parent has the purchase's Rule remember who pays part back, or stop remembering. */
export function useOwedBackRule() {
	const queryClient = useQueryClient();
	const onSettled = () => queryClient.invalidateQueries({ queryKey: owedBackKey });
	const failed = () => toast("Couldn’t save it, so the Rule is as it was.", { tone: "error" });
	const remember = useMutation({
		mutationFn: async (owedBackId: string) => {
			const result = await rememberOwedBackRule({ data: { owedBackId } });
			if (!result.ok) throw new Refused("refused");
			return result.rule;
		},
		onError: failed,
		onSuccess: () => toast("The Rule will remember", { tone: "success" }),
		onSettled,
	});
	const forget = useMutation({
		mutationFn: (ruleId: string) => forgetOwedBackRule({ data: { ruleId } }),
		onError: failed,
		onSettled,
	});
	return { remember, forget };
}
