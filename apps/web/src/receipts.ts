import type { MonthKey } from "@noodle/domain";
import { queryOptions } from "@tanstack/react-query";
import { monthQuery } from "./queries";
import { getTransactionReceipt } from "./server/receipts";

export type { ReceiptDetail } from "./server/receipts";

/**
 * A Transaction's Receipt. Kept under its month, so anything that refetches the month (a
 * forwarded Receipt filed, the other Parent's write) refetches it too.
 */
export const receiptQuery = (transaction: { id: string; date: string }) =>
	queryOptions({
		queryKey: [
			...monthQuery(transaction.date.slice(0, 7) as MonthKey).queryKey,
			"receipt",
			transaction.id,
		],
		queryFn: () => getTransactionReceipt({ data: { transactionId: transaction.id } }),
	});
