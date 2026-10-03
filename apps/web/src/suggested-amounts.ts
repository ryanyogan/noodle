import type { SetupAnswers } from "./setup";
import { billsMonthly } from "./setup-bills";
import { scaleBuckets, startingBuckets } from "./starter-buckets";

// "Apply suggested amounts" on This Month (#72): the get-started wizard's starter Buckets were
// written before there was take-home pay to scale them from (Set up later), so they still have the
// amount setup wrote. Once the Plan has take-home pay, each gets its share of what's left after
// the bills, as step 4 would have suggested, but only where no Parent has changed it since.

export type SuggestedAmount = {
	bucketId: string;
	name: string;
	/** The allowance setup wrote, still in force. */
	fromCents: number;
	toCents: number;
};

/**
 * The starter Buckets whose suggested amount isn't applied yet. A Bucket counts only while its
 * allowance still equals what setup wrote, nobody typed its amount in the wizard (`touched`), it
 * didn't come from the plan draft, and no Parent has changed its allowance since (`edited`: any
 * allowance Plan change). A Personal Allowance is each Parent's own and never suggested here.
 */
export function unappliedSuggestions(input: {
	answers: Pick<SetupAnswers, "buckets" | "bills" | "takeHomePayCents">;
	/** The Plan's take-home pay now. */
	takeHomeCents: number | null;
	plan: { id: string; allowance: number }[];
	edited: ReadonlySet<string>;
}): SuggestedAmount[] {
	const saved = input.answers.buckets ?? [];
	const takeHome = input.takeHomeCents ?? input.answers.takeHomePayCents ?? 0;
	const left = takeHome - billsMonthly(input.answers.bills ?? []);
	if (left <= 0 || saved.length === 0) return [];
	const scaled = scaleBuckets(startingBuckets(saved, null, String), left, String);
	return saved.flatMap((row, index) => {
		if (!row.kept || row.personal || row.touched !== false || row.draftKey) return [];
		const bucket = input.plan.find((b) => b.id === row.id);
		if (!bucket || input.edited.has(row.id) || bucket.allowance !== row.amountCents) return [];
		const toCents = scaled[index]?.amountCents ?? row.amountCents;
		if (toCents === row.amountCents) return [];
		return [{ bucketId: row.id, name: row.name, fromCents: row.amountCents, toCents }];
	});
}
