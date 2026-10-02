import * as React from "react";

/** How many modal layers hold the page still, and where the page was when the first one opened. */
let holds = 0;
let heldAt = 0;

/**
 * Holds the page still under a modal layer while it's mounted, and puts it back exactly where it
 * was afterwards. Hiding the body's overflow alone (Radix's scroll lock) let the page jump to the
 * top, and stay there after closing: pinning the body at its offset keeps the place.
 */
function useHoldPage() {
	// An insertion effect, so it runs before Radix's own scroll lock (inside the same content)
	// styles the body, which is what moved the page.
	React.useInsertionEffect(() => {
		if (holds++ === 0) {
			heldAt = window.scrollY;
			Object.assign(document.body.style, {
				position: "fixed",
				top: `-${heldAt}px`,
				insetInline: "0",
			});
			// Where the root contains fixed boxes, the body scrolls with it: start that from the top.
			window.scrollTo({ top: 0, behavior: "instant" });
		}
		return () => {
			if (--holds > 0) return;
			Object.assign(document.body.style, { position: "", top: "", insetInline: "" });
			window.scrollTo({ top: heldAt, behavior: "instant" });
		};
	}, []);
}

/**
 * While a sheet is open on a phone, keeps `--keyboard-inset` (how much of the layout viewport the
 * on-screen keyboard covers) and `--visible-height` on the root, so the sheet sits above the
 * keyboard rather than behind it (iOS Safari doesn't resize the layout viewport for it).
 */
export function useKeyboardInset() {
	React.useEffect(() => {
		const viewport = window.visualViewport;
		if (!viewport) return;
		const root = document.documentElement.style;
		const update = () => {
			const covered = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
			root.setProperty("--keyboard-inset", `${Math.round(covered)}px`);
			root.setProperty("--visible-height", `${Math.round(viewport.height)}px`);
		};
		update();
		viewport.addEventListener("resize", update);
		viewport.addEventListener("scroll", update);
		return () => {
			viewport.removeEventListener("resize", update);
			viewport.removeEventListener("scroll", update);
			root.removeProperty("--keyboard-inset");
			root.removeProperty("--visible-height");
		};
	}, []);
}

/** Render inside a modal layer's content (mounted only while it's open) to hold the page still. */
export function HoldPage() {
	useHoldPage();
	return null;
}
