import AxeBuilder from "@axe-core/playwright";
import { type Browser, expect, type Page, test } from "@playwright/test";
import { createTestParent } from "./parents";
import { clientRendered, createHousehold, signedInPage } from "./session";

// Guards the 393 px phone (#48): tap targets meet WCAG 2.5.8 (24 × 24, hard fail) and axe finds no
// violations in light or dark. Targets under 44 × 44 are listed as annotations, not failures.
const phone = {
	viewport: { width: 393, height: 852 },
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
let household = false;

test.beforeAll(async () => {
	parent = await createTestParent();
});

test.afterAll(async () => {
	await parent?.remove();
});

/** Signs in as the phone and creates the Household once for the whole file. */
async function phonePage(browser: Browser) {
	const page = await signedInPage(browser, parent.email, phone);
	if (!household) await createHousehold(page, "The Rinks", "Alex");
	household = true;
	return page;
}

async function open(page: Page, path: string) {
	// In WebKit the last page's client redirect (/transactions to /transactions/<month>) can land
	// after its header shows, cutting this navigation short: go again once it has.
	await page.goto(path).catch((error: Error) => {
		if (!error.message.includes("interrupted by another navigation")) throw error;
		return page.goto(path);
	});
	await expect(page.locator("[data-slot=page-header]:visible").first(), path).toBeVisible(
		clientRendered,
	);
	await page.evaluate(() => document.fonts.ready);
}

/**
 * Every visible interactive element's hit area: its box joined with an absolutely placed `::after`
 * (the phone hit-area pattern from phase 3). Links inside running text are left out (WCAG's inline
 * exception), as are elements hidden from everyone.
 */
function targets(page: Page) {
	return page.evaluate(() => {
		const selector =
			"a[href],button,input:not([type=hidden]),select,textarea,summary,[role=button],[role=tab],[role=checkbox],[role=switch],[role=radio],[role=combobox],[role=menuitem],[role=option],[role=slider]";
		const hidden = (el: Element) =>
			el.closest("[aria-hidden=true],[inert],.sr-only") !== null ||
			getComputedStyle(el).visibility === "hidden";
		const inline = (el: Element) => {
			if (el.tagName !== "A") return false;
			const block = el.parentElement?.closest("p,li,dd,td");
			return (
				block !== null &&
				block !== undefined &&
				(block.textContent ?? "").trim() !== (el.textContent ?? "").trim()
			);
		};
		const out: { name: string; width: number; height: number }[] = [];
		for (const el of document.querySelectorAll(selector)) {
			const box = el.getBoundingClientRect();
			if (box.width <= 1 || box.height <= 1 || hidden(el) || inline(el)) continue;
			let { left, right, top, bottom } = box;
			const after = getComputedStyle(el, "::after");
			if (after.content !== "none" && after.position === "absolute") {
				const px = (v: string) => (v.endsWith("px") ? Number.parseFloat(v) : 0);
				left = Math.min(left, box.left + px(after.left));
				right = Math.max(right, box.right - px(after.right));
				top = Math.min(top, box.top + px(after.top));
				bottom = Math.max(bottom, box.bottom - px(after.bottom));
			}
			const label =
				el.getAttribute("aria-label") ??
				(el.textContent ?? "").trim() ??
				el.getAttribute("placeholder");
			out.push({
				name: `${el.getAttribute("data-slot") ?? el.tagName.toLowerCase()} "${(label || el.id).slice(0, 30)}"`,
				width: Math.round(right - left),
				height: Math.round(bottom - top),
			});
		}
		return out;
	});
}

test("tap targets on a 393 px phone are at least 24 × 24", async ({ browser }) => {
	test.setTimeout(120_000);
	const page = await phonePage(browser);
	const small: string[] = [];
	for (const path of pages) {
		await open(page, path);
		const found = await targets(page);
		expect(found.length, `${path}: no targets found`).toBeGreaterThan(0);
		test.info().annotations.push({ type: "targets", description: `${path} ${found.length}` });
		const tiny = found.filter((t) => t.width < 24 || t.height < 24);
		expect
			.soft(
				tiny.map((t) => `${t.name} ${t.width}×${t.height}`),
				`${path}: targets under 24 × 24`,
			)
			.toEqual([]);
		for (const t of found) {
			if (t.width < 44 || t.height < 44) small.push(`${path} ${t.name} ${t.width}×${t.height}`);
		}
	}
	for (const description of new Set(small))
		test.info().annotations.push({ type: "under 44 × 44", description });
	await page.context().close();
});

test("axe finds no violations on a 393 px phone, light and dark", async ({ browser }) => {
	test.setTimeout(240_000);
	const page = await phonePage(browser);
	for (const colorScheme of ["light", "dark"] as const) {
		await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
		for (const path of pages) {
			await open(page, path);
			const { violations } = await new AxeBuilder({ page })
				.withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
				.analyze();
			expect
				.soft(
					violations.map(
						(v) =>
							`${v.id}: ${v.nodes
								.map((n) => n.target.join(" "))
								.slice(0, 4)
								.join(", ")}`,
					),
					`${colorScheme} ${path}: axe violations`,
				)
				.toEqual([]);
		}
	}
	await page.context().close();
});
