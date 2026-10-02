import type { Cadence, DayKey, DraftCommitment, MonthKey } from "@noodle/domain";
import { ulid } from "ulid";
import type { SetupBill } from "./setup";

// Step 3 of the get-started wizard (#53): the common bills a family has, filled from the plan
// draft's detected Commitments when there's history, and what writing them to the Plan takes.
// Pure, so the wizard and its tests agree.

/** A bill as the wizard edits it: what's saved, plus the field's text and where its amount came from. */
export type BillRow = SetupBill & {
	amount: string;
	/** The Parent typed in this row: suggestions arriving later leave it alone. */
	touched: boolean;
	/** Its amount came from the plan draft ("Suggested from your spending"). */
	suggested: boolean;
};

/** The common bills, in the order a Parent thinks of them, and words that find them in a draft. */
export const COMMON_BILLS: { key: string; name: string; dueDay: number; words: RegExp }[] = [
	{
		key: "housing",
		name: "Mortgage or rent",
		dueDay: 1,
		words: /mortgage|rent|apartment|property/i,
	},
	{
		key: "utilities",
		name: "Utilities",
		dueDay: 15,
		words: /electric|energy|power|water|utilit|gas co/i,
	},
	{
		key: "phone",
		name: "Phone",
		dueDay: 15,
		words: /phone|verizon|t-mobile|at&t|wireless|mobile/i,
	},
	{
		key: "internet",
		name: "Internet",
		dueDay: 15,
		words: /internet|comcast|xfinity|spectrum|fiber/i,
	},
	{
		key: "car",
		name: "Car payment",
		dueDay: 15,
		words: /auto|car |vehicle|motor|toyota|honda|ford/i,
	},
	{
		key: "insurance",
		name: "Insurance",
		dueDay: 15,
		words: /insur|geico|state farm|progressive|allstate/i,
	},
	{ key: "daycare", name: "Daycare", dueDay: 1, words: /daycare|child ?care|preschool|nanny/i },
	{
		key: "streaming",
		name: "Streaming",
		dueDay: 15,
		words: /netflix|hulu|spotify|disney|stream|youtube|hbo|max/i,
	},
];

const norm = (name: string) => name.trim().toLowerCase();

/** The checklist to start from: what was saved, or the common bills, unticked and empty. */
export function startingBills(
	saved: SetupBill[] | undefined,
	format: (c: number) => string,
): BillRow[] {
	if (saved?.length) {
		return saved.map((bill) => ({
			...bill,
			amount: bill.amountCents ? format(bill.amountCents) : "",
			touched: true,
			suggested: false,
		}));
	}
	return COMMON_BILLS.map((bill) => ({
		key: bill.key,
		id: ulid(),
		name: bill.name,
		amountCents: 0,
		cadence: "monthly",
		dueDay: bill.dueDay,
		ticked: false,
		amount: "",
		touched: false,
		suggested: false,
	}));
}

/** A new, empty row for "Add another". */
export const anotherBill = (): BillRow => ({
	key: `own-${ulid()}`,
	id: ulid(),
	name: "",
	amountCents: 0,
	cadence: "monthly",
	dueDay: 1,
	ticked: true,
	amount: "",
	touched: true,
	suggested: false,
});

/**
 * Detected Commitments, merged in as they arrive: each fills the common bill it sounds like (or a
 * row of its own), ticked, with its amount and due day. Rows the Parent typed in are left alone,
 * and a suggestion already in the list isn't added twice.
 */
export function mergeDraftBills(
	rows: BillRow[],
	draft: DraftCommitment[],
	format: (c: number) => string,
): BillRow[] {
	const next = [...rows];
	for (const found of draft) {
		if (next.some((row) => row.draftKey === found.key)) continue;
		const filled = {
			amountCents: found.amount,
			amount: format(found.amount),
			cadence: found.cadence,
			dueDay: Number(found.dueDate.slice(8, 10)),
			dueDate: found.dueDate,
			ticked: true,
			suggested: true,
			draftKey: found.key,
		};
		const words = `${found.name} ${found.merchant} ${found.description}`;
		const common = next.findIndex(
			(row) =>
				!row.touched &&
				!row.draftKey &&
				(norm(row.name) === norm(found.name) ||
					COMMON_BILLS.find((bill) => bill.key === row.key)?.words.test(words)),
		);
		if (common >= 0) {
			next[common] = { ...(next[common] as BillRow), ...filled };
		} else if (!next.some((row) => row.touched && norm(row.name) === norm(found.name))) {
			next.push({
				key: `draft-${found.key}`,
				id: ulid(),
				name: found.name.slice(0, 40),
				touched: false,
				...filled,
			});
		}
	}
	return next;
}

/** What a bill costs in an average month. */
export function monthlyCents(amount: number, cadence: Cadence): number {
	if (cadence === "biweekly") return Math.round((amount * 26) / 12);
	if (cadence === "annual") return Math.round(amount / 12);
	return amount;
}

/** The ticked bills' total in an average month. */
export const billsMonthly = (rows: Pick<SetupBill, "ticked" | "amountCents" | "cadence">[]) =>
	rows.reduce((sum, row) => sum + (row.ticked ? monthlyCents(row.amountCents, row.cadence) : 0), 0);

/** The day a bill's schedule starts: the detected date, or its day in `month` (clamped to the month's end). */
export function dueDateFor(bill: Pick<SetupBill, "dueDay" | "dueDate">, month: MonthKey): DayKey {
	if (bill.dueDate && Number(bill.dueDate.slice(8, 10)) === bill.dueDay)
		return bill.dueDate as DayKey;
	const [year, mon] = month.split("-").map(Number) as [number, number];
	const last = new Date(Date.UTC(year, mon, 0)).getUTCDate();
	return `${month}-${String(Math.min(bill.dueDay, last)).padStart(2, "0")}` as DayKey;
}

export type PlanCommitmentNow = { id: string; name: string };

/** The writes that take the Plan from what was saved last time to `next`. */
export type BillWrites = {
	/** The rows to save, with ids swapped for a Commitment the Plan already had by that name. */
	rows: SetupBill[];
	add: SetupBill[];
	accept: SetupBill[];
	update: SetupBill[];
	end: string[];
};

/**
 * Re-running the step never makes a second Commitment: a bill saved before is updated (only when
 * it changed), one the Plan already has by name is updated in place, and a bill unticked or
 * removed since is ended.
 */
export function planBillWrites(
	previous: SetupBill[] | undefined,
	next: SetupBill[],
	plan: PlanCommitmentNow[],
): BillWrites {
	const out: BillWrites = { rows: [], add: [], accept: [], update: [], end: [] };
	const before = new Map((previous ?? []).map((bill) => [bill.key, bill]));
	for (const bill of next) {
		const prev = before.get(bill.key);
		before.delete(bill.key);
		if (!bill.ticked) {
			if (prev?.ticked) out.end.push(prev.id);
			out.rows.push(prev?.ticked ? { ...bill, id: ulid() } : bill);
			continue;
		}
		if (prev?.ticked && prev.id === bill.id) {
			const changed =
				prev.name !== bill.name ||
				prev.amountCents !== bill.amountCents ||
				prev.dueDay !== bill.dueDay ||
				prev.cadence !== bill.cadence;
			if (changed) out.update.push(bill);
			out.rows.push(bill);
			continue;
		}
		const existing = plan.find((c) => norm(c.name) === norm(bill.name));
		if (existing) {
			const row = { ...bill, id: existing.id };
			out.update.push(row);
			out.rows.push(row);
		} else {
			(bill.draftKey ? out.accept : out.add).push(bill);
			out.rows.push(bill);
		}
	}
	for (const gone of before.values()) if (gone.ticked) out.end.push(gone.id);
	return out;
}
