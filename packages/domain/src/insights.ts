import { merchantKey } from "./categorize";
import { type Cadence, yearlyCost } from "./commitments";
import type { Cents } from "./money";
import { addDays, type DayKey, daysBetween, monthOfDay } from "./month";
import { mentions, type PerkKind } from "./perks";
import type { PlanCommitment } from "./plan";

// Insights: suggested changes found in a Household's spending and Commitments, each backed by the
// exact Transactions and Commitments behind it and a yearly impact. Finding them is plain code
// over what the Viewer may see; a model only says which names are the same service (`sameService`)
// and rewords the plain title and body written here. Every figure comes from this module.

export const INSIGHT_KINDS = [
	"duplicate-service",
	"duplicate-charge",
	"price-increase",
	"unused",
	"perk-service",
	"perk-cost",
] as const;
export type InsightKind = (typeof INSIGHT_KINDS)[number];

/**
 * Overlaps: paying twice for the same benefit, as two services, the same charge twice, a service
 * a Perk already includes, or a cost a Perk covers.
 */
export const isOverlap = (kind: InsightKind) => kind !== "price-increase" && kind !== "unused";

/** Insights about money paid once (a charge twice, a covered cost), not every year. */
export const isOnce = (kind: InsightKind) => kind === "duplicate-charge" || kind === "perk-cost";

/** A Transaction an Insight may rest on, as the Viewer sees it. `amount` is money spent. */
export type InsightSpend = {
	/** The Account it was charged to, when known (a card's perks count only its own). */
	accountId?: string | null;
	id: string;
	date: DayKey;
	amount: Cents;
	/** Its note: the merchant, for a statement line. */
	note: string;
	/** The Commitment it pays, if any. */
	commitmentId: string | null;
	/** In the Viewer's own Personal Allowance: an Insight resting on it is theirs alone (ADR-0003). */
	private: boolean;
};

/** Something the Household pays for again and again: a Commitment, or a merchant charging monthly. */
export type Service = {
	/** `c:<Commitment ID>` or `m:<merchantKey>`. */
	key: string;
	name: string;
	/** What it charges each time, and in a year. */
	amount: Cents;
	yearly: Cents;
	commitmentId: string | null;
	/** Its charges, oldest first. */
	charges: InsightSpend[];
};

/** An Insight found, before a model rewords it. */
export type InsightCandidate = {
	kind: InsightKind;
	/** The same finding always has the same fingerprint, so a dismissed one never returns. */
	fingerprint: string;
	yearlyImpact: Cents;
	transactionIds: string[];
	commitmentIds: string[];
	/** The Perks it rests on. */
	perkIds: string[];
	/** Rests on the Viewer's own Personal Allowance (or their own Perk Source): theirs alone. */
	private: boolean;
	/** The names it's about. */
	subjects: string[];
	title: string;
	body: string;
};

export type InsightInputs = {
	/** Spending over the last year or so, as the Viewer may see it. */
	spends: InsightSpend[];
	/** The Commitments in this month's Plan. */
	commitments: PlanCommitment[];
	/** Today, in the Household's time zone. */
	asOf: DayKey;
	/** The Perks of the Perk Sources the Viewer may see. */
	perks?: InsightPerk[];
};

/** A Perk an Insight may rest on. */
export type InsightPerk = {
	id: string;
	sourceId: string;
	sourceName: string;
	/** Its identity within its Perk Source (perkKey), stable across re-checks. */
	key: string;
	name: string;
	kind: PerkKind;
	/** The service or cost as it would read on a statement. */
	matches: string;
	/** Its Perk Source is the Viewer's alone. */
	private: boolean;
};

/** How far back a merchant's charges make it a monthly service. */
export const RECURRING_DAYS = 120;
/** How far back two equal charges count as one charged twice. */
const DUPLICATE_DAYS = 45;
/** How close together two equal charges must be to look like one charged twice. */
const DUPLICATE_GAP_DAYS = 2;
/** Smaller equal charges (two coffees) are too ordinary to call duplicates. */
const DUPLICATE_MIN: Cents = 1000;
/** How recent a higher charge must be to report it as a price increase. */
const INCREASE_DAYS = 45;
/** How far back a cost a Perk covers is worth mentioning. */
const COVERED_COST_DAYS = 365;
/** How many Transactions an Insight lists at most. */
const MAX_TRANSACTIONS = 12;

const PERIODS_A_YEAR: Record<Cadence, number> = { monthly: 12, biweekly: 26, annual: 1 };
/** Days without a charge after which a Commitment looks unused. */
const UNUSED_AFTER_DAYS: Record<Cadence, number | null> = {
	monthly: 70,
	biweekly: 40,
	annual: null,
};

const byDate = (a: InsightSpend, b: InsightSpend) =>
	a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : 1;

const within = (amount: Cents, of: Cents, share: number) =>
	Math.abs(amount - of) <= Math.abs(of) * share;

/**
 * The services the Household pays for: every Commitment in the Plan, and every merchant that
 * charged, outside any Commitment, in at least two of the last months, once a month, about the
 * same amount each time. Weekly shops (several charges a month) and one-offs aren't services.
 */
export function services({ spends, commitments, asOf }: InsightInputs): Service[] {
	const since = addDays(asOf, -RECURRING_DAYS);
	const recent = spends.filter((s) => s.date > since && s.date <= asOf).sort(byDate);
	const own: Service[] = commitments.map((commitment) => ({
		key: `c:${commitment.id}`,
		name: commitment.name,
		amount: commitment.amount,
		yearly: yearlyCost(commitment),
		commitmentId: commitment.id,
		charges: recent.filter((s) => s.commitmentId === commitment.id),
	}));
	const byMerchant = new Map<string, InsightSpend[]>();
	for (const spend of recent) {
		if (spend.commitmentId !== null || !spend.note.trim()) continue;
		const key = merchantKey(spend.note);
		byMerchant.set(key, [...(byMerchant.get(key) ?? []), spend]);
	}
	const merchants: Service[] = [];
	for (const [key, charges] of byMerchant) {
		const months = new Set(charges.map((c) => monthOfDay(c.date)));
		const latest = charges.at(-1) as InsightSpend;
		if (months.size < 2 || months.size !== charges.length) continue;
		if (!charges.every((c) => within(c.amount, latest.amount, 0.2))) continue;
		merchants.push({
			key: `m:${key}`,
			name: latest.note.trim(),
			amount: latest.amount,
			yearly: latest.amount * 12,
			commitmentId: null,
			charges,
		});
	}
	return [...own, ...merchants];
}

/** Keys of services that are one service: the same merchant, or grouped by `sameService`. */
function groupsOf(all: Service[], sameService: string[][]): Service[][] {
	const parent = new Map(all.map((s) => [s.key, s.key]));
	const find = (key: string): string => {
		const up = parent.get(key) as string;
		return up === key ? key : find(up);
	};
	const join = (a: string, b: string) => parent.set(find(a), find(b));
	const byName = new Map<string, string>();
	for (const service of all) {
		const name = merchantKey(service.name);
		const seen = byName.get(name);
		if (seen) join(service.key, seen);
		else byName.set(name, service.key);
	}
	for (const group of sameService) {
		const known = group.filter((key) => parent.has(key));
		for (const key of known.slice(1)) join(key, known[0] as string);
	}
	const groups = new Map<string, Service[]>();
	for (const service of all) {
		const root = find(service.key);
		groups.set(root, [...(groups.get(root) ?? []), service]);
	}
	return [...groups.values()];
}

/**
 * A group's services, with each merchant charging about what one of its Commitments costs, in
 * months that Commitment wasn't charged, taken as that Commitment's own charges (paid, just not
 * assigned to it), not as a second service. Charged alongside it, the merchant is paid twice.
 */
function distinct(group: Service[]): Service[] {
	const commitments = group.filter((s) => s.commitmentId !== null);
	const out = commitments.map((s) => ({ ...s, charges: [...s.charges] }));
	const monthsOf = (s: Service) => new Set(s.charges.map((c) => monthOfDay(c.date)));
	for (const merchant of group.filter((s) => s.commitmentId === null)) {
		const months = monthsOf(merchant);
		const same = out.find(
			(c) =>
				c.commitmentId !== null &&
				within(merchant.amount, c.amount, 0.1) &&
				![...monthsOf(c)].some((m) => months.has(m)),
		);
		if (same) same.charges = [...same.charges, ...merchant.charges].sort(byDate);
		else out.push(merchant);
	}
	return out;
}

const names = (list: string[]) =>
	list.length <= 2
		? list.join(" and ")
		: `${list.slice(0, -1).join(", ")}, and ${list.at(-1) as string}`;

const candidate = (
	fields: Omit<InsightCandidate, "private" | "transactionIds" | "perkIds"> & {
		charges: InsightSpend[];
		perks?: InsightPerk[];
	},
): InsightCandidate => {
	const { charges, perks = [], ...rest } = fields;
	const latest = [...charges].sort(byDate).slice(-MAX_TRANSACTIONS);
	return {
		...rest,
		transactionIds: [...new Set(latest.map((c) => c.id))],
		perkIds: perks.map((p) => p.id),
		private: latest.some((c) => c.private) || perks.some((p) => p.private),
	};
};

/** Two or more services that are the same, or cover the same need: an Overlap. */
function duplicateServices(all: Service[], sameService: string[][]): InsightCandidate[] {
	const found: InsightCandidate[] = [];
	for (const group of groupsOf(all, sameService)) {
		const paid = distinct(group);
		if (paid.length < 2) continue;
		const subjects = paid.map((s) => s.name);
		found.push(
			candidate({
				kind: "duplicate-service",
				fingerprint: `duplicate-service:${paid
					.map((s) => s.key)
					.sort()
					.join(",")}`,
				// Ending one saves at least the cheaper one's cost.
				yearlyImpact: Math.min(...paid.map((s) => s.yearly)),
				commitmentIds: paid.flatMap((s) => (s.commitmentId ? [s.commitmentId] : [])),
				charges: paid.flatMap((s) => s.charges),
				subjects,
				title: `${names(subjects)} may overlap`,
				body: "You pay for each of these, and they look like the same service or cover the same need. Ending one would save at least the cheaper one’s cost.",
			}),
		);
	}
	return found;
}

/** The same amount at the same merchant (or to the same Commitment) a day or two apart. */
function duplicateCharges({ spends, asOf }: InsightInputs): InsightCandidate[] {
	const since = addDays(asOf, -DUPLICATE_DAYS);
	const recent = spends
		.filter((s) => s.date > since && s.date <= asOf && s.amount >= DUPLICATE_MIN)
		.sort(byDate);
	const payee = (s: InsightSpend) =>
		s.commitmentId ? `c:${s.commitmentId}` : s.note.trim() ? `m:${merchantKey(s.note)}` : null;
	const used = new Set<string>();
	const found: InsightCandidate[] = [];
	for (const [i, first] of recent.entries()) {
		if (used.has(first.id) || payee(first) === null) continue;
		const second = recent
			.slice(i + 1)
			.find(
				(s) =>
					!used.has(s.id) &&
					s.amount === first.amount &&
					payee(s) === payee(first) &&
					daysBetween(first.date, s.date) <= DUPLICATE_GAP_DAYS,
			);
		if (!second) continue;
		used.add(first.id);
		used.add(second.id);
		const name = first.note.trim() || second.note.trim() || "The same payee";
		found.push(
			candidate({
				kind: "duplicate-charge",
				fingerprint: `duplicate-charge:${[first.id, second.id].sort().join(",")}`,
				// Once, not every year: the money a mistaken second charge took.
				yearlyImpact: first.amount,
				commitmentIds: first.commitmentId ? [first.commitmentId] : [],
				charges: [first, second],
				subjects: [name],
				title: `${name} charged twice`,
				body: "Two charges of the same amount, a day or two apart. If one is a mistake, ask for that money back.",
			}),
		);
	}
	return found;
}

/**
 * A service whose latest charge is higher than the steady amount it charged before: a Commitment
 * by its cadence, a merchant monthly. Bills that vary every month (no steady amount) never count.
 */
function priceIncreases(all: Service[], { commitments, asOf }: InsightInputs): InsightCandidate[] {
	const found: InsightCandidate[] = [];
	for (const service of all) {
		const charges = [...service.charges].sort(byDate);
		const latest = charges.at(-1);
		const before = charges.slice(-4, -1);
		const was = before.at(-1)?.amount;
		if (!latest || was === undefined || daysBetween(latest.date, asOf) > INCREASE_DAYS) continue;
		if (!before.every((c) => c.amount === was)) continue;
		const rise = latest.amount - was;
		if (rise < 50 || rise < was * 0.03) continue;
		const cadence = commitments.find((c) => c.id === service.commitmentId)?.cadence ?? "monthly";
		found.push(
			candidate({
				kind: "price-increase",
				fingerprint: `price-increase:${service.key}:${latest.amount}`,
				yearlyImpact: rise * PERIODS_A_YEAR[cadence],
				commitmentIds: service.commitmentId ? [service.commitmentId] : [],
				charges: [...before, latest],
				subjects: [service.name],
				title: `${service.name} went up`,
				body: service.commitmentId
					? "Its latest charge is higher than the ones before. Update its terms in the Plan, or see whether a cheaper plan would do."
					: "Its latest charge is higher than the ones before. See whether a cheaper plan would do.",
			}),
		);
	}
	return found;
}

/** A Commitment still in the Plan that was charged before, but not for a while. */
function unusedCommitments({ spends, commitments, asOf }: InsightInputs): InsightCandidate[] {
	const found: InsightCandidate[] = [];
	for (const commitment of commitments) {
		const after = UNUSED_AFTER_DAYS[commitment.cadence];
		const last = spends
			.filter((s) => s.commitmentId === commitment.id && s.date <= asOf)
			.sort(byDate)
			.at(-1);
		if (after === null || !last || daysBetween(last.date, asOf) <= after) continue;
		found.push(
			candidate({
				kind: "unused",
				fingerprint: `unused:${commitment.id}:${last.id}`,
				yearlyImpact: yearlyCost(commitment),
				commitmentIds: [commitment.id],
				charges: [last],
				subjects: [commitment.name],
				title: `Still paying for ${commitment.name}?`,
				body: "Nothing has been charged to it for over two months, but the Plan still sets money aside for it. If it has ended, end it in the Plan too.",
			}),
		);
	}
	return found;
}

/**
 * A service the Household pays for that one of its Perks already includes (Netflix, paid for
 * and included with the phone plan): an Overlap. Ending it saves what it costs a year, if the
 * Perk covers what's used; the Perk Source itself (its own bill) never counts.
 */
function includedServices(all: Service[], perks: InsightPerk[]): InsightCandidate[] {
	const found: InsightCandidate[] = [];
	for (const perk of perks.filter((p) => p.kind === "service")) {
		for (const service of all) {
			if (!mentions(service.name, perk.matches) || mentions(service.name, perk.sourceName)) {
				continue;
			}
			found.push(
				candidate({
					kind: "perk-service",
					fingerprint: `perk-service:${perk.sourceId}:${perk.key}:${service.key}`,
					yearlyImpact: service.yearly,
					commitmentIds: service.commitmentId ? [service.commitmentId] : [],
					charges: service.charges,
					perks: [perk],
					subjects: [service.name, perk.sourceName],
					title: `${service.name} may come with ${perk.sourceName}`,
					body: `${perk.sourceName} includes ${perk.name}. If that covers what you use, ending ${service.name} would save what it costs.`,
				}),
			);
		}
	}
	return found;
}

/**
 * Charges in the last year for a cost one of its Perks covers (a TSA PreCheck fee, with a card
 * that credits it): an Overlap, once. Each new charge makes it a new finding.
 */
function coveredCosts({ spends, asOf, perks = [] }: InsightInputs): InsightCandidate[] {
	const since = addDays(asOf, -COVERED_COST_DAYS);
	const found: InsightCandidate[] = [];
	for (const perk of perks.filter((p) => p.kind === "cost")) {
		const paid = spends
			.filter(
				(s) =>
					s.date > since &&
					s.date <= asOf &&
					mentions(s.note, perk.matches) &&
					!mentions(s.note, perk.sourceName),
			)
			.sort(byDate);
		if (paid.length === 0) continue;
		const name = (paid.at(-1) as InsightSpend).note.trim();
		found.push(
			candidate({
				kind: "perk-cost",
				fingerprint: `perk-cost:${perk.sourceId}:${perk.key}:${paid
					.map((s) => s.id)
					.sort()
					.join(",")}`,
				// What was paid for it: the most the Perk could have saved.
				yearlyImpact: paid.reduce((sum, s) => sum + s.amount, 0),
				commitmentIds: [...new Set(paid.flatMap((s) => (s.commitmentId ? [s.commitmentId] : [])))],
				charges: paid,
				perks: [perk],
				subjects: [name, perk.sourceName],
				title: `${perk.sourceName} may cover ${perk.matches}`,
				body: `${perk.sourceName} includes ${perk.name}. If you paid some other way, or the credit wasn’t applied, you may be able to get it back or use it next time.`,
			}),
		);
	}
	return found;
}

/**
 * Every Insight in what the Viewer may see, largest yearly impact first. `sameService` lists
 * service keys (see `services`) a model says are one service or overlap; unknown keys are ignored.
 */
export function findInsights(
	inputs: InsightInputs,
	sameService: string[][] = [],
): InsightCandidate[] {
	const all = services(inputs);
	return [
		...duplicateServices(all, sameService),
		...duplicateCharges(inputs),
		...priceIncreases(all, inputs),
		...unusedCommitments(inputs),
		...includedServices(all, inputs.perks ?? []),
		...coveredCosts(inputs),
	].sort((a, b) => b.yearlyImpact - a.yearlyImpact || (a.fingerprint < b.fingerprint ? -1 : 1));
}
