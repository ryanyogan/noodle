import { expect, type Page, test } from "@playwright/test";
import { createTestParent } from "./parents";
import { chooseKind, createPlannedHousehold, hydrated, reloadUntil, signedInPage } from "./session";

let parent: Awaited<ReturnType<typeof createTestParent>>;

test.beforeEach(async () => {
	parent = await createTestParent();
});

test.afterEach(async () => {
	await parent?.remove();
});

const toast = (page: Page, text: string) => page.getByRole("status").filter({ hasText: text });

/** Today where the browser (and so the Household) is, as a statement writes it. */
const today = (page: Page) =>
	page.evaluate(() =>
		new Date().toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" }),
	);

/** Adds a checking Account and imports a statement into it. */
async function uploadChecking(page: Page, lines: string[]) {
	await page.getByRole("link", { name: "Accounts", exact: true }).click();
	await expect(page.getByRole("heading", { level: 1 })).toHaveText("Accounts");
	await page.getByLabel("Name").fill("Checking");
	await chooseKind(page, "checking");
	await page.getByLabel("Balance now").fill("2,500");
	await page.getByRole("button", { name: "Add Account" }).click();
	await page.getByRole("link", { name: /^Checking, / }).click();
	await expect(page.locator("[data-slot=detail-title]:visible")).toContainText("Checking");
	await page.getByRole("button", { name: "Upload statement" }).click();
	const sheet = page.getByRole("dialog", { name: "Upload a statement" });
	await sheet.getByLabel("Statement file").setInputFiles({
		name: "checking.csv",
		mimeType: "text/csv",
		buffer: Buffer.from(lines.join("\n")),
	});
	await sheet.getByRole("button", { name: `Import ${lines.length - 1} lines` }).click();
	await expect(sheet).toBeHidden();
}

test("a fee is offered the Fees and interest Bucket in Review: Confirm adds it to the Plan, and a Rule files the rest", async ({
	browser,
}) => {
	test.slow();
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, { baseline: "5,000", buckets: [["Groceries", "1,200"]] });
	const thisMonth = page.url();
	const day = await today(page);

	await uploadChecking(page, [
		"Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #",
		`DEBIT,${day},"OVERDRAFT FEE FOR A $54.12 ITEM - DETAILS: SHELL OIL",-34.00,FEE_TRANSACTION,2466.00,`,
		`DEBIT,${day},"OVERDRAFT FEE FOR A $9.00 ITEM - DETAILS: NETFLIX",-34.00,FEE_TRANSACTION,2432.00,`,
		`DEBIT,${day},"LATE NIGHT DINER AUSTIN TX",-30.00,DEBIT_CARD,2402.00,`,
	]);
	await expect(toast(page, "checking.csv: 3 Transactions")).toBeVisible();

	// Both fees wait in Review with the Bucket as their suggestion, though the Plan has none yet.
	const cards = page.getByTestId("review-card");
	const fees = cards.filter({ hasText: "Fees and interest" });
	await reloadUntil(page, new URL("/review?view=list", thisMonth).href, () =>
		expect(fees).toHaveCount(2, { timeout: 2_000 }),
	);
	await expect(fees.first()).toContainText("Fee or interest");
	await expect(fees.first()).toContainText(
		"Looks like a fee from your bank or card · adds the Bucket to your Plan",
	);
	// The diner is no fee, whatever its name.
	await expect(
		cards.filter({ hasText: /Late Night Diner/i }).filter({ hasText: "Fees and interest" }),
	).toHaveCount(0);

	// Confirm one: the Bucket is added, the card filed, and the Rule files the other.
	const confirm = fees.first().getByRole("button", { name: "Confirm" });
	await hydrated(confirm);
	await confirm.click();
	// (Saved before the page is left: a Rule on its way isn't sent again.)
	await expect(toast(page, "Rule saved")).toBeVisible({ timeout: 15_000 });
	await expect(fees).toHaveCount(0);
	await expect(cards).toHaveCount(1);

	// The Rule is the charge, not what this one was for.
	await page.goto(new URL("/review/rules", thisMonth).href);
	await expect(page.getByRole("link", { name: /^overdraft fee, Fees and interest/ })).toBeVisible();

	// In the Plan: resets monthly, with both fees in it and no allowance yet.
	await page.goto(thisMonth);
	const bucket = page.getByRole("listitem", { name: /^Fees and interest: / });
	await expect(bucket).toBeVisible();
	await expect(bucket).toContainText("$68");
});
