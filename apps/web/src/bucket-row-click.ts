/** A control inside a Bucket's row that does something of its own when chosen. */
const OWN_CONTROL = "a, button, input, select, textarea, label";

/**
 * Whether a press or click in a Bucket's row is for opening its sheet (#98): it landed in the row
 * itself, not in the sheet (a portal, whose events React bubbles to the row too), and not on a
 * control with a job of its own: the name's link to the Bucket's page, the handle that moves it,
 * the pencil (which opens the sheet itself) or a retry.
 */
export function opensBucketSheet(target: EventTarget | null, row: Pick<Node, "contains">) {
	if (target === null || !("closest" in target)) return false;
	const element = target as Element;
	return row.contains(element) && element.closest(OWN_CONTROL) === null;
}
