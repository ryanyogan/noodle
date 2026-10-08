import { expect, test } from "@playwright/test";
import { measure } from "./overflow";
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
	"/reports?view=cash-flow",
	"/explore",
	"/explore/scenarios",
	"/explore/afford",
	"/explore/afford?kind=car",
	"/explore/afford?kind=anything",
	"/insights",
	"/review",
	"/review/rules",
	"/household",
	"/household/logs",
	"/household/changelog",
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
