import { expect, type Page, test } from "@playwright/test";
import { createTestParent } from "./parents";
import {
	accountKindLabel,
	choose,
	createPlannedHousehold,
	serverFn,
	signedInPage,
} from "./session";

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
const editSheet = (page: Page) =>
	page
		.locator("[role=dialog], [data-slot=transaction-detail]")
		.filter({ has: page.getByRole("heading", { name: "Edit Transaction" }) });
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
			.getByRole("radiogroup", { name: "For" })
			.getByRole("radio", { name: forName })
			.click();
	}
	await quickAddSheet(page)
		.getByRole("button", { name: new RegExp(`^${bucket}`) })
		.click();
	await expect(quickAddSheet(page)).toBeHidden();
}

async function openTransactions(page: Page) {
	await nav(page).getByRole("link", { name: "Transactions" }).click();
	await expect(page.locator("[data-slot=page-header]:visible")).toContainText("Transactions");
}

test("editing a Transaction reassigns its spending on This Month at once", async ({ browser }) => {
	const page = await signedInPage(browser, parent.email);
	await setUp(page);
	await openTransactions(page);

	// Newest first, under the day they happened.
	await expect(list(page).getByRole("listitem").first()).toHaveText(/^Today/);
	await expect(list(page).getByRole("button")).toHaveCount(2);
	await expect(list(page).getByRole("button").first()).toHaveAccessibleName(
		"Pro Hockey Life, $64.99, Groceries, For Everyone",
	);

	await row(page, "Pro Hockey Life").click();
	await expect(editSheet(page)).toBeVisible();
	await editSheet(page).getByLabel("Amount").fill("70");
	await choose(editSheet(page), "Assigned to", "Hockey");
	await editSheet(page)
		.getByRole("toolbar", { name: "For" })
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
	await choose(editSheet(page), "Assigned to", "Hockey");
	await editSheet(page).getByRole("button", { name: "Save" }).click();
	const failed = page.getByRole("status").filter({ hasText: "Couldn’t save" });
	await expect(failed).toContainText("Couldn’t save your change to $85.50 (Costco)");
	await expect(row(page, "Costco")).toHaveAccessibleName("Costco, $85.50, Groceries, For Everyone");
	await page.unroute(update);

	const remove = serverFn("deleteTransaction");
	await page.route(remove, (route) => route.fulfill({ status: 500, body: "Server error" }));
	await row(page, "Costco").click();
	await editSheet(page).getByRole("button", { name: "Delete" }).click();
	await page.getByRole("alertdialog").getByRole("button", { name: "Delete Transaction" }).click();
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
	// The month's total comes from the server, so it counts every page, not just those loaded.
	await expect(page.getByText(/^Spent in /)).toBeVisible();
	await expect(page.getByTestId("month-total")).toHaveText("$190.49");

	await choose(page, "Bucket", "Hockey");
	await expect(page).toHaveURL(/bucket=/);
	await expect(list(page).getByRole("button")).toHaveCount(1);
	await expect(row(page, "Ice time")).toBeVisible();
	await expect(page.getByText("Total for these filters")).toBeVisible();
	await expect(page.getByTestId("month-total")).toHaveText("$40");

	await choose(page, "Bucket", "All Buckets");
	await choose(page, "For", "Leo");
	await expect(list(page).getByRole("button")).toHaveCount(1);
	await expect(row(page, "Ice time")).toBeVisible();

	await choose(page, "For", "Everyone (shared)");
	await expect(list(page).getByRole("button")).toHaveCount(2);
	await expect(row(page, "Ice time")).toHaveCount(0);

	// The filters are in the URL, so a reload keeps them.
	await page.reload();
	await expect(page.getByRole("combobox", { name: "For", exact: true })).toHaveText(
		"Everyone (shared)",
	);
	await expect(list(page).getByRole("button")).toHaveCount(2);

	await choose(page, "Bucket", "Hockey");
	await expect(page.getByText("Nothing matches")).toBeVisible();
	await page.context().close();
});

test("at xl, Date and Amount sort the list", async ({ browser }) => {
	const page = await signedInPage(browser, parent.email);
	await page.setViewportSize({ width: 1440, height: 900 });
	await setUp(page);
	await quickAdd(page, "40", "Hockey", "Ice time", "Leo");
	await openTransactions(page);
	const rows = list(page).getByRole("button");
	await expect(rows).toHaveText([/Ice time/, /Pro Hockey Life/, /Costco/]);
	await expect(page.getByRole("button", { name: "Date, newest first" })).toHaveAttribute(
		"aria-pressed",
		"true",
	);

	await page.getByRole("button", { name: "Sort by amount" }).click();
	await expect(page).toHaveURL(/sort=largest/);
	await expect(rows).toHaveText([/Costco/, /Pro Hockey Life/, /Ice time/]);
	await page.getByRole("button", { name: "Amount, largest first" }).click();
	await expect(page).toHaveURL(/sort=smallest/);
	await expect(rows).toHaveText([/Ice time/, /Pro Hockey Life/, /Costco/]);
	// Sorting isn't filtering: the total stays the month's.
	await expect(page.getByTestId("month-total")).toHaveText("$190.49");

	await page.getByRole("button", { name: "Sort by date" }).click();
	await expect(page).not.toHaveURL(/sort=/);
	await page.getByRole("button", { name: "Date, newest first" }).click();
	await expect(page).toHaveURL(/sort=oldest/);
	await expect(rows).toHaveText([/Costco/, /Pro Hockey Life/, /Ice time/]);
	await page.context().close();
});

test("the list searches notes, and the editor says what's missing before it saves", async ({
	browser,
}) => {
	const page = await signedInPage(browser, parent.email);
	await setUp(page);
	await openTransactions(page);

	await page.getByLabel("Search notes and merchants").fill("hockey");
	await expect(page).toHaveURL(/q=hockey/);
	await expect(list(page).getByRole("button")).toHaveCount(1);
	await expect(row(page, "Pro Hockey Life")).toBeVisible();
	await page.reload();
	await expect(page.getByLabel("Search notes and merchants")).toHaveValue("hockey");
	await expect(list(page).getByRole("button")).toHaveCount(1);
	await page.getByLabel("Search notes and merchants").fill("");
	await expect(list(page).getByRole("button")).toHaveCount(2);

	// An empty amount is said beside the form, not by the browser, and nothing is saved.
	await row(page, "Costco").click();
	await editSheet(page).getByLabel("Amount").fill("");
	await editSheet(page).getByRole("button", { name: "Save" }).click();
	await expect(editSheet(page).getByRole("alert")).toHaveText(
		"Enter the amount in dollars, like 12 or 85.50.",
	);
	await expect(editSheet(page).getByLabel("Amount")).toHaveAttribute("aria-invalid", "true");
	// Closing it gives focus back to the row it was opened from.
	await page.keyboard.press("Escape");
	await expect(editSheet(page)).toBeHidden();
	await expect(row(page, "Costco")).toBeFocused();
	await expect(row(page, "Costco")).toHaveAccessibleName("Costco, $85.50, Groceries, For Everyone");
	await page.context().close();
});

test("an Account lists its Transactions, and Transactions filters by it", async ({ browser }) => {
	const page = await signedInPage(browser, parent.email);
	await setUp(page);
	await quickAdd(page, "12", "Hockey", "Chipotle");

	// A card whose statement has Costco's bank copy, a tipped Chipotle, and Trader Joe's.
	await page.getByRole("link", { name: "Accounts", exact: true }).click();
	await page.getByLabel("Name").fill("Visa");
	await choose(page, "Kind", accountKindLabel("credit-card"));
	await page.getByLabel("Owed now").fill("800");
	await page.getByRole("button", { name: "Add Account" }).click();
	await page.getByRole("link", { name: /^Visa, / }).click();
	const today = await page.evaluate(() => new Date().toLocaleDateString("en-US"));
	const csv = [
		"Transaction Date,Description,Debit,Credit",
		`${today},COSTCO WHSE #1042,85.50,`,
		`${today},CHIPOTLE 1234,14.40,`,
		`${today},TRADER JOE'S #552,42.17,`,
	].join("\n");
	await page.getByRole("button", { name: "Upload statement" }).click();
	const upload = page.getByRole("dialog", { name: "Upload a statement" });
	await upload
		.getByLabel("Statement file")
		.setInputFiles({ name: "visa.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
	await upload.getByRole("button", { name: "Import 3 lines" }).click();
	await expect(upload).toBeHidden();

	// The Account's page lists them: Costco as its Matched Quick Add, the others as brought in.
	const latest = page.getByRole("list", { name: "Latest Transactions in Visa" });
	await expect(latest.getByRole("button")).toHaveCount(3);
	await expect(
		latest.getByRole("button", {
			name: /^Costco, \$85\.50, Groceries, For Everyone, Matched in Visa$/,
		}),
	).toBeVisible();
	await expect(latest.getByRole("button", { name: /^TRADER JOE'S #552, / })).toBeVisible();

	// Matching keeps what was typed in the editor: the note is saved with the Match.
	await page.getByRole("link", { name: "All in Transactions" }).click();
	await expect(page).toHaveURL(/account=/);
	await expect(page.getByRole("combobox", { name: "Account", exact: true })).not.toHaveText(
		"All Accounts",
	);
	await expect(list(page).getByRole("button")).toHaveCount(3);
	await choose(page, "Account", "All Accounts");
	await expect(row(page, "Pro Hockey Life")).toHaveAccessibleName(
		"Pro Hockey Life, $64.99, Groceries, For Everyone, waiting for the bank’s copy",
	);
	await row(page, "Chipotle").click();
	await editSheet(page).getByLabel("Note").fill("Chipotle lunch");
	const possible = editSheet(page).getByRole("region", { name: "Possible match" });
	await possible.getByRole("button", { name: /^Match with CHIPOTLE 1234, \$14\.40/ }).click();
	await expect(editSheet(page)).toBeHidden();
	await expect(row(page, "Chipotle lunch")).toHaveAccessibleName(
		"Chipotle lunch, $12, Hockey, For Everyone, Matched in Visa",
	);
	await page.reload();
	await expect(row(page, "Chipotle lunch")).toHaveAccessibleName(
		"Chipotle lunch, $12, Hockey, For Everyone, Matched in Visa",
	);
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
	await expect(page.locator("[data-slot=page-header]:visible")).toContainText("Transactions");
	await expect(page.getByText(/^No Transactions in /)).toBeVisible();
	// It says how to get some in.
	await expect(
		page.getByRole("link", { name: "Connect a bank or upload a statement" }),
	).toBeVisible();
	await expect(page.getByRole("main").getByRole("link", { name: "Quick Add" })).toBeVisible();
	const overflows = await page.evaluate(
		() => document.documentElement.scrollWidth > window.innerWidth,
	);
	expect(overflows).toBe(false);
	await page.context().close();
});
