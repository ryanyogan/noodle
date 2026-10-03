import type { Cadence } from "./commitments";
import { addDays, addMonths, type DayKey, daysBetween, type MonthKey, monthOfDay } from "./month";

// Suggestions (ADR-0027): what background AI spots in spending and offers a Parent to add with one
// tap. Pure, so the thresholds are unit-tested; the run (suggestion-run.ts) loads lines and saves
// what these return. Every line here is spending (amount above zero) with its clean merchant name,
// and `owner` is the Parent whose Personal Allowance it's in (null for the Household's): ideas never
// mix owners, so one Parent's private spending only ever makes a suggestion for that Parent
// (ADR-0003).

export const SUGGESTION_KINDS = [
	"new-bucket",
	"new-commitment",
	"commitment-amount",
	"rule",
] as const;
export type SuggestionKind = (typeof SUGGESTION_KINDS)[number];

export type SpendLine = {
	id: string;
	date: DayKey;
	/** Spent, in cents, above zero. */
	amountCents: number;
	merchant: string;
	owner: string | null;
	/** The Commitment it's assigned to, if any. */
	commitmentId: string | null;
	/** In Review (unassigned) or in a catch-all Bucket ("Other"): spending without a home. */
	homeless: boolean;
};

export type Evidence = {
	count: number;
	/** The amount the suggestion rests on: a month's spending for a Bucket, one charge otherwise. */
	amountCents: number;
	months: number;
	transactionIds: string[];
};

export type BucketIdea = {
	kind: "new-bucket";
	owner: string | null;
	name: string;
	amountCents: number;
	evidence: Evidence;
};

export type CommitmentIdea = {
	kind: "new-commitment";
	owner: string | null;
	name: string;
	merchant: string;
	amountCents: number;
	cadence: Cadence;
	/** The next day it's due, after its latest charge. */
	dueDate: DayKey;
	evidence: Evidence;
};

export type AmountIdea = {
	kind: "commitment-amount";
	owner: null;
	commitmentId: string;
	name: string;
	fromCents: number;
	amountCents: number;
	cadence: Cadence;
	dueDate: DayKey;
	evidence: Evidence;
};

export type SuggestionIdea = BucketIdea | CommitmentIdea | AmountIdea;

/** A catch-all Bucket, whose spending could use a Bucket of its own. */
export const isCatchAll = (bucketName: string) =>
	/^(other|misc\.?|miscellaneous|everything else|general|uncategori[sz]ed)$/i.test(
		bucketName.trim(),
	);

// Kinds of merchant a Bucket can be named for, by words in the clean name. Deterministic rather
// than the model: the same spending always gets the same name, it costs nothing, it's testable
// under AI_MODEL=stub as it is in production, and an unknown merchant is named for itself, which a
// Parent can rename before adding.
const KINDS: [name: string, words: RegExp][] = [
	["Pets", /\b(pet|pets|petco|petsmart|chewy|vet|veterinary|animal|banfield)\b/i],
	["Coffee", /\b(starbucks|dunkin|coffee|peet'?s|dutch bros)\b/i],
	[
		"Eating Out",
		/\b(chipotle|mcdonald'?s|restaurant|pizza|taco|grill|burger|doordash|uber eats|grubhub|subway)\b/i,
	],
	[
		"Groceries",
		/\b(costco|safeway|kroger|trader joe'?s|whole foods|aldi|publix|grocery|market)\b/i,
	],
	["Health", /\b(cvs|walgreens|pharmacy|rite aid|dental|clinic)\b/i],
	["Home", /\b(home depot|lowe'?s|ikea|hardware)\b/i],
	["Kids", /\b(toys|kids|children'?s|daycare|tutoring)\b/i],
	["Fun", /\b(amc|cinema|theater|theatre|arcade|bowling)\b/i],
];

/** The Bucket name a merchant's spending would go in: its kind, or the merchant itself. */
export const bucketNameFor = (merchant: string) =>
	KINDS.find(([, words]) => words.test(merchant))?.[0] ?? merchant;

export const BUCKET_THRESHOLDS = {
	days: 90,
	minMonths: 3,
	minCharges: 4,
	minMonthlyCents: 4_000,
	/** No one month holds more than this share of the group's spending. */
	maxMonthShare: 0.6,
};

const head = <T>(items: T[]): T => items[0] as T;
const last = <T>(items: T[]): T => items[items.length - 1] as T;

const median = (values: number[]): number => {
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	const at = (i: number) => sorted[i] ?? 0;
	return sorted.length % 2 ? at(mid) : Math.round((at(mid - 1) + at(mid)) / 2);
};

const groupBy = <T>(items: T[], key: (item: T) => string) => {
	const groups = new Map<string, T[]>();
	for (const item of items) groups.set(key(item), [...(groups.get(key(item)) ?? []), item]);
	return groups;
};

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Suggest Buckets: over the last 90 days, homeless spending grouped by kind (or merchant). A group
 * that's steady (in at least 3 months, no month more than 60% of it) and sizeable (4 or more
 * charges, $40 or more a month) becomes a Bucket with its monthly amount, rounded up to $5. Not for
 * a name the Household's Buckets already have.
 */
export function spotBuckets(
	lines: SpendLine[],
	today: DayKey,
	bucketNames: string[],
): BucketIdea[] {
	const t = BUCKET_THRESHOLDS;
	const from = addDays(today, -t.days);
	const recent = lines.filter(
		(line) => line.homeless && line.amountCents > 0 && line.date > from && line.date <= today,
	);
	const ideas: BucketIdea[] = [];
	for (const group of groupBy(
		recent,
		(l) => `${l.owner ?? ""}|${bucketNameFor(l.merchant)}`,
	).values()) {
		const name = bucketNameFor(head(group).merchant);
		if (bucketNames.some((existing) => sameName(existing, name))) continue;
		const total = group.reduce((sum, l) => sum + l.amountCents, 0);
		const byMonth = groupBy(group, (l) => monthOfDay(l.date));
		const biggest = Math.max(
			...[...byMonth.values()].map((m) => m.reduce((s, l) => s + l.amountCents, 0)),
		);
		const monthly = Math.ceil(total / (t.days / 30) / 500) * 500;
		if (byMonth.size < t.minMonths || group.length < t.minCharges) continue;
		if (monthly < t.minMonthlyCents || biggest / total > t.maxMonthShare) continue;
		ideas.push({
			kind: "new-bucket",
			owner: head(group).owner,
			name,
			amountCents: monthly,
			evidence: {
				count: group.length,
				amountCents: monthly,
				months: byMonth.size,
				transactionIds: group.map((l) => l.id),
			},
		});
	}
	return ideas.sort((a, b) => b.amountCents - a.amountCents);
}

const CADENCE_DAYS: [Cadence, number, number][] = [
	["biweekly", 12, 16],
	["monthly", 26, 35],
	["annual", 350, 380],
];

const nextDue = (last: DayKey, cadence: Cadence): DayKey => {
	if (cadence === "biweekly") return addDays(last, 14);
	const months = cadence === "monthly" ? 1 : 12;
	const month = addMonths(monthOfDay(last), months);
	const day = Math.min(Number(last.slice(8)), 28);
	return `${month}-${String(day).padStart(2, "0")}` as DayKey;
};

/** The cadence a run of charges keeps, when every gap between them fits one. */
export function cadenceOf(dates: DayKey[]): Cadence | null {
	const sorted = [...new Set(dates)].sort();
	if (sorted.length < 2) return null;
	const gaps = sorted.slice(1).map((date, i) => daysBetween(sorted[i] as DayKey, date));
	return (
		CADENCE_DAYS.find(([, low, high]) => gaps.every((gap) => gap >= low && gap <= high))?.[0] ??
		null
	);
}

/** Each charge within 10% of their median: a steady amount. */
const steady = (amounts: number[]) => {
	const mid = median(amounts);
	return amounts.every((amount) => Math.abs(amount - mid) <= mid * 0.1);
};

export type CommitmentNow = {
	id: string;
	name: string;
	amountCents: number;
	cadence: Cadence;
	dueDate: DayKey;
};

/**
 * Spot Commitments: charges at one merchant with a steady amount (within 10%) on a monthly,
 * biweekly or annual cadence, 3 or more of them (2 for annual) and the latest not overdue by more
 * than half a period, that pay no Commitment and aren't named like one: a Commitment with its terms.
 * Also a Commitment whose latest charges (2 or more, steady) are more than 10% off what it expects.
 */
export function spotCommitments(
	lines: SpendLine[],
	commitments: CommitmentNow[],
	today: DayKey,
): (CommitmentIdea | AmountIdea)[] {
	const ideas: (CommitmentIdea | AmountIdea)[] = [];
	const from = addDays(today, -400);
	const recent = lines.filter((l) => l.amountCents > 0 && l.date > from && l.date <= today);
	const loose = recent.filter((l) => l.commitmentId === null);
	for (const group of groupBy(
		loose,
		(l) => `${l.owner ?? ""}|${l.merchant.toLowerCase()}`,
	).values()) {
		const merchant = head(group).merchant;
		if (commitments.some((c) => sameName(c.name, merchant))) continue;
		const sorted = [...group].sort((a, b) => a.date.localeCompare(b.date));
		// The latest steady run of charges: an older price doesn't hide a steady recent one.
		const run = sorted.slice(-6);
		const cadence = cadenceOf(run.map((l) => l.date));
		if (!cadence) continue;
		if (run.length < (cadence === "annual" ? 2 : 3)) continue;
		const amounts = run.map((l) => l.amountCents);
		if (!steady(amounts)) continue;
		const lastDate = last(run).date;
		const period = CADENCE_DAYS.find(([c]) => c === cadence)?.[2] ?? 35;
		if (daysBetween(lastDate, today) > period * 1.5) continue;
		const amountCents = median(amounts);
		ideas.push({
			kind: "new-commitment",
			owner: head(group).owner,
			name: merchant.slice(0, 40),
			merchant,
			amountCents,
			cadence,
			dueDate: nextDue(lastDate, cadence),
			evidence: {
				count: run.length,
				amountCents,
				months: new Set(run.map((l) => monthOfDay(l.date))).size,
				transactionIds: run.map((l) => l.id),
			},
		});
	}
	for (const commitment of commitments) {
		// Only the Household's spending: a Commitment is the whole Household's.
		const paid = recent
			.filter((l) => l.commitmentId === commitment.id && l.owner === null)
			.sort((a, b) => a.date.localeCompare(b.date))
			.slice(-3);
		if (paid.length < 2) continue;
		const amounts = paid.map((l) => l.amountCents);
		const amountCents = median(amounts);
		if (
			!steady(amounts) ||
			Math.abs(amountCents - commitment.amountCents) <= commitment.amountCents * 0.1
		)
			continue;
		ideas.push({
			kind: "commitment-amount",
			owner: null,
			commitmentId: commitment.id,
			name: commitment.name,
			fromCents: commitment.amountCents,
			amountCents,
			cadence: commitment.cadence,
			dueDate: commitment.dueDate,
			evidence: {
				count: paid.length,
				amountCents,
				months: new Set(paid.map((l) => monthOfDay(l.date))).size,
				transactionIds: paid.map((l) => l.id),
			},
		});
	}
	return ideas;
}

/** What a suggestion is about, so finding it again finds the same one: one per owner and key. */
export function suggestionKey(idea: SuggestionIdea): string {
	if (idea.kind === "commitment-amount") return `commitment-amount:${idea.commitmentId}`;
	if (idea.kind === "new-commitment") return `new-commitment:${idea.merchant.toLowerCase()}`;
	return `new-bucket:${idea.name.toLowerCase()}`;
}

/** The evidence in short, to tell when it changed at all. */
export const evidenceFingerprint = (e: Evidence) => `${e.count}:${e.amountCents}:${e.months}`;

/**
 * Whether a decided suggestion's evidence changed a lot since: the amount moved by 30% or more,
 * or the charges doubled. Only then does a dismissed (or accepted) suggestion come back.
 */
export function changedALot(before: Evidence, now: Evidence): boolean {
	if (
		before.amountCents > 0 &&
		Math.abs(now.amountCents - before.amountCents) >= before.amountCents * 0.3
	)
		return true;
	return now.count >= before.count * 2;
}

/** The month a suggestion would start in the Plan: this month. */
export const suggestionMonth = (today: DayKey): MonthKey => monthOfDay(today);
