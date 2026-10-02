import { expect, type Page, test } from "@playwright/test";
import { createTestParent } from "./parents";
import { clientRendered, createHousehold, signedInPage } from "./session";

// Guards the 320 px phone (#48): no main page scrolls sideways, and nothing sticks out past the
// right edge, except inside a container that scrolls or clips on purpose (tab strips, wide charts).
const phone = {
	viewport: { width: 320, height: 720 },
	deviceScaleFactor: 2,
	isMobile: true,
	hasTouch: true,
} as const;

const pages = [
	"/month",
	"/transactions",
	"/accounts",
	"/plan",
	"/goals",
	"/reports",
	"/explore",
	"/explore/scenarios",
	"/insights",
	"/review",
	"/review/rules",
	"/household",
	"/insights/perks",
	"/glossary",
	"/ask",
	"/check-in",
];

let parent: Awaited<ReturnType<typeof createTestParent>>;

test.beforeAll(async () => {
	parent = await createTestParent();
});

test.afterAll(async () => {
	await parent?.remove();
});

/** The page's scroll width and the visible elements whose right edge passes the viewport. */
function measure(page: Page) {
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

test("main pages fit a 320 px phone", async ({ browser }) => {
	test.setTimeout(120_000);
	const page = await signedInPage(browser, parent.email, phone);
	await createHousehold(page, "The Rinks", "Alex");
	for (const path of pages) {
		await page.goto(path);
		// Reports and Explore render on the client and can take a while on a busy runner.
		await expect(page.locator("[data-slot=page-header]:visible").first()).toBeVisible(
			clientRendered,
		);
		await page.evaluate(() => document.fonts.ready);
		const found = await measure(page);
		expect.soft(found.sticking, `${path}: elements past the right edge`).toEqual([]);
		expect
			.soft(found.scrollWidth, `${path}: page scrolls sideways`)
			.toBeLessThanOrEqual(found.width);
	}
	await page.context().close();
});
