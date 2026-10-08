/** How long the pane takes to shut. */
const CLOSE_MS = 180;

/**
 * The Transaction a phone opened from its list, and how far the list was scrolled then. Below lg
 * a Transaction is a page of its own (ADR-0024), started at its top; Back puts the list where it
 * was, with focus on the row.
 */
let fromList: { id: string; y: number } | null = null;

/** A row tapped below lg: its page slides in from the right, and the list's place is kept. */
export function rememberListPlace(id: string) {
	fromList = { id, y: window.scrollY };
}

/** The list has gone (another page): the place kept is no use to the next visit. */
export function forgetListPlace() {
	fromList = null;
}

/**
 * Whether this Transaction's page was opened from the list just now, so it slides in. Never for
 * an address opened on its own, or reached with previous and next: those are simply there.
 */
export function slidesInFromList(id: string | undefined) {
	return id !== undefined && fromList?.id === id;
}

/**
 * Back at the list below lg: where it was scrolled to when a row was tapped, with focus on the
 * row of the Transaction just left (the one stepped to with previous or next, if that was used).
 * Called once the list's rows are drawn again. Nothing to do when the address was opened on its
 * own, or from lg, where the list never left.
 */
export function restoreListPlace(id: string) {
	const place = fromList;
	fromList = null;
	if (!place || window.matchMedia("(min-width: 1024px)").matches) return;
	window.scrollTo(0, place.y);
	const row = document.querySelector<HTMLElement>(
		`[data-transaction="${CSS.escape(id)}"] button:not([role=checkbox]):not([data-cell])`,
	);
	row?.focus({ preventScroll: true });
	// Still where it was unless previous and next went to a row off the screen.
	row?.scrollIntoView({ block: "nearest" });
}

/** The close that is under way, if any: its pane and the animation shutting it. */
let closing: { region: HTMLElement; animation: Animation } | null = null;

/**
 * Stops a close that is still animating, leaving the pane open and usable. True when there was
 * one: a row pressed while its pane is closing opens again, and another row opened meanwhile is
 * not closed by the first one's ending.
 */
export function cancelTransactionClose() {
	if (!closing) return false;
	closing.animation.cancel();
	return true;
}

/** Only this page's inline editor moves; reduced-motion and phone layouts stay immediate. */
export function animateTransactionClose(done: () => void) {
	const region = document.querySelector<HTMLElement>('[data-slot="transaction-detail"]');
	if (
		!region ||
		!window.matchMedia("(min-width: 1024px) and (prefers-reduced-motion: no-preference)").matches
	) {
		done();
		return;
	}
	if (region.dataset.closing) return;
	// The address being closed: the close is only finished while the page is still at it.
	const from = window.location.pathname;
	region.dataset.closing = "true";
	region.inert = true;
	const animation = region.animate(
		[
			{ height: `${region.offsetHeight}px`, opacity: 1, overflow: "clip" },
			{ height: "0px", paddingTop: "0px", paddingBottom: "0px", opacity: 0, overflow: "clip" },
		],
		{ duration: CLOSE_MS, easing: "ease-in-out", fill: "forwards" },
	);
	const mine = { region, animation };
	closing = mine;
	const restore = () => {
		if (closing === mine) closing = null;
		delete region.dataset.closing;
		region.inert = false;
	};
	let settled = false;
	const finish = () => {
		if (settled) return;
		settled = true;
		clearTimeout(late);
		if (closing === mine) closing = null;
		// Somewhere else by now (another row, another page): that is not this close's to undo.
		// Still here, the pane closes even when its row has gone (a deleted Transaction's pane
		// is taken out of the page before the animation ends, and must not come back with Undo).
		if (window.location.pathname === from) done();
		else if (region.isConnected) {
			animation.cancel();
			restore();
		}
	};
	// A pane taken out of the page mid-close (its row left the list: a filter, a change from the
	// other Parent) may never be told its animation ended. The close still finishes, a moment
	// after it would have, so the address is never left on a Transaction that isn't shown.
	const late = setTimeout(finish, CLOSE_MS + 120);
	void animation.finished.then(
		finish,
		// Cancelled: the pane is open again.
		() => {
			settled = true;
			clearTimeout(late);
			restore();
		},
	);
}
