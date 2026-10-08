import { expect, type Page, test } from "@playwright/test";
import { createTestParent } from "./parents";
import { chooseKind, createPlannedHousehold, signedInPage } from "./session";

// The Log in Household settings (issue 141) has what a Parent asked Noodle to remember and what
// they put away and took back out: a remembered pair of Accounts, as a Rule for money in, and an
// Account brought back from the archive, after the row that says it was archived.

let parent: Awaited<ReturnType<typeof createTestParent>>;

test.beforeEach(async () => {
	parent = await createTestParent();
});

test.afterEach(async () => {
	await parent?.remove();
});

const JORDAN = "Zelle payment from JORDAN PIKE 99887766";

const toast = (page: Page, text: string | RegExp) =>
	page.getByRole("status").filter({ hasText: text });
const logRows = (page: Page) =>
	page.getByRole("table", { name: "Log" }).locator("[data-slot=data-table-row]");

async function addAccount(page: Page, name: string, kind: "checking" | "savings", balance: string) {
	await page.getByRole("link", { name: "Accounts", exact: true }).click();
	await expect(page.getByRole("heading", { level: 1 })).toHaveText("Accounts");
	if (await page.getByRole("region", { name: "Totals" }).isVisible()) {
		await expect(async () => {
			await page.getByRole("button", { name: "Add Account" }).click();
			await expect(page.getByLabel("Name")).toBeVisible({ timeout: 1000 });
		}).toPass();
	}
	await page.getByLabel("Name").fill(name);
	await chooseKind(page, kind);
	await page.getByLabel("Balance now").fill(balance);
	await page.getByRole("button", { name: "Add Account" }).click();
	await expect(page.getByRole("link", { name: new RegExp(`^${name}, `) })).toBeVisible();
}

test("a remembered pair of Accounts is in the Log as a Rule for money in", async ({ browser }) => {
	test.setTimeout(180_000);
	const page = await signedInPage(browser, parent.email);
	await page.setViewportSize({ width: 1440, height: 900 });
	await createPlannedHousehold(page, { baseline: "5,000", buckets: [["Groceries", "1,200"]] });
	await addAccount(page, "Ally savings", "savings", "10,000");
	await addAccount(page, "Everyday Checking", "checking", "4,000");

	// Money into checking that a person sent, as the bank's CSV says it.
	const today = await page.evaluate(() => {
		const now = new Date();
		return `${String(now.getMonth() + 1).padStart(2, "0")}/${String(now.getDate()).padStart(2, "0")}/${now.getFullYear()}`;
	});
	await page.getByRole("link", { name: /^Everyday Checking, / }).click();
	await expect(page.locator("[data-slot=detail-title]:visible")).toContainText("Everyday Checking");
	await page.getByRole("button", { name: "Upload statement" }).click();
	const sheet = page.getByRole("dialog", { name: "Upload a statement" });
	await sheet.getByLabel("Statement file").setInputFiles({
		name: "checking.csv",
		mimeType: "text/csv",
		buffer: Buffer.from(
			[
				"Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #",
				`CREDIT,${today},"${JORDAN}",75.00,ACH_CREDIT,9000.00,`,
			].join("\n"),
		),
	});
	await sheet.getByRole("button", { name: /^Import \d+ lines?$/ }).click();
	await expect(sheet).toBeHidden();
	await expect(toast(page, "checking.csv").first()).toBeVisible();

	// Review: it is a Transfer from the savings Account, and Noodle is told to remember the pair.
	await page.goto("/review");
	const row = page
		.getByTestId("money-in-review")
		.getByTestId("money-in-row")
		.filter({ hasText: "JORDAN PIKE" });
	await expect(row).toBeVisible({ timeout: 30_000 });
	const pair = row.getByTestId("account-pair-offer");
	await expect(async () => {
		if (!(await pair.isVisible()))
			await row.getByRole("button", { name: "Transfer", exact: true }).click({ timeout: 2_000 });
		await expect(pair).toBeVisible({ timeout: 3_000 });
	}).toPass({ timeout: 30_000 });
	await pair.getByRole("button", { name: "Ally savings" }).click();
	await expect(pair).toContainText(
		"Always treat money from Ally savings into Everyday Checking as a Transfer?",
	);
	await pair.getByRole("button", { name: "Yes, always" }).click();
	await expect(
		toast(page, "Money from Ally savings into Everyday Checking is always a Transfer now"),
	).toBeVisible();

	// The Log, narrowed to Rules: the pair, by its wording, who made it and what it always is.
	await page.goto("/household/logs?kind=rule");
	const remembered = logRows(page).filter({
		hasText: "Rule made · always a Transfer between two of your Accounts",
	});
	await expect(remembered).toHaveCount(1, { timeout: 30_000 });
	await expect(remembered).toContainText("“zelle from jordan pike”");
	await expect(remembered).toContainText("Rule for money in");
	await expect(remembered).toContainText("Alex");
	await expect(remembered).toContainText("Right away");
	await page.context().close();
});

test("an Account brought back from the archive is in the Log, after the row that archived it", async ({
	browser,
}) => {
	test.setTimeout(180_000);
	const page = await signedInPage(browser, parent.email);
	await page.setViewportSize({ width: 1440, height: 900 });
	await createPlannedHousehold(page, { baseline: "5,000", buckets: [["Groceries", "1,200"]] });
	await addAccount(page, "Everyday Checking", "checking", "4,000");
	await addAccount(page, "Old savings", "savings", "250");

	// Archive it from its own page.
	await page.getByRole("link", { name: /^Old savings, / }).click();
	const more = page.getByRole("region", { name: "More" });
	await expect(more).toBeVisible();
	await more.getByRole("button", { name: "Archive this Account" }).click();
	await page
		.getByRole("alertdialog", { name: "Archive this Account" })
		.getByRole("button", { name: "Archive this Account" })
		.click();
	await expect(toast(page, "is archived.")).toBeVisible();
	await expect(page).toHaveURL(/\/accounts$/);
	await expect(page.getByRole("link", { name: /^Old savings, / })).toHaveCount(0);

	// Archived: the Log has the one row.
	await page.goto("/household/logs?kind=account");
	const about = logRows(page).filter({ has: page.getByText("Old savings", { exact: true }) });
	await expect(about).toHaveCount(1, { timeout: 30_000 });
	await expect(about).toContainText("Archived");

	// Bring it back, from the Archived fold at the bottom of Accounts.
	await page.goto("/accounts");
	const fold = page.getByRole("button", { name: /^Archived/ });
	await expect(async () => {
		if ((await fold.getAttribute("aria-expanded")) !== "true") await fold.click({ timeout: 2_000 });
		await expect(fold).toHaveAttribute("aria-expanded", "true", { timeout: 2_000 });
	}).toPass({ timeout: 20_000 });
	await page
		.getByRole("list", { name: "Archived Accounts" })
		.getByRole("button", { name: /^Restore Old savings/ })
		.click();
	await expect(toast(page, "is back in Accounts")).toBeVisible();
	await expect(page.getByRole("link", { name: /^Old savings, / })).toHaveCount(1);

	// Both rows, newest first: brought back, then archived, each by the Parent who did it.
	await page.goto("/household/logs?kind=account");
	await expect(about).toHaveCount(2, { timeout: 30_000 });
	await expect(about.nth(0)).toContainText("Brought back from the archive");
	await expect(about.nth(0)).toContainText("Alex");
	await expect(about.nth(1)).toContainText("Archived");
	await expect(about.nth(1)).not.toContainText("Brought back");
	await page.context().close();
});
