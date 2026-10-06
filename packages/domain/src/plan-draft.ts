import { merchantKey } from "./categorize";
import type { Cadence } from "./commitments";
import { type InsightSpend, services } from "./insights";
import type { Cents } from "./money";
import { addDays, type DayKey, daysBetween } from "./month";
import { billKindOf } from "./suggestions";

// The first Plan, drafted from a new Household's history: whatever came in first (statements
// today, a Bank Connection later), read the same way. Plain code finds the paychecks behind a
// take-home pay, the recurring charges that look like Commitments, and what everyday spending comes
// to each month; a model only names things, sorting merchants into Bucket names from a closed
// list and giving statement lines a readable name. Every figure comes from this module. Nothing
// is added to the Plan until a Parent adds it, as it is or changed, and each can be skipped.

/** How far back a draft reads: about three months, ending on the latest day of history. */
export const DRAFT_DAYS = 91;
/** Less history than about a month says too little about a normal month to draft from. */
export const DRAFT_MIN_DAYS = 28;

/** The Bucket names a model may sort merchants into. */
export const DRAFT_BUCKET_NAMES = [
	"Groceries",
	"Eating out",
	"Gas",
	"Kids",
	"Home",
	"Shopping",
	"Health",
	"Fun",
	"Travel",
	"Pets",
] as const;
/** Where spending no named Bucket takes goes. */
export const EVERYDAY_BUCKET = "Everyday";

/** A Bucket smaller than this a month folds into Everyday: too small to plan on its own. */
const MIN_BUCKET: Cents = 2000;
/** Allowances round up to whole tens of dollars. */
const ALLOWANCE_STEP: Cents = 1000;
/** Deposits smaller than this (interest, cash back) aren't paychecks. */
const MIN_PAYCHECK: Cents = 10000;
/** How far a paycheck's amount may stray from its usual (overtime, a short week). */
const PAYCHECK_SPREAD = 0.25;
/** How far a biweekly charge's amount may stray from its latest. */
const BIWEEKLY_SPREAD = 0.1;
/** How many merchants a model sorts at most: the largest, which make up most of the spending. */
export const MAX_DRAFT_MERCHANTS = 60;
const AVERAGE_MONTH_DAYS = 365.25 / 12;

/** Paydays: weekly (assumed four a month), every two weeks or twice a month (two), or monthly. */
export type PayCadence = "weekly" | "biweekly" | "monthly";

/** Days between paydays each pay cadence allows, and the paychecks a month takes it as. */
const PAY_CADENCES: { cadence: PayCadence; gaps: [number, number]; perMonth: number }[] = [
	{ cadence: "weekly", gaps: [6, 8], perMonth: 4 },
	// Twice a month (the 15th and the last day) lands 13 to 17 days apart too.
	{ cadence: "biweekly", gaps: [12, 17], perMonth: 2 },
	{ cadence: "monthly", gaps: [26, 35], perMonth: 1 },
];

/** Income as a draft reads it: `amount` is what came in; `note` the statement line. */
export type DraftIncome = { id: string; date: DayKey; amount: Cents; note: string };

/** A Household's history, as the Viewer may see it. */
export type DraftHistory = { spends: InsightSpend[]; income: DraftIncome[] };

/** A paycheck that comes in regularly from one payer. */
export type Paycheck = {
	/** The payer's merchantKey. */
	key: string;
	description: string;
	/** What one paycheck usually is (the median). */
	amount: Cents;
	cadence: PayCadence;
	/** What it brings in a month, at the paychecks a month its cadence is taken as. */
	monthly: Cents;
	dates: DayKey[];
};

/** A merchant charging the same amount on a schedule: likely a Commitment. */
export type DetectedCommitment = {
	/** The merchant's merchantKey. */
	key: string;
	description: string;
	/** Its latest charge. */
	amount: Cents;
	cadence: Cadence;
	/** Its latest charge's day, which sets its schedule. */
	dueDate: DayKey;
	transactionIds: string[];
};

/** A merchant's everyday spending over a draft's history. */
export type DraftMerchant = { key: string; description: string; total: Cents; count: number };

/** What a draft found in the history, before any names or a Parent's decisions. */
export type DraftFindings = {
	from: DayKey;
	through: DayKey;
	days: number;
	paychecks: Paycheck[];
	commitments: DetectedCommitment[];
	/** Spending outside the Commitments found, by merchant, largest first. */
	merchants: DraftMerchant[];
};

/** What a model said: Bucket names by merchantKey, and readable names by merchantKey. */
export type DraftLabels = { buckets: Record<string, string>; names: Record<string, string> };

export const noDraftLabels: DraftLabels = { buckets: {}, names: {} };

export type DraftTakeHomePay = {
	key: "baseline";
	amount: Cents;
	paychecks: (Paycheck & { name: string })[];
};
export type DraftCommitment = DetectedCommitment & {
	key: string;
	name: string;
	merchant: string;
	/** Offered as an "about" amount: a utility, whose bill varies (issue 135). */
	about?: true;
};

/** Whether a found bill is a utility (power, water, gas), by its name or the bank's wording. */
export const draftVaries = (name: string, description: string): boolean =>
	billKindOf(name) === "utility" || billKindOf(description) === "utility";
export type DraftBucket = {
	key: string;
	name: string;
	/** The allowance suggested: the average month's spending, rounded up to tens of dollars. */
	allowance: Cents;
	/** What it averaged a month, exactly. */
	monthly: Cents;
	/** Its merchants' names, largest first. */
	merchants: string[];
	count: number;
};

/** The first Plan as drafted: each suggestion keyed for a Parent's decision. */
export type PlanDraft = {
	from: DayKey;
	through: DayKey;
	baseline: DraftTakeHomePay | null;
	commitments: DraftCommitment[];
	buckets: DraftBucket[];
};

const median = (values: number[]) => {
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 1
		? (sorted[mid] as number)
		: Math.round(((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2);
};

const within = (amount: Cents, of: Cents, share: number) =>
	Math.abs(amount - of) <= Math.abs(of) * share;

const gapsOf = (dates: DayKey[]) =>
	dates.slice(1).map((date, i) => daysBetween(dates[i] as DayKey, date));

const byDate = <T extends { date: DayKey; id: string }>(a: T, b: T) =>
	a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : 1;

function groupByMerchant<T extends { note: string }>(items: T[]): Map<string, T[]> {
	const groups = new Map<string, T[]>();
	for (const item of items) {
		if (!item.note.trim()) continue;
		const key = merchantKey(item.note);
		groups.set(key, [...(groups.get(key) ?? []), item]);
	}
	return groups;
}

/**
 * A statement line as a name to show until a model names it: its merchantKey's first words,
 * each capitalised ("TRADER JOE'S #552 PORTLAND OR" is "Trader Joe's Portland").
 */
export function plainName(description: string): string {
	const words = merchantKey(description).split(" ").slice(0, 3);
	return words
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join(" ")
		.slice(0, 40);
}

/** Paychecks in the income: from one payer, on a steady schedule, about the same each time. */
export function detectPaychecks(income: DraftIncome[], through: DayKey): Paycheck[] {
	const found: Paycheck[] = [];
	for (const [key, deposits] of groupByMerchant([...income].sort(byDate))) {
		if (deposits.length < 2) continue;
		const usual = median(deposits.map((d) => d.amount));
		if (usual < MIN_PAYCHECK || !deposits.every((d) => within(d.amount, usual, PAYCHECK_SPREAD))) {
			continue;
		}
		const dates = deposits.map((d) => d.date);
		const gaps = gapsOf(dates);
		const pay = PAY_CADENCES.find(({ gaps: [low, high] }) =>
			gaps.every((gap) => gap >= low && gap <= high),
		);
		// Still paid: the latest came no longer ago than a gap (and a few days' leeway).
		if (!pay || daysBetween(dates.at(-1) as DayKey, through) > pay.gaps[1] + 3) continue;
		found.push({
			key,
			description: (deposits.at(-1) as DraftIncome).note.trim(),
			amount: usual,
			cadence: pay.cadence,
			monthly: usual * pay.perMonth,
			dates,
		});
	}
	return found.sort((a, b) => b.monthly - a.monthly || (a.key < b.key ? -1 : 1));
}

/**
 * Merchants charging on a schedule outside any Commitment: once a month, about the same amount,
 * in at least two months (as Insights find services); or every two weeks, at least three times,
 * within a tenth of the latest amount.
 */
export function detectCommitments(spends: InsightSpend[], through: DayKey): DetectedCommitment[] {
	const open = spends.filter((s) => s.commitmentId === null && !s.private).sort(byDate);
	const monthly = services({ spends: open, commitments: [], asOf: through }).map(
		(service): DetectedCommitment => {
			const latest = service.charges.at(-1) as InsightSpend;
			return {
				key: service.key.slice(2),
				description: latest.note.trim(),
				amount: latest.amount,
				cadence: "monthly",
				dueDate: latest.date,
				transactionIds: service.charges.map((c) => c.id),
			};
		},
	);
	const biweekly: DetectedCommitment[] = [];
	for (const [key, charges] of groupByMerchant(open)) {
		const latest = charges.at(-1) as InsightSpend;
		if (charges.length < 3) continue;
		if (!gapsOf(charges.map((c) => c.date)).every((gap) => gap >= 13 && gap <= 15)) continue;
		if (!charges.every((c) => within(c.amount, latest.amount, BIWEEKLY_SPREAD))) continue;
		biweekly.push({
			key,
			description: latest.note.trim(),
			amount: latest.amount,
			cadence: "biweekly",
			dueDate: latest.date,
			transactionIds: charges.map((c) => c.id),
		});
	}
	return [...monthly, ...biweekly].sort((a, b) => b.amount - a.amount || (a.key < b.key ? -1 : 1));
}

/**
 * What a draft finds in `history`: the latest `DRAFT_DAYS` of it, up to its latest day. Null with
 * less than `DRAFT_MIN_DAYS` of history. Private spending (a Parent's own Personal Allowance)
 * never counts: a draft is the Household's, and both Parents see it.
 */
export function draftFindings(history: DraftHistory): DraftFindings | null {
	const dates = [...history.spends.map((s) => s.date), ...history.income.map((i) => i.date)].sort();
	const first = dates[0];
	const through = dates.at(-1);
	if (!first || !through) return null;
	const earliest = addDays(through, 1 - DRAFT_DAYS);
	const from = first > earliest ? first : earliest;
	const days = daysBetween(from, through) + 1;
	if (days < DRAFT_MIN_DAYS) return null;
	const inRange = <T extends { date: DayKey }>(items: T[]) =>
		items.filter((item) => item.date >= from && item.date <= through);
	const spends = inRange(history.spends).filter((s) => !s.private);
	const commitments = detectCommitments(spends, through);
	const recurring = new Set(commitments.map((c) => c.key));
	const merchants = new Map<string, DraftMerchant>();
	for (const spend of spends) {
		if (spend.commitmentId !== null) continue;
		const key = spend.note.trim() ? merchantKey(spend.note) : "";
		if (recurring.has(key)) continue;
		const merchant = merchants.get(key) ?? {
			key,
			description: spend.note.trim(),
			total: 0,
			count: 0,
		};
		merchants.set(key, {
			...merchant,
			total: merchant.total + spend.amount,
			count: merchant.count + 1,
		});
	}
	return {
		from,
		through,
		days,
		paychecks: detectPaychecks(inRange(history.income), through),
		commitments,
		merchants: [...merchants.values()]
			.filter((m) => m.total > 0)
			.sort((a, b) => b.total - a.total || (a.key < b.key ? -1 : 1)),
	};
}

/** What `total` over `days` comes to in an average month. */
const perMonth = (total: Cents, days: number) => Math.round((total * AVERAGE_MONTH_DAYS) / days);

const allowanceOf = (monthly: Cents) => Math.ceil(monthly / ALLOWANCE_STEP) * ALLOWANCE_STEP;

/**
 * Buckets for the spending found: each merchant in the Bucket a model named for it (Everyday
 * when it named none), each Bucket's allowance its average month rounded up to tens of dollars.
 * A Bucket that averages under $20 a month folds into Everyday, which comes last.
 */
export function suggestBuckets(findings: DraftFindings, labels: DraftLabels): DraftBucket[] {
	const nameOf = (key: string) => {
		const name = labels.buckets[key]?.trim();
		return name ? name : EVERYDAY_BUCKET;
	};
	const groups = new Map<string, DraftMerchant[]>();
	for (const merchant of findings.merchants) {
		const name = nameOf(merchant.key);
		groups.set(name, [...(groups.get(name) ?? []), merchant]);
	}
	const small = [...groups].filter(
		([name, merchants]) =>
			name !== EVERYDAY_BUCKET &&
			perMonth(
				merchants.reduce((sum, m) => sum + m.total, 0),
				findings.days,
			) < MIN_BUCKET,
	);
	for (const [name, merchants] of small) {
		groups.delete(name);
		groups.set(EVERYDAY_BUCKET, [...(groups.get(EVERYDAY_BUCKET) ?? []), ...merchants]);
	}
	return [...groups]
		.map(([name, merchants]): DraftBucket => {
			const sorted = [...merchants].sort((a, b) => b.total - a.total);
			const monthly = perMonth(
				sorted.reduce((sum, m) => sum + m.total, 0),
				findings.days,
			);
			return {
				key: `bucket:${name.toLowerCase()}`,
				name,
				allowance: allowanceOf(monthly),
				monthly,
				merchants: sorted
					.map((m) => labels.names[m.key] ?? plainName(m.description))
					.filter(Boolean),
				count: sorted.reduce((sum, m) => sum + m.count, 0),
			};
		})
		.filter((bucket) => bucket.allowance > 0)
		.sort(
			(a, b) =>
				Number(a.name === EVERYDAY_BUCKET) - Number(b.name === EVERYDAY_BUCKET) ||
				b.allowance - a.allowance ||
				(a.name < b.name ? -1 : 1),
		);
}

/** The merchants a model is asked to sort into Buckets and to name: the largest first. */
export function merchantsToLabel(findings: DraftFindings): {
	toSort: DraftMerchant[];
	toName: { key: string; description: string }[];
} {
	const toSort = findings.merchants.filter((m) => m.key).slice(0, MAX_DRAFT_MERCHANTS);
	const toName = [...findings.paychecks, ...findings.commitments, ...toSort].map(
		({ key, description }) => ({ key, description }),
	);
	return { toSort, toName: [...new Map(toName.map((m) => [m.key, m])).values()] };
}

/** The Plan as it stands, which a draft leaves alone. */
export type PlanSoFar = {
	baseline: Cents | null;
	commitments: { name: string }[];
	buckets: { name: string }[];
};

/**
 * The first Plan, drafted from what was found and named: take-home pay from the paychecks (while
 * there's none), the Commitments found, and a Bucket for each kind of everyday spending. A
 * suggestion a Parent has already added or skipped (`decided`, by key) isn't made again, nor
 * one the Plan already has: a Commitment of the same name or merchant, a Bucket of the same name.
 */
export function draftPlan(
	findings: DraftFindings,
	labels: DraftLabels,
	plan: PlanSoFar,
	decided: ReadonlySet<string>,
): PlanDraft {
	const nameOf = (key: string, description: string) =>
		labels.names[key]?.trim() || plainName(description);
	const lower = (name: string) => name.trim().toLowerCase();
	const planned = new Set(plan.commitments.flatMap((c) => [lower(c.name), merchantKey(c.name)]));
	const bucketNames = new Set(plan.buckets.map((b) => lower(b.name)));
	const paychecks = findings.paychecks.map((p) => ({ ...p, name: nameOf(p.key, p.description) }));
	return {
		from: findings.from,
		through: findings.through,
		baseline:
			plan.baseline === null && paychecks.length > 0 && !decided.has("baseline")
				? { key: "baseline", amount: paychecks.reduce((sum, p) => sum + p.monthly, 0), paychecks }
				: null,
		commitments: findings.commitments
			.map((c) => ({
				...c,
				key: `commitment:${c.key}`,
				merchant: c.key,
				name: nameOf(c.key, c.description),
			}))
			.map((c) => (draftVaries(c.name, c.description) ? { ...c, about: true as const } : c))
			.filter(
				(c) => !decided.has(c.key) && !planned.has(lower(c.name)) && !planned.has(c.merchant),
			),
		buckets: suggestBuckets(findings, labels).filter(
			(b) => !decided.has(b.key) && !bucketNames.has(lower(b.name)),
		),
	};
}

/** Whether a draft has anything left to decide. */
export const draftIsEmpty = (draft: PlanDraft) =>
	draft.baseline === null && draft.commitments.length === 0 && draft.buckets.length === 0;
