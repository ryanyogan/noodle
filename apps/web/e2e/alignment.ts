import type { Page } from "@playwright/test";

/**
 * Column alignment on a desktop page (#73). In each SplitLayout, the first block of the main
 * column and the first block of the rail (a section's heading, a card, a tab strip) start on one
 * top edge, and every card that is a block of a column starts at that column's left edge.
 *
 * A "block" is found by walking down from the column through plain wrappers (no border, no
 * background) to the first thing that draws: a card, a heading row, a tab strip, or text.
 * Returns one line per misalignment, so `expect(...).toEqual([])` prints what is off and by how much.
 */
export function misaligned(page: Page) {
	return page.evaluate(() => {
		const visible = (el: Element) => {
			const box = el.getBoundingClientRect();
			const style = getComputedStyle(el);
			return box.height > 0 && box.width > 0 && style.visibility !== "hidden";
		};
		const draws = (el: Element) => {
			if (
				el.matches(
					"[data-slot=card],[data-slot=section-header],[data-slot=link-tabs],[data-slot=tabs-list],[role=tablist],h1,h2,h3,p,table,img,svg,canvas,button,a,input,select",
				)
			)
				return true;
			const style = getComputedStyle(el);
			if (parseFloat(style.borderTopWidth) > 0) return true;
			if (style.backgroundColor !== "rgba(0, 0, 0, 0)" && style.backgroundColor !== "transparent")
				return true;
			return [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim());
		};
		const firstBlock = (column: Element) => {
			let el: Element = column;
			for (let depth = 0; depth < 8; depth++) {
				const child = [...el.children].find(visible);
				if (!child) return el;
				if (draws(child)) return child;
				el = child;
			}
			return el;
		};
		const name = (el: Element) =>
			`${el.getAttribute("data-slot") ?? el.tagName.toLowerCase()} "${(el.textContent ?? "").trim().slice(0, 24)}"`;
		return [...document.querySelectorAll("[data-slot=split-layout]")].flatMap((split) => {
			const columns = ["split-main", "split-rail"]
				.map((slot) => split.querySelector(`:scope > [data-slot=${slot}]`))
				.filter((c): c is Element => !!c && visible(c));
			const off: string[] = [];
			const blocks = columns.map(firstBlock);
			const [main, rail] = blocks;
			if (main && rail) {
				const a = main.getBoundingClientRect().top;
				const b = rail.getBoundingClientRect().top;
				if (Math.abs(a - b) > 1)
					off.push(
						`tops: ${name(main)} at ${a}, ${name(rail)} at ${b} (Δ${Math.round(Math.abs(a - b))})`,
					);
			}
			for (const column of columns) {
				const left = column.getBoundingClientRect().left;
				// Cards that are blocks of this column: its own children, or one level into a section.
				const cards = [
					...column.querySelectorAll(":scope > [data-slot=card], :scope > * > [data-slot=card]"),
				]
					.filter(visible)
					.filter(
						(card) =>
							card.parentElement === column ||
							!card.parentElement?.matches("[class*=grid-cols],[class*=flex]"),
					);
				for (const card of cards) {
					const x = card.getBoundingClientRect().left;
					if (Math.abs(x - left) > 1) off.push(`left: ${name(card)} at ${x}, column at ${left}`);
				}
			}
			return off;
		});
	});
}
