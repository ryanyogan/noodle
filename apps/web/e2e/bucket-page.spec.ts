import { expect, type Page, test } from "@playwright/test";
import { createTestParent } from "./parents";
import { createPlannedHousehold, serverFn, signedInPage, pickQuickAddBucket } from "./session";

let parent: Awaited<ReturnType<typeof createTestParent>>;

test.beforeEach(async () => {
	parent = await createTestParent();
});

test.afterEach(async () => {
	await parent?.remove();
});

// The Bucket's name, in the detail's header (the h1 is the Plan's month).
const heading = (page: Page) => page.locator("[data-slot=detail-title]");
const thisMonth = (page: Page) => page.getByRole("region", { name: /^(Left|Over) this month$/ });
const editSheet = (page: Page, bucket: string) => page.getByRole("dialog", { name: bucket });

async function quickAdd(page: Page, amount: string, bucket: string, note: string) {
	await page.getByRole("link", { name: "Quick Add" }).click();
	const sheet = page.getByRole("dialog", { name: "Quick Add" });
	await expect(sheet).toBeVisible();
	await page.keyboard.type(amount);
	await sheet.getByLabel("Note").fill(note);
	await pickQuickAddBucket(sheet, bucket);
	await expect(sheet).toBeHidden();
}

test("a Bucket's page shows its month, its year and its history, and changes it", async ({
	browser,
}) => {
	test.slow();
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
	await expect(heading(page)).toHaveText("Hockey");
	await expect(thisMonth(page)).toContainText("$300");
	await expect(thisMonth(page)).toContainText("of $400");
	await expect(thisMonth(page)).toContainText("Resets monthly");
	await expect(thisMonth(page)).toContainText("Even spending by today");

	// This month's Transactions, and the rest in the Transactions list.
	const transactions = page.getByRole("region", { name: /^Transactions in / });
	await expect(transactions.getByRole("button", { name: /^Skates, / })).toContainText("$100");
	// A row opens the Transaction, as on Transactions.
	await transactions.getByRole("button", { name: /^Skates, / }).click();
	const edit = page
		.locator("[role=dialog], [data-slot=transaction-detail]")
		.filter({ has: page.getByRole("heading", { name: "Edit Transaction" }) });
	await expect(edit.locator('input[name="assignment"]')).toHaveValue(/^bucket:/);
	await edit.getByRole("button", { name: "Close" }).click();
	await expect(edit).toBeHidden();
	await transactions.getByRole("link", { name: "All in Transactions" }).click();
	await expect(page).toHaveURL(/\/transactions\/\d{4}-\d{2}\?bucket=/);
	await page.goBack();
	await expect(heading(page)).toHaveText("Hockey");

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

	// One sheet, one Save: closing it with changes asks before throwing them away.
	await expect(page.getByRole("group", { name: "Carried over each month" })).toHaveCount(0);
	await page.getByRole("button", { name: "Edit", exact: true }).click();
	const sheet = editSheet(page, "Hockey");
	await expect(sheet.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
	await sheet.getByLabel("Name").fill("Kids’ hockey");
	await page.keyboard.press("Escape");
	const discard = page.getByRole("alertdialog");
	await expect(discard).toContainText("hasn’t been saved");
	await discard.getByRole("button", { name: "Cancel" }).click();
	await expect(sheet.getByLabel("Name")).toHaveValue("Kids’ hockey");

	// Renamed and made to carry over together; it shows its balance month by month.
	await sheet.getByRole("radio", { name: /^Carries over/ }).check();
	const carriesOver = page.waitForResponse((r) => serverFn("setCarriesOver")(new URL(r.url())));
	const renamed = page.waitForResponse((r) => serverFn("updateBucket")(new URL(r.url())));
	await sheet.getByRole("button", { name: "Save", exact: true }).click();
	expect((await carriesOver).ok()).toBe(true);
	expect((await renamed).ok()).toBe(true);
	await expect(sheet).toBeHidden();
	await expect(heading(page)).toHaveText("Kids’ hockey");
	await expect(thisMonth(page)).toContainText("Carries over");
	await expect(page.getByRole("group", { name: "Carried over each month" })).toBeVisible();

	// Saved, not just shown.
	await page.reload();
	await expect(heading(page)).toHaveText("Kids’ hockey");
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

test("an archived Bucket can be restored to the Plan", async ({ browser }) => {
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, {
		baseline: "5,000",
		buckets: [
			["Groceries", "1,200"],
			["Gifts", "150"],
		],
	});
	await page.getByRole("link", { name: "Gifts", exact: true }).click();
	await page.getByRole("button", { name: "Edit", exact: true }).click();
	await editSheet(page, "Gifts").getByRole("button", { name: "Archive" }).click();
	await page.getByRole("alertdialog").getByRole("button", { name: "Archive Gifts" }).click();
	await expect(heading(page)).toHaveText("Gifts");
	await expect(page.getByText("It’s archived, so nothing goes into it.")).toBeVisible();
	// Fresh from the server: archived in the month it started, it was in no month's Plan, and the
	// Restore sheet still starts from its last allowance.
	await page.reload();

	await page.getByRole("button", { name: "Restore to the Plan" }).click();
	const restore = page.getByRole("dialog", { name: "Restore Gifts" });
	await expect(restore.getByRole("textbox", { name: "Allowance", exact: true })).toHaveValue("150");
	await restore.getByRole("textbox", { name: "Allowance", exact: true }).fill("200");
	await restore.getByRole("button", { name: "Restore to the Plan" }).click();
	await expect(restore).toBeHidden();
	await expect(heading(page)).toHaveText("Gifts");
	await expect(thisMonth(page)).toContainText("of $200");
	await expect(page.getByRole("region", { name: "Allowance history" })).toContainText(
		"Back in the Plan",
	);
	await page.context().close();
});

test("a Bucket's page works on a phone", { tag: "@phone" }, async ({ browser }) => {
	const page = await signedInPage(browser, parent.email, {
		viewport: { width: 393, height: 852 },
		isMobile: true,
		hasTouch: true,
	});
	await createPlannedHousehold(page, { baseline: "5,000", buckets: [["Groceries", "1,200"]] });
	await page.getByRole("link", { name: "Groceries", exact: true }).click();
	await expect(heading(page)).toHaveText("Groceries");
	await expect(page.getByRole("group", { name: "Spent vs allowance" })).toBeVisible();
	await page.getByRole("button", { name: "Edit", exact: true }).click();
	await expect(editSheet(page, "Groceries").getByRole("button", { name: "Save" })).toBeVisible();
	const width = await page.evaluate(() => document.documentElement.scrollWidth);
	expect(width).toBeLessThanOrEqual(393);
	await page.context().close();
});
