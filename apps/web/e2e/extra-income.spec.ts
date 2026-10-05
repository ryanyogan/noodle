import { expect, type Page, test } from "@playwright/test";
import { createTestParent } from "./parents";
import {
	accountKindLabel,
	choose,
	createPlannedHousehold,
	openToDo,
	signedInPage,
} from "./session";

let parent: Awaited<ReturnType<typeof createTestParent>>;

test.beforeEach(async () => {
	parent = await createTestParent();
});

test.afterEach(async () => {
	await parent?.remove();
});

const freeToSpend = (page: Page) => page.getByRole("region", { name: "Free to Spend" });
const income = (page: Page) => page.getByRole("region", { name: "Income" });
const extraIncome = (page: Page) => page.getByRole("region", { name: "Extra income" });

async function addIncome(page: Page, amount: string, note: string) {
	await income(page).getByRole("button", { name: "Add income" }).click();
	const sheet = page.getByRole("dialog", { name: "Add income" });
	await sheet.getByLabel("Amount").fill(amount);
	await sheet.getByLabel("Note").fill(note);
	await sheet.getByRole("button", { name: "Add income" }).click();
	await expect(sheet).toBeHidden();
}

test("income beyond take-home pay is Extra income, sent to the emergency Goal", async ({
	browser,
}) => {
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, {
		baseline: "5,000",
		buckets: [["Groceries", "1,200"]],
	});
	const thisMonth = page.url();
	await expect(freeToSpend(page).getByText("$3,800", { exact: true }).first()).toBeVisible();

	// A Goal kept for emergencies.
	await page.getByRole("link", { name: "Accounts", exact: true }).click();
	await page.getByLabel("Name").fill("Ally savings");
	await choose(page, "Kind", accountKindLabel("savings"));
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

	// Take-home pay's worth of paychecks is no Extra income.
	await page.goto(thisMonth);
	await addIncome(page, "2,500", "Paycheck");
	await addIncome(page, "2,500", "Paycheck");
	await expect(income(page)).toContainText("$5,000 received of $5,000 usual take-home pay");
	await expect(extraIncome(page)).toBeHidden();

	// A bonus is, and it doesn't touch Free to Spend.
	await addIncome(page, "1,200", "Bonus");
	await openToDo(page, "Extra income");
	await expect(extraIncome(page)).toContainText("$1,200 came in above your usual take-home pay");
	await expect(freeToSpend(page).getByText("$3,800", { exact: true }).first()).toBeVisible();
	const suggestion = extraIncome(page).getByRole("listitem").filter({ hasText: "Rainy day" });
	await expect(suggestion).toContainText("Your emergency Goal");
	await suggestion.getByRole("button", { name: "Send $1,200 to Rainy day" }).click();
	await expect(page.getByRole("status").filter({ hasText: "of the Extra income" })).toContainText(
		"$1,200 of the Extra income to Rainy day",
	);
	await expect(extraIncome(page)).toBeHidden();
	await expect(freeToSpend(page).getByText("$3,800", { exact: true }).first()).toBeVisible();

	// It stuck, and it's in what the Goal has set aside.
	await page.reload();
	await expect(income(page)).toContainText("$6,200 received");
	await expect(extraIncome(page)).toBeHidden();
	await page.getByRole("link", { name: "Goals", exact: true }).click();
	await page.getByRole("link", { name: /^Rainy day, \$1,200 of \$6,000/ }).click();
	await expect(page.getByRole("listitem").filter({ hasText: "From Extra income" })).toContainText(
		"$1,200",
	);
});

test("Extra income is added to Free to Spend in one tap; a few dollars over is not Extra income", async ({
	browser,
}) => {
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, { baseline: "5,000", buckets: [["Groceries", "1,200"]] });
	await expect(freeToSpend(page).getByText("$3,800", { exact: true }).first()).toBeVisible();

	// A fixed pay that lands a few dollars over raises nothing to do (#86).
	await addIncome(page, "5,010", "Paychecks");
	await expect(income(page)).toContainText("$5,010 received of $5,000 usual take-home pay");
	await expect(page.getByRole("region", { name: "To do" }).getByText("Extra income")).toHaveCount(
		0,
	);

	// Pay that came in well above is Extra income, and one tap makes it Free to Spend.
	await addIncome(page, "990", "Extra shifts");
	await openToDo(page, "Extra income");
	await expect(extraIncome(page)).toContainText("$1,000 came in above your usual take-home pay");
	await extraIncome(page).getByRole("button", { name: "Add $1,000 to Free to Spend" }).click();
	await expect(page.getByRole("status").filter({ hasText: "of the Extra income" })).toContainText(
		"$1,000 of the Extra income to Free to Spend",
	);
	await expect(extraIncome(page)).toBeHidden();
	await expect(freeToSpend(page).getByText("$4,800", { exact: true }).first()).toBeVisible();

	// It stuck.
	await page.reload();
	await expect(freeToSpend(page).getByText("$4,800", { exact: true }).first()).toBeVisible();
	await expect(extraIncome(page)).toBeHidden();
	await page.context().close();
});

test("income removed by mistake comes back with Undo", async ({ browser }) => {
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, { baseline: "5,000", buckets: [["Groceries", "1,200"]] });
	await addIncome(page, "2,500", "Paycheck");
	await expect(income(page)).toContainText("$2,500 received of $5,000 usual take-home pay");

	await income(page).getByRole("button", { name: "Actions for $2,500 of income" }).click();
	await page.getByRole("menuitem", { name: "Remove income" }).click();
	await expect(income(page)).toContainText("$0 received");
	const removed = page.getByRole("status").filter({ hasText: "$2,500 of income removed" });
	await removed.getByRole("button", { name: "Undo" }).click();
	await expect(income(page)).toContainText("$2,500 received of $5,000 usual take-home pay");
	await expect(income(page).getByRole("listitem")).toContainText("Paycheck");

	// It's back for good, not only on screen.
	await page.reload();
	await expect(income(page)).toContainText("$2,500 received of $5,000 usual take-home pay");
	await page.context().close();
});

test("income is added and removed on Plan › Income as on This Month", async ({ browser }) => {
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, { baseline: "5,000", buckets: [["Groceries", "1,200"]] });
	const month = /\/month\/(\d{4}-\d{2})/.exec(page.url())?.[1];
	if (!month) throw new Error(`No month in ${page.url()}`);
	await page.goto(`/plan/${month}/income`);
	await expect(page.locator("nav[aria-label='Plan pages'] [aria-current=page]")).toHaveText(
		"Income",
	);
	await addIncome(page, "2,500", "Paycheck");
	await expect(income(page)).toContainText("$2,500 received of $5,000 usual take-home pay");
	await expect(income(page).getByRole("listitem")).toContainText("Paycheck");

	// The same list on This Month, and the same row actions on either.
	await page.goto(`/month/${month}`);
	await expect(income(page)).toContainText("$2,500 received of $5,000");
	await page.goto(`/plan/${month}/income`);
	await income(page).getByRole("button", { name: "Actions for $2,500 of income" }).click();
	await page.getByRole("menuitem", { name: "Remove income" }).click();
	await expect(income(page).getByRole("listitem")).toHaveCount(0);
	await page.context().close();
});
