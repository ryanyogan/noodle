import { join } from "node:path";
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

const fixture = (name: string) =>
	join(import.meta.dirname, "..", "..", "..", "packages", "domain", "fixtures", "statements", name);

/** Adds an Account on the Accounts page and opens it. */
async function addAccount(page: Page, name: string, kind: string, balance: string) {
	await page.getByRole("link", { name: "Accounts", exact: true }).click();
	await expect(page.getByRole("heading", { level: 1 })).toHaveText("Accounts");
	await page.getByLabel("Name").fill(name);
	await page.getByLabel("Kind").selectOption(kind);
	await page.getByLabel(kind === "credit-card" ? "Owed now" : "Balance now").fill(balance);
	await page.getByRole("button", { name: "Add Account" }).click();
	await page.getByRole("link", { name: new RegExp(`^${name}, `) }).click();
	await expect(page.getByRole("heading", { level: 1 })).toContainText(name);
}

/** Opens the upload sheet and chooses a statement file. */
async function chooseStatement(page: Page, file: string) {
	await page.getByRole("button", { name: "Upload statement" }).click();
	const sheet = page.getByRole("dialog", { name: "Upload a statement" });
	await sheet.getByLabel("Statement file").setInputFiles(fixture(file));
	return sheet;
}

const toast = (page: Page, text: string) => page.getByRole("status").filter({ hasText: text });

test("a bank statement comes in once, as Transactions to assign and income", async ({
	browser,
}) => {
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, { baseline: "5,000", buckets: [["Groceries", "1,200"]] });
	await addAccount(page, "Everyday Checking", "checking", "2,500");
	const statements = page.getByRole("region", { name: "Statements" });

	// A CSV: its columns are guessed, and the preview says what it will bring in.
	let sheet = await chooseStatement(page, "checking.csv");
	await expect(sheet.getByLabel("Date", { exact: true })).toHaveValue("1");
	await expect(sheet.getByLabel("Description")).toHaveValue("2");
	await expect(sheet.getByLabel("Amounts")).toHaveValue("negative");
	const preview = sheet.getByRole("region", { name: "Preview" });
	await expect(preview).toContainText("6 lines from Sep 2 to Sep 10");
	await expect(preview).toContainText("money in $3,200");
	await sheet.getByRole("button", { name: "Import 6 lines" }).click();
	await expect(sheet).toBeHidden();
	await expect(toast(page, "checking.csv: 5 Transactions and 1 deposit as income")).toBeVisible();
	await expect(statements.getByRole("listitem")).toHaveCount(1);
	await expect(statements.getByRole("listitem")).toContainText(
		"5 Transactions and 1 deposit as income",
	);

	// The same statement again adds nothing twice.
	sheet = await chooseStatement(page, "checking.csv");
	await sheet.getByRole("button", { name: "Import 6 lines" }).click();
	await expect(toast(page, "checking.csv: Nothing new; 6 already imported")).toBeVisible();
	await expect(statements.getByRole("listitem")).toHaveCount(2);

	// An OFX statement brings its closing balance, shown beside the one entered by hand.
	sheet = await chooseStatement(page, "checking-v1.ofx");
	await expect(sheet.getByLabel("Amounts")).toHaveCount(0);
	await sheet.getByRole("button", { name: /^Import \d+ lines$/ }).click();
	await expect(toast(page, "checking-v1.ofx:")).toBeVisible();
	await expect(page.getByText("Your latest statement ends at $2,540.26 on Sep 20")).toBeVisible();

	// Money out waits, unassigned, in the Transactions list; nothing is listed twice.
	await page.goto(page.url().replace(/\/accounts\/.*$/, "/transactions/2026-09"));
	const coffee = page.getByRole("button", {
		name: "STUMPTOWN COFFEE, $4.50, Unassigned, For Everyone, from Everyday Checking",
	});
	await expect(coffee).toHaveCount(2);
	await expect(page.getByText("Unassigned · Everyone · Everyday Checking").first()).toBeVisible();
	await expect(page.getByText("TRADER JOE'S #552 PORTLAND OR")).toHaveCount(1);
	// Deposits are income, not Transactions.
	await expect(page.getByText("ACME CORP PAYROLL")).toHaveCount(0);
});

test("money back onto a card is listed but counts nowhere", async ({ browser }) => {
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, { baseline: "5,000", buckets: [["Groceries", "1,200"]] });
	await addAccount(page, "Visa", "credit-card", "800");

	const sheet = await chooseStatement(page, "card-debit-credit.csv");
	await expect(sheet.getByLabel("Amounts")).toHaveValue("debit-credit");
	await expect(sheet.getByRole("region", { name: "Preview" })).toContainText(
		"1 row can’t be read and will be skipped (row 6)",
	);
	await sheet.getByRole("button", { name: "Import 4 lines" }).click();
	await expect(toast(page, "card-debit-credit.csv: 4 Transactions")).toBeVisible();

	// A card's QFX reports what's owed as a negative balance: the note says what's owed.
	const qfx = await chooseStatement(page, "card-v2.qfx");
	await qfx.getByRole("button", { name: /^Import \d+ lines?$/ }).click();
	await expect(toast(page, "card-v2.qfx:")).toBeVisible();
	await expect(page.getByText("Your latest statement ends owing $812.33 on Sep 21")).toBeVisible();

	await page.goto(page.url().replace(/\/accounts\/.*$/, "/transactions/2026-09"));
	const refund = page.getByRole("listitem").filter({ hasText: "REI #11 RETURN" });
	await expect(refund).toContainText("Money back · Visa");
	await expect(refund).toContainText("−$24.99");
	// It opens its Transfer and Refund link, not the editor.
	await expect(refund.getByRole("button")).toHaveAccessibleName(
		"REI #11 RETURN, −$24.99, Money back, from Visa",
	);
	await expect(
		page.getByRole("button", { name: "NETFLIX.COM, $15.49, Unassigned, For Everyone, from Visa" }),
	).toBeVisible();
});
