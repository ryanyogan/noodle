import { merchantKey, type Rule, ruleFor } from "./categorize";
import { type DayKey, daysBetween } from "./month";

/**
 * A past use of a Bucket, e.g. an earlier Quick Add filed into it: the day, and, when known, the
 * hour (0–23) it was entered in the Household's time zone and its merchant (a merchantKey).
 */
export type BucketUse = {
	bucketId: string;
	date: DayKey;
	hour?: number | null;
	merchant?: string | null;
};

/** How many days until an old use counts half as much as one today. */
const HALF_LIFE_DAYS = 14;

/** How much more a use counts when it was entered within TIME_OF_DAY_HOURS of now. */
const TIME_OF_DAY_BOOST = 1.5;
const TIME_OF_DAY_HOURS = 2;

/** The hour (0–23) an instant falls in for a Household in the given IANA time zone. */
export function hourAt(instant: Date, timeZone: string): number {
	const hour = new Intl.DateTimeFormat("en-US", { timeZone, hour: "2-digit", hourCycle: "h23" })
		.formatToParts(instant)
		.find((part) => part.type === "hour")?.value;
	return Number(hour ?? 0) % 24;
}

/** Hours apart on a clock: 23:00 and 01:00 are 2 apart. */
function hoursApart(a: number, b: number): number {
	const apart = Math.abs(a - b) % 24;
	return Math.min(apart, 24 - apart);
}

/** Each use counts 0.5^(age / 14 days), times TIME_OF_DAY_BOOST near `hour` when that's given. */
function frecency(uses: BucketUse[], today: DayKey, hour?: number): Map<string, number> {
	const score = new Map<string, number>();
	for (const use of uses) {
		const age = Math.max(0, daysBetween(use.date, today));
		const nearNow =
			hour !== undefined && use.hour != null && hoursApart(use.hour, hour) <= TIME_OF_DAY_HOURS;
		const weight = 0.5 ** (age / HALF_LIFE_DAYS) * (nearNow ? TIME_OF_DAY_BOOST : 1);
		score.set(use.bucketId, (score.get(use.bucketId) ?? 0) + weight);
	}
	return score;
}

/**
 * Buckets ordered by how likely the next Quick Add goes into them: each past use counts, and
 * recent uses count more (halving every two weeks). Buckets used equally often keep their Plan
 * order, so with no history this is the Plan's order.
 */
export function likelyBucketOrder<T extends { id: string }>(
	buckets: T[],
	uses: BucketUse[],
	today: DayKey,
): T[] {
	const score = frecency(uses, today);
	// Array.prototype.sort is stable, so ties keep the Plan's order.
	return [...buckets].sort((a, b) => (score.get(b.id) ?? 0) - (score.get(a.id) ?? 0));
}

/** Why a Bucket sits where it does in Quick Add. */
export type QuickAddReason = "suggested" | "rule" | "merchant" | "likely";

/** A Bucket Quick Add offers, and why it's there. */
export type QuickAddChoice<T> = { bucket: T; reason: QuickAddReason };

/** `inner` appears in `outer` as whole words. */
const hasWords = (outer: string, inner: string) => ` ${outer} `.includes(` ${inner} `);

/**
 * Every Bucket Quick Add may offer, most likely first (ADR-0031): a `suggested` one (Snap or
 * Speak) first; then the Bucket a Rule files the note's merchant into; then the Bucket that
 * merchant was filed to most before; then the rest by recent use, a use within two hours of
 * `hour` counting 1.5 times; ties keep the Plan's order. Rules into a Commitment, or into a
 * Bucket not in `buckets`, are passed over.
 */
export function quickAddChoices<T extends { id: string }>(input: {
	buckets: T[];
	uses: BucketUse[];
	rules: Rule[];
	note: string;
	today: DayKey;
	hour: number;
	suggested?: string | null;
}): QuickAddChoice<T>[] {
	const { buckets, uses, today, hour } = input;
	const offered = new Set(buckets.map((bucket) => bucket.id));
	const pinned: { id: string; reason: QuickAddReason }[] = [];
	const pin = (id: string | null | undefined, reason: QuickAddReason) => {
		if (id && offered.has(id) && !pinned.some((p) => p.id === id)) pinned.push({ id, reason });
	};
	pin(input.suggested, "suggested");
	const merchant = input.note.trim() ? merchantKey(input.note) : "";
	if (merchant) {
		const rules = input.rules.filter((rule) => rule.bucketId && offered.has(rule.bucketId));
		pin(ruleFor(rules, merchant)?.bucketId, "rule");
		const filed = uses.filter(
			(use) =>
				use.merchant && (hasWords(use.merchant, merchant) || hasWords(merchant, use.merchant)),
		);
		const [top] = likelyBucketOrder(
			buckets.filter((bucket) => filed.some((use) => use.bucketId === bucket.id)),
			filed,
			today,
		);
		pin(top?.id, "merchant");
	}
	const score = frecency(uses, today, hour);
	const byId = new Map(buckets.map((bucket) => [bucket.id, bucket]));
	const rest = buckets
		.filter((bucket) => !pinned.some((p) => p.id === bucket.id))
		.sort((a, b) => (score.get(b.id) ?? 0) - (score.get(a.id) ?? 0));
	return [
		...pinned.map((p) => ({ bucket: byId.get(p.id) as T, reason: p.reason })),
		...rest.map((bucket) => ({ bucket, reason: "likely" as const })),
	];
}

/** How a Bucket matched a search: by its name, or by a Rule's merchant pattern into it. */
export type BucketMatch<T> =
	| { bucket: T; via: "name" }
	| { bucket: T; via: "rule"; pattern: string };

const wordsOf = (text: string) =>
	text
		.toLowerCase()
		.split(/[^a-z0-9&']+/)
		.filter(Boolean);

/**
 * The Buckets a search finds, best first: those whose name has a word starting with each word
 * searched, in any order ("gro" → Groceries, "sup pet" → Pet supplies); then those whose name
 * contains it ("cery"); then those a Rule's merchant pattern files into ("costco" → Groceries).
 * Within each, `buckets`' order is kept, so pass them most likely first. An empty search finds
 * every Bucket.
 */
export function matchBuckets<T extends { id: string; name: string }>(
	query: string,
	buckets: T[],
	rules: Rule[] = [],
): BucketMatch<T>[] {
	const words = wordsOf(query);
	if (!words.length) return buckets.map((bucket) => ({ bucket, via: "name" }));
	const phrase = query.trim().toLowerCase();
	const prefix: BucketMatch<T>[] = [];
	const substring: BucketMatch<T>[] = [];
	const byRule: BucketMatch<T>[] = [];
	for (const bucket of buckets) {
		const nameWords = wordsOf(bucket.name);
		if (words.every((word) => nameWords.some((nameWord) => nameWord.startsWith(word)))) {
			prefix.push({ bucket, via: "name" });
		} else if (bucket.name.toLowerCase().includes(phrase)) {
			substring.push({ bucket, via: "name" });
		} else {
			const rule = rules
				.filter((r) => r.bucketId === bucket.id)
				.find((r) => {
					const patternWords = wordsOf(r.pattern);
					return words.every((word) => patternWords.some((p) => p.startsWith(word)));
				});
			if (rule) byRule.push({ bucket, via: "rule", pattern: rule.pattern });
		}
	}
	return [...prefix, ...substring, ...byRule];
}
