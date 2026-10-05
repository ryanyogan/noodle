// The rules of DataTable (components/data-table.tsx, ADR-0051), kept apart from the component so
// they can be tested without a browser: which columns show at which width, where a column goes
// when the row is stacked on a phone, which rows a shift-click takes, what the header's checkbox
// says and which way a click on a column's name sorts.

/** Where a column's cell goes when the table is too narrow for columns and each row is a block. */
export type StackedSlot = "title" | "value" | "secondary" | "trailing" | "hidden";

/** What the layout needs to know of a column. */
export type ColumnShape = {
	id: string;
	/** The narrowest the column reads at, in rem. Decides when it drops; see `columnTiers`. */
	min: number;
	/**
	 * Its grid track from `@2xl`, e.g. `"6rem"` or `"minmax(0,2fr)"`. Each row is its own grid, so
	 * the track must not depend on what is in the cell (no `auto`, no `max-content`), or rows would
	 * not line up. Default `minmax(<min>rem,1fr)`.
	 */
	width?: string;
	/**
	 * 1 (the default) is always shown. Higher numbers drop first as the table's container narrows:
	 * a 3 goes before a 2. Columns with the same number drop from the right.
	 */
	priority?: number;
	/** Where it goes in a stacked row. Default: the first column is the title, the rest secondary. */
	stacked?: StackedSlot;
	/** False for a column that exists only in the stacked row (one line that sums up several columns). */
	wide?: boolean;
};

/**
 * The container widths, in rem, at which the table changes shape: Tailwind's `@2xl`, `@3xl`,
 * `@4xl`, `@5xl` and `@6xl`. Below the first the rows are stacked. The component's classes are
 * written for exactly these five, so change both together.
 */
export const TABLE_TIERS = [42, 48, 56, 64, 72] as const;

/** The space between two columns, in rem (`gap-x-3`). */
export const COLUMN_GAP = 0.75;

/**
 * The first tier (an index into TABLE_TIERS) at which each column shows. A column is in a tier
 * when it and every column that matters more fit in that width, by their `min`s; so columns drop
 * strictly in order of priority and a wider tier always shows at least what a narrower one does.
 * Priority 1 is in from the first tier whether it fits or not (its track can shrink), and the
 * widest tier shows everything. Columns with `wide: false` are left out.
 *
 * `reserved` is what the row spends before any column, in rem: its padding, the checkbox and the
 * leading slot.
 */
export function columnTiers(
	columns: readonly ColumnShape[],
	{ reserved = 0, gap = COLUMN_GAP }: { reserved?: number; gap?: number } = {},
): Record<string, number> {
	const byPriority = columns
		.map((column, index) => ({ column, index }))
		.filter(({ column }) => column.wide !== false)
		.sort((a, b) => (a.column.priority ?? 1) - (b.column.priority ?? 1) || a.index - b.index);
	const tiers: Record<string, number> = {};
	const last = TABLE_TIERS.length - 1;
	TABLE_TIERS.forEach((width, tier) => {
		let used = reserved;
		let count = 0;
		for (const { column } of byPriority) {
			const need = column.min + (count > 0 ? gap : 0);
			const kept = (column.priority ?? 1) <= 1 || tier === last;
			if (!kept && used + need > width) break;
			used += need;
			count += 1;
			if (!(column.id in tiers)) tiers[column.id] = tier;
		}
	});
	return tiers;
}

/** The row's `grid-template-columns` at a tier: `before` (checkbox, leading slot), then the columns showing. */
export function gridTemplate(
	columns: readonly ColumnShape[],
	tiers: Record<string, number>,
	tier: number,
	before: readonly string[] = [],
): string {
	const tracks = columns
		.filter((column) => {
			const from = tiers[column.id];
			return from !== undefined && from <= tier;
		})
		.map((column) => column.width ?? `minmax(${column.min}rem,1fr)`);
	return [...before, ...tracks].join(" ");
}

export type StackedPlace = { slot: StackedSlot; row: number };

/**
 * Where each column goes in a stacked row, and how many lines the row has. One title and one
 * value share the first line; each secondary column takes a line of its own under them; a
 * trailing column (an edit button) sits at the end, centred on the whole row. A second title or
 * value becomes a secondary line rather than landing on top of the first.
 */
export function stackedLayout(columns: readonly ColumnShape[]): {
	places: Record<string, StackedPlace>;
	rows: number;
	has: { value: boolean; trailing: boolean };
} {
	const places: Record<string, StackedPlace> = {};
	const named = columns.some((column) => column.stacked === "title");
	let title = false;
	let value = false;
	let trailing = false;
	let row = 1;
	columns.forEach((column, index) => {
		let slot: StackedSlot = column.stacked ?? (!named && index === 0 ? "title" : "secondary");
		if (slot === "title" && title) slot = "secondary";
		if (slot === "value" && value) slot = "secondary";
		if (slot === "trailing" && trailing) slot = "hidden";
		if (slot === "title") title = true;
		if (slot === "value") value = true;
		if (slot === "trailing") trailing = true;
		if (slot === "secondary") row += 1;
		places[column.id] = { slot, row: slot === "secondary" ? row : 1 };
	});
	return { places, rows: row, has: { value, trailing } };
}

/**
 * The stacked row's `grid-template-columns`, with a named line for each slot so a cell can be put
 * in its place by name. Only the tracks in use are written, so a table with no checkbox has no
 * empty track and no stray gap. `mainend` closes the title's and the value's columns: a secondary
 * line runs from `main` to it.
 */
export function stackedTemplate(at: {
	select: boolean;
	leading: string | null;
	value: boolean;
	trailing: boolean;
}): string {
	return [
		at.select ? "[sel] 2.75rem" : "",
		at.leading ? `[lead] ${at.leading}` : "",
		"[main] minmax(0,1fr)",
		at.value ? "[val] auto" : "",
		at.trailing ? "[mainend trail] auto" : "[mainend]",
	]
		.filter(Boolean)
		.join(" ");
}

/**
 * The rows a shift-click takes: from the row ticked last (the anchor) to this one, both included,
 * in the order shown. `ordered` is the rows that can be selected, so one that can't is skipped.
 * With no anchor, or one that is no longer in the list, it is just this row.
 */
export function rangeIds(ordered: readonly string[], anchor: string | null, id: string): string[] {
	const to = ordered.indexOf(id);
	if (to === -1) return [];
	const from = anchor === null ? -1 : ordered.indexOf(anchor);
	if (from === -1) return [id];
	return ordered.slice(Math.min(from, to), Math.max(from, to) + 1);
}

/** What the header's checkbox says. */
export type HeaderCheck = "all" | "some" | "none";

/**
 * The header's checkbox from two counts. `total` is everything that could be selected, which may
 * be more than the rows loaded (the page knows; the table doesn't), so a page that selects "all
 * that match, except these" passes the server's count less the exceptions.
 */
export function headerCheck(selected: number, total: number): HeaderCheck {
	if (selected <= 0 || total <= 0) return "none";
	return selected >= total ? "all" : "some";
}

/** What a click on the header's checkbox asks for: everything, unless everything is selected already. */
export const selectsAll = (check: HeaderCheck): boolean => check !== "all";

/** The list's order: one column, one way. */
export type TableSort = { id: string; desc: boolean };

/**
 * The order after a click on a column's name. A column that isn't sorting the list starts its
 * own first way (`descFirst` for newest or largest first); the one that is flips. There is no
 * third, unsorted, step: a list always has an order.
 */
export function nextSort(current: TableSort | null, id: string, descFirst = false): TableSort {
	if (current?.id === id) return { id, desc: !current.desc };
	return { id, desc: descFirst };
}

/** `aria-sort` for a column's header: only the column in use says anything. */
export function ariaSort(
	current: TableSort | null,
	id: string,
): "ascending" | "descending" | undefined {
	if (current?.id !== id) return undefined;
	return current.desc ? "descending" : "ascending";
}
