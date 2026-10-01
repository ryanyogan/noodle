import { expect, type Page, test } from "@playwright/test";
import { createTestParent } from "./parents";
import { createPlannedHousehold, serverFn, signedInPage } from "./session";

let parent: Awaited<ReturnType<typeof createTestParent>>;

test.beforeEach(async () => {
	parent = await createTestParent();
});

test.afterEach(async () => {
	await parent?.remove();
});

const heading = (page: Page) => page.getByRole("heading", { level: 1 });
const thisMonth = (page: Page) => page.getByRole("region", { name: "Left this month" });
const editSheet = (page: Page, bucket: string) => page.getByRole("dialog", { name: bucket });

async function quickAdd(page: Page, amount: string, bucket: string, note: string) {
	await page.getByRole("link", { name: "Quick Add" }).click();
	const sheet = page.getByRole("dialog", { name: "Quick Add" });
	await expect(sheet).toBeVisible();
	await page.keyboard.type(amount);
	await sheet.getByLabel("Note").fill(note);
	await sheet.getByRole("button", { name: new RegExp(`^${bucket}`) }).click();
	await expect(sheet).toBeHidden();
}

test("a Bucket's page shows its month, its year and its history, and changes it", async ({
	browser,
}) => {
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, {
		baseline: "5,000",
		buckets: [
			["Groceries", "1,200"],
			["Hockey", "400"],
		],
	});
	await quickAdd(page, "100", "Hockey", "Skates");

	// Every Bucket on This Month links to its page.
	await page.getByRole("link", { name: "Hockey", exact: true }).click();
	await expect(heading(page)).toHaveText("BucketHockey");
	await expect(thisMonth(page)).toContainText("$300");
	await expect(thisMonth(page)).toContainText("of $400");
	await expect(thisMonth(page)).toContainText("Resets monthly");
	await expect(thisMonth(page)).toContainText("Even spending by today");

	// This month's Transactions, and the rest in the Transactions list.
	const transactions = page.getByRole("region", { name: /^Transactions in / });
	await expect(transactions.getByRole("listitem", { name: /^Skates, / })).toContainText("$100");
	await transactions.getByRole("link", { name: "In Transactions" }).click();
	await expect(page).toHaveURL(/\/transactions\/\d{4}-\d{2}\?bucket=/);
	await page.goBack();
	await expect(heading(page)).toHaveText("BucketHockey");

	// Spent vs allowance, as a table too.
	const spentVsAllowance = page.getByRole("group", { name: "Spent vs allowance" });
	await spentVsAllowance
		.getByRole("button", { name: "Show Spent vs allowance as a table" })
		.click();
	await expect(spentVsAllowance.getByRole("row").last()).toContainText("$400$100$300");

	// A new allowance lands in its history.
	await page.getByRole("button", { name: "Edit", exact: true }).click();
	await editSheet(page, "Hockey")
		.getByRole("textbox", { name: "Allowance", exact: true })
		.fill("450");
	await editSheet(page, "Hockey").getByRole("button", { name: "Save", exact: true }).click();
	await expect(editSheet(page, "Hockey")).toBeHidden();
	await expect(thisMonth(page)).toContainText("of $450");
	await expect(page.getByRole("region", { name: "Allowance history" })).toContainText(
		"$400 → $450",
	);

	// carries over shows its balance month by month.
	await expect(page.getByRole("group", { name: "Carried over each month" })).toHaveCount(0);
	await page.getByRole("button", { name: "Edit", exact: true }).click();
	const carriesOver = page.waitForResponse((r) => serverFn("setCarriesOver")(new URL(r.url())));
	await page.getByRole("radio", { name: /^Carries over/ }).check();
	expect((await carriesOver).ok()).toBe(true);

	// Renamed, here and on This Month.
	await editSheet(page, "Hockey").getByLabel("Name").fill("Kids’ hockey");
	await editSheet(page, "Hockey").getByRole("button", { name: "Rename" }).click();
	await expect(editSheet(page, "Kids’ hockey")).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(heading(page)).toHaveText("BucketKids’ hockey");
	await expect(thisMonth(page)).toContainText("Carries over");
	await expect(page.getByRole("group", { name: "Carried over each month" })).toBeVisible();

	// Saved, not just shown.
	await page.reload();
	await expect(heading(page)).toHaveText("BucketKids’ hockey");
	await expect(thisMonth(page)).toContainText("of $450");
	await expect(page.getByRole("group", { name: "Carried over each month" })).toBeVisible();

	// Reports' Plan vs actual, for this Bucket.
	await page.getByRole("link", { name: "See in Reports" }).click();
	await expect(page).toHaveURL(/\/reports\?.*view=plan/);
	await expect(page).toHaveURL(/buckets=/);

	await page
		.getByRole("navigation", { name: "Main" })
		.getByRole("link", { name: "This Month" })
		.click();
	await expect(page.getByRole("listitem", { name: /^Kids’ hockey: / })).toContainText(
		"Carries over",
	);
	await page.context().close();
});

test("a Bucket's page works on a phone", async ({ browser }) => {
	const page = await signedInPage(browser, parent.email, {
		viewport: { width: 393, height: 852 },
		isMobile: true,
		hasTouch: true,
	});
	await createPlannedHousehold(page, { baseline: "5,000", buckets: [["Groceries", "1,200"]] });
	await page.getByRole("link", { name: "Groceries", exact: true }).click();
	await expect(heading(page)).toHaveText("BucketGroceries");
	await expect(page.getByRole("group", { name: "Spent vs allowance" })).toBeVisible();
	await page.getByRole("button", { name: "Edit", exact: true }).click();
	await expect(editSheet(page, "Groceries").getByRole("button", { name: "Rename" })).toBeVisible();
	const width = await page.evaluate(() => document.documentElement.scrollWidth);
	expect(width).toBeLessThanOrEqual(393);
	await page.context().close();
});
