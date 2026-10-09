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

/**
 * "$600 Paid back by Casey": money Paid back into a Commitment this month, said apart from what
 * was paid (ADR-0058). Null when none was.
 */
export function paidBackIntoText(
	paidBack: { amount: number; who: readonly string[]; refunded?: number | undefined } | undefined,
): string | null {
	if (!paidBack || paidBack.amount <= 0) return null;
	// A Refund linked to its purchase is "refunded": "Paid back" is what was Owed back (ADR-0058).
	const refunded = Math.min(paidBack.refunded ?? 0, paidBack.amount);
	const owed = paidBack.amount - refunded;
	const sum = `${formatMoney(owed)} Paid back`;
	const said = [
		...(owed > 0
			? [paidBack.who.length > 0 ? `${sum} by ${names.format(paidBack.who)}` : sum]
			: []),
		...(refunded > 0 ? [`${formatMoney(refunded)} refunded`] : []),
	];
	return said.join(" and ");
}

/**
 * What was said Owed back on a purchase, for its row, which keeps the purchase's full amount:
 * "$300 owed back by Casey", and "$300 Paid back by Casey" once all of it is. Null when nothing
 * was said.
 */
export function owedBackOnRowText(
	items: readonly { who: string; owed: number; paid: number }[] | undefined,
): string | null {
	const owed = (items ?? []).reduce((sum, item) => sum + item.owed, 0);
	if (owed <= 0) return null;
	const left = (items ?? []).reduce((sum, item) => sum + Math.max(0, item.owed - item.paid), 0);
	// "casey" and "Casey" are one person, as first written.
	const people = new Map<string, string>();
	for (const item of items ?? [])
		if (!people.has(item.who.toLowerCase())) people.set(item.who.toLowerCase(), item.who);
	const who = [...people.values()];
	return `${formatMoney(owed)} ${left > 0 ? "owed back" : "Paid back"} by ${names.format(who)}`;
}

/**
 * The Owed back part of a month's purchases, said apart from spending: "$300 owed back", with
 * "($100 of it Paid back)" or "(all Paid back)" once money has come. Null when there is none.
 */
export function owedBackApartText(owed: number | undefined, settled = 0): string | null {
	if (!owed || owed <= 0) return null;
	const said = `${formatMoney(owed)} owed back`;
	if (settled <= 0) return said;
	return settled >= owed
		? `${said} (all Paid back)`
		: `${said} (${formatMoney(settled)} of it Paid back)`;
}

/**
 * What a Bucket has spent this month: "$120 spent". Where money Paid back into it has taken the
 * month below zero it says that instead of negative spending: "$45 Paid back", or "$20 more Paid
 * back than spent" when there were purchases too. What a Refund linked to its purchase gave back
 * (`refunded`, a part of `paidBack`) is "refunded", never "Paid back", which is Owed back's word
 * (ADR-0058): "$20 refunded", "$20 more refunded than spent", and with both, "$20 refunded and $45
 * Paid back". A month a Refund on a card took below zero stays as it was. The Owed back part of
 * its purchases, which `spent` leaves out, is said after it: "$300 spent · $300 owed back".
 */
export function bucketSpentText(bucket: {
	spent: number;
	paidBack?: number | undefined;
	refunded?: number | undefined;
	owedBack?: number | undefined;
	owedBackSettled?: number | undefined;
}): string {
	const apart = owedBackApartText(bucket.owedBack, bucket.owedBackSettled);
	if (apart) return `${bucketSpentText({ ...bucket, owedBack: undefined })} · ${apart}`;
	const back = bucket.paidBack ?? 0;
	if (bucket.spent >= 0 || back < -bucket.spent) return `${formatMoney(bucket.spent)} spent`;
	const refunded = Math.min(bucket.refunded ?? 0, back);
	const owed = back - refunded;
	if (back === -bucket.spent)
		return [
			...(refunded > 0 ? [`${formatMoney(refunded)} refunded`] : []),
			...(owed > 0 ? [`${formatMoney(owed)} Paid back`] : []),
		].join(" and ");
	const how = refunded === 0 ? "Paid back" : owed === 0 ? "refunded" : "refunded and Paid back";
	return `${formatMoney(-bucket.spent)} more ${how} than spent`;
}

/** What's still Owed back on purchases filed in a Commitment, and by whom; null when nothing is. */
export function useOwedBackOnCommitment(commitmentId: string) {
	const { data } = useQuery(owedBackOpenQuery());
	if (!data) return null;
	return owedBackSummary(data.filter((item) => item.commitmentId === commitmentId));
}

/**
 * "$300 owed back by Casey" for a purchase with something still owed on it, from the one read of
 * all that is Owed back: a screen of Review cards asks once, not once a card. Null when nothing is.
 */
export function useOwedBackSaidOn(transactionId: string): string | null {
	const { data } = useQuery(owedBackOpenQuery());
	return owedBackOnRowText(data?.filter((item) => item.transactionId === transactionId));
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
	/** The item meant, when it is one whose Split is gone; a new ID otherwise. */
	owedBackId?: string;
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
							: reason === "on-whole"
								? "It’s already Owed back on the whole purchase. Take that off to say it for a Split."
								: reason === "on-splits"
									? "It’s already Owed back on its Splits. Take those off to say it for the whole purchase."
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
			/** One match was taken off, nothing new matched: said so when it is kept. */
			takenOff?: boolean;
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
		onSuccess: (result, input) =>
			toast(
				input.takenOff
					? `Taken off. ${formatMoney(result.unmatched)} is Paid back, not matched yet`
					: result.unmatched > 0
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
