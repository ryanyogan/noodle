import { merchantKey, type Rule, ruleFor } from "./categorize";
import { aboutAmount, type Cadence } from "./commitments";
import { addDays, addMonths, type DayKey, daysBetween, type MonthKey, monthOfDay } from "./month";
import { looksLikeCardPayment } from "./transfers";

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
	/** Why, in plain words: "Verizon, $85 on the 12th, 4 months running". */
	reason: string;
	/** Proposed as an "about" amount: a utility, whose bill varies (issue 135). */
	about?: true;
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
	/**
	 * For an "about" Commitment (issue 135): `amountCents` is the average of its charges, which has
	 * drifted from what the Plan sets aside, and these are the lowest and highest of them.
	 */
	about?: true;
	lowCents?: number;
	highCents?: number;
	evidence: Evidence;
};

/** "Always put Costco in Groceries?": a Parent filed one merchant into one Bucket by hand, again and again. */
export type RuleIdea = {
	kind: "rule";
	owner: string | null;
	/** The merchant's clean name, as shown. */
	name: string;
	/** The Rule's pattern: the clean name made a merchantKey. */
	merchant: string;
	bucketId: string;
	bucketName: string;
	amountCents: number;
	evidence: Evidence;
};

export type SuggestionIdea = BucketIdea | CommitmentIdea | AmountIdea | RuleIdea;

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

/** Each charge within `tolerance` (10% unless said) of their median: a steady amount. */
const steady = (amounts: number[], tolerance = 0.1) => {
	const mid = median(amounts);
	return amounts.every((amount) => Math.abs(amount - mid) <= mid * tolerance);
};

export type CommitmentNow = {
	id: string;
	name: string;
	amountCents: number;
	cadence: Cadence;
	dueDate: DayKey;
	/** Its amount is "about": judged on the average of its charges, not the last three. */
	about?: boolean;
};

// What a Commitment is (CONTEXT.md, #76): a bill the Household signed up to, by kind of payee.
export const BILL_KINDS = [
	"housing",
	"loan",
	"insurance",
	"utility",
	"telecom",
	"childcare",
	"subscription",
] as const;
export type BillKind = (typeof BILL_KINDS)[number];

const BILLS: [BillKind, RegExp][] = [
	[
		"housing",
		/\b(rent|mortgage|apartments?|apts|property management|properties|hoa|homeowners'? assoc\w*|landlord|realty|mr\.? cooper|rocket mortgage)\b/i,
	],
	[
		"loan",
		/\b(loans?|auto finance|car payment|financial services|toyota financial|honda financial|ford credit|gm financial|ally auto|capital one auto|chase auto|santander consumer|navient|nelnet|mohela|sallie mae|sofi|upstart)\b/i,
	],
	[
		"insurance",
		/\b(insurance|insur\w*|assurance|geico|state farm|progressive|allstate|usaa|liberty mutual|farmers|nationwide|lemonade|aflac|metlife|prudential|travelers)\b/i,
	],
	[
		"utility",
		/\b(electric\w*|energy|power|gas co\w*|natural gas|water|sewer|trash|waste|sanitation|utilit\w*|pg&e|pge|con ?ed|duke energy|xcel|dominion|edison|comed|fpl|republic services)\b/i,
	],
	[
		"telecom",
		/\b(verizon|at&t|att|t-?mobile|sprint|comcast|xfinity|spectrum|cox|frontier|centurylink|mint mobile|google fi|visible|cricket|boost mobile|wireless|cellular|internet|broadband|fiber|directv|dish|sling)\b/i,
	],
	[
		"childcare",
		/\b(daycare|day care|child ?care|preschool|montessori|tuition|school|academy|kindercare|bright horizons|learning cent(er|re)|university|college|tutoring)\b/i,
	],
	[
		"subscription",
		/\b(netflix|hulu|disney\+?|spotify|apple\.com|icloud|youtube|hbo|paramount\+?|peacock|audible|prime video|amazon prime|adobe|microsoft 365|dropbox|patreon|membership|subscription|gym|fitness|ymca|peloton)\b/i,
	],
];

// Day-to-day spending that repeats but is never a Commitment: eating out, coffee, groceries (the
// Bucket kinds above), fuel and general retail. It belongs in a Bucket.
const NOT_BILL_BUCKETS = ["Coffee", "Eating Out", "Groceries"];
const NOT_BILLS =
	/\b(cafe|wendy'?s|chick-fil-a|kitchen|diner|bar|sam'?s club|heb|wegmans|fuel|gas station|shell|chevron|exxon|mobil|bp|arco|valero|speedway|wawa|sunoco|citgo|marathon|quiktrip|circle k|76|amazon(?! prime)|amzn|target|walmart|best buy|ebay|etsy|dollar|tj ?maxx|marshalls|kohl'?s|macy'?s|old navy|home depot|lowe'?s|ikea|cvs|walgreens)\b/i;

/**
 * The kind of bill a merchant is, by words in its clean name: a BillKind, "unknown" (judged only
 * on strong amount and regularity), or null when it's day-to-day spending or moving money.
 */
export function billKindOf(merchant: string): BillKind | "unknown" | null {
	if (isMoneyMovement(merchant)) return null;
	if (NOT_BILL_BUCKETS.includes(bucketNameFor(merchant)) || NOT_BILLS.test(merchant)) return null;
	return BILLS.find(([, words]) => words.test(merchant))?.[0] ?? "unknown";
}

export const COMMITMENT_THRESHOLDS = {
	/** The least a month (monthly equivalent, cents) a payee costs to be a Commitment. */
	minMonthlyCents: { subscription: 1_000, known: 2_500, unknown: 10_000 },
	/** How far (days) a charge's day may sit from the usual due day. */
	dueDayDays: 3,
	/** How far from the median each charge may be: fixed bills, varying bills, unknown kinds. */
	tolerance: { fixed: 0.1, varying: 0.6, unknown: 0.05 },
	/** Charges needed: an unknown kind needs more. Annual takes 2. */
	minCharges: { known: 3, unknown: 4, annual: 2 },
};

/** The cadences a kind really bills on: monthly for all; annual and biweekly only where they're real. */
const CADENCES_FOR: Record<BillKind | "unknown", Cadence[]> = {
	housing: ["monthly"],
	loan: ["monthly", "biweekly"],
	insurance: ["monthly", "annual"],
	utility: ["monthly"],
	telecom: ["monthly"],
	childcare: ["monthly", "biweekly"],
	subscription: ["monthly", "annual"],
	unknown: ["monthly"],
};

/** Bills whose amount moves month to month (seasons, usage): judged on payee and due day. */
const VARYING: (BillKind | "unknown")[] = ["utility", "telecom"];

const perMonth = (amountCents: number, cadence: Cadence) =>
	cadence === "biweekly"
		? (amountCents * 26) / 12
		: cadence === "annual"
			? amountCents / 12
			: amountCents;

const dayOf = (date: DayKey) => Number(date.slice(8));

/** The usual day of the month, when every charge lands within a few days of it (around month end too). */
const dueDayOf = (dates: DayKey[], cadence: Cadence): number | null => {
	const t = COMMITMENT_THRESHOLDS.dueDayDays;
	if (cadence === "biweekly") return dayOf(last(dates));
	if (cadence === "annual") {
		const gaps = dates.slice(1).map((date, i) => daysBetween(dates[i] as DayKey, date));
		return gaps.every((gap) => Math.abs(gap - 365) <= t + 1) ? dayOf(last(dates)) : null;
	}
	const days = dates.map(dayOf);
	const mid = median(days);
	const near = days.every((day) => {
		const apart = Math.abs(day - mid);
		return Math.min(apart, 31 - apart) <= t;
	});
	return near ? mid : null;
};

/** A plan name close to the merchant's: "Verizon" for "Verizon Wireless", "Netflix" for "NETFLIX.COM". */
const NAME_NOISE =
	/\b(inc|llc|ltd|co|corp|company|the|wireless|services?|bill|payments?|online|usa?|com)\b/g;
const coreName = (name: string) =>
	name
		.toLowerCase()
		.replace(/\.com\b/g, "")
		.replace(/[^a-z0-9& ]+/g, "")
		.replace(NAME_NOISE, " ")
		.split(/\s+/)
		.filter(Boolean);

export function nearName(a: string, b: string): boolean {
	if (sameName(a, b)) return true;
	const [x, y] = [coreName(a), coreName(b)];
	const [short, long] = x.length <= y.length ? [x, y] : [y, x];
	if (short.join("").length < 3) return false;
	return short.every((word, i) => long[i] === word);
}

const MONTH_NAMES = [
	"January",
	"February",
	"March",
	"April",
	"May",
	"June",
	"July",
	"August",
	"September",
	"October",
	"November",
	"December",
];

const dollars = (cents: number) =>
	`$${(cents / 100).toLocaleString("en-US", {
		minimumFractionDigits: cents % 100 ? 2 : 0,
		maximumFractionDigits: 2,
	})}`;

const ordinal = (n: number) => {
	const teen = n % 100 >= 11 && n % 100 <= 13;
	const suffix = teen ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10];
	return `${n}${suffix ?? "th"}`;
};

/** Why a Commitment is suggested: "Verizon, $85 on the 12th, 4 months running". */
function commitmentReason(
	merchant: string,
	cadence: Cadence,
	amountCents: number,
	loosely: "" | "up to " | "about ",
	dueDay: number,
	dates: DayKey[],
): string {
	const amount = `${loosely}${dollars(amountCents)}`;
	if (cadence === "biweekly")
		return `${merchant}, ${amount} every two weeks, ${dates.length} times running`;
	if (cadence === "annual") {
		const month = MONTH_NAMES[Number(last(dates).slice(5, 7)) - 1];
		return `${merchant}, ${amount} a year in ${month}, ${dates.length} years running`;
	}
	const months = new Set(dates.map(monthOfDay)).size;
	return `${merchant}, ${amount} on the ${ordinal(dueDay)}, ${months} months running`;
}

/** The fewest charges an "about" Commitment's average must rest on before its drift is raised. */
export const ABOUT_DRIFT_CHARGES = 3;

const wholeDollars = (cents: number) => Math.round(cents / 100) * 100;

const aboutOf = (lines: SpendLine[], today: DayKey) =>
	aboutAmount(
		lines.map((l) => ({ amount: l.amountCents, date: l.date })),
		today,
	);

/**
 * Spot Commitments (#76): a bill, not day-to-day spending. Charges at one payee whose kind can be a
 * Commitment (never eating out, coffee, groceries, fuel, retail or moving money), on a cadence that
 * kind bills on, with a stable due day (within 3 days), a steady amount (within 10%; utilities and
 * phone within 60%, taken at their recent high; an unknown kind within 5% and 4 or more charges),
 * 3 or more charges (2 for annual), costing at least $25 a month ($10 for a subscription, $100 for
 * an unknown kind), the latest not overdue by more than half a period, paying no Commitment and not
 * near the name of a Commitment or Bucket the Plan has: a Commitment with its terms and a reason.
 * A utility (power, water, gas) is proposed as an "about" amount: the average of its charges.
 * Also a Commitment whose latest charges (2 or more, steady) are more than 10% off what it expects;
 * for an "about" Commitment instead, one whose average (aboutAmount, 3 or more charges) has drifted
 * more than 10% from what the Plan sets aside.
 */
export function spotCommitments(
	lines: SpendLine[],
	commitments: CommitmentNow[],
	today: DayKey,
	bucketNames: string[] = [],
): (CommitmentIdea | AmountIdea)[] {
	const t = COMMITMENT_THRESHOLDS;
	const ideas: (CommitmentIdea | AmountIdea)[] = [];
	const from = addDays(today, -400);
	const recent = lines.filter((l) => l.amountCents > 0 && l.date > from && l.date <= today);
	const loose = recent.filter((l) => l.commitmentId === null);
	const planned = [...commitments.map((c) => c.name), ...bucketNames];
	for (const group of groupBy(
		loose,
		(l) => `${l.owner ?? ""}|${l.merchant.toLowerCase()}`,
	).values()) {
		const merchant = head(group).merchant;
		const kind = billKindOf(merchant);
		if (!kind) continue;
		if (planned.some((name) => nearName(name, merchant))) continue;
		const sorted = [...group].sort((a, b) => a.date.localeCompare(b.date));
		// The latest steady run of charges: an older price doesn't hide a steady recent one.
		const run = sorted.slice(-6);
		const dates = run.map((l) => l.date);
		const cadence = cadenceOf(dates);
		if (!cadence || !CADENCES_FOR[kind].includes(cadence)) continue;
		const fewest =
			cadence === "annual"
				? t.minCharges.annual
				: kind === "unknown"
					? t.minCharges.unknown
					: t.minCharges.known;
		if (run.length < fewest) continue;
		const dueDay = dueDayOf(dates, cadence);
		if (dueDay === null) continue;
		const varying = VARYING.includes(kind);
		const amounts = run.map((l) => l.amountCents);
		const tolerance =
			kind === "unknown" ? t.tolerance.unknown : varying ? t.tolerance.varying : t.tolerance.fixed;
		if (!steady(amounts, tolerance)) continue;
		const lastDate = last(run).date;
		const period = CADENCE_DAYS.find(([c]) => c === cadence)?.[2] ?? 35;
		if (daysBetween(lastDate, today) > period * 1.5) continue;
		// A utility is an "about" amount: the average of its charges, a cold month's extra coming out
		// of what carries over. Any other bill that varies is planned at its recent high.
		const about = kind === "utility" ? aboutOf(run, today) : null;
		const amountCents = about
			? wholeDollars(about.average)
			: varying
				? Math.max(...amounts.slice(-3))
				: median(amounts);
		const least =
			kind === "unknown"
				? t.minMonthlyCents.unknown
				: kind === "subscription"
					? t.minMonthlyCents.subscription
					: t.minMonthlyCents.known;
		if (perMonth(amountCents, cadence) < least) continue;
		ideas.push({
			kind: "new-commitment",
			owner: head(group).owner,
			name: merchant.slice(0, 40),
			merchant,
			amountCents,
			cadence,
			dueDate: nextDue(lastDate, cadence),
			reason: commitmentReason(
				merchant,
				cadence,
				amountCents,
				about ? "about " : varying && new Set(amounts).size > 1 ? "up to " : "",
				dueDay,
				dates,
			),
			...(about ? { about: true as const } : {}),
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
		const charged = recent
			.filter((l) => l.commitmentId === commitment.id && l.owner === null)
			.sort((a, b) => a.date.localeCompare(b.date));
		if (commitment.about) {
			// It varies, so three charges in a row say nothing: its average is what's watched.
			const about = aboutOf(charged, today);
			if (!about || about.count < ABOUT_DRIFT_CHARGES) continue;
			const amountCents = wholeDollars(about.average);
			if (
				Math.abs(about.average - commitment.amountCents) <= commitment.amountCents * 0.1 ||
				amountCents === commitment.amountCents
			)
				continue;
			const rests = charged.slice(-about.count);
			ideas.push({
				kind: "commitment-amount",
				owner: null,
				commitmentId: commitment.id,
				name: commitment.name,
				fromCents: commitment.amountCents,
				amountCents,
				cadence: commitment.cadence,
				dueDate: commitment.dueDate,
				about: true,
				lowCents: about.low,
				highCents: about.high,
				evidence: {
					count: rests.length,
					amountCents,
					months: new Set(rests.map((l) => monthOfDay(l.date))).size,
					transactionIds: rests.map((l) => l.id),
				},
			});
			continue;
		}
		const paid = charged.slice(-3);
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
	if (idea.kind === "rule") return `rule:${idea.merchant}`;
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

/**
 * A card payment or a transfer between accounts ("Online Payment", "Autopay Payment", "Chase
 * Credit Crd Autopay", "Amex Epayment"), by its name. Never suggested as a Commitment or a Rule:
 * paying the card is a Transfer (#91).
 */
export const isMoneyMovement = (merchant: string) =>
	/^(online|autopay|auto|mobile|internet|electronic|ach|e-?pay|card|credit card)?\s*(payment|pymt)s?\b|\bautopay\b|\btransfers?\b|\bxfer\b|\bthank you\b/i.test(
		merchant.trim(),
	) || looksLikeCardPayment(merchant);

/**
 * An imported line a Parent put in a Bucket themselves (not filed by categorization), with its
 * clean merchant name and the Bucket's owner (the Parent whose Personal Allowance it is, else null).
 */
export type HandFiling = {
	id: string;
	date: DayKey;
	merchant: string;
	bucketId: string;
	bucketName: string;
	owner: string | null;
};

/** A Rule as it stands, with whose it is (null: the Household's). */
export type RuleNow = Rule & { owner: string | null };

/** How many times the same merchant went into the same Bucket by hand before a Rule is offered. */
export const RULE_TIMES = 3;

/**
 * Learn (ADR-0027): a merchant a Parent filed into the same Bucket by hand 3 or more times, with no
 * Rule covering it, makes a Rule suggestion. Filings never mix owners, so filing into a Personal
 * Allowance offers a Rule only to its Parent (ADR-0003). A merchant split between Buckets with no
 * clear favourite offers nothing.
 */
export function spotRules(filings: HandFiling[], rules: RuleNow[]): RuleIdea[] {
	const groups = new Map<string, { owner: string | null; key: string; lines: HandFiling[] }>();
	for (const line of filings) {
		const key = merchantKey(line.merchant);
		if (!key) continue;
		const group = `${line.owner ?? ""}|${key}`;
		const found = groups.get(group) ?? { owner: line.owner, key, lines: [] };
		found.lines.push(line);
		groups.set(group, found);
	}
	const ideas: RuleIdea[] = [];
	for (const { owner, key, lines } of groups.values()) {
		const theirs = rules.filter((rule) => rule.owner === null || rule.owner === owner);
		if (ruleFor(theirs, key)) continue;
		const byBucket = new Map<string, HandFiling[]>();
		for (const line of lines)
			byBucket.set(line.bucketId, [...(byBucket.get(line.bucketId) ?? []), line]);
		const ranked = [...byBucket.values()].sort((a, b) => b.length - a.length);
		const best = ranked[0] ?? [];
		if (best.length < RULE_TIMES || (ranked[1]?.length ?? 0) >= best.length) continue;
		const latest = [...best].sort((a, b) => b.date.localeCompare(a.date))[0] as HandFiling;
		ideas.push({
			kind: "rule",
			owner,
			name: latest.merchant,
			merchant: key,
			bucketId: latest.bucketId,
			bucketName: latest.bucketName,
			amountCents: 0,
			evidence: {
				count: best.length,
				amountCents: 0,
				months: new Set(best.map((line) => line.date.slice(0, 7))).size,
				transactionIds: best.map((line) => line.id).sort(),
			},
		});
	}
	return ideas;
}
