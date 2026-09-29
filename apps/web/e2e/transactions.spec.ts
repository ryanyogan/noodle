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

const plan = {
	baseline: "5,000",
	buckets: [
		["Groceries", "1,200"],
		["Hockey", "400"],
	] as [string, string][],
};

const quickAddSheet = (page: Page) => page.getByRole("dialog", { name: "Quick Add" });
const editSheet = (page: Page) => page.getByRole("dialog", { name: "Edit Transaction" });
const nav = (page: Page) => page.getByRole("navigation", { name: "Main" });
const list = (page: Page) => page.getByRole("list", { name: /^Transactions in / });
const row = (page: Page, title: string) =>
	list(page).getByRole("button", { name: new RegExp(`^${title},`) });
const bucketRow = (page: Page, name: string) =>
	page.getByRole("listitem", { name: new RegExp(`^${name}: `) });

/** A Household with Leo as a Child, Buckets planned, and two Quick Adds; ends on This Month. */
async function setUp(page: Page) {
	await createPlannedHousehold(page, plan);
	await page.goto("/household");
	await page.getByLabel("Add a Child").fill("Leo");
	await page.getByRole("button", { name: "Add Child" }).click();
	await expect(page.getByRole("button", { name: "Edit Leo" })).toBeVisible();
	await quickAdd(page, "85.50", "Groceries", "Costco");
	await quickAdd(page, "64.99", "Groceries", "Pro Hockey Life");
	await nav(page).getByRole("link", { name: "This Month" }).click();
	await expect(bucketRow(page, "Groceries")).toContainText("$150.49 spent");
}

async function quickAdd(
	page: Page,
	amount: string,
	bucket: string,
	note: string,
	forName?: string,
) {
	await page.getByRole("link", { name: "Quick Add" }).first().click();
	await expect(quickAddSheet(page)).toBeVisible();
	await page.keyboard.type(amount);
	await quickAddSheet(page).getByLabel("Note").fill(note);
	if (forName) {
		await quickAddSheet(page)
			.getByRole("group", { name: "For" })
			.getByRole("button", { name: forName })
			.click();
	}
	await quickAddSheet(page)
		.getByRole("button", { name: new RegExp(`^${bucket}`) })
		.click();
	await expect(quickAddSheet(page)).toBeHidden();
}

async function openTransactions(page: Page) {
	await nav(page).getByRole("link", { name: "Transactions" }).click();
	await expect(page.getByRole("heading", { level: 1 })).toContainText("Transactions");
}

test("editing a Transaction reassigns its spending on This Month at once", async ({ browser }) => {
	const page = await signedInPage(browser, parent.email);
	await setUp(page);
	await openTransactions(page);

	// Newest first, under the day they happened.
	await expect(list(page).getByRole("listitem").first()).toHaveText("Today");
	await expect(list(page).getByRole("button")).toHaveCount(2);
	await expect(list(page).getByRole("button").first()).toHaveAccessibleName(
		"Pro Hockey Life, $64.99, Groceries, For Everyone",
	);

	await row(page, "Pro Hockey Life").click();
	await expect(editSheet(page)).toBeVisible();
	await editSheet(page).getByLabel("Amount").fill("70");
	await editSheet(page).getByLabel("Assigned to").selectOption({ label: "Hockey" });
	await editSheet(page)
		.getByRole("group", { name: "For" })
		.getByRole("button", { name: "Leo" })
		.click();
	await editSheet(page).getByLabel("Note").fill("Skates");
	await editSheet(page).getByRole("button", { name: "Save" }).click();
	await expect(editSheet(page)).toBeHidden();
	await expect(row(page, "Skates")).toHaveAccessibleName("Skates, $70, Hockey, For Leo");
	await expect(page.getByRole("status").filter({ hasText: "saved" })).toHaveText(
		"$64.99 (Pro Hockey Life) saved",
	);

	await nav(page).getByRole("link", { name: "This Month" }).click();
	await expect(bucketRow(page, "Groceries")).toContainText("$85.50 spent");
	await expect(bucketRow(page, "Hockey")).toContainText("$70 spent");
	await page.reload();
	await expect(bucketRow(page, "Groceries")).toContainText("$85.50 spent");
	await expect(bucketRow(page, "Hockey")).toContainText("$70 spent");

	// Leo's cost moved with it.
	await page.goto("/household");
	await expect(
		page.getByRole("region", { name: "Leo", exact: true }).getByRole("row", { name: /^Total/ }),
	).toHaveText(/Total\$70\$70/);
	await page.context().close();
});

test("a failed edit or delete is undone and can be retried", async ({ browser }) => {
	const page = await signedInPage(browser, parent.email);
	await setUp(page);
	await openTransactions(page);

	const update = serverFn("updateTransaction");
	await page.route(update, (route) => route.fulfill({ status: 500, body: "Server error" }));
	await row(page, "Costco").click();
	await editSheet(page).getByLabel("Assigned to").selectOption({ label: "Hockey" });
	await editSheet(page).getByRole("button", { name: "Save" }).click();
	const failed = page.getByRole("status").filter({ hasText: "Couldn’t save" });
	await expect(failed).toContainText("Couldn’t save your change to $85.50 (Costco)");
	await expect(row(page, "Costco")).toHaveAccessibleName("Costco, $85.50, Groceries, For Everyone");
	await page.unroute(update);

	const remove = serverFn("deleteTransaction");
	await page.route(remove, (route) => route.fulfill({ status: 500, body: "Server error" }));
	await row(page, "Costco").click();
	await editSheet(page).getByRole("button", { name: "Delete" }).click();
	await editSheet(page).getByRole("button", { name: "Delete Transaction" }).click();
	const notDeleted = page.getByRole("status").filter({ hasText: "Couldn’t delete" });
	await expect(notDeleted).toContainText("Couldn’t delete $85.50 (Costco), so it’s back.");
	await expect(row(page, "Costco")).toBeVisible();

	await page.unroute(remove);
	await notDeleted.getByRole("button", { name: "Retry" }).click();
	await expect(row(page, "Costco")).toHaveCount(0);
	await expect(list(page).getByRole("button")).toHaveCount(1);

	await nav(page).getByRole("link", { name: "This Month" }).click();
	await expect(bucketRow(page, "Groceries")).toContainText("$64.99 spent");
	await page.reload();
	await expect(bucketRow(page, "Groceries")).toContainText("$64.99 spent");
	await page.context().close();
});

test("the list filters by Bucket and by who it was For", async ({ browser }) => {
	const page = await signedInPage(browser, parent.email);
	await setUp(page);
	await quickAdd(page, "40", "Hockey", "Ice time", "Leo");
	await openTransactions(page);
	await expect(list(page).getByRole("button")).toHaveCount(3);

	await page.getByLabel("Bucket", { exact: true }).selectOption({ label: "Hockey" });
	await expect(page).toHaveURL(/bucket=/);
	await expect(list(page).getByRole("button")).toHaveCount(1);
	await expect(row(page, "Ice time")).toBeVisible();

	await page.getByLabel("Bucket", { exact: true }).selectOption({ label: "All Buckets" });
	await page.getByLabel("For", { exact: true }).selectOption({ label: "Leo" });
	await expect(list(page).getByRole("button")).toHaveCount(1);
	await expect(row(page, "Ice time")).toBeVisible();

	await page.getByLabel("For", { exact: true }).selectOption({ label: "Everyone (shared)" });
	await expect(list(page).getByRole("button")).toHaveCount(2);
	await expect(row(page, "Ice time")).toHaveCount(0);

	// The filters are in the URL, so a reload keeps them.
	await page.reload();
	await expect(page.getByLabel("For", { exact: true })).toHaveValue("everyone");
	await expect(list(page).getByRole("button")).toHaveCount(2);

	await page.getByLabel("Bucket", { exact: true }).selectOption({ label: "Hockey" });
	await expect(page.getByText("Nothing matches")).toBeVisible();
	await page.context().close();
});

test("on a phone, Transactions is in the tab bar either side of Quick Add", async ({ browser }) => {
	const page = await signedInPage(browser, parent.email, {
		viewport: { width: 393, height: 852 },
		isMobile: true,
		hasTouch: true,
	});
	await createPlannedHousehold(page, plan);
	await expect(nav(page).getByRole("link")).toHaveText([
		"Month",
		"Transactions",
		"Quick Add",
		"Goals",
		"Household",
	]);
	await nav(page).getByRole("link", { name: "Transactions" }).tap();
	await expect(page.getByRole("heading", { level: 1 })).toContainText("Transactions");
	await expect(page.getByText(/^No Transactions in /)).toBeVisible();
	await page.context().close();
});
