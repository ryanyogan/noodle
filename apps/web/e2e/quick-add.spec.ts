import { expect, type Page, test } from "@playwright/test";
import { createTestParent } from "./parents";
import { createPlannedHousehold, serverFn, signedInPage, switchTo } from "./session";

let parent: Awaited<ReturnType<typeof createTestParent>>;

test.beforeEach(async () => {
	parent = await createTestParent();
});

test.afterEach(async () => {
	await parent?.remove();
});

const plan = {
	baseline: "5,000",
	buckets: [
		["Groceries", "1,200"],
		["Hockey", "400"],
	] as [string, string][],
};

const sheet = (page: Page) => page.getByRole("dialog", { name: "Quick Add" });
const hero = (page: Page) => page.getByRole("region", { name: "Free to Spend" });
const bucketRow = (page: Page, name: string) =>
	page.getByRole("listitem", { name: new RegExp(`^${name}: `) });

/** Opens Quick Add from the sidebar, types an amount, and picks a Bucket. */
async function quickAdd(page: Page, amount: string, bucket: string, note?: string) {
	await page.getByRole("link", { name: "Quick Add" }).click();
	await expect(sheet(page)).toBeVisible();
	await page.keyboard.type(amount);
	if (note) await sheet(page).getByLabel("Note").fill(note);
	await sheet(page)
		.getByRole("button", { name: new RegExp(`^${bucket}`) })
		.click();
	await expect(sheet(page)).toBeHidden();
}

test("a Quick Add drains its Bucket at once and is saved", async ({ browser }) => {
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, plan);
	await expect(hero(page)).toContainText("Left in Buckets$1,600");

	await quickAdd(page, "85.50", "Groceries", "Costco");
	await expect(bucketRow(page, "Groceries")).toHaveAccessibleName(
		/^Groceries: \$1,114\.50 left of \$1,200/,
	);
	await expect(bucketRow(page, "Groceries")).toContainText("$85.50 spent");
	await expect(hero(page)).toContainText("Left in Buckets$1,514.50");
	// Spending inside a Bucket doesn't touch Free to Spend: that money was already planned.
	await expect(hero(page).getByText("$3,400", { exact: true }).first()).toBeVisible();
	await expect(page.getByRole("status").filter({ hasText: "added to" })).toHaveText(
		"$85.50 added to Groceries",
	);

	await page.reload();
	await expect(bucketRow(page, "Groceries")).toHaveAccessibleName(
		/^Groceries: \$1,114\.50 left of \$1,200/,
	);
	await page.context().close();
});

test("Buckets are offered most likely first", async ({ browser }) => {
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, plan);
	const picks = sheet(page).getByRole("listitem");

	await page.keyboard.press("q");
	await expect(picks.first()).toContainText("Groceries");
	await page.keyboard.press("Escape");
	await expect(sheet(page)).toBeHidden();

	await quickAdd(page, "40", "Hockey");
	await quickAdd(page, "25", "Hockey");
	await expect(bucketRow(page, "Hockey")).toContainText("$65 spent");
	await page.keyboard.press("q");
	await expect(picks.first()).toContainText("Hockey");
	await expect(picks.first()).toContainText("$335 left");
	await page.context().close();
});

test("Quick Add opens over any screen, and Back closes it without reloading the screen", async ({
	browser,
}) => {
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, plan);

	// A half-typed Bucket name in the Plan survives opening and closing Quick Add.
	await switchTo(page, "Plan");
	await page
		.getByRole("navigation", { name: "Plan pages" })
		.getByRole("link", { name: "Buckets", exact: true })
		.click();
	await page.getByRole("button", { name: "Change Hockey: $400" }).click();
	const name = page
		.getByRole("form", { name: "Change Hockey" })
		.getByRole("textbox", { name: "Name" });
	await name.fill("Gifts");
	await page.getByRole("link", { name: "Quick Add" }).click();
	await expect(sheet(page)).toBeVisible();
	await expect(page).toHaveURL(/sheet=quick-add/);
	await page.goBack();
	await expect(sheet(page)).toBeHidden();
	await expect(page).not.toHaveURL(/sheet=/);
	await expect(name).toHaveValue("Gifts");

	// From the Household screen, adding closes the sheet and stays there.
	await page
		.getByRole("navigation", { name: "Main" })
		.getByRole("link", { name: "Household" })
		.click();
	await expect(page.getByRole("heading", { name: "Parents" })).toBeVisible();
	await quickAdd(page, "12", "Hockey");
	await expect(page.getByRole("heading", { name: "Parents" })).toBeVisible();
	await expect(page).not.toHaveURL(/sheet=/);
	await page
		.getByRole("navigation", { name: "Main" })
		.getByRole("link", { name: "This Month" })
		.click();
	await expect(bucketRow(page, "Hockey")).toContainText("$12 spent");

	// Opened straight from a link (e.g. a home screen shortcut), closing it stays on the page.
	await page.goto("/month?sheet=quick-add");
	await expect(sheet(page)).toBeVisible();
	await sheet(page).getByRole("button", { name: "Close" }).click();
	await expect(sheet(page)).toBeHidden();
	await expect(page).toHaveURL(/\/month\/\d{4}-\d{2}$/);
	await page.context().close();
});

test("on a phone, Quick Add takes three taps from the tab bar", { tag: "@phone" }, async ({
	browser,
}) => {
	const page = await signedInPage(browser, parent.email, {
		viewport: { width: 393, height: 852 },
		isMobile: true,
		hasTouch: true,
	});
	await createPlannedHousehold(page, plan);
	await page
		.getByRole("navigation", { name: "Main" })
		.getByRole("link", { name: "Quick Add" })
		.tap();
	const keypad = sheet(page).getByRole("group", { name: "Keypad" });
	for (const key of ["4", "2", "Decimal point", "5"]) {
		await keypad.getByRole("button", { name: key, exact: true }).tap();
	}
	await expect(sheet(page).getByRole("status", { name: "Amount" })).toHaveText("$42.5");
	await sheet(page)
		.getByRole("button", { name: /^Groceries/ })
		.tap();
	await expect(sheet(page)).toBeHidden();
	await expect(bucketRow(page, "Groceries")).toContainText("$42.50 spent");
	await page.context().close();
});

test("a failed Quick Add is undone and can be retried", async ({ browser }) => {
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, plan);

	const addQuickAdd = serverFn("addQuickAdd");
	await page.route(addQuickAdd, (route) => route.fulfill({ status: 500, body: "Server error" }));
	await quickAdd(page, "20", "Hockey");
	const toast = page.getByRole("status").filter({ hasText: "Couldn’t save" });
	await expect(toast).toContainText("Couldn’t save $20 to Hockey");
	await expect(bucketRow(page, "Hockey")).toContainText("$0 spent");

	await page.unroute(addQuickAdd);
	await toast.getByRole("button", { name: "Retry" }).click();
	await expect(bucketRow(page, "Hockey")).toContainText("$20 spent");
	await page.reload();
	await expect(bucketRow(page, "Hockey")).toContainText("$20 spent");
	await page.context().close();
});

test("a Quick Add delivered twice is recorded once", async ({ browser }) => {
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, plan);
	// Deliver the request to the server twice, as a retry after a lost response would.
	await page.route(serverFn("addQuickAdd"), async (route) => {
		await route.fetch();
		await route.continue();
	});
	await quickAdd(page, "30", "Groceries");
	await expect(page.getByRole("status").filter({ hasText: "added to" })).toBeVisible();
	await page.reload();
	await expect(bucketRow(page, "Groceries")).toContainText("$30 spent");
	await page.context().close();
});
