import { expect, type Page, test } from "@playwright/test";
import { createTestParent } from "./parents";
import { createPlannedHousehold, hydrated, signedInPage } from "./session";

// Money in has a kind (issue 131, ADR-0057): it is listed on Transactions with its kind in plain
// words, and a Parent can say it is something other than Income, which takes it out of Income.
// The month's summary over the table (issue 134) says what came in, and each figure is a filter.

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
	// Money in is fetched once the page is live, which a cold dev server takes a while over.
	await expect(rows).toHaveCount(2, { timeout: 30_000 });
	const casey = rows.filter({ hasText: "Casey for tuition" });
	await expect(casey).toContainText("+$300");
	await expect(casey.getByTestId("money-in-kind")).toHaveText("Income");
	// The month at a glance: both lines are Income; nothing is spent and nothing waits.
	const summary = page.getByRole("group", { name: "The month at a glance" });
	await expect(summary.getByTestId("month-in")).toHaveText("+$5,300");
	await expect(summary.getByTestId("month-total")).toHaveText("$0");
	await expect(summary.getByTestId("month-review")).toHaveText("0");

	// The month's money in is in the server's HTML now (issue 134): wait for React before pressing.
	const changeCasey = casey.getByRole("button", { name: "Change what Casey for tuition is" });
	await hydrated(changeCasey);
	await changeCasey.click();
	await expect(casey.getByRole("button", { name: "Income", exact: true })).toHaveAttribute(
		"aria-pressed",
		"true",
	);
	// Said for every line worded like it too: a Rule for money in.
	await casey.getByRole("checkbox", { name: "Always, for money in like this" }).click();
	await casey.getByRole("button", { name: "Paid back", exact: true }).click();
	await expect(toast(page, "$300 is Paid back")).toBeVisible();
	await expect(casey.getByTestId("money-in-kind")).toHaveText("Paid back");
	// Nothing is Owed back, so it waits unmatched (issue 132); it is never Income.
	await expect(casey.getByTestId("paid-back-matching")).toContainText(
		"$300 is Paid back, not matched yet",
	);
	// Paid back is still money in.
	await expect(summary.getByTestId("month-in")).toHaveText("+$5,300");
	// Of it, only the pay is Income: what This Month calls "received".
	await expect(summary.getByTestId("month-in-income")).toHaveText("$5,000 of it Income");
	// One "Done" closes the row once what it pays back has been looked at.
	await casey.getByRole("button", { name: "Done with Casey for tuition" }).click();
	await expect(casey.getByTestId("paid-back-matching")).toBeHidden();

	// Each figure is a filter, kept in the address: Money out leaves the money in out, Money in
	// shows it alone, and pressing the one that is on takes it off.
	const moneyOut = summary.getByRole("button", { name: /^Money out/ });
	await moneyOut.click();
	await expect(page).toHaveURL(/[?&]show=out/);
	await expect(moneyOut).toHaveAttribute("aria-pressed", "true");
	await expect(moneyIn(page)).toHaveCount(0);
	const moneyInFilter = summary.getByRole("button", { name: /^Money in/ });
	await moneyInFilter.click();
	await expect(page).toHaveURL(/[?&]show=in/);
	await expect(rows).toHaveCount(2);
	// Nothing in the bar narrows money in, so it waits while Money in shows alone.
	await expect(page.getByRole("searchbox", { name: "Search notes and merchants" })).toBeDisabled();
	await expect(page.getByRole("combobox", { name: "Bucket", exact: true })).toBeDisabled();
	await page.reload();
	await expect(moneyInFilter).toHaveAttribute("aria-pressed", "true");
	await expect(rows).toHaveCount(2);
	await hydrated(moneyInFilter);
	await moneyInFilter.click();
	await expect(page).not.toHaveURL(/show=/);

	// The server keeps it: it is out of the month's Income.
	await page.goto("/month");
	await expect(income(page)).toContainText("$5,000 received of $5,000 usual take-home pay");

	// The Rule is listed on the Rules page, and can be removed there.
	await page.goto("/review/rules");
	const rule = page.getByTestId("money-in-rules").getByTestId("money-in-rule");
	await expect(rule).toHaveCount(1);
	await expect(rule).toContainText(/casey/i);
	await expect(rule).toContainText("Always Paid back");
	const remove = rule.getByRole("button", { name: /Remove the Rule for/ });
	await hydrated(remove);
	await remove.click();
	await expect(toast(page, "Rule removed")).toBeVisible();
	await expect(page.getByTestId("money-in-rules")).toBeHidden();
});
