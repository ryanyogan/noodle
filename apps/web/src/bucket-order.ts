/**
 * `order` with `id` one place earlier (`by` -1) or later (+1), for the Bucket sheet's Move up and
 * Move down. The same list comes back when it is already first or last, or isn't in the list.
 */
export function nudged(order: string[], id: string, by: -1 | 1): string[] {
	const from = order.indexOf(id);
	const to = from + by;
	if (from < 0 || to < 0 || to >= order.length) return order;
	const next = order.filter((other) => other !== id);
	next.splice(to, 0, id);
	return next;
}

/** Where a Bucket is in the list, in words: "2 of 8". Empty when it isn't in the list. */
export function placeOf(order: string[], id: string): string {
	const index = order.indexOf(id);
	return index < 0 ? "" : `${index + 1} of ${order.length}`;
}
