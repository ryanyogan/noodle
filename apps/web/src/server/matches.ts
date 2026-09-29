import {
	loadMatch,
	type MatchPeer,
	type MatchResult,
	type MatchView,
	matchTransactions,
	unmatch,
} from "@noodle/db";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { HouseholdChange } from "../household-changes";
import { getDb } from "./db";
import { householdMiddleware, viewerOf } from "./household";
import { notifyHousehold } from "./notify";
import { ulidSchema } from "./schemas";

// Matches, from a Transaction's detail: its bank copy (or Quick Add), or what it might be Matched
// with; a Parent Matches or unmatches by hand. Imports Match automatically (importStatement).

export type { MatchPeer, MatchResult, MatchView };

/** A Transaction's Match, or what it might be Matched with. */
export const getTransactionMatch = createServerFn({ method: "GET" })
	.middleware([householdMiddleware])
	.validator(z.object({ transactionId: ulidSchema }))
	.handler(
		({ data, context }): Promise<MatchView> =>
			loadMatch(getDb(), viewerOf(context), data.transactionId),
	);

/** What changes when a Match is made or undone: the months of its sides, and what rolls on. */
const matchChanges = (months: string[]): HouseholdChange[] => [
	...months.map((month) => `month:${month}` as HouseholdChange),
	"months",
	"bucket-uses",
];

/** Matches a Quick Add with an imported Transaction. Idempotent per `matchId`. */
export const matchTransaction = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(z.object({ matchId: ulidSchema, quickAddId: ulidSchema, importedId: ulidSchema }))
	.handler(async ({ data, context }): Promise<MatchResult> => {
		const result = await matchTransactions(getDb(), viewerOf(context), data);
		if (result.ok) await notifyHousehold(context.household.id, matchChanges(result.months));
		return result;
	});

/** Unmatches a Match: its imported copy counts again, and is never Matched to it automatically. */
export const unmatchTransaction = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(z.object({ matchId: ulidSchema }))
	.handler(async ({ data, context }): Promise<MatchResult> => {
		const result = await unmatch(getDb(), viewerOf(context), data.matchId);
		if (result.ok) await notifyHousehold(context.household.id, matchChanges(result.months));
		return result;
	});
