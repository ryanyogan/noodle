// Household settings → Snapshots (#88, ADR-0035): at rest only the newest snapshot shows; the rest
// wait behind one button that says how many there are. Kept apart from the component so it can be
// tested without a page.

export type SnapshotFold<T> = {
	/** The newest snapshot, always shown. Null when there are none. */
	latest: T | null;
	/** The ones under the button: every other snapshot when open, none when folded. */
	earlier: T[];
	/** What the button says. Null when there is nothing to unfold, and then there is no button. */
	label: string | null;
};

/**
 * `list` is newest first, as the server sends it, and is never reordered: a newest snapshot that
 * can't be restored still comes first.
 */
export function foldSnapshots<T>(list: readonly T[], open: boolean): SnapshotFold<T> {
	const [latest, ...rest] = list;
	if (latest === undefined) return { latest: null, earlier: [], label: null };
	if (rest.length === 0) return { latest, earlier: [], label: null };
	return {
		latest,
		earlier: open ? rest : [],
		label: open ? "Show fewer" : `Show all ${list.length.toLocaleString("en-US")} snapshots`,
	};
}
