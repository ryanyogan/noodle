/** How long the pane takes to shut. */
const CLOSE_MS = 180;

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
