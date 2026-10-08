import { expect, type Page, test } from "@playwright/test";
import { openMoneyIn } from "./money-in-rows";
import { createTestParent } from "./parents";
import { createPlannedHousehold, signedInPage } from "./session";

// Money between the two Parents (issue 92): only one Parent's Account is in Noodle, so the other's
// Zelle arrives looking like Income. Saying "It's between us" takes it out of Income and Extra
// income without it becoming spending, and Undo brings it back.

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
const betweenUs = (page: Page) => income(page).getByRole("region", { name: "Between us" });
const toast = (page: Page, text: string) => page.getByRole("status").filter({ hasText: text });

async function addIncome(page: Page, amount: string, note: string) {
	await income(page).getByRole("button", { name: "Add income" }).click();
	const sheet = page.getByRole("dialog", { name: "Add income" });
	await sheet.getByLabel("Amount").fill(amount);
	await sheet.getByLabel("Note").fill(note);
	await sheet.getByRole("button", { name: "Add income" }).click();
	await expect(sheet).toBeHidden();
}

test("a Zelle from the other Parent marked as between us isn't Income or Extra income, and Undo brings it back", async ({
	browser,
}) => {
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, {
		baseline: "5,000",
		buckets: [["Groceries", "1,200"]],
	});
	await expect(freeToSpend(page).getByText("$3,800", { exact: true }).first()).toBeVisible();

	await addIncome(page, "5,000", "Paycheck");
	await addIncome(page, "1,500", "Zelle from Sam");
	await expect(income(page)).toContainText("$6,500 received of $5,000 usual take-home pay");
	// The line looks person to person, so the list says what can be done about it.
	await expect(income(page)).toContainText("From the other Parent? It’s between us");
	await expect(betweenUs(page)).toBeHidden();

	await income(page).getByRole("button", { name: "Actions for $1,500 of income" }).click();
	await page.getByRole("menuitem", { name: "It’s between us · not Income" }).click();
	const marked = toast(page, "$1,500 is between you, so it isn’t Income");
	await expect(marked).toBeVisible();

	// Out of the Income total and off the Income list (it only moved between the two Parents, so
	// it is a row on Transactions and nowhere here), and nothing else moved.
	await expect(income(page)).toContainText("$5,000 received of $5,000 usual take-home pay");
	await expect(income(page)).not.toContainText("Zelle from Sam");
	await expect(betweenUs(page)).toHaveCount(0);
	await expect(extraIncome(page)).toBeHidden();
	await expect(freeToSpend(page).getByText("$3,800", { exact: true }).first()).toBeVisible();

	// It stays that way after a reload: the server keeps it, not just this screen.
	await page.reload();
	await expect(income(page)).toContainText("$5,000 received of $5,000 usual take-home pay");
	await expect(income(page)).not.toContainText("Zelle from Sam");

	// On Transactions it is a row like any other, where a Parent can say it is Income after all.
	await page.goto("/transactions");
	const { editor } = await openMoneyIn(page, "Zelle from Sam");
	await editor.getByRole("button", { name: "Income", exact: true }).click();
	await page.goto("/");
	await expect(income(page)).toContainText("$6,500 received of $5,000 usual take-home pay");

	// And the toast's Undo right after marking.
	await income(page).getByRole("button", { name: "Actions for $1,500 of income" }).click();
	await page.getByRole("menuitem", { name: "It’s between us · not Income" }).click();
	await toast(page, "$1,500 is between you, so it isn’t Income")
		.getByRole("button", { name: "Undo" })
		.click();
	await expect(income(page)).toContainText("$6,500 received of $5,000 usual take-home pay");
	await expect(betweenUs(page)).toBeHidden();
	await expect(freeToSpend(page).getByText("$3,800", { exact: true }).first()).toBeVisible();
});
