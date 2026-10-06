import {
	FEES_AND_INTEREST,
	feesBucketIn,
	feesOffer,
	feesRulePattern,
	type Plan,
	type PlanBucket,
} from "@noodle/domain";
import type { ReviewItem } from "../review";

// Review's card for money out that reads as a fee or interest (issue 137): the "Fees and interest"
// Bucket is its suggestion, whether or not the Plan has one yet. Confirm adds the Bucket when it
// isn't there (resets monthly, no allowance until a Parent sets one), files the card in it, and
// makes the Rule that files the rest. Decided when Review is read, from the bank's own wording;
// nothing is stored. Only ever offered: the picker is still there for any other Bucket.

/** Stands for the Bucket in a suggestion while the Plan has none: never sent anywhere. */
export const NEW_FEES_BUCKET = "new:fees-and-interest";

type Guess = NonNullable<ReviewItem["guess"]>;

const WHY = {
	fee: "Looks like a fee from your bank or card",
	interest: "Looks like interest you were charged",
} as const;
const ADDS = " · adds the Bucket to your Plan";
const whys = new Set(Object.values(WHY).flatMap((why) => [why, why + ADDS]));

/**
 * The card's suggestion when it reads as a fee or interest: the Plan's "Fees and interest" Bucket,
 * or one to add (`canAdd`: not for a month that is over, whose Plan is closed). Null otherwise.
 */
export function feesGuess(
	item: Pick<ReviewItem, "note" | "merchant" | "merchantName" | "amountCents">,
	plan: Pick<Plan, "buckets"> | undefined,
	canAdd: boolean,
): Guess | null {
	const offer = feesOffer({
		text: item.note || (item.merchantName ?? item.merchant),
		amountCents: item.amountCents,
	});
	if (!offer || !plan) return null;
	const there = feesBucketIn(plan.buckets);
	if (!there && !canAdd) return null;
	return {
		bucketId: there?.id ?? NEW_FEES_BUCKET,
		name: there?.name ?? FEES_AND_INTEREST,
		confidence: null,
		method: null,
		reason: there ? WHY[offer.what] : WHY[offer.what] + ADDS,
	};
}

/** Whether a card's suggestion is the one made here. */
export const isFeesGuess = (guess: ReviewItem["guess"]): boolean =>
	guess !== null && guess.method === null && whys.has(guess.reason ?? "");

/** The Bucket as Noodle adds it: resets monthly, with no allowance until a Parent sets one. */
export const newFeesBucket = (id: string, color: number): PlanBucket => ({
	id,
	name: FEES_AND_INTEREST,
	color,
	allowance: 0,
	rolling: false,
});

/** What the Rule made on Confirm matches: the charge, without what this one was for. */
export const feesRuleFor = (item: Pick<ReviewItem, "merchant">) => feesRulePattern(item.merchant);
