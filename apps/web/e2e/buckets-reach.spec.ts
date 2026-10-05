import { type Browser, expect, type Page, test } from "@playwright/test";
import { createTestParent } from "./parents";
import { createPlannedHousehold, savedBy, signedInPage } from "./session";

// Finding and changing Buckets (#98): This Month's Buckets heading leads to the list where they
// are added, changed, moved and archived; a Bucket moves without dragging from its sheet; and a
// Bucket's own page says "Edit Bucket".

let parent: Awaited<ReturnType<typeof createTestParent>>;

test.beforeEach(async () => {
	parent = await createTestParent();
});

test.afterEach(async () => {
	await parent?.remove();
});

const names = (page: Page) =>
	page
		.locator("[data-bucket-row]")
		.evaluateAll((rows) => rows.map((row) => row.querySelector("a")?.textContent ?? ""));

async function reachAndEdit(page: Page) {
	await createPlannedHousehold(page, {
		baseline: "9,000",
		buckets: [
			["Groceries", "800"],
			["Gas", "200"],
			["Fun", "100"],
		],
	});

	// One tap from This Month, on the Buckets heading.
	await page.getByRole("link", { name: "Edit Buckets", exact: true }).click();
	await expect(page).toHaveURL(/\/plan\/\d{4}-\d{2}\/buckets$/);
	await expect(page.getByRole("button", { name: "Add Buckets", exact: true })).toBeEnabled();
	// Adding is at the top and under the list, and the list says how a Bucket is changed.
	await expect(page.getByRole("button", { name: "Add another Bucket" })).toBeVisible();
	await expect(page.locator("[data-slot=bucket-how]")).toContainText("To change a Bucket");
	await expect.poll(() => names(page)).toEqual(["Groceries", "Gas", "Fun"]);

	// Its amount, right in the list.
	await page.getByRole("button", { name: "Change Gas: $200" }).click();
	const form = page.getByRole("form", { name: "Change Gas" });
	await form.getByRole("textbox", { name: "Allowance" }).fill("250");
	await expect(form.getByRole("radio", { name: /^From .* on$/ })).toBeChecked();
	const allowanceSaved = savedBy(page, "setAllowance");
	await form.getByRole("button", { name: "Save", exact: true }).click();
	await allowanceSaved;
	await expect(page.getByRole("button", { name: "Change Gas: $250" })).toBeVisible();

	// Moved from its sheet, with no dragging.
	await page.getByRole("button", { name: "Edit Gas", exact: true }).click();
	const sheet = page.getByRole("dialog", { name: "Gas" });
	await expect(sheet).toContainText("2 of 3 in the list");
	const moved = savedBy(page, "reorderBuckets");
	await sheet.getByRole("button", { name: "Move up" }).click();
	await moved;
	await expect(sheet).toContainText("1 of 3 in the list");
	await expect(sheet.getByRole("button", { name: "Move up" })).toBeDisabled();
	await expect(sheet.getByRole("button", { name: "Move down" })).toBeEnabled();
	await sheet.getByRole("button", { name: "Cancel", exact: true }).click();
	await expect(sheet).toBeHidden();
	await expect.poll(() => names(page)).toEqual(["Gas", "Groceries", "Fun"]);

	// A Bucket's own page opens the same sheet from "Edit Bucket".
	await page
		.locator("[data-bucket-row]")
		.first()
		.getByRole("link", { name: "Gas", exact: true })
		.click();
	await expect(page.locator("[data-slot=detail-header]")).toContainText("Gas");
	await page.getByRole("button", { name: "Edit Bucket", exact: true }).click();
	await expect(sheet.getByRole("button", { name: "Move down" })).toBeEnabled();
	await expect(sheet.getByRole("button", { name: "Archive", exact: true })).toBeVisible();
}

async function open(browser: Browser, phone: boolean) {
	return signedInPage(
		browser,
		parent.email,
		phone ? { viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true } : undefined,
	);
}

test("Buckets are one tap from This Month, changed in the list and moved from the sheet", async ({
	browser,
}) => {
	test.setTimeout(120_000);
	const page = await open(browser, false);
	await reachAndEdit(page);
	await page.context().close();
});

test("Buckets are reached and changed on a phone", { tag: "@phone" }, async ({ browser }) => {
	test.setTimeout(120_000);
	const page = await open(browser, true);
	await reachAndEdit(page);
	const width = await page.evaluate(() => document.documentElement.scrollWidth);
	expect(width).toBeLessThanOrEqual(393);
	await page.context().close();
});
