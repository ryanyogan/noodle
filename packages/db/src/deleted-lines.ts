import { type BankLine, bankLineKey } from "@noodle/domain";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { Db } from "./index";
import { deletedBankLines } from "./schema";

// Lines a Parent deleted stay deleted (ADR-0045). A Transaction that came from a bank or a
// statement is kept in its Account under its line's ID, and an Import leaves out lines whose ID
// is already there. Deleting the row would forget the ID, so the next sync or the same statement
// uploaded again would bring the line back. deleted_bank_lines remembers the ID instead: nothing
// else about the Transaction, and nothing reads it but an Import.

/** Which of these line IDs (as a row's `external_id` holds them) a Parent deleted from the Account. */
export async function deletedLineKeys(
	db: Db,
	householdId: string,
	accountId: string,
	keys: string[],
): Promise<Set<string>> {
	if (keys.length === 0) return new Set();
	const rows = await db
		.select({ key: deletedBankLines.externalId })
		.from(deletedBankLines)
		.where(
			and(
				eq(deletedBankLines.accountId, accountId),
				eq(deletedBankLines.householdId, householdId),
				inArray(
					deletedBankLines.externalId,
					sql`(select value from json_each(${JSON.stringify(keys)}))`,
				),
			),
		);
	return new Set(rows.map((row) => row.key));
}

/**
 * A Bank Connection's new lines for one of its Accounts, less those a Parent deleted: under the
 * line's own ID, or under the ID of the pending line it replaces (a pending charge deleted before
 * it posted). `writes` remember the posted copy's ID too, so a later change to it stays out.
 */
export async function bankLinesNotDeleted(
	db: Db,
	input: { householdId: string; accountId: string; lines: BankLine[] },
): Promise<{ add: BankLine[]; deleted: number; writes: BatchItem<"sqlite">[] }> {
	const { householdId, accountId, lines } = input;
	const gone = await deletedLineKeys(
		db,
		householdId,
		accountId,
		lines.flatMap((line) =>
			line.replaces
				? [bankLineKey(line.bankId), bankLineKey(line.replaces)]
				: [bankLineKey(line.bankId)],
		),
	);
	if (gone.size === 0) return { add: lines, deleted: 0, writes: [] };
	const add: BankLine[] = [];
	const writes: BatchItem<"sqlite">[] = [];
	for (const line of lines) {
		const own = bankLineKey(line.bankId);
		if (gone.has(own)) continue;
		if (line.replaces && gone.has(bankLineKey(line.replaces))) {
			writes.push(
				db
					.insert(deletedBankLines)
					.values({ householdId, accountId, externalId: own })
					.onConflictDoNothing(),
			);
			continue;
		}
		add.push(line);
	}
	return { add, deleted: lines.length - add.length, writes };
}
