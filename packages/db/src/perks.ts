import {
	cardCatalogKey,
	cardIssuerFor,
	cardProductIn,
	cardProductNamed,
	catalogEntryFor,
	type DayKey,
	type FoundPerk,
	type InsightPerk,
	mentions,
	type PerkKind,
	type PerkRenewal,
	type PerkSourceKind,
	type PerkSourceSuggestion,
	type PerkUse,
	perkKey,
	type WorthLine,
	worthUsing,
} from "@noodle/domain";
import {
	and,
	desc,
	eq,
	gt,
	inArray,
	isNull,
	like,
	lt,
	ne,
	notInArray,
	or,
	type SQL,
	sql,
} from "drizzle-orm";
import type { Db } from "./index";
import type { Viewer } from "./privacy";
import { accounts, bankConnections, perkPages, perkSources, perks, perkUses } from "./schema";

// Perk Sources and their Perks in D1. A suggestion seen only in a Parent's own Personal Allowance
// is stored as theirs alone, like an Insight (ADR-0003), and so are its Perks and the Perk
// Overlaps resting on them. Perk Sources are keyed by fingerprint (the catalog product, or one a
// Parent added, with its owner), so a dismissed or removed one isn't suggested again. Research
// (the Perk research Workflow) writes a Perk Source's Perks and where reading them stands.

export type PerkResearch = (typeof perkSources.$inferSelect)["research"];

/** A Perk Source's fingerprint: its catalog product, or its own ID, with its owner. */
/** Ids as one JSON parameter for `in (…)`: D1 allows 100 bound parameters a statement. */
const jsonList = (values: string[]) =>
	sql`(select value from json_each(${JSON.stringify(values)}))`;

const fingerprintOf = (ownerMemberId: string | null, product: string) =>
	`${ownerMemberId ?? "household"}|${product}`;

/**
 * A Perk Source made from a card a Bank Connection brought in is bound to that Account by its
 * fingerprint ("household|account:<Account ID>", #96): one per Account, and one a Parent removed
 * isn't made again.
 */
const ACCOUNT_MARK = "|account:";
const boundAccountId = (fingerprint: string): string | null => {
	const at = fingerprint.indexOf(ACCOUNT_MARK);
	return at < 0 ? null : fingerprint.slice(at + ACCOUNT_MARK.length);
};

/** Whether a card's Perk Source is this Account's by its name, as #80 told them: for ones not bound. */
const namedFor = (
	source: { name: string; seenIn: string | null },
	accountName: string,
): boolean => {
	const name = accountName.trim();
	const entry = catalogEntryFor(source.name);
	return (
		name === source.seenIn ||
		name.toLowerCase() === source.name.trim().toLowerCase() ||
		(entry !== undefined && catalogEntryFor(name) === entry)
	);
};

type CardAccount = {
	id: string;
	householdId: string;
	name: string;
	kind: string;
	mask: string | null;
	bankConnectionId: string | null;
	institution: string | null;
};

/** Accounts with the institution each came from, for one Household or all. */
function loadAccountsWithBank(db: Db, householdId?: string): Promise<CardAccount[]> {
	return db
		.select({
			id: accounts.id,
			householdId: accounts.householdId,
			name: accounts.name,
			kind: accounts.kind,
			mask: accounts.mask,
			bankConnectionId: accounts.bankConnectionId,
			institution: bankConnections.institution,
		})
		.from(accounts)
		.leftJoin(bankConnections, eq(bankConnections.id, accounts.bankConnectionId))
		.where(householdId ? eq(accounts.householdId, householdId) : undefined);
}

/** What tells two Perk Sources are one card or membership. */
type Foldable = {
	id: string;
	name: string;
	kind: string;
	seenIn: string | null;
	status: string;
	fingerprint: string;
	ownerMemberId: string | null;
	createdAt: Date;
};

/** The card Accounts a Perk Source is: the one it's bound to, else those its name tells. */
function cardAccountsOf(row: Foldable, cardAccounts: CardAccount[]): CardAccount[] {
	if (row.kind !== "credit-card") return [];
	const bound = boundAccountId(row.fingerprint);
	return bound
		? cardAccounts.filter((account) => account.id === bound)
		: cardAccounts.filter((account) => namedFor(row, account.name));
}

/** A name as a Parent would know it again: its letter case and spaces aside. */
const nameKey = (row: Foldable) =>
	`${row.ownerMemberId ?? ""}|${row.kind}|${row.name.toLowerCase().replace(/\s+/g, "")}`;

/**
 * Perk Sources that are the same card or membership, together (issue 119): a Household may hold
 * two for one Account from before adding one twice was stopped. Two are the same when they are
 * the same card Account's, or, for one that is no Account's, when they have the same kind and
 * name (letter case and spaces aside). Nothing stored changes: they are read as one. Each group
 * has the kept one first: the one bound to the Account, else a confirmed one, else the oldest.
 * The groups come in the order of their kept ones.
 */
function foldDuplicates<T extends Foldable>(rows: T[], cardAccounts: CardAccount[]): T[][] {
	const groups: T[][] = [];
	const byAccount = new Map<string, T[]>();
	const loose: T[] = [];
	for (const row of rows) {
		const account = cardAccountsOf(row, cardAccounts)[0];
		if (!account) {
			loose.push(row);
			continue;
		}
		const key = `${row.ownerMemberId ?? ""}|${account.id}`;
		const group = byAccount.get(key);
		if (group) group.push(row);
		else {
			const made = [row];
			byAccount.set(key, made);
			groups.push(made);
		}
	}
	for (const row of loose) {
		const key = nameKey(row);
		const group = groups.find((members) => members.some((member) => nameKey(member) === key));
		if (group) group.push(row);
		else groups.push([row]);
	}
	const rank = (row: T) =>
		(boundAccountId(row.fingerprint) !== null ? 0 : 2) + (row.status === "confirmed" ? 0 : 1);
	const place = new Map(rows.map((row, index) => [row.id, index]));
	const placeOf = (row: T | undefined) => (row ? (place.get(row.id) ?? 0) : 0);
	return groups
		.map((members) =>
			[...members].sort(
				(a, b) =>
					rank(a) - rank(b) ||
					a.createdAt.getTime() - b.createdAt.getTime() ||
					a.id.localeCompare(b.id),
			),
		)
		.sort((a, b) => placeOf(a[0]) - placeOf(b[0]));
}

const foldable = {
	id: perkSources.id,
	name: perkSources.name,
	kind: perkSources.kind,
	seenIn: perkSources.seenIn,
	status: perkSources.status,
	fingerprint: perkSources.fingerprint,
	ownerMemberId: perkSources.ownerMemberId,
	createdAt: perkSources.createdAt,
};

/** The Perk Sources `viewer` may read that weren't dismissed, the same ones together. */
async function loadFolded(db: Db, viewer: Viewer): Promise<Foldable[][]> {
	const rows = await db
		.select(foldable)
		.from(perkSources)
		.where(and(readableBy(viewer), ne(perkSources.status, "dismissed")))
		.orderBy(perkSources.createdAt, perkSources.id);
	if (rows.length < 2) return rows.map((row) => [row]);
	const cardAccounts = (await loadAccountsWithBank(db, viewer.householdId)).filter(
		(account) => account.kind === "credit-card",
	);
	return foldDuplicates(rows, cardAccounts);
}

/**
 * The confirmed Perk Source a card or membership a Parent is adding already is, if there is one
 * (issue 119): the same Account's, the same catalog product, or the same name. The add sheet then
 * says it's already there instead of adding it again.
 */
export async function perkSourceAlreadyThere(
	db: Db,
	viewer: Viewer,
	input: { name: string; kind: PerkSourceKind },
): Promise<{ id: string; name: string } | null> {
	const rows: Foldable[] = await db
		.select(foldable)
		.from(perkSources)
		.where(
			and(
				eq(perkSources.householdId, viewer.householdId),
				isNull(perkSources.ownerMemberId),
				ne(perkSources.status, "dismissed"),
			),
		)
		.orderBy(perkSources.createdAt, perkSources.id);
	if (rows.length === 0) return null;
	const cardAccounts = (await loadAccountsWithBank(db, viewer.householdId)).filter(
		(account) => account.kind === "credit-card",
	);
	const entry = catalogEntryFor(input.name);
	const adding: Foldable = {
		id: "",
		name: input.name,
		kind: input.kind,
		seenIn: null,
		status: "confirmed",
		fingerprint: fingerprintOf(null, entry ? `catalog:${entry.key}` : "own:"),
		ownerMemberId: null,
		createdAt: new Date(8.64e15),
	};
	const same =
		foldDuplicates([...rows, adding], cardAccounts)
			.find((members) => members.includes(adding))
			?.find((member) => member !== adding) ??
		rows.find((row) => row.fingerprint === adding.fingerprint);
	if (!same) return null;
	// As the Perks page shows it: the kept one of those that are the same.
	const kept = foldDuplicates(rows, cardAccounts).find((members) => members.includes(same))?.[0];
	return kept?.status === "confirmed" ? { id: kept.id, name: kept.name } : null;
}

/**
 * Every credit card a Bank Connection brought in gets a Perk Source of its own, confirmed, without
 * a Parent adding it. Idempotent: an Account that has one (bound to it, or told by its
 * name), or whose one a Parent removed, is left alone. When the Account's name tells which card it
 * is, its benefits page is known and the returned Perk Sources are ready to research; when the
 * bank named it only "CREDIT CARD", the Perk Source waits for a Parent to say which card it is.
 */
export async function ensureCardPerkSources(
	db: Db,
	input: { householdId?: string; newId: () => string },
): Promise<{ id: string; householdId: string }[]> {
	const cards = (await loadAccountsWithBank(db, input.householdId)).filter(
		(account) => account.kind === "credit-card" && account.bankConnectionId !== null,
	);
	if (cards.length === 0) return [];
	const existing = await db
		.select({
			householdId: perkSources.householdId,
			name: perkSources.name,
			seenIn: perkSources.seenIn,
			status: perkSources.status,
			fingerprint: perkSources.fingerprint,
		})
		.from(perkSources)
		.where(
			and(
				eq(perkSources.kind, "credit-card"),
				input.householdId ? eq(perkSources.householdId, input.householdId) : undefined,
			),
		);
	const inserts = cards.flatMap((account) => {
		const has = existing.some(
			(row) =>
				row.householdId === account.householdId &&
				(boundAccountId(row.fingerprint) === account.id ||
					(row.status !== "dismissed" && namedFor(row, account.name))),
		);
		if (has) return [];
		const issuer = cardIssuerFor(account.institution, account.name);
		const product = issuer ? cardProductIn(issuer, account.name) : undefined;
		const known = catalogEntryFor(account.name);
		const catalog = known?.kind === "credit-card" ? known : undefined;
		const pageUrl = product?.page ?? catalog?.page ?? null;
		return [
			db
				.insert(perkSources)
				.values({
					id: input.newId(),
					householdId: account.householdId,
					name:
						product?.name ??
						catalog?.name ??
						(issuer ? `${issuer.name} credit card` : "Credit card"),
					kind: "credit-card",
					catalogKey: issuer && product ? cardCatalogKey(issuer, product) : (catalog?.key ?? null),
					pageUrl,
					seenIn: account.name.trim(),
					status: "confirmed",
					research: pageUrl ? "researching" : "idle",
					fingerprint: fingerprintOf(null, `account:${account.id}`),
				})
				.onConflictDoNothing({ target: [perkSources.householdId, perkSources.fingerprint] })
				.returning({
					id: perkSources.id,
					householdId: perkSources.householdId,
					pageUrl: perkSources.pageUrl,
				}),
		];
	});
	const [first, ...rest] = inserts;
	if (!first) return [];
	const results = await db.batch([first, ...rest]);
	return results
		.flat()
		.filter((row) => row.pageUrl !== null)
		.map(({ id, householdId }) => ({ id, householdId }));
}

/**
 * A Parent says which card a linked card's Perk Source is: one of its issuer's listed cards
 * (whose benefits page is then known), or another they name (they're then asked for its page).
 * The Perks it had, if any, were another card's and go. Returns whether it changed.
 */
export async function nameCardProduct(
	db: Db,
	viewer: Viewer,
	input: { id: string; product: string },
): Promise<boolean> {
	const target = and(
		readableBy(viewer),
		eq(perkSources.id, input.id),
		eq(perkSources.status, "confirmed"),
	);
	const [row] = await db
		.select({ fingerprint: perkSources.fingerprint })
		.from(perkSources)
		.where(target);
	const accountId = row ? boundAccountId(row.fingerprint) : null;
	if (!accountId) return false;
	const account = (await loadAccountsWithBank(db, viewer.householdId)).find(
		(a) => a.id === accountId,
	);
	// The issuer is the bank's when it's one Noodle knows, else whichever the typed name tells.
	const issuer =
		(account ? cardIssuerFor(account.institution, account.name) : undefined) ??
		cardIssuerFor(null, input.product);
	const listed = issuer
		? (cardProductNamed(issuer, input.product) ?? cardProductIn(issuer, input.product))
		: undefined;
	const known = catalogEntryFor(input.product);
	const [changed] = await db.batch([
		db
			.update(perkSources)
			.set({
				name: listed?.name ?? input.product,
				catalogKey: issuer && listed ? cardCatalogKey(issuer, listed) : "card:other",
				pageUrl: listed?.page ?? (known?.kind === "credit-card" ? known.page : null),
				plan: null,
				planOptions: null,
				research: "researching",
				decidedByMemberId: viewer.memberId,
			})
			.where(target)
			.returning({ id: perkSources.id }),
		db.delete(perks).where(eq(perks.perkSourceId, input.id)),
	]);
	return changed.length > 0;
}

/** A benefits page read since `since`, if one was kept. */
export async function loadPerkPage(
	db: Db,
	url: string,
	since: Date,
): Promise<{ url: string; text: string; via: "fetch" | "browser"; fetchedAt: Date } | null> {
	const [row] = await db
		.select()
		.from(perkPages)
		.where(and(eq(perkPages.url, url), gt(perkPages.fetchedAt, since)));
	return row ? { url: row.finalUrl, text: row.text, via: row.via, fetchedAt: row.fetchedAt } : null;
}

/** Keeps a benefits page as just read, in place of the one kept before. */
export async function savePerkPage(
	db: Db,
	page: { url: string; finalUrl: string; text: string; via: "fetch" | "browser"; fetchedAt: Date },
): Promise<void> {
	const { url, ...fields } = page;
	await db
		.insert(perkPages)
		.values(page)
		.onConflictDoUpdate({ target: perkPages.url, set: fields });
}

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
		.where(and(eq(accounts.householdId, householdId), isNull(accounts.archivedAt)));
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
	// A card that already has a Perk Source of its own (bound to its Account, #96) isn't suggested too.
	const bound = suggestions.some((s) => s.kind === "credit-card")
		? await db
				.select({ seenIn: perkSources.seenIn })
				.from(perkSources)
				.where(
					and(
						eq(perkSources.householdId, viewer.householdId),
						like(perkSources.fingerprint, `%${ACCOUNT_MARK}%`),
					),
				)
		: [];
	const fresh = suggestions.filter(
		(s) => s.kind !== "credit-card" || !bound.some((row) => row.seenIn === s.seenIn),
	);
	const [first, ...rest] = fresh.map((s) => {
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
	if (!first) return 0;
	const results = await db.batch([first, ...rest]);
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
	/** What it's worth, in cents, when its page's quote states it. */
	valueCents: number | null;
	renews: PerkRenewal | null;
	/** The uses Parents marked by hand, latest first. */
	uses: PerkUse[];
	/** Days the Household paid for what it covers. */
	spentOn: DayKey[];
};

/** The card Account a credit-card Perk Source is, when Noodle knows which. */
export type PerkCard = {
	accountId: string;
	accountName: string;
	mask: string | null;
	/** The card's issuer, when the institution or the Account's name tells. */
	issuer: string | null;
	/** The bank didn't say which card it is: a Parent is asked. */
	needsProduct: boolean;
	/** The issuer's common cards, to pick from. */
	productOptions: string[];
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
	/** Its annual fee, as a Parent typed it. */
	annualFeeCents: number | null;
	/** The Household's today, when it was loaded for the Perks page. */
	asOf: DayKey | null;
	card: PerkCard | null;
	/** "Worth using": its Perks against the Household's own spending, most valuable first. */
	worth: WorthLine[];
	perks: PerkItem[];
};

/**
 * The Perk Sources `viewer` may read that weren't dismissed, suggestions first, with their Perks.
 * Ones that are the same card or membership show as one (issue 119): the kept one, with every
 * Perk of either once, and a use marked on both counted once.
 */
export async function loadPerkSources(
	db: Db,
	viewer: Viewer,
	look?: {
		asOf: DayKey;
		spends: {
			id?: string;
			date: DayKey;
			note: string;
			amount?: number;
			accountId?: string | null;
		}[];
	},
): Promise<PerkSourceItem[]> {
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
					.where(inArray(perks.perkSourceId, jsonList(ids)))
					.orderBy(perks.kind, perks.name);
	const uses =
		found.length === 0
			? []
			: await db
					.select()
					.from(perkUses)
					.where(
						and(
							eq(perkUses.householdId, viewer.householdId),
							inArray(perkUses.perkId, jsonList(found.map((perk) => perk.id))),
						),
					)
					.orderBy(desc(perkUses.usedOn), desc(perkUses.createdAt));
	const spends = look?.spends ?? [];
	// A card's perk counts only charges on that card's own Account (#80): "Hotel" on another
	// card isn't this card's hotel credit used. Other Perk Sources count any of the spending.
	const allAccounts = await loadAccountsWithBank(db, viewer.householdId);
	const cardAccounts = allAccounts.filter((account) => account.kind === "credit-card");
	const accountsOf = (row: (typeof rows)[number]) => cardAccountsOf(row, cardAccounts);
	const spendsFor = (row: (typeof rows)[number]) => {
		if (row.kind !== "credit-card") return spends;
		const own = new Set(accountsOf(row).map((account) => account.id));
		return spends.filter((s) => s.accountId != null && own.has(s.accountId));
	};
	const cardOf = (row: (typeof rows)[number]): PerkCard | null => {
		const account = accountsOf(row)[0];
		if (!account) return null;
		const issuer = cardIssuerFor(account.institution, account.name);
		const needsProduct = boundAccountId(row.fingerprint) !== null && row.catalogKey === null;
		return {
			accountId: account.id,
			accountName: account.name,
			mask: account.mask,
			issuer: issuer?.name ?? null,
			needsProduct,
			productOptions: needsProduct ? (issuer?.products.map((product) => product.name) ?? []) : [],
		};
	};
	const accountNames = Object.fromEntries(allAccounts.map((account) => [account.id, account.name]));
	const usesOf = (perkId: string) => uses.filter((use) => use.perkId === perkId);
	type Folded = { perk: (typeof found)[number]; uses: typeof uses };
	/** The Perks of Perk Sources that are the same, each once, the kept one's own first. */
	const perksOf = (members: (typeof rows)[number][]): Folded[] => {
		const byKey = new Map<string, Folded>();
		for (const member of members) {
			for (const perk of found.filter((p) => p.perkSourceId === member.id)) {
				const own = usesOf(perk.id);
				const kept = byKey.get(perk.key);
				if (!kept) {
					byKey.set(perk.key, { perk, uses: own });
					continue;
				}
				// A use marked on both for one day is one use.
				const days = new Set(kept.uses.map((use) => use.usedOn));
				kept.uses = [...kept.uses, ...own.filter((use) => !days.has(use.usedOn))].sort(
					(a, b) =>
						b.usedOn.localeCompare(a.usedOn) || b.createdAt.getTime() - a.createdAt.getTime(),
				);
				if (kept.perk.valueCents === null && kept.perk.renews === null) {
					kept.perk = { ...kept.perk, valueCents: perk.valueCents, renews: perk.renews };
				}
			}
		}
		const place = (perk: Folded["perk"]) => found.findIndex((p) => p.id === perk.id);
		return [...byKey.values()].sort((a, b) => place(a.perk) - place(b.perk));
	};
	const worthOf = (row: (typeof rows)[number], folded: Folded[]): WorthLine[] => {
		if (!look || row.kind !== "credit-card" || row.status !== "confirmed") return [];
		return worthUsing({
			cardAccountId: accountsOf(row)[0]?.id ?? null,
			perks: folded.map(({ perk, uses: marked }) => ({
				id: perk.id,
				name: perk.name,
				kind: perk.kind,
				matches: perk.matches,
				quote: perk.quote,
				valueCents: perk.valueCents,
				renews: perk.renews,
				usedOn: marked.map((use) => use.usedOn as DayKey),
			})),
			spends: spends.map((s, index) => ({
				id: s.id ?? String(index),
				date: s.date,
				amount: s.amount ?? 0,
				note: s.note,
				accountId: s.accountId ?? null,
			})),
			accountNames,
			asOf: look.asOf,
		});
	};
	return foldDuplicates(rows, cardAccounts).flatMap((members) => {
		const row = members[0];
		if (!row) return [];
		const folded = perksOf(members);
		const ownSpends = spendsFor(row);
		return [sourceItem(row, members, folded, ownSpends)];
	});
	function sourceItem(
		row: (typeof rows)[number],
		members: (typeof rows)[number][],
		folded: Folded[],
		ownSpends: typeof spends,
	): PerkSourceItem {
		return {
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
			// A fee typed on one that is now hidden still counts.
			annualFeeCents:
				members.find((member) => member.annualFeeCents !== null)?.annualFeeCents ?? null,
			asOf: look?.asOf ?? null,
			card: cardOf(row),
			worth: worthOf(row, folded),
			perks: folded.map(({ perk, uses: marked }) => ({
				id: perk.id,
				name: perk.name,
				kind: perk.kind,
				matches: perk.matches,
				quote: perk.quote,
				sourceUrl: perk.sourceUrl,
				checkedAt: perk.checkedAt.getTime(),
				valueCents: perk.valueCents,
				renews: perk.renews,
				uses: marked.map((use) => ({ id: use.id, on: use.usedOn as DayKey, note: use.note })),
				spentOn: ownSpends.filter((s) => mentions(s.note, perk.matches)).map((s) => s.date),
			})),
		};
	}
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
	// Ones that show as the same card or membership go together (issue 119), or the hidden one
	// would take the removed one's place.
	const same = (await loadFolded(db, viewer)).find((members) =>
		members.some((member) => member.id === input.id),
	);
	const ids = same ? same.map((member) => member.id) : [input.id];
	let changed = false;
	for (const id of ids) {
		const one = and(readableBy(viewer), eq(perkSources.id, id));
		const [gone] = await db.batch([
			db
				.update(perkSources)
				.set({ status: "dismissed", decidedByMemberId: viewer.memberId })
				.where(and(one, ne(perkSources.status, "dismissed")))
				.returning({ id: perkSources.id }),
			// Only once it's dismissed, whoever wins a race.
			db
				.delete(perks)
				.where(
					and(
						eq(perks.perkSourceId, id),
						sql`exists (select 1 from ${perkSources} where ${perkSources.id} = ${id} and ${perkSources.status} = 'dismissed' and ${one})`,
					),
				),
		]);
		changed ||= gone.length > 0;
	}
	return changed;
}

/** The Perk Source bound to a linked card Account that this name tells, if there is one. */
async function linkedCardSourceNamed(
	db: Db,
	householdId: string,
	name: string,
): Promise<string | null> {
	const cards = (await loadAccountsWithBank(db, householdId)).filter(
		(account) => account.kind === "credit-card",
	);
	if (cards.length === 0) return null;
	const rows = await db
		.select({ id: perkSources.id, fingerprint: perkSources.fingerprint })
		.from(perkSources)
		.where(and(eq(perkSources.householdId, householdId), eq(perkSources.kind, "credit-card")));
	const source = { name, seenIn: null };
	const found = rows.find((row) => {
		const bound = boundAccountId(row.fingerprint);
		return (
			bound !== null &&
			cards.some((account) => account.id === bound && namedFor(source, account.name))
		);
	});
	return found?.id ?? null;
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
	// A linked card already has a Perk Source of its own (issue 96). Adding the same card by name
	// confirms that one: a second would show the card twice, each counting the same charges.
	const linked =
		input.kind === "credit-card"
			? await linkedCardSourceNamed(db, viewer.householdId, input.name)
			: null;
	if (linked) {
		await db
			.update(perkSources)
			.set({
				name: input.name,
				status: "confirmed",
				research: "researching",
				decidedByMemberId: viewer.memberId,
				...(entry ? { catalogKey: entry.key } : {}),
				...(input.plan ? { plan: input.plan } : {}),
				...(pageUrl ? { pageUrl } : {}),
			})
			.where(and(eq(perkSources.householdId, viewer.householdId), eq(perkSources.id, linked)));
		return linked;
	}
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
					keys.length > 0 ? notInArray(perks.key, jsonList(keys)) : undefined,
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
				valueCents: perk.valueCents ?? null,
				renews: perk.renews ?? null,
			};
			return db
				.insert(perks)
				.values({ id: input.newId(), householdId, perkSourceId, key: perkKey(perk), ...fields })
				.onConflictDoUpdate({
					target: [perks.perkSourceId, perks.key],
					// A value and renewal a Parent typed stay; the page's only fill the rest (#80).
					set: {
						...fields,
						valueCents: sql`case when ${perks.valueByHand} then ${perks.valueCents} else excluded.value_cents end`,
						renews: sql`case when ${perks.valueByHand} then ${perks.renews} else excluded.renews end`,
					},
				});
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
				// "idle" once confirmed is a linked card waiting for a Parent to say which card it is.
				notInArray(perkSources.research, ["needs-plan", "needs-link", "idle"]),
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
		// What a card earns more on covers no cost and includes no service: no Overlap rests on it.
		.where(and(readableBy(viewer), eq(perkSources.status, "confirmed"), ne(perks.kind, "earn")));
	// A Perk two Perk Sources that are the same both hold is one Perk: the kept one's (issue 119).
	const keptOf = new Map<string, string>();
	for (const members of await loadFolded(db, viewer)) {
		for (const member of members) keptOf.set(member.id, members[0]?.id ?? member.id);
	}
	const kept = (perk: { sourceId: string }) => keptOf.get(perk.sourceId) ?? perk.sourceId;
	const own = new Set(
		rows.filter((perk) => kept(perk) === perk.sourceId).map((p) => `${p.sourceId}|${p.key}`),
	);
	const once = new Set<string>();
	return rows
		.filter((perk) => {
			const mark = `${kept(perk)}|${perk.key}`;
			if (kept(perk) === perk.sourceId) return true;
			if (own.has(mark) || once.has(mark)) return false;
			once.add(mark);
			return true;
		})
		.map(({ owner, ...perk }) => ({ ...perk, private: owner !== null }));
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
		.where(and(readableBy(viewer), inArray(perks.id, jsonList(ids))));
	return rows.map(({ perk, sourceName }) => ({
		id: perk.id,
		name: perk.name,
		kind: perk.kind,
		matches: perk.matches,
		quote: perk.quote,
		sourceUrl: perk.sourceUrl,
		checkedAt: perk.checkedAt.getTime(),
		valueCents: perk.valueCents,
		renews: perk.renews,
		uses: [],
		spentOn: [],
		sourceName,
	}));
}

/**
 * The Perk a Parent's change to `perkId` is stored on, or null when they may not read it: the
 * Perk itself, or the kept Perk Source's own when a hidden one that is the same holds it too
 * (issue 119).
 */
async function keptPerkId(db: Db, viewer: Viewer, perkId: string): Promise<string | null> {
	const [perk] = await db
		.select({ id: perks.id, key: perks.key, sourceId: perks.perkSourceId })
		.from(perks)
		.innerJoin(perkSources, eq(perkSources.id, perks.perkSourceId))
		.where(and(readableBy(viewer), eq(perks.id, perkId)));
	if (!perk) return null;
	const kept = (await loadFolded(db, viewer)).find((members) =>
		members.some((member) => member.id === perk.sourceId),
	)?.[0];
	if (!kept || kept.id === perk.sourceId) return perk.id;
	const [same] = await db
		.select({ id: perks.id })
		.from(perks)
		.where(and(eq(perks.perkSourceId, kept.id), eq(perks.key, perk.key)));
	return same?.id ?? perk.id;
}

/** A Parent marks a Perk they may read used on `on`, with a short note. Returns whether it was stored. */
export async function addPerkUse(
	db: Db,
	viewer: Viewer,
	input: { id: string; perkId: string; on: DayKey; note: string | null },
): Promise<boolean> {
	const perkId = await keptPerkId(db, viewer, input.perkId);
	if (!perkId) return false;
	await db
		.insert(perkUses)
		.values({
			id: input.id,
			householdId: viewer.householdId,
			perkId,
			memberId: viewer.memberId,
			usedOn: input.on,
			note: input.note,
		})
		.onConflictDoNothing();
	return true;
}

/** Takes back a use marked by hand. Returns whether it was there. */
export async function removePerkUse(db: Db, viewer: Viewer, id: string): Promise<boolean> {
	const gone = await db
		.delete(perkUses)
		.where(and(eq(perkUses.householdId, viewer.householdId), eq(perkUses.id, id)))
		.returning({ id: perkUses.id });
	return gone.length > 0;
}

/** A Parent says what a Perk Source's annual fee is, or clears it. Returns whether it changed. */
export async function setPerkSourceFee(
	db: Db,
	viewer: Viewer,
	input: { id: string; annualFeeCents: number | null },
): Promise<boolean> {
	const changed = await db
		.update(perkSources)
		.set({ annualFeeCents: input.annualFeeCents })
		.where(and(readableBy(viewer), eq(perkSources.id, input.id)))
		.returning({ id: perkSources.id });
	return changed.length > 0;
}

/**
 * A Parent types a perk's value and how often it renews, when its benefits page states none.
 * Only a perk of a Perk Source they may read. Returns whether it changed.
 */
export async function setPerkValue(
	db: Db,
	viewer: Viewer,
	input: {
		id: string;
		valueCents: number | null;
		renews: (typeof perks.$inferInsert)["renews"];
	},
): Promise<boolean> {
	const id = await keptPerkId(db, viewer, input.id);
	if (!id) return false;
	await db
		.update(perks)
		.set({
			valueCents: input.valueCents,
			renews: input.renews ?? null,
			valueByHand: input.valueCents !== null || input.renews != null,
		})
		.where(eq(perks.id, id));
	return true;
}
