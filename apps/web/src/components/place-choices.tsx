import { type BucketUse, type DayKey, likelyBucketOrder } from "@noodle/domain";
import { ChoiceMark } from "@noodle/ui/components/choice-list";
import type { Choice, ChoiceGroup } from "@noodle/ui/components/select";
import { useQuery } from "@tanstack/react-query";
import { CreditCard, ReceiptText, Target, Wallet } from "lucide-react";
import { useMemo } from "react";
import { asBucketColor, monogram } from "../buckets";
import type { MemberSummary } from "../members";
import { bucketUsesQuery, membersQuery } from "../queries";

// The choices of every list a Bucket, Commitment or Goal is picked from (issue 154), made in one
// place so each list shows them the same: a Bucket by its colour and letter, as its tile in the
// Plan; a Commitment, a Goal and the rest by a small neutral icon in the same square.

type BucketPlace = { id: string; name: string; color?: number; owner?: string };
type Place = { id: string; name: string };

/** The heading Commitments go under: what the app calls them where it lists them. */
export const BILLS = "Bills";
/** The first, short group: where this is likeliest to go. */
export const SUGGESTED = "Suggested";
/** A list this long gets the Suggested group; a shorter one is all in view as it is. */
const SUGGEST_FROM = 8;
const SUGGEST_MOST = 3;

/**
 * A Bucket as a choice. One that left the Plan (a Rule still files into it) has no colour to show.
 * A Personal Allowance is found by its Parent's name too.
 */
export function bucketChoice(
	bucket: BucketPlace,
	value: string,
	members: readonly Pick<MemberSummary, "id" | "name">[] = [],
): Choice {
	const owner = bucket.owner ? members.find((m) => m.id === bucket.owner)?.name : undefined;
	return {
		value,
		label: bucket.name,
		mark: (
			<ChoiceMark
				bucket={bucket.color === undefined ? undefined : asBucketColor(bucket.color)}
				letter={monogram(bucket.name)}
			/>
		),
		keywords: bucket.owner ? [...(owner ? [owner] : []), "Personal Allowance"] : undefined,
	};
}

export const billChoice = (commitment: Place, value: string): Choice => ({
	value,
	label: commitment.name,
	mark: (
		<ChoiceMark>
			<ReceiptText />
		</ChoiceMark>
	),
	keywords: ["bill", "commitment"],
});

export const goalChoice = (goal: Place, value: string): Choice => ({
	value,
	label: goal.name,
	mark: (
		<ChoiceMark>
			<Target />
		</ChoiceMark>
	),
	keywords: ["goal"],
});

export const freeToSpendChoice = (value: string): Choice => ({
	value,
	label: "Free to Spend",
	mark: (
		<ChoiceMark>
			<Wallet />
		</ChoiceMark>
	),
});

export const cardChoice = (card: Place): Choice => ({
	value: card.id,
	label: card.name,
	mark: (
		<ChoiceMark>
			<CreditCard />
		</ChoiceMark>
	),
});

/**
 * The Buckets to offer first, at most three: the one already guessed for this Transaction, then
 * the ones spending was filed in most lately. None for a short list, or with nothing to go on.
 */
export function suggestedBuckets<T extends { id: string }>(
	buckets: T[],
	uses: BucketUse[],
	today: DayKey,
	guess?: string | null,
): T[] {
	if (buckets.length < SUGGEST_FROM) return [];
	const used = new Set(uses.map((use) => use.bucketId));
	const guessed = buckets.filter((bucket) => bucket.id === guess);
	const lately = likelyBucketOrder(
		buckets.filter((bucket) => used.has(bucket.id) && bucket.id !== guess),
		uses,
		today,
	);
	return [...guessed, ...lately].slice(0, SUGGEST_MOST);
}

/**
 * Where a Transaction can be filed, as a picker's groups: Suggested (see `suggestedBuckets`; those
 * Buckets are listed there and not again under Buckets), Buckets in the Plan's order, then Bills.
 * A choice's value is `bucket:<id>` or `commitment:<id>`.
 */
export function placeChoices(input: {
	buckets: BucketPlace[];
	commitments: Place[];
	members?: readonly Pick<MemberSummary, "id" | "name">[];
	suggested?: { id: string }[];
}): ChoiceGroup[] {
	const first = new Set((input.suggested ?? []).map((bucket) => bucket.id));
	const choice = (bucket: BucketPlace) =>
		bucketChoice(bucket, `bucket:${bucket.id}`, input.members);
	const byId = new Map(input.buckets.map((bucket) => [bucket.id, bucket]));
	return [
		{
			label: SUGGESTED,
			choices: [...first].flatMap((id) => {
				const bucket = byId.get(id);
				return bucket ? [choice(bucket)] : [];
			}),
		},
		{
			label: "Buckets",
			choices: input.buckets.filter((bucket) => !first.has(bucket.id)).map(choice),
		},
		{
			label: BILLS,
			choices: input.commitments.map((c) => billChoice(c, `commitment:${c.id}`)),
		},
	].filter((group) => group.choices.length > 0);
}

/**
 * `placeChoices` for a month's Plan, with what the page already knows: the Members, and the
 * Buckets used lately (Quick Add's list, already fetched or fetched once beside the page: the
 * list never waits for it). `guess` is the Bucket guessed for the Transaction being filed.
 */
export function usePlaceChoices(
	plan: { buckets: BucketPlace[]; commitments: Place[] } | null | undefined,
	guess?: string | null,
): ChoiceGroup[] {
	const members = useQuery(membersQuery()).data;
	const uses = useQuery(bucketUsesQuery()).data;
	return useMemo(() => {
		if (!plan) return [];
		// The day in UTC is near enough: lately is counted in weeks.
		const today = new Date().toISOString().slice(0, 10) as DayKey;
		return placeChoices({
			buckets: plan.buckets,
			commitments: plan.commitments,
			members,
			suggested: suggestedBuckets(plan.buckets, uses ?? [], today, guess),
		});
	}, [plan, members, uses, guess]);
}
