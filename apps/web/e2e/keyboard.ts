import type { Page } from "@playwright/test";

/**
 * Stands in for the iPhone's on-screen keyboard: while a text field has focus, the visual viewport
 * is `height` px shorter, as in Mobile Safari, where the keyboard covers the page without resizing
 * the layout viewport. It overrides `window.visualViewport`'s height and offsetTop and fires its
 * `resize` and `scroll` events, which works the same in Chromium and WebKit (neither has a real
 * keyboard in a headless browser). Returns a function that takes the keyboard away for good.
 */
export async function withKeyboard(page: Page, height: number): Promise<() => Promise<void>> {
	await page.evaluate((keyboard) => {
		const viewport = window.visualViewport;
		if (!viewport) throw new Error("No visualViewport in this browser");
		const typed = (el: Element | null) =>
			el instanceof HTMLTextAreaElement ||
			(el instanceof HTMLInputElement &&
				!["checkbox", "radio", "button", "submit", "range", "file", "color"].includes(el.type)) ||
			(el instanceof HTMLElement && el.isContentEditable);
		const fire = () => {
			viewport.dispatchEvent(new Event("resize"));
			viewport.dispatchEvent(new Event("scroll"));
		};
		const show = () => {
			const full = window.innerHeight;
			Object.defineProperty(viewport, "height", { configurable: true, get: () => full - keyboard });
			Object.defineProperty(viewport, "offsetTop", { configurable: true, get: () => 0 });
			fire();
		};
		const hide = () => {
			// Back to the prototype's own getters.
			delete (viewport as { height?: number }).height;
			delete (viewport as { offsetTop?: number }).offsetTop;
			fire();
		};
		const onFocusIn = (event: FocusEvent) => typed(event.target as Element) && show();
		const onFocusOut = (event: FocusEvent) => !typed(event.relatedTarget as Element) && hide();
		document.addEventListener("focusin", onFocusIn);
		document.addEventListener("focusout", onFocusOut);
		if (typed(document.activeElement)) show();
		(window as { __removeKeyboard?: () => void }).__removeKeyboard = () => {
			document.removeEventListener("focusin", onFocusIn);
			document.removeEventListener("focusout", onFocusOut);
			hide();
		};
	}, height);
	return () =>
		page.evaluate(() => (window as { __removeKeyboard?: () => void }).__removeKeyboard?.());
}

/** The bottom of the part of the page the keyboard leaves visible, in CSS px from the top. */
export const visibleBottom = (page: Page) =>
	page.evaluate(() => {
		const viewport = window.visualViewport;
		return viewport ? viewport.offsetTop + viewport.height : window.innerHeight;
	});
