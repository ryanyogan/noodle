import type { InsightItem } from "@noodle/db";
import { isOverlap, type Lever, leverPreset, type MonthKey } from "@noodle/domain";
import { toast } from "@noodle/ui/components/toast";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { formatMoney } from "./format";
import { insightsQuery, perkSourcesQuery } from "./queries";
import type { ExploreTry } from "./scenarios";
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
 * What an Insight can be tried as in Explore, a Lever preset each: ending a Commitment it's about
 * (an Overlap, or one not charged lately), or a price increase as its Commitment's new terms, to
 * see what the new price costs. An Overlap offers ending each of its Commitments still in the
 * Plan. The same charge twice, a cost a Perk covers, or a merchant's price increase, has no
 * Lever to try.
 */
export function exploreTriesFor(
	insight: Pick<InsightItem, "kind" | "commitments" | "transactions">,
	current: MonthKey,
): ExploreTry[] {
	const live = insight.commitments.filter(
		(c) => c.endedFromMonth === null || c.endedFromMonth > current,
	);
	const tryAs = (name: string, lever: Lever) => {
		const preset = leverPreset(lever);
		return preset ? [{ name, preset }] : [];
	};
	switch (insight.kind) {
		case "duplicate-charge":
		case "perk-cost":
			return [];
		case "price-increase": {
			// Its latest charge (Transactions are newest first) is the new price.
			const [commitment] = live;
			const amount = insight.transactions[0]?.amount;
			if (!commitment || !amount) return [];
			return tryAs(`${commitment.name} at ${formatMoney(amount)}`, {
				kind: "commitment-terms",
				commitmentId: commitment.id,
				amount,
				fromMonth: current,
			});
		}
		default:
			return live.flatMap((commitment) =>
				tryAs(`Without ${commitment.name}`, {
					kind: "end-commitment",
					commitmentId: commitment.id,
					fromMonth: current,
				}),
			);
	}
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
		onSettled: () => {
			queryClient.invalidateQueries({ queryKey: insightsQuery().queryKey });
			// It may also have spotted Perk Sources to confirm.
			queryClient.invalidateQueries({ queryKey: perkSourcesQuery().queryKey });
		},
	});
}
