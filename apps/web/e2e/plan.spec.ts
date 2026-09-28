import { expect, type Page, test } from "@playwright/test";
import { createTestParent } from "./parents";
import { createHousehold, serverFn, signedInPage } from "./session";

let parent: Awaited<ReturnType<typeof createTestParent>>;

test.beforeEach(async () => {
	parent = await createTestParent();
});

test.afterEach(async () => {
	await parent?.remove();
});

/** Opens the Plan editor from an empty This Month. */
async function openPlan(page: Page) {
	await createHousehold(page, "The Rinks", "Alex");
	await page.getByRole("link", { name: "Set up the Plan" }).click();
	await expect(page.getByRole("heading", { level: 1 })).toContainText("Plan");
}

const summary = (page: Page) => page.getByRole("region", { name: "Free to Spend" });
const freeToSpend = (page: Page) => summary(page).getByRole("definition").last();
const allowance = (page: Page, bucket: string) => page.getByLabel(`${bucket} allowance`);

async function setAmount(page: Page, label: string, amount: string) {
	const input = page.getByLabel(label, { exact: true });
	await input.fill(amount);
	await input.press("Enter");
}

async function addBucket(page: Page, name: string, amount: string) {
	await page.getByLabel("New Bucket").fill(name);
	await page.getByLabel("Monthly allowance").fill(amount);
	await page.getByRole("button", { name: "Add Bucket" }).click();
	await expect(allowance(page, name)).toBeVisible();
}

test("a Parent plans the month and This Month shows Free to Spend and each Bucket", async ({
	browser,
}) => {
	const page = await signedInPage(browser, parent.email);
	await openPlan(page);

	await setAmount(page, "Baseline", "9,000");
	await expect(freeToSpend(page)).toHaveText("$9,000");
	await addBucket(page, "Groceries", "1,200");
	await expect(freeToSpend(page)).toHaveText("$7,800");
	await addBucket(page, "Hockey", "400");
	await expect(freeToSpend(page)).toHaveText("$7,400");

	// Allowances beyond the Baseline are allowed, but never silently.
	await setAmount(page, "Groceries allowance", "8,800");
	await expect(freeToSpend(page)).toHaveText("−$200");
	await expect(summary(page)).toContainText("Your Buckets add up to $200 more than your Baseline");
	await setAmount(page, "Groceries allowance", "1,250.50");
	await expect(freeToSpend(page)).toHaveText("$7,349.50");
	await expect(summary(page)).not.toContainText("more than your Baseline");

	// Rename, recolour, and reorder Hockey.
	await page.getByRole("button", { name: "Edit Hockey" }).click();
	await page.getByLabel("Name").fill("Kids’ hockey");
	await page.getByRole("button", { name: "Rename" }).click();
	await expect(allowance(page, "Kids’ hockey")).toBeVisible();
	await page.getByRole("radio", { name: "Green" }).check();
	await page.getByRole("button", { name: "Move up" }).click();
	await expect(page.getByRole("listitem").first()).toContainText("Kids’ hockey");

	// Everything above was saved, not just shown.
	await page.reload();
	await expect(freeToSpend(page)).toHaveText("$7,349.50");
	await expect(page.getByRole("listitem").first()).toContainText("Kids’ hockey");
	await expect(allowance(page, "Groceries")).toHaveValue("1,250.50");
	await page.getByRole("button", { name: "Edit Kids’ hockey" }).click();
	await expect(page.getByRole("radio", { name: "Green" })).toBeChecked();

	await page.getByRole("link", { name: "Back to This Month" }).click();
	await expect(page.getByRole("heading", { level: 1 })).toContainText("This Month");
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
	await page.getByRole("link", { name: "Edit Plan" }).click();
	await page.getByRole("button", { name: "Edit Groceries" }).click();
	await page.getByRole("button", { name: "Archive", exact: true }).click();
	await page.getByRole("button", { name: "Archive Groceries" }).click();
	await expect(allowance(page, "Groceries")).toHaveCount(0);
	await expect(freeToSpend(page)).toHaveText("$8,600");
	await page.reload();
	await expect(allowance(page, "Groceries")).toHaveCount(0);
	await page.context().close();
});

test("a failed save is undone and can be retried", async ({ browser }) => {
	const page = await signedInPage(browser, parent.email);
	await openPlan(page);
	await setAmount(page, "Baseline", "5,000");
	await addBucket(page, "Fun", "300");
	await expect(freeToSpend(page)).toHaveText("$4,700");

	const setAllowance = serverFn("setAllowance");
	await page.route(setAllowance, (route) => route.fulfill({ status: 500, body: "Server error" }));
	await setAmount(page, "Fun allowance", "500");
	await expect(page.getByRole("alert")).toContainText("We couldn’t save that change");
	await expect(freeToSpend(page)).toHaveText("$4,700");
	await expect(allowance(page, "Fun")).toHaveValue("300");

	await page.unroute(setAllowance);
	await page.getByRole("button", { name: "Try again" }).click();
	await expect(freeToSpend(page)).toHaveText("$4,500");
	await expect(page.getByRole("alert")).toHaveCount(0);
	await page.reload();
	await expect(allowance(page, "Fun")).toHaveValue("500");
	await page.context().close();
});

test("adding a Bucket twice with the same ID creates one Bucket", async ({ browser }) => {
	const page = await signedInPage(browser, parent.email);
	await openPlan(page);
	// Deliver the request to the server twice, as a retry after a lost response would.
	await page.route(serverFn("addBucket"), async (route) => {
		await route.fetch();
		await route.continue();
	});
	await addBucket(page, "Life", "250");
	await page.reload();
	await expect(allowance(page, "Life")).toHaveCount(1);
	await expect(freeToSpend(page)).toHaveText("−$250");
	await page.context().close();
});
