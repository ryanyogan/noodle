import { join } from "node:path";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { createTestParent } from "./parents";
import {
	accountKindLabel,
	choose,
	createPlannedHousehold,
	reloadUntil,
	signedInPage,
} from "./session";

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
	await choose(page, "Kind", accountKindLabel(kind));
	await page.getByLabel(kind === "credit-card" ? "Owed now" : "Balance now").fill(balance);
	await page.getByRole("button", { name: "Add Account" }).click();
	await page.getByRole("link", { name: new RegExp(`^${name}, `) }).click();
	await expect(page.locator("[data-slot=detail-title]")).toContainText(name);
}

/** Opens the upload sheet and chooses a statement file. */
async function chooseStatement(page: Page, file: string) {
	await page.getByRole("button", { name: "Upload statement" }).click();
	const sheet = page.getByRole("dialog", { name: "Upload a statement" });
	await sheet.getByLabel("Statement file").setInputFiles(fixture(file));
	return sheet;
}

const toast = (page: Page, text: string) => page.getByRole("status").filter({ hasText: text });

/**
 * What a Parent can read in a Transaction's row: each part is on show, in its own column on a
 * wide table or on the row's one detail line on a narrow one (the copy not in use is hidden).
 */
async function says(page: Page, control: Locator, parts: string[]) {
	const row = page.getByRole("row").filter({ has: control }).first();
	for (const part of parts) {
		await expect(row.getByText(part).filter({ visible: true }).first()).toBeVisible();
	}
}

test("a bank statement comes in once, as Transactions to assign and income", async ({
	browser,
}) => {
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, { baseline: "5,000", buckets: [["Groceries", "1,200"]] });
	await addAccount(page, "Everyday Checking", "checking", "2,500");
	const statements = page.getByRole("region", { name: "Statements" });

	// A CSV: its columns are guessed, and the preview says what it will bring in.
	let sheet = await chooseStatement(page, "checking.csv");
	await expect(sheet.getByLabel("Date", { exact: true })).toHaveText(/^Posting Date /);
	await expect(sheet.getByLabel("Description")).toHaveText(/^Description /);
	await expect(sheet.getByLabel("Amounts")).toHaveText("One column, money out is negative");
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
	await expect(toast(page, "checking.csv: Nothing new; 6 already in Noodle")).toBeVisible();
	await expect(statements.getByRole("listitem")).toHaveCount(2);

	// An OFX statement brings its closing balance, shown beside the one entered by hand.
	sheet = await chooseStatement(page, "checking-v1.ofx");
	await expect(sheet.getByLabel("Amounts")).toHaveCount(0);
	await sheet.getByRole("button", { name: /^Import \d+ lines$/ }).click();
	await expect(toast(page, "checking-v1.ofx:")).toBeVisible();
	await expect(page.getByText("Your latest statement ends at $2,540.26 on Sep 20")).toBeVisible();
	// It's older than the balance typed today, so it isn't offered in its place.
	await expect(sheet).toBeHidden();

	// A file for another account (its OFX names the account) is caught before it's imported.
	sheet = await chooseStatement(page, "card-v2.qfx");
	await expect(sheet.getByRole("alert")).toContainText(
		"This file is for an account ending 1111, but earlier statements for Everyday Checking were for one ending 3210",
	);
	await page.keyboard.press("Escape");
	await expect(sheet).toBeHidden();

	// Money out waits, unassigned, in the Transactions list; nothing is listed twice.
	// Listed by the clean names the background run gives them a moment after the import.
	const traderJoes = page.getByRole("button", { name: /^Trader Joe’?'?s, \$/i });
	await reloadUntil(page, page.url().replace(/\/accounts\/.*$/, "/transactions/2026-09"), () =>
		expect(traderJoes).toHaveCount(1, { timeout: 2_000 }),
	);
	const coffee = page.getByRole("button", {
		name: /^Stumptown Coffee, \$4\.50, Unassigned, For Everyone, from Everyday Checking ••3210$/i,
	});
	await expect(coffee).toHaveCount(2);
	// Who it's For is in the row's name above: with the checkbox column the For column needs a
	// wider table than this window's (64rem).
	await says(page, coffee.first(), ["Unassigned", "Everyday Checking", "••3210"]);
	// The bank's own text is kept as the note: rows open their detail once the page is hydrated.
	await expect(page.getByLabel("Bucket")).toBeEnabled();
	await traderJoes.click();
	const editor = page
		.locator("[role=dialog], [data-slot=transaction-detail]")
		.filter({ has: page.getByRole("heading", { name: "Edit Transaction" }) });
	await expect(editor.getByLabel("Name")).toHaveValue("Trader Joe's");
	await expect(editor.getByText("From your bank: TRADER JOE'S #552 PORTLAND OR")).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(editor).toBeHidden();
	await page.keyboard.press("Escape");
	// Deposits are income, not Transactions.
	await expect(page.getByText("ACME CORP PAYROLL")).toHaveCount(0);
});

test("money back onto a card is listed but counts nowhere", async ({ browser }) => {
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, { baseline: "5,000", buckets: [["Groceries", "1,200"]] });
	await addAccount(page, "Visa", "credit-card", "800");

	const sheet = await chooseStatement(page, "card-debit-credit.csv");
	await expect(sheet.getByLabel("Amounts")).toHaveText("Two columns: money out, money in");
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

	const netflix = page.getByRole("button", {
		name: /^Netflix(\.com)?, \$15\.49, Unassigned, For Everyone, from Visa ••1111$/i,
	});
	await reloadUntil(page, page.url().replace(/\/accounts\/.*$/, "/transactions/2026-09"), () =>
		expect(netflix).toBeVisible({ timeout: 2_000 }),
	);
	const rei = page.getByRole("button", { name: /^REI\b/i });
	const refund = page.getByRole("row").filter({ has: rei });
	await says(page, rei, ["Money back", "Visa", "••1111", "−$24.99"]);
	// It opens its Transfer and Refund link, not the editor.
	await expect(refund.getByRole("button")).toHaveAccessibleName(
		/^REI[^,]*, −\$24\.99, Money back, from Visa ••1111$/i,
	);
});
