import { expect, test } from "@playwright/test";
import { createTestParent } from "./parents";
import { installed, looks, notch } from "./phone";
import { clientRendered, createPlannedHousehold, signedInPage, switchTo } from "./session";

// The installed app on an iPhone with a notch: the tab bar sits above the home indicator, the page
// and its sticky headers start below the status bar, the page doesn't rubber-band under the fixed
// bars, and Back closes Quick Add but asks before throwing away what was typed in another sheet
// (#52 row 144).

let parent: Awaited<ReturnType<typeof createTestParent>>;

test.beforeEach(async () => {
	parent = await createTestParent();
});

test.afterEach(async () => {
	await parent?.remove();
});

for (const look of looks) {
	test(`the installed app keeps clear of the notch and the home indicator${look.name}`, async ({
		browser,
	}) => {
		const page = await signedInPage(browser, parent.email, look.options);
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
		await switchTo(page, "Month");
		await installed(page);
		await expect(page.locator("[data-slot=page-header]:visible").first()).toBeVisible(
			clientRendered,
		);
		expect(
			await page.evaluate(() => [
				window.matchMedia("(display-mode: standalone)").matches,
				(navigator as { standalone?: boolean }).standalone,
			]),
		).toEqual([true, true]);
		if (look.options.colorScheme) {
			expect(
				await page.evaluate(() => window.matchMedia("(prefers-color-scheme: dark)").matches),
			).toBe(true);
		}

		// The tab bar's buttons end above the home indicator; the bar's background runs under it.
		const height = page.viewportSize()?.height ?? 0;
		const tabBar = page.getByRole("navigation", { name: "Main" });
		const bar = await tabBar.boundingBox();
		expect(Math.round((bar?.y ?? 0) + (bar?.height ?? 0))).toBe(height);
		for (const link of await tabBar.getByRole("link").all()) {
			const box = await link.boundingBox();
			expect(Math.ceil((box?.y ?? 0) + (box?.height ?? 0))).toBeLessThanOrEqual(
				height - notch.bottom,
			);
		}

		// The page starts below the status bar.
		const title = await page.getByRole("heading", { level: 1 }).boundingBox();
		expect(title?.y ?? 0).toBeGreaterThanOrEqual(notch.top);

		// Fixed bars: the page doesn't rubber-band under them.
		expect(await tabBar.evaluate((el) => getComputedStyle(el).position)).toBe("fixed");
		expect(
			await page.evaluate(() => [
				getComputedStyle(document.documentElement).overscrollBehaviorY,
				getComputedStyle(document.body).overscrollBehaviorY,
			]),
		).toEqual(["none", "none"]);

		// A sticky header (the Buckets toolbar) sticks below the status bar, not under it.
		await switchTo(page, "Plan");
		await page
			.getByRole("region", { name: "From take-home pay to Free to Spend" })
			.getByRole("link", { name: "Buckets", exact: true })
			.click();
		const sticky = page.locator("main .sticky").first();
		await expect(sticky).toBeVisible();
		await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
		const box = await sticky.boundingBox();
		expect(Math.round(box?.y ?? 0)).toBeGreaterThanOrEqual(notch.top);
	});

	test(`Back closes Quick Add${look.name}`, async ({ browser }) => {
		const page = await signedInPage(browser, parent.email, look.options);
		await createPlannedHousehold(page, { baseline: "5,000", buckets: [["Groceries", "1,200"]] });
		await switchTo(page, "Month");
		await installed(page);

		// Quick Add is in the URL (?sheet=), so Back closes just it.
		await switchTo(page, "Month");
		const month = page.url();
		await page
			.getByRole("navigation", { name: "Main" })
			.getByRole("link", { name: "Quick Add" })
			.click();
		const quickAdd = page.getByRole("dialog", { name: "Quick Add" });
		await expect(quickAdd).toBeVisible();
		await page.goBack();
		await expect(quickAdd).toBeHidden();
		expect(page.url()).toBe(month);
	});
}

// #52 row 144: Back in another sheet with something typed asks first. It does on a desktop
// (sheet-leave.spec.ts) but not here on a phone: Back leaves without asking. For phase d of #66.
test.fixme("Back asks first in a sheet with something typed, on a phone", async ({ browser }) => {
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, { baseline: "5,000", buckets: [["Groceries", "1,200"]] });
	await installed(page);
	// Into Accounts by a link, so Back stays in the app (a fresh page load would leave it).
	await page.goto("/goals");
	await page.getByRole("link", { name: "Go to Accounts" }).click(clientRendered);
	await expect(page.getByRole("heading", { level: 1 })).toHaveText("Accounts", clientRendered);
	await page.getByLabel("Name").fill("Everyday Checking");
	await page.getByRole("button", { name: "Add Account" }).click();
	await expect(page.getByRole("link", { name: /^Everyday Checking, / })).toBeVisible();
	const accounts = page.url();
	await page.getByRole("button", { name: "Add Account" }).click();
	const sheet = page.getByRole("dialog", { name: "Add an Account" });
	await sheet.getByLabel("Name").fill("Ally savings");
	await page.goBack();
	const ask = page.getByRole("alertdialog", { name: "Leave without saving?" });
	await expect(ask).toBeVisible();
	await ask.getByRole("button", { name: "Stay" }).click();
	await expect(sheet.getByLabel("Name")).toHaveValue("Ally savings");
	expect(page.url()).toBe(accounts);
});
