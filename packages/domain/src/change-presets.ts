import type { ScenarioChange } from "./changes";
import { MAX_CENTS } from "./money";
import type { DayKey, MonthKey } from "./month";

// Change presets: a change written into a link, so Explore opens with it already made. Insights,
// Ask, a Commitment's "Try ending this" and Affordability open Explore this way:
//
//   /explore?lever=end-commitment:<id>:2027-03
//
// Each is the Change's kind, then its fields, colon-separated; amounts are in cents, and the
// range (from, then until) comes last and may be left off (from this month, for good):
//
//   baseline:<cents>[:from[:until]]
//   allowance:<bucket>:<cents>[:from[:until]]
//   commitment-terms:<commitment>:<cents>[:from[:until]]
//   end-commitment:<commitment>[:from[:until]]
//   archive-bucket:<bucket>[:from[:until]]
//   goal:<goal>:<target cents>[:<target date>|none]
//
// A preset only says what to change; whether its Bucket, Commitment or Goal is in the Plan is
// for Explore to check.

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const DAY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const CENTS = /^\d{1,10}$/;

const cents = (text: string | undefined) =>
	text !== undefined && CENTS.test(text) && Number(text) <= MAX_CENTS ? Number(text) : null;

/**
 * The months a preset's Change holds for: from `from` (this month when left off, or earlier) up
 * to `until`. Null when either isn't a month, or the range ends before it starts.
 */
function range(
	from: string | undefined,
	until: string | undefined,
	month: MonthKey,
): { fromMonth: MonthKey; untilMonth?: MonthKey } | null {
	if (from !== undefined && !MONTH.test(from)) return null;
	if (until !== undefined && !MONTH.test(until)) return null;
	const fromMonth = from === undefined || from < month ? month : (from as MonthKey);
	if (until === undefined) return { fromMonth };
	return until > fromMonth ? { fromMonth, untilMonth: until as MonthKey } : null;
}

/** A preset as a Change from `month` (the Household's current month) on, or null if it isn't one. */
export function parseChangePreset(preset: string, month: MonthKey): ScenarioChange | null {
	const [kind, ...fields] = preset.trim().split(":");
	const id = fields[0] ?? "";
	switch (kind) {
		case "baseline": {
			const [amount, from, until] = fields;
			const value = cents(amount);
			const months = range(from, until, month);
			return value === null || months === null || fields.length > 3
				? null
				: { kind, amount: value, ...months };
		}
		case "allowance":
		case "commitment-terms": {
			const [, amount, from, until] = fields;
			const value = cents(amount);
			const months = range(from, until, month);
			if (!ID.test(id) || value === null || months === null || fields.length > 4) return null;
			if (kind === "allowance") return { kind, bucketId: id, amount: value, ...months };
			return value === 0 ? null : { kind, commitmentId: id, amount: value, ...months };
		}
		case "end-commitment":
		case "archive-bucket": {
			const [, from, until] = fields;
			const months = range(from, until, month);
			if (!ID.test(id) || months === null || fields.length > 3) return null;
			return kind === "end-commitment"
				? { kind, commitmentId: id, ...months }
				: { kind, bucketId: id, ...months };
		}
		case "goal": {
			const [, target, date] = fields;
			const value = cents(target);
			if (!ID.test(id) || value === null || value === 0 || fields.length > 3) return null;
			if (date !== undefined && date !== "none" && !DAY.test(date)) return null;
			return {
				kind,
				goalId: id,
				target: value,
				targetDate: date === undefined || date === "none" ? null : (date as DayKey),
				fromMonth: month,
			};
		}
		default:
			return null;
	}
}

/** A Change as a preset (see parseChangePreset), or null for a kind presets don't carry. */
export function changePreset(change: ScenarioChange): string | null {
	const months = [change.fromMonth, ...(change.untilMonth ? [change.untilMonth] : [])];
	const join = (...parts: (string | number)[]) => parts.join(":");
	switch (change.kind) {
		case "baseline":
			return join(change.kind, change.amount, ...months);
		case "allowance":
			return join(change.kind, change.bucketId, change.amount, ...months);
		case "commitment-terms":
			return change.amount === undefined || change.cadence || change.dueDay
				? null
				: join(change.kind, change.commitmentId, change.amount, ...months);
		case "end-commitment":
			return join(change.kind, change.commitmentId, ...months);
		case "archive-bucket":
			return join(change.kind, change.bucketId, ...months);
		case "goal":
			return join(change.kind, change.goalId, change.target, change.targetDate ?? "none");
		default:
			return null;
	}
}
