import type { MonthKey } from "@noodle/domain";
import type { QueryKey } from "@tanstack/react-query";
import {
	bucketUsesQuery,
	commitmentsQuery,
	forTotalsEarlierKey,
	goalsQuery,
	householdParentsQuery,
	membersQuery,
	monthQuery,
	monthsKey,
	reportsKey,
	rulesQuery,
	scenariosQuery,
	viewerQuery,
} from "./queries";

/** Where a Parent's open screen connects to their Household Agent. */
export const HOUSEHOLD_AGENT_PATH = "/api/household-agent";

/**
 * Each change a write can announce, besides one month's (`month:YYYY-MM`), and the Query key
 * (a prefix) that screens refetch for it. Add a line here when a write changes something new.
 */
const changedQueries = {
	/** Every month: a Plan change carries into later months. */
	months: monthsKey,
	/** Recent spending's Buckets, which order Quick Add. */
	"bucket-uses": bucketUsesQuery().queryKey,
	/** The Household's Parents and its open invite. */
	parents: householdParentsQuery().queryKey,
	/** Every Member, Children included. */
	members: membersQuery().queryKey,
	/** What each Member cost earlier in the year: only edits to past spending change it. */
	"for-earlier": forTotalsEarlierKey,
	/** Accounts, Goals and their Earmarks. */
	goals: goalsQuery().queryKey,
	/** Every Account's Imports. */
	imports: ["imports"],
	/** Scenarios and their Levers. */
	scenarios: scenariosQuery().queryKey,
	/** The Household itself, as each screen's viewer sees it. */
	viewer: viewerQuery().queryKey,
	/** The Rules a Parent sees. */
	rules: rulesQuery().queryKey,
	/** Every Report; also refetched for any change to what Reports sum (see `queryKeysFor`). */
	reports: reportsKey,
} satisfies Record<string, QueryKey>;

/**
 * What a write changed, as the Household Agent announces it to every open screen (ADR-0007).
 * Never data: each screen refetches what it shows through the normal read path, so privacy
 * rules apply there as always.
 */
export type HouseholdChange = keyof typeof changedQueries | `month:${MonthKey}`;

const monthChange = /^month:(\d{4}-(0[1-9]|1[0-2]))$/;

const isHouseholdChange = (value: unknown): value is HouseholdChange =>
	typeof value === "string" && (Object.hasOwn(changedQueries, value) || monthChange.test(value));

/** Every change but single months', for catching up on whatever a screen missed while away. */
export const everyHouseholdChange = Object.keys(changedQueries) as HouseholdChange[];

/** The message the Household Agent broadcasts. */
export const householdChangesMessage = (changes: readonly HouseholdChange[]) =>
	JSON.stringify({ changes });

/** The changes in a broadcast message; anything unrecognised is ignored. */
export function parseHouseholdChanges(message: unknown): HouseholdChange[] {
	if (typeof message !== "string") return [];
	try {
		const { changes } = JSON.parse(message) as { changes?: unknown };
		return Array.isArray(changes) ? changes.filter(isHouseholdChange) : [];
	} catch {
		return [];
	}
}

/** Changes to what Reports sum: spending, income, the Plan, Goals, Members or Imports. */
const changesReports = (change: HouseholdChange) =>
	monthChange.test(change) || ["months", "goals", "members", "imports"].includes(change);

/**
 * The Query keys to refetch for some changes, each once; every month covers any one month, and
 * any one month's change also refetches the Commitments' charges.
 * Reports refetch after any of their inputs change, so an open Report stays live.
 */
export function queryKeysFor(changes: readonly HouseholdChange[]): QueryKey[] {
	const everyMonth = changes.includes("months");
	const keys = new Map<string, QueryKey>();
	for (const change of changes) {
		const month = monthChange.exec(change)?.[1] as MonthKey | undefined;
		if (month && everyMonth) continue;
		const key = month
			? monthQuery(month).queryKey
			: changedQueries[change as keyof typeof changedQueries];
		keys.set(JSON.stringify(key), key);
	}
	// A change to one month's spending can be a Commitment's charge, which Coming up counts.
	if (!everyMonth && changes.some((change) => monthChange.test(change))) {
		const { queryKey } = commitmentsQuery();
		keys.set(JSON.stringify(queryKey), queryKey);
	}
	if (changes.some(changesReports)) keys.set(JSON.stringify(reportsKey), reportsKey);
	return [...keys.values()];
}
