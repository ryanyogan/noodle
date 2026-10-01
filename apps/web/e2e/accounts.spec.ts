import { expect, type Page, test } from "@playwright/test";
import { createTestParent } from "./parents";
import { createPlannedHousehold, signedInPage } from "./session";

// Accounts have their own area: every Account and Bank Connection at /accounts, each Account's
// page under it, and Goals keeping only Goals, each naming the Account that holds it.

let parent: Awaited<ReturnType<typeof createTestParent>>;

test.beforeEach(async () => {
	parent = await createTestParent();
});

test.afterEach(async () => {
	await parent?.remove();
});

const plan = { baseline: "5,000", buckets: [["Groceries", "1,200"]] as [string, string][] };
const phone = { viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true };
const heading = (page: Page) => page.getByRole("heading", { level: 1 });

test("Accounts are their own area, and each Goal names the Account holding it", async ({
	browser,
}) => {
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, plan);

	// Before any Account, Goals points to Accounts rather than adding one itself.
	await page.getByRole("link", { name: "Goals", exact: true }).click();
	await expect(heading(page)).toHaveText("Goals");
	await expect(page.getByLabel("Balance now")).toHaveCount(0);
	await page.getByRole("link", { name: "Go to Accounts" }).click();

	// The empty state names the three ways in, connecting first; adding one by hand is below.
	await expect(heading(page)).toHaveText("Accounts");
	await expect(page.getByText("Accounts are where the money is")).toBeVisible();
	const ways = page.getByRole("list", { name: "Ways to add an Account" }).getByRole("listitem");
	await expect(ways).toHaveCount(3);
	await expect(ways.nth(0)).toContainText("Connect your bank");
	await expect(ways.nth(0).getByRole("button", { name: "Connect a bank" })).toBeVisible();
	await expect(ways.nth(1)).toContainText("Upload statements");
	await expect(ways.nth(2)).toContainText("Type in a balance");

	await page.getByLabel("Name").fill("Joint Savings");
	await page.getByLabel("Kind").selectOption("savings");
	await page.getByLabel("Balance now").fill("8,000");
	await page.getByRole("button", { name: "Add Account" }).click();
	const savings = page.getByRole("link", { name: /^Joint Savings, Savings, \$8,000/ });
	await expect(savings).toContainText("Set aside $0 · Not set aside $8,000");

	// A second Account, from the header's Add Account.
	await page.getByRole("button", { name: "Add Account" }).click();
	const sheet = page.getByRole("dialog", { name: "Add an Account" });
	await sheet.getByLabel("Name").fill("Visa");
	await sheet.getByLabel("Kind").selectOption("credit-card");
	await sheet.getByLabel("Owed now").fill("600");
	await sheet.getByRole("button", { name: "Add Account" }).click();
	await expect(page.getByRole("link", { name: /^Visa, Credit card, / })).toBeVisible();

	// Goals has only Goals now; a Goal says where it's held, and its page links there.
	await page.getByRole("link", { name: "Goals", exact: true }).click();
	await expect(page.getByRole("heading", { name: /^Accounts/ })).toHaveCount(0);
	await expect(page.getByRole("region", { name: "Bank Connections" })).toHaveCount(0);
	await page.getByRole("button", { name: "Add Goal" }).click();
	const addGoal = page.getByRole("dialog", { name: "Add a Goal" });
	await addGoal.getByLabel("Name").fill("Trip");
	await addGoal.getByLabel("Target", { exact: true }).fill("3,000");
	await addGoal.getByLabel("Already set aside").fill("500");
	await addGoal.getByRole("button", { name: "Add Goal" }).click();
	await expect(addGoal).toBeHidden();
	const trip = page.getByRole("link", { name: /^Trip, \$500 of \$3,000, in Joint Savings$/ });
	await expect(trip).toContainText("in Joint Savings");
	await trip.click();
	await page.getByRole("link", { name: "Joint Savings", exact: true }).click();

	// The Account's page lives under Accounts, and back goes to Accounts.
	await expect(heading(page)).toContainText("Joint Savings");
	await expect(page).toHaveURL(/\/accounts\/[^/]+$/);
	await expect(page.getByRole("link", { name: "Trip, $500 set aside" })).toBeVisible();
	const accountPath = new URL(page.url()).pathname;
	await page.getByRole("link", { name: "Back to Accounts" }).click();
	await expect(heading(page)).toHaveText("Accounts");
	await expect(savings).toContainText("Set aside $500 · Not set aside $7,500");

	// The old address still opens it.
	await page.goto(`/goals${accountPath}`);
	await expect(page).toHaveURL(new RegExp(`${accountPath}$`));
	await expect(heading(page)).toContainText("Joint Savings");
});

test("on a phone, Accounts is reached from Transactions and the Household page", async ({
	browser,
}) => {
	const page = await signedInPage(browser, parent.email, { ...phone, colorScheme: "dark" });
	await createPlannedHousehold(page, plan);
	const tabs = page.getByRole("navigation", { name: "Main" });
	await expect(tabs.getByRole("link", { name: "Accounts" })).toHaveCount(0);

	await tabs.getByRole("link", { name: "Transactions" }).click();
	await expect(heading(page)).toContainText("Transactions");
	await page.getByRole("link", { name: "Accounts", exact: true }).click();
	await expect(heading(page)).toHaveText("Accounts");
	// Accounts sits with Transactions in the tab bar.
	await expect(tabs.getByRole("link", { name: "Transactions" })).toHaveClass(
		/(^|\s)text-foreground(\s|$)/,
	);
	const width = await page.evaluate(() => document.documentElement.scrollWidth);
	expect(width).toBeLessThanOrEqual(393);

	await tabs.getByRole("link", { name: "Household" }).click();
	await page.getByRole("link", { name: "Accounts", exact: true }).click();
	await expect(heading(page)).toHaveText("Accounts");
});
