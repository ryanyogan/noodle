import {
	changedALot,
	commitmentsIn,
	type DayKey,
	evidenceFingerprint,
	type HandFiling,
	isCatchAll,
	type MonthKey,
	type RuleNow,
	type SpendLine,
	type SuggestionIdea,
	suggestionKey,
} from "@noodle/domain";
import { and, eq, gt, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";

import { counts } from "./counting";
import type { Db } from "./index";
import { loadPlanRecords } from "./plan";
import type { Viewer } from "./privacy";
import {
	buckets,
	categorizations,
	households,
	rules,
	splits,
	suggestions,
	transactions,
} from "./schema";

// Suggestions (ADR-0027). The run loads the Household's spending with each line's owner (the
// Parent whose Personal Allowance it's in), saves what the detectors find, and each Parent reads
// only the Household's suggestions and their own.

export type SuggestionInputs = {
	lines: SpendLine[];
	bucketNames: string[];
	commitments: {
		id: string;
		name: string;
		amountCents: number;
		cadence: "monthly" | "biweekly" | "annual";
		dueDate: DayKey;
	}[];
};

/** The Household's spending since `from` (unsplit, counted, with a merchant), its Buckets and Commitments in `month`. */
export async function loadSuggestionInputs(
	db: Db,
	householdId: string,
	from: DayKey,
	month: MonthKey,
): Promise<SuggestionInputs> {
	const rows = await db
		.select({
			id: transactions.id,
			date: transactions.date,
			amountCents: transactions.amountCents,
			merchant: sql<string | null>`coalesce(${transactions.merchant}, ${transactions.note})`,
			bucketId: transactions.bucketId,
			bucketName: buckets.name,
			owner: buckets.ownerMemberId,
			commitmentId: transactions.commitmentId,
			goalId: transactions.goalId,
		})
		.from(transactions)
		.leftJoin(buckets, eq(buckets.id, transactions.bucketId))
		.where(
			and(
				eq(transactions.householdId, householdId),
				gt(transactions.date, from),
				gt(transactions.amountCents, 0),
				counts(),
				sql`not exists (select 1 from ${splits} where ${splits.transactionId} = ${transactions.id})`,
			),
		);
	const records = await loadPlanRecords(db, householdId, month);
	return {
		lines: rows
			.filter((row) => row.merchant?.trim())
			.map((row) => ({
				id: row.id,
				date: row.date as DayKey,
				amountCents: row.amountCents,
				merchant: (row.merchant as string).trim(),
				owner: row.owner,
				commitmentId: row.commitmentId,
				homeless:
					row.goalId === null &&
					row.commitmentId === null &&
					(row.bucketId === null || (row.owner === null && isCatchAll(row.bucketName ?? ""))),
			})),
		bucketNames: records.buckets
			.filter((b) => b.archivedFromMonth === null || b.archivedFromMonth > month)
			.map((b) => b.name),
		commitments: commitmentsIn(records, month).map((c) => ({
			id: c.id,
			name: c.name,
			amountCents: c.amount,
			cadence: c.cadence,
			dueDate: c.dueDate,
		})),
	};
}

/**
 * What Learn rests on (ADR-0027): imported lines since `from` that a Parent put in a Bucket
 * themselves (categorization's decision is gone once a Parent settles one; one it filed keeps it),
 * by clean merchant name, with the Bucket's owner; and the Household's Rules with theirs.
 */
export async function loadLearnInputs(
	db: Db,
	householdId: string,
	from: DayKey,
): Promise<{ filings: HandFiling[]; rules: RuleNow[] }> {
	const rows = await db
		.select({
			id: transactions.id,
			date: transactions.date,
			merchant: transactions.merchant,
			bucketId: buckets.id,
			bucketName: buckets.name,
			owner: buckets.ownerMemberId,
		})
		.from(transactions)
		.innerJoin(buckets, eq(buckets.id, transactions.bucketId))
		.where(
			and(
				eq(transactions.householdId, householdId),
				eq(transactions.source, "import"),
				gt(transactions.date, from),
				isNotNull(transactions.merchant),
				counts(),
				sql`not exists (select 1 from ${categorizations} where ${categorizations.transactionId} = ${transactions.id})`,
				sql`not exists (select 1 from ${splits} where ${splits.transactionId} = ${transactions.id})`,
			),
		);
	const stated = await db
		.select({ pattern: rules.pattern, bucketId: rules.bucketId, owner: rules.ownerMemberId })
		.from(rules)
		.where(eq(rules.householdId, householdId));
	return {
		filings: rows
			.filter((row) => row.merchant?.trim())
			.map((row) => ({
				id: row.id,
				date: row.date as DayKey,
				merchant: (row.merchant as string).trim(),
				bucketId: row.bucketId,
				bucketName: row.bucketName,
				owner: row.owner,
			})),
		rules: stated,
	};
}

/** The Household's time zone, for today's date in a background run. */
export async function householdTimeZone(db: Db, householdId: string): Promise<string> {
	const [row] = await db
		.select({ timeZone: households.timeZone })
		.from(households)
		.where(eq(households.id, householdId));
	return row?.timeZone ?? "UTC";
}

/**
 * Saves what the detectors found, idempotently: a new one opens, an open one takes the latest
 * evidence, a decided one reopens only when its evidence changed a lot, and an open one not found
 * again (filed, added by hand) goes. Returns how many opened or changed.
 */
export async function saveSuggestions(
	db: Db,
	householdId: string,
	ideas: SuggestionIdea[],
): Promise<number> {
	const stored = await db
		.select()
		.from(suggestions)
		.where(eq(suggestions.householdId, householdId));
	const byKey = new Map(stored.map((row) => [row.key, row]));
	const found = new Set<string>();
	let changed = 0;
	const now = new Date();
	for (const idea of ideas) {
		const { evidence, owner, ...payload } = idea;
		// Stored with its owner, so the other Parent's findings never collide with it.
		const key = `${owner ?? "household"}|${suggestionKey(idea)}`;
		found.add(key);
		const fingerprint = evidenceFingerprint(evidence);
		const row = byKey.get(key);
		if (!row) {
			await db.insert(suggestions).values({
				id: crypto.randomUUID(),
				householdId,
				memberId: owner,
				kind: idea.kind,
				key,
				payload,
				evidence,
				fingerprint,
			});
			changed++;
		} else if (
			row.status === "open" ? row.fingerprint !== fingerprint : changedALot(row.evidence, evidence)
		) {
			await db
				.update(suggestions)
				.set({
					status: "open",
					payload,
					evidence,
					fingerprint,
					decidedByMemberId: null,
					updatedAt: now,
				})
				.where(eq(suggestions.id, row.id));
			changed++;
		}
	}
	const gone = stored.filter((row) => row.status === "open" && !found.has(row.key));
	if (gone.length > 0) {
		await db.delete(suggestions).where(
			inArray(
				suggestions.id,
				gone.map((row) => row.id),
			),
		);
		changed += gone.length;
	}
	return changed;
}

/** The terms a suggestion would add (by kind), as saved. */
export type SuggestionTerms = {
	name: string;
	amountCents: number;
	fromCents?: number;
	cadence?: "monthly" | "biweekly" | "annual";
	dueDate?: string;
	commitmentId?: string;
	merchant?: string;
	bucketId?: string;
	bucketName?: string;
};

export type SuggestionItem = {
	id: string;
	kind: "new-bucket" | "new-commitment" | "commitment-amount" | "rule";
	personal: boolean;
	payload: SuggestionTerms;
	evidence: { count: number; amountCents: number; months: number };
};

/** The open suggestions `viewer` may read: the Household's and their own, never another Parent's. */
export async function loadOpenSuggestions(db: Db, viewer: Viewer): Promise<SuggestionItem[]> {
	const rows = await db
		.select()
		.from(suggestions)
		.where(
			and(
				eq(suggestions.householdId, viewer.householdId),
				eq(suggestions.status, "open"),
				or(isNull(suggestions.memberId), eq(suggestions.memberId, viewer.memberId)),
			),
		)
		.orderBy(suggestions.createdAt, suggestions.id);
	return rows.map((row) => ({
		id: row.id,
		kind: row.kind,
		personal: row.memberId !== null,
		payload: row.payload as SuggestionTerms,
		evidence: {
			count: row.evidence.count,
			amountCents: row.evidence.amountCents,
			months: row.evidence.months,
		},
	}));
}

/** One open suggestion `viewer` may read, to accept it. */
export async function loadOpenSuggestion(db: Db, viewer: Viewer, id: string) {
	const [row] = await db
		.select()
		.from(suggestions)
		.where(
			and(
				eq(suggestions.id, id),
				eq(suggestions.householdId, viewer.householdId),
				or(isNull(suggestions.memberId), eq(suggestions.memberId, viewer.memberId)),
			),
		);
	return row;
}

/** Accepts or dismisses a suggestion `viewer` may read. Idempotent. */
export async function decideSuggestion(
	db: Db,
	viewer: Viewer,
	id: string,
	status: "accepted" | "dismissed",
): Promise<void> {
	await db
		.update(suggestions)
		.set({ status, decidedByMemberId: viewer.memberId, updatedAt: new Date() })
		.where(
			and(
				eq(suggestions.id, id),
				eq(suggestions.householdId, viewer.householdId),
				or(isNull(suggestions.memberId), eq(suggestions.memberId, viewer.memberId)),
			),
		);
}
