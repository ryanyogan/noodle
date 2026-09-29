import { expect, type Page, test } from "@playwright/test";
import { createTestParent } from "./parents";
import { createHousehold, signedInPage } from "./session";

// Connecting a bank through Plaid Link, against the fake Plaid API (AI_MODEL=stub): its Accounts
// appear at once, and the Import Workflow, started from the ingest Queue, brings in their
// Transactions.

let parent: Awaited<ReturnType<typeof createTestParent>>;

test.beforeEach(async () => {
	parent = await createTestParent();
});

test.afterEach(async () => {
	await parent?.remove();
});

const toast = (page: Page, text: string) => page.getByRole("status").filter({ hasText: text });
const bankConnections = (page: Page) => page.getByRole("region", { name: "Bank Connections" });

test("a Parent connects a bank, and its Accounts and Transactions come in", async ({ browser }) => {
	const page = await signedInPage(browser, parent.email);
	await createHousehold(page, "The Rinks", "Alex");
	await page.getByRole("link", { name: "Goals", exact: true }).click();
	await expect(page.getByRole("heading", { level: 1 })).toHaveText("Goals");

	await bankConnections(page).getByRole("button", { name: "Connect a bank" }).click();
	await expect(toast(page, "Connected 4 Accounts")).toBeVisible();

	// Checking, savings, card and loan become Accounts with their balances; the brokerage doesn't.
	await expect(
		page.getByRole("link", { name: "Plaid Checking ··0000, Checking, $1,250.40" }),
	).toBeVisible();
	await expect(page.getByRole("link", { name: /^Plaid Saving ··1111, Savings, / })).toBeVisible();
	await expect(page.getByRole("link", { name: /^Plaid Credit Card ··3333, / })).toBeVisible();
	await expect(page.getByRole("link", { name: /^Plaid Auto Loan ··4444, / })).toBeVisible();
	await expect(page.getByRole("link", { name: /Brokerage/ })).toHaveCount(0);

	// The Import Workflow finishes, and the screen hears of it.
	const connection = bankConnections(page).getByRole("listitem");
	await expect(connection).toContainText("First Platypus Bank");
	await expect(connection).toContainText("4 Accounts · Up to date");

	// Its Import sits in the Account's history like a statement's.
	await page.getByRole("link", { name: /^Plaid Checking ··0000, / }).click();
	await expect(page.getByRole("heading", { level: 1 })).toContainText("Plaid Checking");
	const imports = page.getByRole("list", { name: "Imported statements" });
	await expect(imports.getByRole("listitem")).toHaveCount(1);
	await expect(imports).toContainText("From First Platypus Bank");
	await expect(imports).toContainText("2 Transactions and 1 deposit as income");

	// The same login again is refused rather than doubled.
	await page.getByRole("link", { name: "Goals", exact: true }).click();
	await bankConnections(page).getByRole("button", { name: "Connect a bank" }).click();
	await expect(toast(page, "That bank is connected already.")).toBeVisible();
	await expect(bankConnections(page).getByRole("listitem")).toHaveCount(1);
});
