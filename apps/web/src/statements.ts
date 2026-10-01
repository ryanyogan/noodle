import type { ImportRecord } from "@noodle/db";
import type { CsvMapping } from "@noodle/domain";
import { toast } from "@noodle/ui/components/toast";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { monthChangeKey } from "./plan-changes";
import { accountImportsQuery, goalsQuery, monthsKey } from "./queries";
import { uploadStatement } from "./server/imports";

export type UploadVariables = {
	/** A client ULID, made when the file is chosen: retrying the same upload imports it once. */
	importId: string;
	accountId: string;
	fileName: string;
	content: string;
	csvMapping: CsvMapping | null;
};

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * What an Import brought in, as a phrase: "5 Transactions and 1 deposit as income; 1 Matched to a
 * Quick Add; 6 already in Noodle".
 */
export function importSummary(
	record: Pick<ImportRecord, "transactionCount" | "incomeCount" | "duplicateCount"> &
		Partial<Pick<ImportRecord, "matchedCount" | "transferCount">>,
): string {
	const added = [
		record.transactionCount > 0 ? count(record.transactionCount, "Transaction") : null,
		record.incomeCount > 0 ? `${count(record.incomeCount, "deposit")} as income` : null,
	].filter(Boolean);
	const matched = record.matchedCount
		? `${record.matchedCount} Matched to ${record.matchedCount === 1 ? "a Quick Add" : "Quick Adds"}`
		: null;
	const transfers = record.transferCount ? count(record.transferCount, "Transfer") : null;
	const already = record.duplicateCount > 0 ? `${record.duplicateCount} already in Noodle` : null;
	if (added.length === 0) return already ? `Nothing new; ${already}` : "Nothing new";
	return [added.join(" and "), matched, transfers, already].filter(Boolean).join("; ");
}

/**
 * Uploads a statement. Nothing is shown optimistically (the server reads the file); on success
 * the Account's Imports and every month refetch. A refused or failed upload stays in the sheet,
 * which offers a retry with the same `importId`.
 */
export function useUploadStatement(onImported: (record: ImportRecord) => void) {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (variables: UploadVariables) => {
			const result = await uploadStatement({ data: variables });
			if (!result.ok) throw new StatementRefused(result.reason);
			return result.import;
		},
		onSuccess: (record, variables) => {
			onImported(record);
			toast(`${variables.fileName}: ${importSummary(record)}`);
			return Promise.all([
				queryClient.invalidateQueries({
					queryKey: accountImportsQuery(variables.accountId).queryKey,
				}),
				// Where the Account's numbers come from: statements, as of this one.
				queryClient.invalidateQueries({ queryKey: goalsQuery().queryKey }),
				// Refetching while a month change is in flight would briefly undo it on screen; that
				// change refetches the months itself when it settles.
				queryClient.isMutating({ mutationKey: monthChangeKey }) === 0
					? queryClient.invalidateQueries({ queryKey: monthsKey })
					: null,
			]);
		},
	});
}

/** An upload the server turned down: the Account is gone, or the file had no lines to import. */
export class StatementRefused extends Error {
	constructor(readonly reason: "no-account" | "nothing-to-import") {
		super(reason);
	}
}
