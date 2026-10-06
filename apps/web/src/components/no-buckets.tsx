import type { MonthKey } from "@noodle/domain";
import { Button } from "@noodle/ui/components/button";
import { toast } from "@noodle/ui/components/toast";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useHydrated } from "@tanstack/react-router";
import { Archive } from "lucide-react";
import { noBucketsSentence } from "../before-plan";
import { monthsKey, reviewQuery } from "../queries";
import { fileWithoutBucket } from "../server/review";
import { noteVersion } from "../transaction-versions";
import { type TransactionRow, transactionLabel } from "../transactions";

/**
 * "File without a Bucket" from a Transaction's own picker (issue 117), as Review's (ADR-0037): it
 * leaves Review if it waited there and stays Unassigned, so no month's figures change. Nothing
 * else about it is touched; one that wasn't waiting is left exactly as it is, and the message
 * says which it was.
 */
export function useFileWithout() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (transaction: TransactionRow) =>
			fileWithoutBucket({ data: { transactionIds: [transaction.id] } }),
		onSuccess: (answer, transaction) => {
			for (const [id, version] of Object.entries(answer.versions)) noteVersion(id, version);
			const label = transactionLabel(transaction);
			toast(
				answer.filed > 0
					? `${label} filed without a Bucket. It has left Review.`
					: `${label} stays Unassigned. It wasn’t waiting in Review.`,
			);
			if (answer.filed === 0) return;
			// Its version moved on, and Review's count is one fewer.
			void queryClient.invalidateQueries({ queryKey: reviewQuery().queryKey });
			void queryClient.invalidateQueries({ queryKey: monthsKey });
		},
		onError: (_error, transaction) =>
			toast(`Couldn’t file ${transactionLabel(transaction)} without a Bucket. Nothing changed.`, {
				tone: "error",
			}),
	});
}

/**
 * What a Bucket picker shows for a Transaction of a month that had no Buckets (issue 117): why
 * nothing is listed, in one sentence, and "File without a Bucket" when that can be done.
 */
export function NoBuckets({
	id,
	month,
	current,
	onFileWithout,
}: {
	id?: string;
	month: MonthKey;
	/** The month it is now. */
	current: MonthKey;
	/** Left out for a Transaction that is assigned somewhere already. */
	onFileWithout?: () => void;
}) {
	const hydrated = useHydrated();
	return (
		<div id={id} data-testid="no-buckets" className="grid justify-items-start gap-2 text-sm">
			<p>{noBucketsSentence(month, current, Boolean(onFileWithout))}</p>
			{onFileWithout ? (
				<Button
					type="button"
					variant="outline"
					size="sm"
					className="max-lg:min-h-11"
					disabled={!hydrated}
					onClick={onFileWithout}
				>
					<Archive aria-hidden="true" />
					File without a Bucket
				</Button>
			) : null}
		</div>
	);
}
