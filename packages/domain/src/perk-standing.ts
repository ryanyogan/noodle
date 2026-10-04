import { addDays, type DayKey } from "./month";
import type { PerkKind } from "./perks";

// Where a Perk stands this year: how often it renews, when it resets next, and whether it was
// used this period, from a Parent marking it used by hand or (for a cost it pays for) a matching
// charge in the Household's spending. Its value is the one its benefits page states, quoted;
// a Perk whose page states none counts for nothing in the sums.

export const PERK_RENEWALS = [
	"monthly",
	"quarterly",
	"yearly",
	"every-4-years",
	"per-trip",
] as const;
export type PerkRenewal = (typeof PERK_RENEWALS)[number];

export const perkRenewalLabel: Record<PerkRenewal, string> = {
	monthly: "Every month",
	quarterly: "Every 3 months",
	yearly: "Every year",
	"every-4-years": "Every 4 years",
	"per-trip": "Each trip",
};

/** A use a Parent marked by hand, with their short note. */
export type PerkUse = { id: string; on: DayKey; note: string | null };

/** A use as seen: by hand, or a matching charge in the Household's spending. */
export type PerkUseSeen = {
	on: DayKey;
	how: "by-hand" | "spending";
	note: string | null;
	id: string | null;
};

export type PerkForStanding = {
	kind: PerkKind;
	valueCents: number | null;
	renews: PerkRenewal | null;
	uses: PerkUse[];
	/** Days the Household paid for what this Perk covers. */
	spentOn: DayKey[];
};

export type PerkStanding = {
	/** The period it's in now; null when it doesn't renew on a calendar (each trip, or unknown). */
	period: { start: DayKey; resets: DayKey | null } | null;
	usedThisPeriod: PerkUseSeen | null;
	lastUsed: PerkUseSeen | null;
	/** Days until it resets, when it resets on a date. */
	daysLeft: number | null;
	/** What it's worth over a year, when its page states a value. */
	yearlyValueCents: number | null;
	usedThisYearCents: number;
};

const parts = (day: DayKey) => day.split("-").map(Number) as [number, number, number];
const dayOf = (y: number, m: number, d: number): DayKey => {
	const at = new Date(Date.UTC(y, m - 1, d));
	return at.toISOString().slice(0, 10) as DayKey;
};

/** Whole days from `from` to `to`. */
export const daysBetween = (from: DayKey, to: DayKey) =>
	Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** The period a Perk renewing so is in on `asOf`: its first day, and the day it resets. */
export function perkPeriod(
	renews: PerkRenewal | null,
	asOf: DayKey,
): { start: DayKey; resets: DayKey | null } | null {
	const [y, m, d] = parts(asOf);
	switch (renews) {
		case "monthly":
			return { start: dayOf(y, m, 1), resets: dayOf(y, m + 1, 1) };
		case "quarterly": {
			const first = Math.floor((m - 1) / 3) * 3 + 1;
			return { start: dayOf(y, first, 1), resets: dayOf(y, first + 3, 1) };
		}
		case "yearly":
			return { start: dayOf(y, 1, 1), resets: dayOf(y + 1, 1, 1) };
		case "every-4-years":
			return { start: addDays(dayOf(y - 4, m, d), 1), resets: null };
		default:
			return null;
	}
}

const PER_YEAR: Record<PerkRenewal, number | null> = {
	monthly: 12,
	quarterly: 4,
	yearly: 1,
	"every-4-years": 0.25,
	"per-trip": null,
};

/** Where `perk` stands on `asOf`. */
export function perkStanding(perk: PerkForStanding, asOf: DayKey): PerkStanding {
	const seen: PerkUseSeen[] = [
		...perk.uses.map((use) => ({
			on: use.on,
			how: "by-hand" as const,
			note: use.note,
			id: use.id,
		})),
		...(perk.kind === "cost"
			? perk.spentOn.map((on) => ({ on, how: "spending" as const, note: null, id: null }))
			: []),
	]
		.filter((use) => use.on <= asOf)
		.sort((a, b) => (a.on < b.on ? 1 : a.on > b.on ? -1 : a.how === "by-hand" ? -1 : 1));
	const period = perkPeriod(perk.renews, asOf);
	const usedThisPeriod = period ? (seen.find((use) => use.on >= period.start) ?? null) : null;
	const perYear = perk.renews ? PER_YEAR[perk.renews] : null;
	const value = perk.valueCents;
	const yearlyValueCents = value !== null && perYear !== null ? Math.round(value * perYear) : null;
	const yearStart = `${asOf.slice(0, 4)}-01-01` as DayKey;
	const thisYear = seen.filter((use) => use.on >= yearStart);
	let usedThisYearCents = 0;
	if (value !== null) {
		if (perk.renews === "monthly" || perk.renews === "quarterly") {
			const starts = new Set(thisYear.map((use) => perkPeriod(perk.renews, use.on)?.start));
			usedThisYearCents = starts.size * value;
		} else if (perk.renews === "yearly") {
			usedThisYearCents = thisYear.length > 0 ? value : 0;
		} else if (perk.renews === "every-4-years") {
			usedThisYearCents = usedThisPeriod ? (yearlyValueCents ?? 0) : 0;
		} else if (perk.renews === "per-trip") {
			usedThisYearCents = thisYear.length * value;
		}
	}
	return {
		period,
		usedThisPeriod,
		lastUsed: seen[0] ?? null,
		daysLeft: period?.resets ? daysBetween(asOf, period.resets) : null,
		yearlyValueCents,
		usedThisYearCents,
	};
}

/** Perks unused this period that reset within this many days are worth doing now. */
export const PERK_DO_NOW_DAYS = 45;

/**
 * Whether a Perk belongs under "Do now": unused this period, and either resetting soon or never
 * used at all. One used each trip only asks when it was never used.
 */
export function perkDoNow(standing: PerkStanding, renews: PerkRenewal | null): boolean {
	if (standing.usedThisPeriod) return false;
	if (renews === "per-trip") return standing.lastUsed === null;
	if (standing.lastUsed === null) return true;
	return standing.daysLeft !== null && standing.daysLeft <= PERK_DO_NOW_DAYS;
}

/** "Do now" order: the soonest to reset first, then the most valuable; no reset date last. */
export function byDoNow<T extends { standing: PerkStanding; valueCents: number | null }>(
	a: T,
	b: T,
): number {
	const left = (x: T) => x.standing.daysLeft ?? Number.POSITIVE_INFINITY;
	if (left(a) !== left(b)) return left(a) - left(b);
	return (b.valueCents ?? 0) - (a.valueCents ?? 0);
}
