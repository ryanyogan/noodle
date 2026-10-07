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
	region.dataset.closing = "true";
	region.inert = true;
	const animation = region.animate(
		[
			{ height: `${region.offsetHeight}px`, opacity: 1, overflow: "clip" },
			{ height: "0px", paddingTop: "0px", paddingBottom: "0px", opacity: 0, overflow: "clip" },
		],
		{ duration: 180, easing: "ease-in-out", fill: "forwards" },
	);
	void animation.finished.then(
		() => {
			// Opening another row during the animation must not close that new row afterwards.
			if (region.isConnected) done();
		},
		() => {
			delete region.dataset.closing;
			region.inert = false;
		},
	);
}
