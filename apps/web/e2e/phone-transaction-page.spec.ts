import { expect, type Page, test } from "@playwright/test";
import { createTestParent } from "./parents";
import { createPlannedHousehold, hydrated, pickQuickAddBucket, signedInPage } from "./session";

// A Transaction tapped in its list on a phone is a page of its own, not a sheet (ADR-0024,
// 2026-10-08): the sheet had no room for it and no Owed back. The page has Back, everything the
// editor has and "Someone's paying part of this back"; Back returns to the list where it was.
// Runs on the phone projects, so the browser and screen come from the project.

let parent: Awaited<ReturnType<typeof createTestParent>>;

test.beforeEach(async () => {
	parent = await createTestParent();
});

test.afterEach(async () => {
	await parent?.remove();
});

async function quickAdd(page: Page, digit: string, note: string) {
	const sheet = page.getByRole("dialog", { name: "Quick Add" });
	await page.getByRole("link", { name: "Quick Add" }).first().click();
	await sheet.getByRole("group", { name: "Keypad" }).getByRole("button", { name: digit }).click();
	await sheet.getByLabel("Note").fill(note);
	await pickQuickAddBucket(sheet, "Groceries");
	await expect(sheet).toBeHidden();
}

test("a Transaction tapped in the list opens as a page with Back, Owed back is said there, and Back returns to the list", async ({
	browser,
}) => {
	test.slow();
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, { baseline: "5,000", buckets: [["Groceries", "1,200"]] });
	await quickAdd(page, "8", "Maple Diner");
	await quickAdd(page, "6", "Birch Books");

	await page
		.getByRole("navigation", { name: "Main" })
		.getByRole("link", { name: "Transactions" })
		.click();
	const list = page
		.getByRole("grid", { name: /^Transactions in / })
		.locator("[data-slot=data-table-body]");
	const row = list.getByRole("button", { name: /^Maple Diner,/ });
	await hydrated(page.getByLabel("Search notes and merchants"));
	await row.click();

	// Its own address, as a page: no sheet, the list and its filters gone, Back at the top.
	await expect(page).toHaveURL(/\/transactions\/\d{4}-\d{2}\/[0-9A-Z]{26}/);
	const detail = page.locator("[data-slot=transaction-detail]");
	await expect(detail.getByRole("heading", { name: "Edit Transaction" })).toBeVisible();
	await expect(page.getByRole("dialog")).toHaveCount(0);
	const back = detail.getByRole("link", { name: "Back to Transactions" });
	await expect(back).toBeInViewport();
	await expect(row).toBeHidden();
	await expect(page.getByLabel("Search notes and merchants")).toBeHidden();
	await expect(detail.getByLabel("Name")).toHaveValue("Maple Diner");
	await expect(detail.getByRole("button", { name: "Save" })).toBeVisible();
	await expect(detail.getByRole("button", { name: "Delete" })).toBeVisible();
	// Come to rest after sliding in: it starts at its top and nothing runs off the side.
	await expect(async () => {
		expect((await detail.boundingBox())?.x ?? -1).toBeGreaterThanOrEqual(0);
		expect(await page.evaluate(() => window.scrollY)).toBe(0);
		expect(
			await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
		).toBe(true);
	}).toPass({ timeout: 3000 });

	// What the sheet never had: someone outside the Household paying part of it back.
	const owedBack = detail.getByTestId("owed-back").filter({ visible: true });
	await owedBack.getByRole("button", { name: /paying part of this back/ }).click();
	const form = owedBack.getByTestId("owed-back-form");
	await form.getByLabel(/paying it back/).fill("Casey");
	await form.getByRole("button", { name: "Save" }).click();
	await expect(form).toBeHidden();
	await expect(owedBack.getByTestId("owed-back-text")).toHaveText("Owed back $4 · Casey");

	// Back: the list again, at its own address, with focus on the row that was opened.
	await back.click();
	await expect(page).toHaveURL(/\/transactions\/\d{4}-\d{2}$/);
	await expect(detail).toHaveCount(0);
	await expect(row).toBeVisible();
	await expect(row).toBeFocused();
	await expect(list.getByRole("button", { name: /^Birch Books,/ })).toBeVisible();
	await page.context().close();
});
