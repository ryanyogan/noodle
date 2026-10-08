import { expect, test } from "@playwright/test";
import { createTestParent } from "./parents";
import { createPlannedHousehold, signedInPage } from "./session";

// A list that opens from a field inside a sheet scrolls with the wheel. The sheet holds the page
// still, and that took the wheel from the list too, since the list is drawn outside the sheet's
// own element: a long list of Buckets could only be reached with the arrow keys.

let parent: Awaited<ReturnType<typeof createTestParent>>;

test.beforeEach(async () => {
	parent = await createTestParent();
});

test.afterEach(async () => {
	await parent?.remove();
});

test("a long list of Buckets in a sheet scrolls with the wheel", async ({ browser }) => {
	test.slow();
	const page = await signedInPage(browser, parent.email);
	const names =
		"Groceries,Eating out,Fuel,Hockey,Fun,Life,Clothes,Pets,Gifts,Travel,Health,Home,School,Garden";
	await createPlannedHousehold(page, {
		baseline: "9,000",
		buckets: names.split(",").map((name) => [name, "100"] as [string, string]),
	});
	await page.goto("/review/rules");
	const sheet = page.getByRole("dialog", { name: "Add a Rule" });
	// Pressed again until it opens: before the page is live a press does nothing.
	await expect(async () => {
		if (!(await sheet.isVisible()))
			await page.getByRole("button", { name: "Add Rule" }).first().click({ timeout: 2_000 });
		await expect(sheet).toBeVisible({ timeout: 3_000 });
	}).toPass({ timeout: 40_000 });
	await sheet.getByRole("combobox", { name: "Files to" }).click();
	const list = page.locator("[data-slot=command-list]");
	await expect(list).toBeVisible();
	// Longer than its window, or there is nothing to scroll.
	expect(await list.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
	const box = await list.boundingBox();
	await page.mouse.move((box?.x ?? 0) + 40, (box?.y ?? 0) + 60);
	await page.mouse.wheel(0, 200);
	await expect.poll(() => list.evaluate((el) => el.scrollTop)).toBeGreaterThan(100);
	await expect(page.getByRole("option", { name: "Garden" })).toBeVisible();
});
