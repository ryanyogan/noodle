import type { DeletionSummary, TransactionSelection } from "@noodle/db";
import type { DayKey, MonthKey } from "@noodle/domain";
import type { HeaderCheck } from "@noodle/ui/lib/data-table";
import { formatMoney } from "./format";

// Selecting Transactions on the Transactions page to delete them together (#97, ADR-0045). What
// is selected is kept as IDs, or as "everything the filters match, except these": never as rows
// on screen, so it holds for a long list that has only loaded its first pages.

/** The list's filters, as the Transactions page keeps them in its address. */
type Filters = { bucket?: string; for?: string; account?: string; q?: string };

export type Picking = {
	/** Picked one by one. */
	picked: ReadonlySet<string>;
	/** Or everything the filters match: in the month shown, or in it and every month before. */
	all: { andEarlier: boolean } | null;
	/** Of `all`, the ones tapped off again. */
	except: ReadonlySet<string>;
};

export const nothingPicked: Picking = { picked: new Set(), all: null, except: new Set() };

export const pickAll = (andEarlier: boolean): Picking => ({
	picked: new Set(),
	all: { andEarlier },
	except: new Set(),
});

export const isPicked = (picking: Picking, id: string) =>
	picking.all ? !picking.except.has(id) : picking.picked.has(id);

/** `picking` with one Transaction tapped: on if it was off, off if it was on. */
export function togglePicked(picking: Picking, id: string): Picking {
	const flipped = (set: ReadonlySet<string>) => {
		const next = new Set(set);
		if (!next.delete(id)) next.add(id);
		return next;
	};
	return picking.all
		? { ...picking, except: flipped(picking.except) }
		: { ...picking, picked: flipped(picking.picked) };
}

/**
 * `picking` with these Transactions all set on, or all off: a tick in the table, or the run of
 * rows a shift-click or Shift+Down takes (issue 99). With everything that matches selected it is
 * the exceptions that change, so rows that have not loaded stay selected.
 */
export function setPicked(picking: Picking, ids: readonly string[], on: boolean): Picking {
	const changed = (set: ReadonlySet<string>, add: boolean) => {
		const next = new Set(set);
		for (const id of ids) {
			if (add) next.add(id);
			else next.delete(id);
		}
		return next;
	};
	return picking.all
		? { ...picking, except: changed(picking.except, !on) }
		: { ...picking, picked: changed(picking.picked, on) };
}

/** Goal spending can't be selected here: it changes from its Goal. */
export const canPick = (transaction: { goal?: unknown }) => !transaction.goal;

/** Whether the selection holds anything, as far as this screen can tell. */
export const anyPicked = (picking: Picking) => picking.all !== null || picking.picked.size > 0;

/**
 * What the checkbox in the table's header says. `selectable` is how many Transactions in the list
 * can be selected once every one of them has loaded; undefined while more are still to load,
 * when ticks made one by one can't be known to be all of them.
 */
export function headerCheckOf(
	picking: Picking | null,
	selectable: number | undefined,
): HeaderCheck {
	if (!picking) return "none";
	if (picking.all) {
		if (picking.except.size === 0) return "all";
		const noneLeft =
			!picking.all.andEarlier && selectable !== undefined && picking.except.size >= selectable;
		return noneLeft ? "none" : "some";
	}
	if (picking.picked.size === 0) return "none";
	return selectable !== undefined && selectable > 0 && picking.picked.size >= selectable
		? "all"
		: "some";
}

/**
 * The words on the bar's "select everything" buttons. `short` is for a phone, where the two sit
 * side by side: the region around them already says they select.
 */
export function selectAllLabel(
	count: number,
	month: string,
	at: { filtered: boolean; andEarlier: boolean; short?: boolean },
): string {
	const n = count.toLocaleString("en-US");
	if (at.short) return at.andEarlier ? `All ${n} with earlier months` : `All ${n} in ${month}`;
	return `Select all ${n}${at.filtered ? " that match" : ""} in ${month}${at.andEarlier ? " and every month before" : ""}`;
}

/** The filters as the server takes them, for a month or for it and every month before. */
export const matchingAll = (month: MonthKey, filters: Filters, andEarlier: boolean) => ({
	month,
	andEarlier,
	bucketId: filters.bucket,
	forMember: filters.for,
	accountId: filters.account,
	search: filters.q,
});

/** What the server is asked to delete. */
export function selectionOf(
	picking: Picking,
	month: MonthKey,
	filters: Filters,
): TransactionSelection {
	if (!picking.all) return { ids: [...picking.picked] };
	return {
		all: matchingAll(month, filters, picking.all.andEarlier),
		except: [...picking.except],
	};
}

/**
 * How many are selected. For "everything that matches", `matching` is how many the server says
 * match; unknown until it has answered.
 */
export function pickedCount(picking: Picking, matching: number | undefined): number | undefined {
	if (!picking.all) return picking.picked.size;
	return matching === undefined ? undefined : Math.max(0, matching - picking.except.size);
}

export const transactionsCount = (count: number) =>
	count === 1 ? "1 Transaction" : `${count.toLocaleString("en-US")} Transactions`;

/** "Oct 3, 2025". */
export const longDay = (day: DayKey) =>
	new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", {
		day: "numeric",
		month: "short",
		year: "numeric",
		timeZone: "UTC",
	});

const listed = (names: string[]) =>
	names.length <= 1
		? (names[0] ?? "")
		: `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

const are = (count: number) => (count === 1 ? "1 is" : `${count.toLocaleString("en-US")} are`);
const have = (count: number) => (count === 1 ? "1 has" : `${count.toLocaleString("en-US")} have`);

export const SNAPSHOT_BEFORE_DELETE =
	"Noodle takes a snapshot first, so you can put them back from Snapshots in Household settings.";

/** The facts the confirm sheet states before a Parent deletes a selection, in plain words. */
export function deletionFacts(summary: DeletionSummary): string[] {
	const { count } = summary;
	if (count === 0) return [];
	const facts: string[] = [];
	const dates =
		summary.firstDate && summary.lastDate
			? summary.firstDate === summary.lastDate
				? ` on ${longDay(summary.firstDate)}`
				: ` from ${longDay(summary.firstDate)} to ${longDay(summary.lastDate)}`
			: "";
	facts.push(
		`${transactionsCount(count)}${dates}, adding up to ${formatMoney(summary.totalCents)}.`,
	);
	if (summary.accounts.length > 0) facts.push(`From ${listed(summary.accounts)}.`);
	if (summary.imported > 0) {
		facts.push(
			`${summary.imported === 1 ? "1 came" : `${summary.imported.toLocaleString("en-US")} came`} from a bank or a statement. They won’t come back when your bank syncs or a statement is uploaded again.`,
		);
	}
	if (summary.filed > 0) {
		facts.push(
			`${are(summary.filed)} already filed in a Bucket or a Commitment, which will show that much less spent.`,
		);
	}
	if (summary.split > 0) facts.push(`${are(summary.split)} split. Their Splits go with them.`);
	if (summary.transfers > 0) {
		facts.push(
			`${are(summary.transfers)} one side of a Transfer. The other side stays and becomes an ordinary Transaction again.`,
		);
	}
	if (summary.refunds > 0) {
		facts.push(
			`${are(summary.refunds)} part of a Refund. The link goes, and money back that stays is unassigned again.`,
		);
	}
	if (summary.receipts > 0) {
		facts.push(`${have(summary.receipts)} a Receipt. The Receipts stay, unattached.`);
	}
	if (summary.closedMonths > 0) {
		facts.push(
			`${are(summary.closedMonths)} in months you’ve already closed. They are deleted too: what those months spent will change, and the Sweeps decided when they closed stay as they are.`,
		);
	}
	return facts;
}

/** What stays whatever is selected, said on the confirm sheet. */
export function stayingFacts(summary: DeletionSummary): string[] {
	const facts: string[] = [];
	if (summary.staying > 0) {
		facts.push(
			`${are(summary.staying)} Goal spending or partly the other Parent’s, and will stay. Goal spending changes from its Goal.`,
		);
	}
	facts.push("Money in (pay and other deposits) isn’t in this list and stays.");
	return facts;
}

/** What the toast says after a bulk delete. */
export function bulkDeletedMessage(result: { deleted: number; snapshot: boolean }): string {
	if (result.deleted === 0) return "Nothing was deleted: those Transactions had already gone.";
	const deleted = `Deleted ${transactionsCount(result.deleted)}.`;
	return result.snapshot
		? `${deleted} Noodle took a snapshot first, so you can put them back from Snapshots in Household settings.`
		: deleted;
}
