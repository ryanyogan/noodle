import type { InsightItem } from "@noodle/db";
import { isOverlap } from "@noodle/domain";
import { toast } from "@noodle/ui/components/toast";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { insightsQuery } from "./queries";
import { decideInsight, lookForInsightsNow } from "./server/insights";

// Acting on Insights from the screen. Accepting or dismissing shows at once (the cached list is
// changed, and put back if the server says no); neither changes money or the Plan.

export type { InsightItem };

/** What kind of Insight it is, in a word or two. */
export const insightLabel = (insight: Pick<InsightItem, "kind">) =>
	isOverlap(insight.kind)
		? "Overlap"
		: insight.kind === "price-increase"
			? "Price increase"
			: "Not charged lately";

/**
 * Where to try an Insight in Explore, if anywhere: for now, ending the one Commitment it's about
 * (`/explore?end=`). The seam for "Try in Explore" (#37): more Insights become Levers there.
 */
export function exploreLinkFor(
	insight: Pick<InsightItem, "kind" | "commitments">,
	commitmentId?: string,
): { to: "/explore"; search: { end: string } } | null {
	const live = insight.commitments.filter((c) => c.endedFromMonth === null);
	const target = commitmentId ? live.find((c) => c.id === commitmentId) : live[0];
	if (!target || insight.kind === "duplicate-charge") return null;
	return { to: "/explore", search: { end: target.id } };
}

type Decision = { insight: InsightItem; status: "accepted" | "dismissed" };

export function useDecideInsight() {
	const queryClient = useQueryClient();
	const { queryKey } = insightsQuery();
	const decide = useMutation({
		mutationFn: ({ insight, status }: Decision) =>
			decideInsight({ data: { id: insight.id, status } }),
		onMutate: async ({ insight, status }) => {
			await queryClient.cancelQueries({ queryKey });
			const before = queryClient.getQueryData(queryKey);
			queryClient.setQueryData(queryKey, (list) =>
				(list ?? []).flatMap((item) =>
					item.id !== insight.id ? [item] : status === "dismissed" ? [] : [{ ...item, status }],
				),
			);
			return { before };
		},
		onError: (_error, decision, context) => {
			if (context?.before) queryClient.setQueryData(queryKey, context.before);
			toast(
				decision.status === "dismissed"
					? "Couldn’t dismiss the Insight."
					: "Couldn’t accept the Insight.",
				{ tone: "error", action: { label: "Retry", onClick: () => decide.mutate(decision) } },
			);
		},
		onSettled: () => queryClient.invalidateQueries({ queryKey }),
	});
	return decide;
}

/** "Look for Insights now": the nightly run, for this Household, at once. */
export function useLookForInsights() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: () => lookForInsightsNow(),
		onSuccess: (added) => {
			toast(
				added === 0
					? "Nothing new."
					: added === 1
						? "Found 1 new Insight."
						: `Found ${added} new Insights.`,
			);
		},
		onError: () => toast("Couldn’t look for Insights. Try again later.", { tone: "error" }),
		onSettled: () => queryClient.invalidateQueries({ queryKey: insightsQuery().queryKey }),
	});
}
