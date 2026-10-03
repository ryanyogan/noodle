import { expect, test } from "@playwright/test";
import { measure } from "./overflow";
import { createTestParent } from "./parents";
import { clientRendered, createPlannedHousehold, signedInPage } from "./session";

// Text at 200% on a phone (the nearest a test gets to iOS's largest Dynamic Type): the main pages
// still fit across, and the Transactions search still reads "Search".

let parent: Awaited<ReturnType<typeof createTestParent>>;

test.beforeAll(async () => {
	parent = await createTestParent();
});

test.afterAll(async () => {
	await parent?.remove();
});

test("the main pages fit a phone with text at 200%", async ({ browser }) => {
	test.setTimeout(120_000);
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, { baseline: "5,000", buckets: [["Groceries", "1,200"]] });
	await page.addInitScript(() => {
		const large = new CSSStyleSheet();
		large.replaceSync(
			"html { font-size: 200% !important; -webkit-text-size-adjust: 200% !important; }",
		);
		document.adoptedStyleSheets = [...document.adoptedStyleSheets, large];
	});
	for (const path of ["/month", "/transactions", "/accounts", "/plan"]) {
		await page.goto(path);
		await expect(page.locator("[data-slot=page-header]:visible").first()).toBeVisible(
			clientRendered,
		);
		await page.evaluate(() => document.fonts.ready);
		// 32 px or more: Chromium's mobile mode applies the text-size-adjust on top.
		expect(
			await page.evaluate(() =>
				Number.parseFloat(getComputedStyle(document.documentElement).fontSize),
			),
		).toBeGreaterThanOrEqual(32);
		const found = await measure(page);
		expect.soft(found.sticking, `${path}: elements past the right edge`).toEqual([]);
		expect.soft(found.scrollWidth, `${path}: page width`).toBeLessThanOrEqual(found.width);
	}

	// The search's placeholder fits its box rather than being cut to "Se".
	await page.goto("/transactions");
	const search = page.getByRole("searchbox", { name: "Search notes and merchants" });
	await expect(search).toBeEnabled(clientRendered);
	const fit = await search.evaluate((input: HTMLInputElement) => {
		const style = getComputedStyle(input);
		const context = document.createElement("canvas").getContext("2d");
		if (!context) return { text: 0, room: 0 };
		context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
		const room =
			input.clientWidth -
			Number.parseFloat(style.paddingLeft) -
			Number.parseFloat(style.paddingRight);
		return {
			text: Math.ceil(context.measureText(input.placeholder).width),
			room: Math.floor(room),
		};
	});
	expect(fit.text).toBeLessThanOrEqual(fit.room);
});
