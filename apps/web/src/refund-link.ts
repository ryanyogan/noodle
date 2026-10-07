import { toast } from "@noodle/ui/components/toast";
import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { monthChangeKey } from "./plan-changes";
import { monthsKey } from "./queries";
import {
	getMoneyInRefund,
	linkRefundToPurchase,
	type RefundLinkResult,
	unlinkRefundFromPurchase,
} from "./server/refund-link";

export type { MoneyInRefund } from "./server/refund-link";

// A Refund in checking and its purchase (issue 131, ADR-0057). The read sits under the months'
// key, so whatever refetches a month (a change of kind, the other Parent's write) refetches it.

/** A Refund money-in line with the purchase it is linked to, or the purchases to pick from. */
export const moneyInRefundQuery = (incomeId: string) =>
	queryOptions({
		queryKey: [...monthsKey, "refund-link", incomeId],
		queryFn: () => getMoneyInRefund({ data: { incomeId } }),
	});

/** What to say when a link or an unlink was refused. */
export const refundLinkRefusal = (reason: Extract<RefundLinkResult, { ok: false }>["reason"]) =>
	reason === "already-linked"
		? "It’s already linked to a purchase. Here’s how it looks now."
		: reason === "month-ended"
			? "That month has ended, so the link stays."
			: reason === "not-refund"
				? "It isn’t a Refund any more, so nothing was linked."
				: "That purchase can’t take this Refund, so it’s as it was.";

/** A Parent links a Refund in checking to its purchase (`transactionId`), or unlinks it (null). */
export function useRefundLink() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationKey: monthChangeKey,
		mutationFn: async (input: { incomeId: string; transactionId: string | null }) => {
			const result = input.transactionId
				? await linkRefundToPurchase({
						data: { incomeId: input.incomeId, transactionId: input.transactionId },
					})
				: await unlinkRefundFromPurchase({ data: { incomeId: input.incomeId } });
			if (!result.ok) {
				toast(refundLinkRefusal(result.reason), { tone: "error" });
				return result;
			}
			toast(
				input.transactionId
					? "Linked. The purchase’s Bucket or Commitment has the money back."
					: "Unlinked. The Refund isn’t counted anywhere now.",
				{ tone: "success" },
			);
			return result;
		},
		onError: () => toast("Couldn’t save that, so it’s as it was.", { tone: "error" }),
		onSettled: () => queryClient.invalidateQueries({ queryKey: monthsKey }),
	});
}
