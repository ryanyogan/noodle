/** The handle that moves a Bucket in the list. */
const HANDLE = "[data-reorder]";
/** What opens the Bucket sheet: the pencil, and the allowance in its column. */
const SHEET = "[data-bucket-edit], [data-bucket-amount]";
/** Any other control in a row, with a job of its own. */
const OWN_CONTROL = "button, input, select, textarea, label";
const ROW = "[data-bucket-row]";

/** What a click in the Buckets table does. */
export type BucketClick = "panel" | "sheet" | "nothing";

/** Whether a press began on a Bucket's handle: whatever follows is a move, never an opening. */
export function beginsOnHandle(target: EventTarget | null): boolean {
	if (target === null || !("closest" in target)) return false;
	return (target as Element).closest(HANDLE) !== null;
}

/**
 * What a click in the Buckets table is for (issue 107). A row opens the Bucket's own page, in the
 * panel beside the list: its name, its figures, the space between them. Its pencil and its
 * allowance open the one Bucket sheet instead. Nothing opens for a click that ends a press begun on
 * the handle (a drag's last click lands on the row), for another control, or for a click in the
 * sheet, which is not inside the list on the page although React hands its events to the list.
 */
export function bucketClick(
	target: EventTarget | null,
	list: Pick<Node, "contains">,
	beganOnHandle: boolean,
): BucketClick {
	if (target === null || !("closest" in target)) return "nothing";
	const element = target as Element;
	if (beganOnHandle || !list.contains(element)) return "nothing";
	if (element.closest(SHEET) !== null) return "sheet";
	if (element.closest(OWN_CONTROL) !== null) return "nothing";
	return element.closest(ROW) !== null ? "panel" : "nothing";
}
