import type { DraftBucket } from "@noodle/domain";
import { ulid } from "ulid";
import type { SetupBucket } from "./setup";

// The starter Buckets a family begins with (#53), shared with the Plan's Buckets page (#57):
// the list, amounts scaled from what's left after the bills, the plan draft's amounts merged in
// when there's history, and the writes that take the Plan to the list without duplicates.

/** A Bucket as the picker edits it: what's saved, plus the field's text and where its amount came from. */
export type BucketRow = SetupBucket & {
	amount: string;
	/** The Parent typed in this row: suggestions arriving later leave it alone. */
	touched: boolean;
	/** "spending" when the amount came from the plan draft; "scaled" when from what's left. */
	suggested: "spending" | "scaled" | null;
};

/**
 * The starter list. `share` is each one's part of what's left after the bills when there's no
 * history to go on; together they leave about a fifth unplanned, for Goals and surprises.
 */
export const STARTER_BUCKETS: {
	key: string;
	name: string;
	share: number;
	rolling: boolean;
	personal?: boolean;
	also?: RegExp;
}[] = [
	{
		key: "groceries",
		name: "Groceries",
		share: 0.3,
		rolling: false,
		also: /grocer|food|supermarket/i,
	},
	{
		key: "dining",
		name: "Dining out",
		share: 0.08,
		rolling: false,
		also: /dining|restaurant|takeout|coffee/i,
	},
	{ key: "gas", name: "Gas", share: 0.08, rolling: false, also: /^gas|fuel|gasoline/i },
	{
		key: "household",
		name: "Household",
		share: 0.08,
		rolling: false,
		also: /household|home|supplies/i,
	},
	{ key: "kids", name: "Kids", share: 0.08, rolling: false, also: /kids|child|school/i },
	{ key: "fun", name: "Fun", share: 0.06, rolling: false, also: /fun|entertainment|hobb/i },
	// Gifts come in lumps (birthdays, December), so what's left carries over by default.
	{ key: "gifts", name: "Gifts", share: 0.04, rolling: true, also: /gift/i },
	{ key: "personal", name: "Personal Allowance", share: 0.04, rolling: false, personal: true },
];

/** The signed-in Parent's Personal Allowance's name, e.g. "Alex’s money". */
export const personalName = (parentName: string | null | undefined) =>
	parentName ? `${parentName.trim().slice(0, 30)}’s money` : "My money";

const norm = (name: string) => name.trim().toLowerCase();

/** The list to start from: what was saved, or the starter Buckets, with no amounts yet. */
export function startingBuckets(
	saved: SetupBucket[] | undefined,
	parentName: string | null | undefined,
	format: (c: number) => string,
): BucketRow[] {
	if (saved?.length) {
		return saved.map((bucket) => ({
			...bucket,
			amount: bucket.amountCents ? format(bucket.amountCents) : "",
			// A row saved without being typed in still takes a suggestion that arrives later.
			touched: bucket.touched ?? true,
			suggested: null,
		}));
	}
	return STARTER_BUCKETS.map((starter) => ({
		key: starter.key,
		id: ulid(),
		name: starter.personal ? personalName(parentName) : starter.name,
		amountCents: 0,
		rolling: starter.rolling,
		personal: starter.personal ?? false,
		kept: true,
		amount: "",
		touched: false,
		suggested: null,
	}));
}

/** A new, empty row for "Add another". */
export const anotherBucket = (): BucketRow => ({
	key: `own-${ulid()}`,
	id: ulid(),
	name: "",
	amountCents: 0,
	rolling: false,
	personal: false,
	kept: true,
	amount: "",
	touched: true,
	suggested: null,
});

/** Rounds down to whole tens of dollars. */
const tens = (cents: number) => Math.max(0, Math.floor(cents / 1000) * 1000);

/**
 * Amounts scaled from what's left after the bills, for the starter rows nobody typed in and the
 * plan draft hasn't filled. Nothing changes when there's nothing left.
 */
export function scaleBuckets(
	rows: BucketRow[],
	leftCents: number,
	format: (c: number) => string,
): BucketRow[] {
	if (leftCents <= 0) return rows;
	return rows.map((row) => {
		const starter = STARTER_BUCKETS.find((s) => s.key === row.key);
		if (!starter || row.touched || row.suggested === "spending") return row;
		const amountCents = tens(leftCents * starter.share);
		return { ...row, amountCents, amount: format(amountCents), suggested: "scaled" };
	});
}

/**
 * The plan draft's Buckets, merged in as they arrive: each fills the starter it matches by name
 * (or a row of its own) with what it averaged a month. Rows the Parent typed in are left alone,
 * and a suggestion already in the list isn't added twice.
 */
export function mergeDraftBuckets(
	rows: BucketRow[],
	draft: DraftBucket[],
	format: (c: number) => string,
): BucketRow[] {
	const next = [...rows];
	for (const found of draft) {
		if (next.some((row) => row.draftKey === found.key)) continue;
		const filled = {
			amountCents: found.allowance,
			amount: format(found.allowance),
			suggested: "spending" as const,
			draftKey: found.key,
		};
		const match = next.findIndex((row) => {
			if (row.personal || row.draftKey) return false;
			if (norm(row.name) === norm(found.name)) return true;
			const starter = STARTER_BUCKETS.find((s) => s.key === row.key);
			return !row.touched && (starter?.also?.test(found.name) ?? false);
		});
		const at = match >= 0 ? (next[match] as BucketRow) : undefined;
		if (at && !at.touched) {
			next[match] = { ...at, ...filled, kept: true };
		} else if (!at) {
			next.push({
				key: `draft-${found.key}`,
				id: ulid(),
				name: found.name.slice(0, 40),
				rolling: false,
				personal: false,
				kept: true,
				touched: false,
				...filled,
			});
		}
	}
	return next;
}

/** The kept Buckets' total. */
export const bucketsTotal = (rows: Pick<SetupBucket, "kept" | "amountCents">[]) =>
	rows.reduce((sum, row) => sum + (row.kept ? row.amountCents : 0), 0);

export type PlanBucketNow = {
	id: string;
	name: string;
	allowance: number;
	rolling: boolean;
	owner?: string;
};

/** The writes that take the Plan from what was saved last time to `next`. */
export type BucketWrites = {
	/** The rows to save, with ids swapped for a Bucket the Plan already had by that name. */
	rows: SetupBucket[];
	add: SetupBucket[];
	addPersonal: SetupBucket[];
	accept: SetupBucket[];
	rename: SetupBucket[];
	amount: SetupBucket[];
	rolling: SetupBucket[];
	archive: string[];
};

/**
 * Re-running never makes a second Bucket: one saved before changes only what changed, one the
 * Plan already has by name is changed in place, and one removed since is archived.
 */
export function planBucketWrites(
	previous: SetupBucket[] | undefined,
	next: SetupBucket[],
	plan: PlanBucketNow[],
	parentId: string,
): BucketWrites {
	const out: BucketWrites = {
		rows: [],
		add: [],
		addPersonal: [],
		accept: [],
		rename: [],
		amount: [],
		rolling: [],
		archive: [],
	};
	const before = new Map((previous ?? []).map((bucket) => [bucket.key, bucket]));
	for (const bucket of next) {
		const prev = before.get(bucket.key);
		before.delete(bucket.key);
		if (!bucket.kept) {
			if (prev?.kept) out.archive.push(prev.id);
			out.rows.push(prev?.kept ? { ...bucket, id: ulid() } : bucket);
			continue;
		}
		if (prev?.kept && prev.id === bucket.id) {
			if (prev.name !== bucket.name) out.rename.push(bucket);
			if (prev.amountCents !== bucket.amountCents) out.amount.push(bucket);
			if (prev.rolling !== bucket.rolling) out.rolling.push(bucket);
			out.rows.push(bucket);
			continue;
		}
		// A Parent has one Personal Allowance, whatever it's called.
		const existing = plan.find((b) =>
			bucket.personal ? b.owner === parentId : !b.owner && norm(b.name) === norm(bucket.name),
		);
		if (existing) {
			const row = { ...bucket, id: existing.id };
			if (norm(existing.name) !== norm(bucket.name)) out.rename.push(row);
			if (existing.allowance !== bucket.amountCents) out.amount.push(row);
			if (existing.rolling !== bucket.rolling) out.rolling.push(row);
			out.rows.push(row);
		} else {
			if (bucket.personal) out.addPersonal.push(bucket);
			else if (bucket.draftKey) {
				out.accept.push(bucket);
				// A plan-draft Bucket is added resetting monthly.
				if (bucket.rolling) out.rolling.push(bucket);
			} else out.add.push(bucket);
			out.rows.push(bucket);
		}
	}
	for (const gone of before.values()) if (gone.kept) out.archive.push(gone.id);
	return out;
}
