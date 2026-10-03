import type { Page } from "@playwright/test";

/** The page's scroll width and the visible elements whose right edge passes the viewport. */
export function measure(page: Page) {
	return page.evaluate(() => {
		const width = window.innerWidth;
		const clipped = (el: Element) => {
			for (let e = el.parentElement; e && e !== document.body; e = e.parentElement) {
				const x = getComputedStyle(e).overflowX;
				if (x === "auto" || x === "scroll" || x === "hidden" || x === "clip") return true;
			}
			return false;
		};
		const sticking = [...document.querySelectorAll("body *")]
			.filter((el) => {
				const box = el.getBoundingClientRect();
				if (box.width <= 1 || box.height <= 1 || box.right <= width + 1) return false;
				if (getComputedStyle(el).visibility === "hidden") return false;
				return !el.closest("[aria-hidden=true],[inert]") && !clipped(el);
			})
			.slice(0, 5)
			.map((el) => {
				const slot = el.getAttribute("data-slot") ?? el.tagName.toLowerCase();
				return `${slot} "${(el.textContent ?? "").trim().slice(0, 40)}" right ${Math.round(el.getBoundingClientRect().right)}`;
			});
		return { scrollWidth: document.documentElement.scrollWidth, width, sticking };
	});
}
