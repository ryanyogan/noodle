// Groups of Buckets (issue 98): a group is only a name some Buckets share, so the Plan's list can
// be read in parts ("Home", "Kids") with a subtotal each. It changes no figure.

/** The longest a group's name can be: as long as a Bucket's. */
export const GROUP_NAME_MAX = 40;

/** A group's name as it is kept: trimmed, single-spaced, cut at its longest. Null for no group. */
export function cleanGroupName(name: string | null | undefined): string | null {
	const clean = (name ?? "").trim().replace(/\s+/g, " ").slice(0, GROUP_NAME_MAX).trim();
	return clean === "" ? null : clean;
}

export type BucketGroup<T> = {
	/** Null for the Buckets in no group. */
	name: string | null;
	buckets: T[];
};

/**
 * Buckets (already in the Plan's order) in their groups: first those in no group, under no name,
 * then each group where its first Bucket comes in the Plan's order. Inside a group the Buckets
 * keep the order they had.
 */
export function groupBuckets<T extends { group?: string }>(
	buckets: readonly T[],
): BucketGroup<T>[] {
	const ungrouped: T[] = [];
	const named = new Map<string, T[]>();
	for (const bucket of buckets) {
		if (!bucket.group) ungrouped.push(bucket);
		else named.set(bucket.group, [...(named.get(bucket.group) ?? []), bucket]);
	}
	return [
		...(ungrouped.length > 0 ? [{ name: null, buckets: ungrouped }] : []),
		...[...named].map(([name, inGroup]) => ({ name, buckets: inGroup })),
	];
}

/** The Buckets in the order a grouped list shows them. */
export const inGroupOrder = <T extends { group?: string }>(buckets: readonly T[]): T[] =>
	groupBuckets(buckets).flatMap((group) => group.buckets);

/** The groups' names, in the order they are shown. */
export const groupNames = (buckets: readonly { group?: string }[]): string[] =>
	groupBuckets(buckets).flatMap((group) => group.name ?? []);

/** A group's subtotal. */
export function groupTotals(
	buckets: readonly { allowance: number; spent: number; left: number }[],
): { allowance: number; spent: number; left: number } {
	return buckets.reduce(
		(total, bucket) => ({
			allowance: total.allowance + bucket.allowance,
			spent: total.spent + bucket.spent,
			left: total.left + bucket.left,
		}),
		{ allowance: 0, spent: 0, left: 0 },
	);
}

/** The Buckets `id` is moved among: those of its own group (or of no group), in order. */
export function peersOf(buckets: readonly { id: string; group?: string }[], id: string): string[] {
	const group = groupBuckets(buckets).find((g) => g.buckets.some((b) => b.id === id));
	return group ? group.buckets.map((b) => b.id) : [];
}

/** The whole list with `peers` in their new order, each in a place one of them had. */
export function putInOrder(order: readonly string[], peers: readonly string[]): string[] {
	const moving = new Set(peers);
	let next = 0;
	return order.map((id) => (moving.has(id) ? (peers[next++] ?? id) : id));
}
