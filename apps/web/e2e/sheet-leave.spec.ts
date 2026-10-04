import { expect, test } from "@playwright/test";
import { createTestParent } from "./parents";
import { createPlannedHousehold, signedInPage } from "./session";

// Back with a sheet open (#47): a sheet isn't a history entry, so Back leaves the page; when
// something was typed in the sheet, the app asks first rather than throw it away.

let parent: Awaited<ReturnType<typeof createTestParent>>;

test.beforeEach(async () => {
	parent = await createTestParent();
});

test.afterEach(async () => {
	await parent?.remove();
});

test("Back asks before throwing away what was typed in a sheet", async ({ browser }) => {
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, { baseline: "5,000", buckets: [["Groceries", "1,200"]] });
	await page.getByRole("link", { name: "Accounts", exact: true }).click();
	await page.getByLabel("Name").fill("Everyday Checking");
	await page.getByRole("button", { name: "Add Account" }).click();
	await expect(page.getByRole("link", { name: /^Everyday Checking, / })).toBeVisible();

	// Nothing typed: Back simply leaves.
	const accounts = page.url();
	await page.getByRole("button", { name: "Add Account" }).click();
	const sheet = page.getByRole("dialog", { name: "Add an Account" });
	await expect(sheet).toBeVisible();
	await page.goBack();
	await expect(page).not.toHaveURL(accounts);
	await page.goForward();
	await expect(page.getByRole("heading", { level: 1 })).toHaveText("Accounts");

	// Something typed: Back asks, and Stay keeps it.
	await page.getByRole("button", { name: "Add Account" }).click();
	await sheet.getByLabel("Name").fill("Ally savings");
	await page.goBack();
	const ask = page.getByRole("alertdialog", { name: "Leave without saving?" });
	await expect(ask).toBeVisible();
	await ask.getByRole("button", { name: "Stay" }).click();
	await expect(ask).toBeHidden();
	await expect(sheet.getByLabel("Name")).toHaveValue("Ally savings");
	await expect(page).toHaveURL(accounts);

	// Leave goes.
	await page.goBack();
	await ask.getByRole("button", { name: "Leave" }).click();
	await expect(page).not.toHaveURL(accounts);
});
