import { expect, type Page, test } from "@playwright/test";
import { createTestParent } from "./parents";
import { createPlannedHousehold, signedInPage, switchTo } from "./session";

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

const freeToSpend = (page: Page) => page.getByRole("region", { name: "Free to Spend" });
const setAside = (page: Page) => page.getByRole("region", { name: "Set aside" });
const bucketRow = (page: Page, name: string) =>
	page.getByRole("listitem", { name: new RegExp(`^${name}: `) });

/** A day about a year ahead, as a date input takes it. */
function aYearAhead() {
	const day = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
	return day.toISOString().slice(0, 10);
}

async function openAccounts(page: Page) {
	await page.getByRole("link", { name: "Accounts", exact: true }).click();
	await expect(page.getByRole("heading", { level: 1 })).toHaveText("Accounts");
}

async function openGoals(page: Page) {
	await page.getByRole("link", { name: "Goals", exact: true }).click();
	await expect(page.getByRole("heading", { level: 1 })).toHaveText("Goals");
}

test("a Goal is funded from Free to Spend and spent from what it has set aside, never a Bucket", async ({
	browser,
}) => {
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, plan);
	const thisMonth = page.url();
	await expect(freeToSpend(page).getByText("$3,400", { exact: true })).toBeVisible();

	// An Account with what's in it, then a dated Goal on it with some already set aside.
	await openAccounts(page);
	await page.getByLabel("Name").fill("Ally savings");
	await page.getByLabel("Kind").selectOption("savings");
	await page.getByLabel("Balance now").fill("10,000");
	await page.getByRole("button", { name: "Add Account" }).click();
	await expect(page.getByRole("link", { name: /^Ally savings, Savings, \$10,000/ })).toBeVisible();

	await openGoals(page);
	await page.getByRole("button", { name: "Add Goal" }).click();
	const addGoal = page.getByRole("dialog", { name: "Add a Goal" });
	await addGoal.getByLabel("Name").fill("Braces");
	await addGoal.getByLabel("Target", { exact: true }).fill("6,000");
	await addGoal.getByLabel("Target date").fill(aYearAhead());
	await addGoal.getByLabel("Already set aside").fill("1,000");
	await addGoal.getByRole("button", { name: "Add Goal" }).click();
	await expect(addGoal).toBeHidden();

	// Each Goal says which Account holds it.
	await page.getByRole("link", { name: /^Braces, \$1,000 of \$6,000, in Ally savings$/ }).click();
	await expect(page.getByRole("heading", { level: 1 })).toContainText("Braces");
	await expect(setAside(page)).toContainText("$1,000of $6,000");

	// Funding more than Free to Spend has can't be sent, and says how much there is.
	await setAside(page).getByRole("button", { name: "Fund" }).click();
	const fund = page.getByRole("dialog", { name: "Fund Braces" });
	await expect(fund.getByLabel("Amount")).not.toHaveValue("");
	await fund.getByLabel("Amount").fill("5,000");
	await expect(fund).toContainText("Free to Spend has only $3,400 this month.");
	await expect(fund.getByRole("button", { name: "Fund" })).toBeDisabled();
	await fund.getByLabel("Amount").fill("250");
	await fund.getByRole("button", { name: "Fund" }).click();
	await expect(fund).toBeHidden();
	await expect(page.getByRole("status").filter({ hasText: "to Braces" })).toContainText(
		"$250 from Free to Spend to Braces",
	);
	await expect(setAside(page)).toContainText("$1,250of $6,000");
	await expect(page.getByRole("list").getByText("Funded from Free to Spend")).toBeVisible();

	// Free to Spend drops by exactly the funding, on the Plan and on This Month.
	await page.goto(thisMonth);
	await expect(freeToSpend(page).getByText("$3,150", { exact: true })).toBeVisible();
	await switchTo(page, "Plan");
	const waterfall = page.getByRole("region", { name: "From take-home pay to Free to Spend" });
	await expect(waterfall).toContainText("Goal funding−$250");
	await expect(waterfall).toContainText("Free to Spend$3,150");
	await waterfall.getByRole("link", { name: "Goal funding" }).click();
	await expect(page.getByRole("region", { name: /^To fund this month/ })).toContainText("Braces");

	// Spending comes out of what's set aside, and no more than it.
	await openGoals(page);
	await page.getByRole("link", { name: /^Braces, / }).click();
	await setAside(page).getByRole("button", { name: "Spend" }).click();
	const spend = page.getByRole("dialog", { name: "Spend from Braces" });
	await spend.getByLabel("Amount").fill("2,000");
	await expect(spend).toContainText("That’s more than the $1,250 set aside.");
	await expect(spend.getByRole("button", { name: "Spend" })).toBeDisabled();
	await spend.getByLabel("Amount").fill("400");
	await spend.getByLabel("Note").fill("First payment");
	await spend.getByRole("button", { name: "Spend" }).click();
	await expect(spend).toBeHidden();
	await expect(setAside(page)).toContainText("$850of $6,000");
	await expect(page.getByRole("listitem").filter({ hasText: "First payment" })).toContainText(
		"−$400",
	);

	// The Account: the spending came off its balance, and not set aside is what isn't Set aside.
	await page.getByRole("link", { name: "Ally savings", exact: true }).click();
	await expect(page.getByRole("heading", { level: 1 })).toContainText("Ally savings");
	const balance = page.getByRole("region", { name: "Balance" });
	await expect(balance.getByText("$9,600", { exact: true })).toBeVisible();
	await expect(balance).toContainText("Goal spending of $400 since the balance was last updated");
	await expect(page.getByRole("link", { name: "Braces, $850 set aside" })).toBeVisible();
	await expect(page.getByRole("listitem", { name: "Not set aside, $8,750" })).toBeVisible();

	// A lower balance than what Goals have set aside is said plainly.
	await balance.getByRole("button", { name: "Update balance" }).click();
	const update = page.getByRole("dialog", { name: "Update balance" });
	await update.getByLabel("Balance now").fill("500");
	await update.getByRole("button", { name: "Save" }).click();
	await expect(update).toBeHidden();
	await expect(balance).toContainText("Goals have set aside $350 more than the balance");
	await expect(page.getByRole("listitem", { name: "Not set aside, −$350" })).toBeVisible();

	// Goal spending never touched a Bucket or Free to Spend.
	await page.goto(thisMonth);
	await expect(freeToSpend(page).getByText("$3,150", { exact: true })).toBeVisible();
	await expect(bucketRow(page, "Groceries")).toHaveAccessibleName(
		/^Groceries: \$1,200 left of \$1,200/,
	);
	await expect(bucketRow(page, "Hockey")).toHaveAccessibleName(/^Hockey: \$400 left of \$400/);
});
