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
 * While the keyboard is up, `data-keyboard` is on the root (so a sheet can hide what the keyboard
 * makes redundant, like Quick Add's keypad), and the focused field is scrolled into the part of the
 * sheet the keyboard leaves, clear of its sticky footer.
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
			// More than a toolbar's worth covered: the keyboard is up.
			document.documentElement.toggleAttribute("data-keyboard", covered > 80);
			if (covered > 80) keepFocusInView();
		};
		const onFocusIn = () => {
			if (document.documentElement.hasAttribute("data-keyboard")) keepFocusInView();
		};
		update();
		viewport.addEventListener("resize", update);
		viewport.addEventListener("scroll", update);
		document.addEventListener("focusin", onFocusIn);
		return () => {
			viewport.removeEventListener("resize", update);
			viewport.removeEventListener("scroll", update);
			document.removeEventListener("focusin", onFocusIn);
			root.removeProperty("--keyboard-inset");
			root.removeProperty("--visible-height");
			document.documentElement.removeAttribute("data-keyboard");
		};
	}, []);
}

/**
 * Scrolls the sheet so its focused field shows between the sheet's top and its sticky footer.
 * The browser scrolls a field into view as it takes focus, but the keyboard then shrinks the sheet
 * and can leave the field behind the footer or below the sheet.
 */
function keepFocusInView() {
	const field = document.activeElement;
	if (!(field instanceof HTMLElement)) return;
	const sheet = field.closest<HTMLElement>("[data-slot=sheet-content]");
	if (!sheet || field.closest("[data-slot=sheet-footer]")) return;
	const area = sheet.getBoundingClientRect();
	const footer = sheet.querySelector<HTMLElement>("[data-slot=sheet-footer]");
	const footerTop = footer?.offsetParent ? footer.getBoundingClientRect().top : area.bottom;
	const bottom = Math.min(area.bottom, footerTop) - 8;
	const box = field.getBoundingClientRect();
	if (box.bottom > bottom) sheet.scrollTop += box.bottom - bottom;
	else if (box.top < area.top + 8) sheet.scrollTop -= area.top + 8 - box.top;
}

/** Render inside a modal layer's content (mounted only while it's open) to hold the page still. */
export function HoldPage() {
	useHoldPage();
	return null;
}
