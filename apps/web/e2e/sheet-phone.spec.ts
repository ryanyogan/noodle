import { expect, test } from "@playwright/test";
import { createTestParent } from "./parents";
import { createPlannedHousehold, signedInPage, switchTo } from "./session";

// Sheets on a phone (packages/ui's Sheet): the page underneath stays where it was while one is
// open and after it closes, the primary action shows without scrolling, and Esc closes it. Quick
// Add keeps what was typed if it closes without adding.

let parent: Awaited<ReturnType<typeof createTestParent>>;

test.beforeEach(async () => {
	parent = await createTestParent();
});

test.afterEach(async () => {
	await parent?.remove();
});

const pageScroll = (page: import("@playwright/test").Page) => page.evaluate(() => window.scrollY);

test("a sheet on a phone keeps the page's place and its Save in view", async ({ browser }) => {
	const page = await signedInPage(browser, parent.email);
	await page.setViewportSize({ width: 393, height: 852 });
	await createPlannedHousehold(page, {
		baseline: "5,000",
		buckets: [
			["Groceries", "1,200"],
			["Dining out", "300"],
			["Gas", "200"],
			["Kids", "250"],
			["Fun money", "150"],
			["Gifts", "100"],
		],
	});
	await switchTo(page, "Plan");
	await page
		.getByRole("region", { name: "From take-home pay to Free to Spend" })
		.getByRole("link", { name: "Buckets", exact: true })
		.click();

	// Short enough that the Buckets page scrolls; the page's place is taken as the tap lands.
	await page.setViewportSize({ width: 393, height: 600 });
	await page.evaluate(() => {
		window.scrollTo(0, document.documentElement.scrollHeight);
		document.addEventListener(
			"pointerdown",
			() => document.documentElement.setAttribute("data-tapped-at", String(window.scrollY)),
			{ capture: true, once: true },
		);
	});
	await page.getByRole("button", { name: "Edit Gifts" }).click();
	const before = Number(await page.locator("html").getAttribute("data-tapped-at"));
	expect(before).toBeGreaterThan(0);

	const sheet = page.getByRole("dialog", { name: "Gifts" });
	await expect(sheet.getByRole("button", { name: "Save" })).toBeInViewport({ ratio: 1 });

	await page.keyboard.press("Escape");
	await expect(sheet).toBeHidden();
	await expect.poll(() => pageScroll(page)).toBe(before);
});

test("Quick Add on a phone keeps its keypad in view and its amount when it closes", async ({
	browser,
}) => {
	const page = await signedInPage(browser, parent.email);
	await page.setViewportSize({ width: 393, height: 852 });
	await createPlannedHousehold(page, { baseline: "5,000", buckets: [["Groceries", "1,200"]] });
	await switchTo(page, "Month");

	const before = await page.evaluate(() => {
		window.scrollTo(0, 200);
		return window.scrollY;
	});
	await page.getByRole("link", { name: "Quick Add" }).first().click();
	const sheet = page.getByRole("dialog", { name: "Quick Add" });
	const keypad = sheet.getByRole("group", { name: "Keypad" });
	await expect(keypad.getByRole("button", { name: "Delete" })).toBeInViewport({ ratio: 1 });
	await keypad.getByRole("button", { name: "4", exact: true }).click();
	await keypad.getByRole("button", { name: "2", exact: true }).click();
	await expect(sheet.locator("output")).toHaveText("$42");

	await page.keyboard.press("Escape");
	await expect(sheet).toBeHidden();
	await expect.poll(() => pageScroll(page)).toBe(before);

	await page.getByRole("link", { name: "Quick Add" }).first().click();
	await expect(sheet.locator("output")).toHaveText("$42");
});
