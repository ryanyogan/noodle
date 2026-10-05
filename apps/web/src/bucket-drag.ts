/**
 * The sums behind dragging a Bucket to a new place in the list (issue 106). The rows are measured
 * once, when the press begins, and stay where they are in the page for the whole drag: they are
 * only shifted on screen, and the list is put in its new order once, at the drop.
 */

/** Where a row was when the press began: its top edge and height, in px. */
export type RowBox = { top: number; height: number };

/** How far a mouse must travel, in px, before a press on the handle becomes a drag. */
export const MOUSE_SLOP = 4;

/**
 * Whether a press on the handle has become a drag. A finger or pen lifts the row at once: the
 * handle can't scroll the page, so there is nothing else the press could mean, and the row rising
 * under the thumb is what says the drag has begun. A mouse needs a few px first, so a plain click
 * on the handle (to focus it for the arrow keys) doesn't lift anything.
 */
export function dragBegins(pointerType: string, dx: number, dy: number): boolean {
	if (pointerType !== "mouse") return true;
	return Math.hypot(dx, dy) >= MOUSE_SLOP;
}

/** The space between two rows, from the first two. */
function gapOf(rows: RowBox[]): number {
	const [first, second] = rows;
	return first && second ? Math.max(0, second.top - first.top - first.height) : 0;
}

/** `dy` kept so the dragged row stays between the top of the first row and the bottom of the last. */
export function clampDrag(rows: RowBox[], from: number, dy: number): number {
	const row = rows[from];
	const first = rows[0];
	const last = rows[rows.length - 1];
	if (!row || !first || !last) return 0;
	const up = first.top - row.top;
	const down = last.top + last.height - (row.top + row.height);
	return Math.max(up, Math.min(down, dy));
}

/**
 * The place the row at `from` would take if dropped after being carried `dy` px (negative is up).
 * It passes a row below once its bottom edge is over that row's middle, and a row above once its
 * top edge is: half a row's travel moves it one place.
 */
export function indexAt(rows: RowBox[], from: number, dy: number): number {
	const row = rows[from];
	if (!row) return from;
	const top = row.top + dy;
	const bottom = top + row.height;
	let to = from;
	rows.forEach((other, index) => {
		const middle = other.top + other.height / 2;
		if (index > from && bottom > middle) to += 1;
		if (index < from && top < middle) to -= 1;
	});
	return to;
}

/**
 * How far each row is shifted on screen, in px: the dragged row by `dy`, and every row it has
 * passed by the dragged row's height (and the gap), to make room where it would land.
 */
export function shifts(rows: RowBox[], from: number, to: number, dy: number): number[] {
	const stride = (rows[from]?.height ?? 0) + gapOf(rows);
	return rows.map((_, index) => {
		if (index === from) return dy;
		if (index > from && index <= to) return -stride;
		if (index < from && index >= to) return stride;
		return 0;
	});
}

/**
 * How far to scroll this frame, in px, while a row is held near the top or bottom of what can be
 * seen: faster the nearer the edge, nothing in between.
 */
export function edgeScroll(
	y: number,
	top: number,
	bottom: number,
	zone = 56,
	fastest = 14,
): number {
	if (bottom - top < zone * 3) return 0;
	if (y < top + zone) return -Math.ceil((Math.min(zone, top + zone - y) / zone) * fastest);
	if (y > bottom - zone) return Math.ceil((Math.min(zone, y - (bottom - zone)) / zone) * fastest);
	return 0;
}

/** `order` with `id` moved to index `to`. */
export function moved(order: string[], id: string, to: number): string[] {
	const next = order.filter((other) => other !== id);
	next.splice(to, 0, id);
	return next;
}
