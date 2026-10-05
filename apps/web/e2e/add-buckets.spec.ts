import { expect, type Page, test } from "@playwright/test";
import { uploadHistory } from "./history";
import { createTestParent } from "./parents";
import { createHousehold, savedBy, signedInPage, switchTo } from "./session";

// The Plan's Add Buckets sheet (#57): the starter list, ticked and priced, added in one save.

let parent: Awaited<ReturnType<typeof createTestParent>>;

test.beforeEach(async () => {
	parent = await createTestParent();
});

test.afterEach(async () => {
	await parent?.remove();
});

/** Opens this month's Plan on its Buckets page, waits for it to hydrate, and opens the sheet. */
async function openSheet(page: Page) {
	const month = page.url().match(/\/month\/(\d{4}-\d{2})/)?.[1];
	if (month) await page.goto(`/plan/${month}#buckets`);
	const open = page.getByRole("button", { name: "Add Buckets", exact: true });
	await expect(open).toBeEnabled();
	await open.focus();
	await page.keyboard.press("Enter");
	const sheet = page.getByRole("dialog", { name: "Add Buckets" });
	await expect(sheet).toBeVisible();
	return sheet;
}

test("eight Buckets are added in one sheet by keyboard alone", async ({ browser }) => {
	const page = await signedInPage(browser, parent.email);
	await createHousehold(page, "The Rinks", "Alex");
	const sheet = await openSheet(page);
	// One line says what carrying over is for.
	await expect(sheet).toContainText("Good for Gifts: save a bit each month for December.");
	// The Parent's own Personal Allowance is offered, with what the other Parent sees.
	await expect(sheet).toContainText("the other Parent sees just the total");

	const leftToPlan = sheet.getByText(/^Left to plan/);
	const eight: [string, string][] = [
		["Groceries", "800"],
		["Dining out", "150"],
		["Gas", "200"],
		["Household", "120"],
		["Kids", "250"],
		["Fun", "100"],
		["Gifts", "60"],
		["Clothes", "75"],
	];
	const started = Date.now();
	await sheet.getByRole("checkbox", { name: "Groceries" }).focus();
	for (const [i, [name, amount]] of eight.entries()) {
		await expect(sheet.getByRole("checkbox", { name, exact: true })).toBeFocused();
		await page.keyboard.press("Space");
		await page.keyboard.press("Tab");
		await page.keyboard.type(amount);
		if (i === 0) await expect(leftToPlan).toContainText("$800");
		if (i < eight.length - 1) {
			// Past Carries over, to the next one's tick.
			await page.keyboard.press("Tab");
			await page.keyboard.press("Tab");
		}
	}
	// Left to plan follows every amount: $1,755 more than a Plan with no take-home pay has.
	await expect(leftToPlan).toContainText("1,755");
	await expect(leftToPlan).toContainText("more than you bring in");
	await expect(sheet.getByRole("button", { name: "Add 8 Buckets" })).toBeVisible();
	// Gifts and Clothes carry over from the start; Groceries resets monthly.
	await expect(sheet.locator("[data-starter=gifts]").getByRole("switch")).toBeChecked();
	await expect(sheet.locator("[data-starter=clothes]").getByRole("switch")).toBeChecked();
	await expect(sheet.locator("[data-starter=groceries]").getByRole("switch")).not.toBeChecked();
	const saved = savedBy(page, "addBuckets");
	await page.keyboard.press("Enter");
	await expect(sheet).toBeHidden();
	for (const [name] of eight) {
		await expect(page.getByRole("button", { name: `Edit ${name}` })).toBeVisible();
	}
	expect((await saved).ok()).toBe(true);
	expect(Date.now() - started).toBeLessThan(60_000);

	// Saved, and no longer offered.
	await page.reload();
	await expect(page.getByRole("button", { name: "Edit Clothes" })).toBeVisible();
	const again = await openSheet(page);
	await expect(again.getByRole("checkbox", { name: "Groceries" })).toHaveCount(0);
	await expect(again.getByRole("checkbox", { name: "Travel" })).toBeVisible();
});

test("with history, the sheet's amounts come from what was spent", async ({ browser }) => {
	const page = await signedInPage(browser, parent.email);
	await createHousehold(page, "The Rinks", "Alex");
	const thisMonth = page.url();
	await uploadHistory(page);
	await page.goto(thisMonth);
	await switchTo(page, "Plan");
	await expect(page.getByRole("region", { name: "Drafted from your history" })).toBeVisible({
		timeout: 15_000,
	});
	await page.goto(thisMonth);
	const sheet = await openSheet(page);
	for (const key of ["groceries", "dining", "gas"]) {
		const row = sheet.locator(`[data-starter=${key}]`);
		await expect(row).toContainText("Suggested from your spending");
		await expect(row.getByRole("checkbox")).toBeChecked();
		await expect(row.getByRole("textbox")).toHaveValue(/[1-9]/);
	}
	// Spending the draft didn't find keeps a share of what's left, unticked.
	await expect(sheet.locator("[data-starter=pets]")).not.toContainText("spending");
	await expect(sheet.locator("[data-starter=pets]").getByRole("checkbox")).not.toBeChecked();
	await sheet.getByRole("button", { name: /^Add \d+ Buckets$/ }).click();
	await expect(page.getByRole("button", { name: "Edit Groceries" })).toBeVisible();
});
