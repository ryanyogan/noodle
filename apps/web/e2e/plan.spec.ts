import { expect, type Page, test } from "@playwright/test";
import { createTestParent } from "./parents";
import { createHousehold, savedBy, serverFn, signedInPage, switchTo } from "./session";

let parent: Awaited<ReturnType<typeof createTestParent>>;

test.beforeEach(async () => {
	parent = await createTestParent();
});

test.afterEach(async () => {
	await parent?.remove();
});

/** Opens the Plan from an empty This Month. */
async function openPlan(page: Page) {
	await createHousehold(page, "The Rinks", "Alex");
	await page.getByRole("link", { name: "Set up the Plan" }).click();
	await expect(page.locator("[data-slot=page-header]:visible")).toContainText("Plan");
}

const waterfall = (page: Page) =>
	page.getByRole("region", { name: "From take-home pay to Free to Spend" });
const freeToSpend = (page: Page) => waterfall(page).getByRole("listitem").last();
const bucketRow = (page: Page, bucket: string) =>
	page.getByRole("listitem").filter({ has: page.getByRole("button", { name: `Edit ${bucket}` }) });

async function setTakeHomePay(page: Page, amount: string) {
	await page.getByRole("textbox", { name: "Take-home pay" }).fill(amount);
	await page.getByRole("button", { name: "Set take-home pay" }).click();
}

/** Opens a part of the Plan from the overview's waterfall. */
async function openStep(page: Page, step: string) {
	await waterfall(page).getByRole("link", { name: step, exact: true }).click();
	await expect(page).toHaveURL(/\/plan\/\d{4}-\d{2}\/\w+/);
}

async function backToPlan(page: Page) {
	await page
		.getByRole("navigation", { name: "Plan pages" })
		.getByRole("link", { name: "Overview" })
		.click();
	await expect(waterfall(page)).toBeVisible();
}

async function addBucket(page: Page, name: string, amount: string) {
	await page.getByLabel("New Bucket").fill(name);
	await page.getByLabel("Monthly allowance").fill(amount);
	await page.getByRole("button", { name: "Add Bucket", exact: true }).click();
	await expect(page.getByRole("button", { name: `Edit ${name}` })).toBeVisible();
}

/** Opens a Bucket's page from the Plan's Buckets. */
async function openBucket(page: Page, bucket: string) {
	await page.getByRole("link", { name: bucket, exact: true }).click();
	await expect(page.locator("[data-slot=detail-header]")).toContainText(bucket);
}

/** Opens the Edit sheet on a Bucket's page. */
async function editBucket(page: Page, bucket: string) {
	await page.getByRole("button", { name: "Edit", exact: true }).click();
	const sheet = page.getByRole("dialog", { name: bucket });
	await expect(sheet).toBeVisible();
	return sheet;
}

/** Sets a Bucket's allowance from its sheet, from this month on. */
async function setAllowance(page: Page, bucket: string, amount: string) {
	await page.getByRole("button", { name: `Edit ${bucket}` }).click();
	const sheet = page.getByRole("dialog", { name: bucket });
	await sheet.getByRole("textbox", { name: "Allowance", exact: true }).fill(amount);
	await sheet.getByRole("button", { name: "Save", exact: true }).click();
	await expect(sheet).toBeHidden();
}

test("a Parent plans the month and This Month shows Free to Spend and each Bucket", async ({
	browser,
}) => {
	const page = await signedInPage(browser, parent.email);
	await openPlan(page);

	await setTakeHomePay(page, "9,000");
	await expect(freeToSpend(page)).toHaveText("Free to Spend$9,000");
	await page.getByRole("link", { name: "Add Buckets" }).click();
	await addBucket(page, "Groceries", "1,200");
	await expect(page.getByText("$1,200 in Buckets")).toBeVisible();
	await addBucket(page, "Hockey", "400");
	await expect(page.getByText("$1,600 in Buckets")).toBeVisible();
	await backToPlan(page);
	await expect(freeToSpend(page)).toHaveText("Free to Spend$7,400");

	// Allowances beyond take-home pay are allowed, but never silently.
	await openStep(page, "Buckets");
	await setAllowance(page, "Groceries", "8,800");
	await backToPlan(page);
	await expect(freeToSpend(page)).toHaveText("Free to Spend−$200");
	await expect(waterfall(page)).toContainText(
		"Your Buckets add up to $200 more than your take-home pay",
	);
	await openStep(page, "Buckets");
	await setAllowance(page, "Groceries", "1,250.50");
	await backToPlan(page);
	await expect(freeToSpend(page)).toHaveText("Free to Spend$7,349.50");
	await expect(waterfall(page)).not.toContainText("more than your take-home pay");

	// Rename, recolour, and reorder Hockey, on its page.
	await openStep(page, "Buckets");
	await openBucket(page, "Hockey");
	const details = await editBucket(page, "Hockey");
	await details.getByLabel("Name").fill("Kids’ hockey");
	await details.getByRole("radio", { name: "Green" }).check();
	await details.getByRole("button", { name: "Save", exact: true }).click();
	await expect(details).toBeHidden();
	await expect(page.locator("[data-slot=detail-header]")).toContainText("Kids’ hockey");
	// Moving happens at once, apart from Save.
	await editBucket(page, "Kids’ hockey");
	await page.getByRole("button", { name: "Move up" }).click();
	await page.keyboard.press("Escape");
	await expect(page.locator("[data-slot=detail-header]")).toContainText("Kids’ hockey");
	await page.getByRole("link", { name: "Back to Buckets" }).click();
	await expect(page.getByRole("main").getByRole("listitem").first()).toContainText("Kids’ hockey");

	// Everything above was saved, not just shown.
	await page.reload();
	await expect(page.getByRole("main").getByRole("listitem").first()).toContainText("Kids’ hockey");
	await expect(bucketRow(page, "Groceries")).toContainText("$1,250.50");
	await openBucket(page, "Kids’ hockey");
	await editBucket(page, "Kids’ hockey");
	await expect(page.getByRole("radio", { name: "Green" })).toBeChecked();
	await page.keyboard.press("Escape");
	await page.getByRole("link", { name: "Back to Buckets" }).click();
	await backToPlan(page);
	await expect(freeToSpend(page)).toHaveText("Free to Spend$7,349.50");

	await switchTo(page, "Month");
	const hero = page.getByRole("region", { name: "Free to Spend" });
	await expect(hero).toContainText("$7,349.50");
	await expect(hero).toContainText("In Buckets$1,650.50");
	await expect(
		page.getByRole("listitem", { name: /^Kids’ hockey: \$400 left of \$400/ }),
	).toBeVisible();
	await expect(
		page.getByRole("listitem", { name: /^Groceries: \$1,250\.50 left of \$1,250\.50/ }),
	).toBeVisible();

	// Archiving takes a Bucket out of this month's Plan.
	await switchTo(page, "Plan");
	await openStep(page, "Buckets");
	await openBucket(page, "Groceries");
	await editBucket(page, "Groceries");
	await page.getByRole("button", { name: "Archive", exact: true }).click();
	await page.getByRole("button", { name: "Archive Groceries" }).click();
	await expect(page.locator("[data-slot=detail-header]")).toContainText("Archived Bucket");
	await page.getByRole("link", { name: "Back to Buckets" }).click();
	await expect(page.getByRole("button", { name: "Edit Groceries" })).toHaveCount(0);
	await backToPlan(page);
	await expect(freeToSpend(page)).toHaveText("Free to Spend$8,600");
	await page.reload();
	await expect(freeToSpend(page)).toHaveText("Free to Spend$8,600");
	await openStep(page, "Buckets");
	await expect(page.getByRole("button", { name: "Edit Groceries" })).toHaveCount(0);
	await page.context().close();
});

test("a failed save is undone and can be retried", async ({ browser }) => {
	const page = await signedInPage(browser, parent.email);
	await openPlan(page);
	await setTakeHomePay(page, "5,000");
	await expect(freeToSpend(page)).toHaveText("Free to Spend$5,000");
	await page.getByRole("link", { name: "Add Buckets" }).click();
	await addBucket(page, "Fun", "300");
	await expect(page.getByText("$300 in Buckets")).toBeVisible();

	const save = serverFn("setAllowance");
	await page.route(save, (route) => route.fulfill({ status: 500, body: "Server error" }));
	await setAllowance(page, "Fun", "500");
	await expect(page.getByRole("alert")).toContainText("We couldn’t save that change");
	await expect(bucketRow(page, "Fun")).toContainText("$300");
	await expect(page.getByText("$300 in Buckets")).toBeVisible();

	await page.unroute(save);
	await page.getByRole("button", { name: "Try again" }).click();
	await expect(page.getByText("$500 in Buckets")).toBeVisible();
	await expect(page.getByRole("alert")).toHaveCount(0);
	await page.reload();
	await expect(bucketRow(page, "Fun")).toContainText("$500");
	await backToPlan(page);
	await expect(freeToSpend(page)).toHaveText("Free to Spend$4,500");
	await page.context().close();
});

test("adding a Bucket twice with the same ID creates one Bucket", async ({ browser }) => {
	const page = await signedInPage(browser, parent.email);
	await openPlan(page);
	await page.getByRole("link", { name: "Add Buckets" }).click();
	// Deliver the request to the server twice, as a retry after a lost response would.
	await page.route(serverFn("addBucket"), async (route) => {
		await route.fetch();
		await route.continue();
	});
	const saved = savedBy(page, "addBucket");
	await addBucket(page, "Life", "250");
	await saved;
	await page.reload();
	await expect(page.getByRole("button", { name: "Edit Life" })).toHaveCount(1);
	// No take-home pay yet, so the overview is still setting up: one Bucket, counted once.
	await page
		.getByRole("navigation", { name: "Plan pages" })
		.getByRole("link", { name: "Overview" })
		.click();
	await expect(page.getByRole("region", { name: "Set up the Plan" })).toContainText(
		"1 Bucket · $250 a month",
	);
	await page.context().close();
});
