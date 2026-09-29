import {
	catalogEntryFor,
	type FoundPerk,
	type InsightPerk,
	type PerkKind,
	type PerkSourceKind,
	type PerkSourceSuggestion,
	perkKey,
} from "@noodle/domain";
import { and, desc, eq, inArray, isNull, lt, ne, notInArray, or, type SQL, sql } from "drizzle-orm";
import type { Db } from "./index";
import type { Viewer } from "./privacy";
import { accounts, perkSources, perks } from "./schema";

// Perk Sources and their Perks in D1. A suggestion seen only in a Parent's own Personal Allowance
// is stored as theirs alone, like an Insight (ADR-0003), and so are its Perks and the Perk
// Overlaps resting on them. Perk Sources are keyed by fingerprint (the catalog product, or one a
// Parent added, with its owner), so a dismissed or removed one isn't suggested again. Research
// (the Perk research Workflow) writes a Perk Source's Perks and where reading them stands.

export type PerkResearch = (typeof perkSources.$inferSelect)["research"];

/** A Perk Source's fingerprint: its catalog product, or its own ID, with its owner. */
const fingerprintOf = (ownerMemberId: string | null, product: string) =>
	`${ownerMemberId ?? "household"}|${product}`;

/** The Perk Sources `viewer` may read: the Household's and their own. */
const readableBy = (viewer: Viewer) =>
	and(
		eq(perkSources.householdId, viewer.householdId),
		or(isNull(perkSources.ownerMemberId), eq(perkSources.ownerMemberId, viewer.memberId)),
	) as SQL;

/** The Household's Accounts, by name and kind, for spotting its cards. */
export function loadAccountNames(
	db: Db,
	householdId: string,
): Promise<{ name: string; kind: string }[]> {
	return db
		.select({ name: accounts.name, kind: accounts.kind })
		.from(accounts)
		.where(eq(accounts.householdId, householdId));
}

/**
 * Stores suggestions the Household hasn't had yet (whatever became of them), each theirs alone
 * when seen only in `viewer`'s own Personal Allowance. Returns how many were added.
 */
export async function recordPerkSourceSuggestions(
	db: Db,
	viewer: Viewer,
	suggestions: PerkSourceSuggestion[],
	newId: () => string,
): Promise<number> {
	if (suggestions.length === 0) return 0;
	const [first, ...rest] = suggestions.map((s) => {
		const ownerMemberId = s.private ? viewer.memberId : null;
		return db
			.insert(perkSources)
			.values({
				id: newId(),
				householdId: viewer.householdId,
				ownerMemberId,
				name: s.name,
				kind: s.kind,
				catalogKey: s.catalogKey,
				pageUrl: s.page,
				seenIn: s.seenIn,
				status: "suggested",
				fingerprint: fingerprintOf(ownerMemberId, `catalog:${s.catalogKey}`),
			})
			.onConflictDoNothing({ target: [perkSources.householdId, perkSources.fingerprint] })
			.returning({ id: perkSources.id });
	});
	const results = await db.batch([first as NonNullable<typeof first>, ...rest]);
	return results.reduce((sum, added) => sum + added.length, 0);
}

export type PerkItem = {
	id: string;
	name: string;
	kind: PerkKind;
	matches: string;
	quote: string;
	sourceUrl: string;
	checkedAt: number;
};

export type PerkSourceItem = {
	id: string;
	name: string;
	kind: PerkSourceKind;
	plan: string | null;
	planOptions: string[];
	pageUrl: string | null;
	seenIn: string | null;
	status: "suggested" | "confirmed";
	research: PerkResearch;
	checkedAt: number | null;
	/** Seen only in the Viewer's own Personal Allowance: nobody else sees it. */
	private: boolean;
	perks: PerkItem[];
};

/** The Perk Sources `viewer` may read that weren't dismissed, suggestions first, with their Perks. */
export async function loadPerkSources(db: Db, viewer: Viewer): Promise<PerkSourceItem[]> {
	const rows = await db
		.select()
		.from(perkSources)
		.where(and(readableBy(viewer), ne(perkSources.status, "dismissed")))
		.orderBy(
			sql`case when ${perkSources.status} = 'suggested' then 0 else 1 end`,
			desc(perkSources.createdAt),
			perkSources.id,
		);
	const ids = rows.map((row) => row.id);
	const found =
		ids.length === 0
			? []
			: await db
					.select()
					.from(perks)
					.where(inArray(perks.perkSourceId, ids))
					.orderBy(perks.kind, perks.name);
	return rows.map((row) => ({
		id: row.id,
		name: row.name,
		kind: row.kind,
		plan: row.plan,
		planOptions: row.planOptions ?? [],
		pageUrl: row.pageUrl,
		seenIn: row.seenIn,
		status: row.status as PerkSourceItem["status"],
		research: row.research,
		checkedAt: row.checkedAt?.getTime() ?? null,
		private: row.ownerMemberId !== null,
		perks: found
			.filter((perk) => perk.perkSourceId === row.id)
			.map((perk) => ({
				id: perk.id,
				name: perk.name,
				kind: perk.kind,
				matches: perk.matches,
				quote: perk.quote,
				sourceUrl: perk.sourceUrl,
				checkedAt: perk.checkedAt.getTime(),
			})),
	}));
}

/**
 * A Parent confirms a suggestion (its Perks are then researched) or dismisses one; removing a
 * confirmed Perk Source dismisses it too, with its Perks, and it isn't suggested again.
 * Idempotent. Returns whether it changed.
 */
export async function decidePerkSource(
	db: Db,
	viewer: Viewer,
	input: { id: string; status: "confirmed" | "dismissed" },
): Promise<boolean> {
	const target = and(readableBy(viewer), eq(perkSources.id, input.id));
	if (input.status === "confirmed") {
		const changed = await db
			.update(perkSources)
			.set({ status: "confirmed", research: "researching", decidedByMemberId: viewer.memberId })
			.where(and(target, eq(perkSources.status, "suggested")))
			.returning({ id: perkSources.id });
		return changed.length > 0;
	}
	const [changed] = await db.batch([
		db
			.update(perkSources)
			.set({ status: "dismissed", decidedByMemberId: viewer.memberId })
			.where(and(target, ne(perkSources.status, "dismissed")))
			.returning({ id: perkSources.id }),
		// Only once it's dismissed, whoever wins a race.
		db
			.delete(perks)
			.where(
				and(
					eq(perks.perkSourceId, input.id),
					sql`exists (select 1 from ${perkSources} where ${perkSources.id} = ${input.id} and ${perkSources.status} = 'dismissed' and ${target})`,
				),
			),
	]);
	return changed.length > 0;
}

/**
 * A Parent adds a Perk Source of their own, for the Household. A catalog product is the catalog's
 * (a suggestion of it, or one removed before, becomes confirmed again, with its page unless a
 * link is given). Returns its ID; its Perks are then researched.
 */
export async function addPerkSource(
	db: Db,
	viewer: Viewer,
	input: {
		id: string;
		name: string;
		kind: PerkSourceKind;
		plan: string | null;
		pageUrl: string | null;
	},
): Promise<string> {
	const entry = catalogEntryFor(input.name);
	const pageUrl = input.pageUrl ?? entry?.page ?? null;
	const [row] = await db
		.insert(perkSources)
		.values({
			id: input.id,
			householdId: viewer.householdId,
			name: input.name,
			kind: input.kind,
			catalogKey: entry?.key ?? null,
			plan: input.plan,
			pageUrl,
			status: "confirmed",
			research: "researching",
			fingerprint: fingerprintOf(null, entry ? `catalog:${entry.key}` : `own:${input.id}`),
			decidedByMemberId: viewer.memberId,
		})
		.onConflictDoUpdate({
			target: [perkSources.householdId, perkSources.fingerprint],
			set: {
				name: input.name,
				kind: input.kind,
				status: "confirmed",
				research: "researching",
				decidedByMemberId: viewer.memberId,
				...(input.plan ? { plan: input.plan } : {}),
				...(pageUrl ? { pageUrl } : {}),
			},
		})
		.returning({ id: perkSources.id });
	return (row as { id: string }).id;
}

/**
 * A Parent says which plan tier a confirmed Perk Source is, links its benefits page, or asks for
 * it to be checked again: its Perks are then researched. Returns whether it changed.
 */
export async function updatePerkSource(
	db: Db,
	viewer: Viewer,
	input: { id: string; plan?: string; pageUrl?: string },
): Promise<boolean> {
	const changed = await db
		.update(perkSources)
		.set({
			research: "researching",
			...(input.plan ? { plan: input.plan } : {}),
			...(input.pageUrl ? { pageUrl: input.pageUrl } : {}),
		})
		.where(
			and(readableBy(viewer), eq(perkSources.id, input.id), eq(perkSources.status, "confirmed")),
		)
		.returning({ id: perkSources.id });
	return changed.length > 0;
}

/** What research needs of a Perk Source; null unless it's confirmed. */
export type PerkSourceToResearch = {
	name: string;
	kind: PerkSourceKind;
	plan: string | null;
	pageUrl: string | null;
};

export async function loadPerkSourceToResearch(
	db: Db,
	householdId: string,
	id: string,
): Promise<PerkSourceToResearch | null> {
	const [row] = await db
		.select({
			name: perkSources.name,
			kind: perkSources.kind,
			plan: perkSources.plan,
			pageUrl: perkSources.pageUrl,
		})
		.from(perkSources)
		.where(
			and(
				eq(perkSources.householdId, householdId),
				eq(perkSources.id, id),
				eq(perkSources.status, "confirmed"),
			),
		);
	return row ?? null;
}

/** What came of reading a Perk Source's page. */
export type PerkResearchOutcome =
	| { research: "done"; perks: FoundPerk[]; sourceUrl: string }
	| { research: "needs-plan"; planOptions: string[] }
	| { research: "needs-link" | "unreadable" };

/**
 * Stores what research found, if the Perk Source is still confirmed. Its Perks are replaced
 * only when research is done (each kept by its key, so Insights resting on it keep it); a page
 * that couldn't be read, or needs a plan tier, leaves the Perks it had.
 */
export async function saveResearch(
	db: Db,
	input: {
		householdId: string;
		perkSourceId: string;
		checkedAt: Date;
		outcome: PerkResearchOutcome;
		newId: () => string;
	},
): Promise<void> {
	const { householdId, perkSourceId, checkedAt, outcome } = input;
	const source = and(
		eq(perkSources.householdId, householdId),
		eq(perkSources.id, perkSourceId),
		eq(perkSources.status, "confirmed"),
	);
	const mark = db
		.update(perkSources)
		.set({
			research: outcome.research,
			checkedAt,
			...(outcome.research === "needs-plan"
				? { planOptions: outcome.planOptions }
				: outcome.research === "done"
					? { planOptions: null }
					: {}),
		})
		.where(source);
	if (outcome.research !== "done") {
		await mark;
		return;
	}
	const [confirmed] = await db.select({ id: perkSources.id }).from(perkSources).where(source);
	if (!confirmed) return;
	const keys = outcome.perks.map(perkKey);
	await db.batch([
		mark,
		db
			.delete(perks)
			.where(
				and(
					eq(perks.perkSourceId, perkSourceId),
					keys.length > 0 ? notInArray(perks.key, keys) : undefined,
				),
			),
		...outcome.perks.map((perk) => {
			const fields = {
				name: perk.name,
				kind: perk.kind,
				matches: perk.matches,
				quote: perk.quote,
				sourceUrl: outcome.sourceUrl,
				checkedAt,
			};
			return db
				.insert(perks)
				.values({ id: input.newId(), householdId, perkSourceId, key: perkKey(perk), ...fields })
				.onConflictDoUpdate({ target: [perks.perkSourceId, perks.key], set: fields });
		}),
	]);
}

/**
 * Confirmed Perk Sources due for the nightly re-check: last read before `before` (or never),
 * and not waiting on a Parent for a plan tier or a link.
 */
export function perkSourcesToRecheck(
	db: Db,
	before: Date,
): Promise<{ id: string; householdId: string }[]> {
	return db
		.select({ id: perkSources.id, householdId: perkSources.householdId })
		.from(perkSources)
		.where(
			and(
				eq(perkSources.status, "confirmed"),
				notInArray(perkSources.research, ["needs-plan", "needs-link"]),
				or(isNull(perkSources.checkedAt), lt(perkSources.checkedAt, before)),
			),
		);
}

/** The Perks of the confirmed Perk Sources `viewer` may read, for the Insight detectors. */
export async function loadInsightPerks(db: Db, viewer: Viewer): Promise<InsightPerk[]> {
	const rows = await db
		.select({
			id: perks.id,
			sourceId: perkSources.id,
			sourceName: perkSources.name,
			key: perks.key,
			name: perks.name,
			kind: perks.kind,
			matches: perks.matches,
			owner: perkSources.ownerMemberId,
		})
		.from(perks)
		.innerJoin(perkSources, eq(perkSources.id, perks.perkSourceId))
		.where(and(readableBy(viewer), eq(perkSources.status, "confirmed")));
	return rows.map(({ owner, ...perk }) => ({ ...perk, private: owner !== null }));
}

/** Perks by ID, with their Perk Source's name, as `viewer` may read them. */
export async function loadPerksById(
	db: Db,
	viewer: Viewer,
	ids: string[],
): Promise<(PerkItem & { sourceName: string })[]> {
	if (ids.length === 0) return [];
	const rows = await db
		.select({ perk: perks, sourceName: perkSources.name })
		.from(perks)
		.innerJoin(perkSources, eq(perkSources.id, perks.perkSourceId))
		.where(and(readableBy(viewer), inArray(perks.id, ids)));
	return rows.map(({ perk, sourceName }) => ({
		id: perk.id,
		name: perk.name,
		kind: perk.kind,
		matches: perk.matches,
		quote: perk.quote,
		sourceUrl: perk.sourceUrl,
		checkedAt: perk.checkedAt.getTime(),
		sourceName,
	}));
}
