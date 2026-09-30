import { expect, type Page, test } from "@playwright/test";
import { createTestParent } from "./parents";
import { createPlannedHousehold, signedInPage } from "./session";

let parent: Awaited<ReturnType<typeof createTestParent>>;

test.beforeEach(async () => {
	parent = await createTestParent();
});

test.afterEach(async () => {
	await parent?.remove();
});

const freeToSpend = (page: Page) => page.getByRole("region", { name: "Free to Spend" });
const income = (page: Page) => page.getByRole("region", { name: "Income" });
const windfall = (page: Page) => page.getByRole("region", { name: "Windfall" });

async function addIncome(page: Page, amount: string, note: string) {
	await income(page).getByRole("button", { name: "Add income" }).click();
	const sheet = page.getByRole("dialog", { name: "Add income" });
	await sheet.getByLabel("Amount").fill(amount);
	await sheet.getByLabel("Note").fill(note);
	await sheet.getByRole("button", { name: "Add income" }).click();
	await expect(sheet).toBeHidden();
}

test("income beyond the Baseline is a Windfall, sent to the emergency Goal", async ({
	browser,
}) => {
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, {
		baseline: "5,000",
		buckets: [["Groceries", "1,200"]],
	});
	const thisMonth = page.url();
	await expect(freeToSpend(page).getByText("$3,800", { exact: true })).toBeVisible();

	// A Goal kept for emergencies.
	await page.getByRole("link", { name: "Accounts", exact: true }).click();
	await page.getByLabel("Name").fill("Ally savings");
	await page.getByLabel("Kind").selectOption("savings");
	await page.getByLabel("Balance now").fill("10,000");
	await page.getByRole("button", { name: "Add Account" }).click();
	await expect(page.getByRole("link", { name: /^Ally savings, Savings/ })).toBeVisible();
	await page.getByRole("link", { name: "Goals", exact: true }).click();
	await page.getByRole("button", { name: "Add Goal" }).click();
	const addGoal = page.getByRole("dialog", { name: "Add a Goal" });
	await addGoal.getByLabel("Name").fill("Rainy day");
	await addGoal.getByLabel("Target", { exact: true }).fill("6,000");
	await addGoal.getByRole("button", { name: "Add Goal" }).click();
	await expect(addGoal).toBeHidden();
	await page.getByRole("link", { name: /^Rainy day, / }).click();
	await page.getByRole("button", { name: "Use for emergencies" }).click();
	await expect(page.getByRole("button", { name: "Stop using" })).toBeVisible();

	// The Baseline's worth of paychecks is no Windfall.
	await page.goto(thisMonth);
	await addIncome(page, "2,500", "Paycheck");
	await addIncome(page, "2,500", "Paycheck");
	await expect(income(page)).toContainText("$5,000 received of the $5,000 Baseline");
	await expect(windfall(page)).toBeHidden();

	// A bonus is, and it doesn't touch Free to Spend.
	await addIncome(page, "1,200", "Bonus");
	await expect(windfall(page)).toContainText("$1,200 came in beyond the Baseline");
	await expect(freeToSpend(page).getByText("$3,800", { exact: true })).toBeVisible();
	const suggestion = windfall(page).getByRole("listitem").filter({ hasText: "Rainy day" });
	await expect(suggestion).toContainText("Your emergency Goal");
	await suggestion.getByRole("button", { name: "Send $1,200 to Rainy day" }).click();
	await expect(page.getByRole("status").filter({ hasText: "of the Windfall" })).toContainText(
		"$1,200 of the Windfall to Rainy day",
	);
	await expect(windfall(page)).toBeHidden();
	await expect(freeToSpend(page).getByText("$3,800", { exact: true })).toBeVisible();

	// It stuck, and it's in the Goal's Earmark.
	await page.reload();
	await expect(income(page)).toContainText("$6,200 received");
	await expect(windfall(page)).toBeHidden();
	await page.getByRole("link", { name: "Goals", exact: true }).click();
	await page.getByRole("link", { name: /^Rainy day, \$1,200 of \$6,000/ }).click();
	await expect(page.getByRole("listitem").filter({ hasText: "From a Windfall" })).toContainText(
		"$1,200",
	);
});

test("income removed by mistake comes back with Undo", async ({ browser }) => {
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, { baseline: "5,000", buckets: [["Groceries", "1,200"]] });
	await addIncome(page, "2,500", "Paycheck");
	await expect(income(page)).toContainText("$2,500 received of the $5,000 Baseline");

	await income(page).getByRole("button", { name: "Remove $2,500 of income" }).click();
	await expect(income(page)).toContainText("$0 received");
	const removed = page.getByRole("status").filter({ hasText: "$2,500 of income removed" });
	await removed.getByRole("button", { name: "Undo" }).click();
	await expect(income(page)).toContainText("$2,500 received of the $5,000 Baseline");
	await expect(income(page).getByRole("listitem")).toContainText("Paycheck");

	// It's back for good, not only on screen.
	await page.reload();
	await expect(income(page)).toContainText("$2,500 received of the $5,000 Baseline");
	await page.context().close();
});
