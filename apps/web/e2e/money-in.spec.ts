import { expect, type Page, test } from "@playwright/test";
import { createTestParent } from "./parents";
import { createPlannedHousehold, signedInPage } from "./session";

// Money in has a kind (issue 131, ADR-0057): it is listed on Transactions with its kind in plain
// words, and a Parent can say it is something other than Income, which takes it out of Income.

let parent: Awaited<ReturnType<typeof createTestParent>>;

test.beforeEach(async () => {
	parent = await createTestParent();
});

test.afterEach(async () => {
	await parent?.remove();
});

const income = (page: Page) => page.getByRole("region", { name: "Income" });
const moneyIn = (page: Page) => page.getByRole("region", { name: "Money in" });
const toast = (page: Page, text: string) => page.getByRole("status").filter({ hasText: text });

async function addIncome(page: Page, amount: string, note: string) {
	await income(page).getByRole("button", { name: "Add income" }).click();
	const sheet = page.getByRole("dialog", { name: "Add income" });
	await sheet.getByLabel("Amount").fill(amount);
	await sheet.getByLabel("Note").fill(note);
	await sheet.getByRole("button", { name: "Add income" }).click();
	await expect(sheet).toBeHidden();
}

test("money in is listed on Transactions with its kind, and a Parent can change it", async ({
	browser,
}) => {
	test.slow();
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, {
		baseline: "5,000",
		buckets: [["Groceries", "1,200"]],
	});
	await addIncome(page, "5,000", "Paycheck");
	await addIncome(page, "300", "Casey for tuition");
	await expect(income(page)).toContainText("$5,300 received of $5,000 usual take-home pay");

	await page.goto("/transactions");
	const rows = moneyIn(page).getByTestId("money-in-row");
	await expect(rows).toHaveCount(2);
	const casey = rows.filter({ hasText: "Casey for tuition" });
	await expect(casey).toContainText("+$300");
	await expect(casey.getByTestId("money-in-kind")).toHaveText("Income");

	await casey.getByRole("button", { name: "Change what Casey for tuition is" }).click();
	await expect(casey.getByRole("button", { name: "Income", exact: true })).toHaveAttribute(
		"aria-pressed",
		"true",
	);
	await casey.getByRole("button", { name: "Paid back", exact: true }).click();
	await expect(toast(page, "$300 is Paid back")).toBeVisible();
	await expect(casey.getByTestId("money-in-kind")).toHaveText("Paid back");

	// The server keeps it: it is out of the month's Income.
	await page.goto("/month");
	await expect(income(page)).toContainText("$5,000 received of $5,000 usual take-home pay");
});
