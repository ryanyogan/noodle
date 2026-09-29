import { expect, type Page, test } from "@playwright/test";
import { createTestParent } from "./parents";
import { createHousehold, signedInPage } from "./session";

// Connecting a bank through SimpleFIN, against the fake SimpleFIN Bridge (AI_MODEL=stub): the
// Parent pastes a setup token, its Accounts appear at once, and the Import Workflow, started from
// the ingest Queue, brings in their Transactions. A token that isn't one, or was claimed already,
// says so. What the Bridge asks the Parent to read shows on the Bank Connection.

let parent: Awaited<ReturnType<typeof createTestParent>>;

test.beforeEach(async () => {
	parent = await createTestParent();
});

test.afterEach(async () => {
	await parent?.remove();
});

/**
 * The fake Bridge's setup token for the code (simplefin-fake.ts); "USED…" was claimed already, and
 * "NOTICE…" reads come with a message.
 */
const setupToken = (code: string) => btoa(`https://bridge.simplefin.fake/simplefin/claim/${code}`);

const toast = (page: Page, text: string) => page.getByRole("status").filter({ hasText: text });
const bankConnections = (page: Page) => page.getByRole("region", { name: "Bank Connections" });

test("a Parent connects through SimpleFIN with a setup token", async ({ browser }) => {
	const page = await signedInPage(browser, parent.email);
	await createHousehold(page, "The Rinks", "Alex");
	await page.getByRole("link", { name: "Goals", exact: true }).click();
	await expect(page.getByRole("heading", { level: 1 })).toHaveText("Goals");

	await bankConnections(page).getByRole("button", { name: "Connect with SimpleFIN" }).click();
	const sheet = page.getByRole("dialog", { name: "Connect with SimpleFIN" });
	const token = sheet.getByLabel("Setup token");
	const connect = sheet.getByRole("button", { name: "Connect" });

	await token.fill("not a setup token");
	await connect.click();
	await expect(sheet.getByRole("alert")).toContainText("That isn’t a SimpleFIN setup token");

	// A setup token can be claimed only once.
	await token.fill(setupToken("USED-by-someone"));
	await connect.click();
	await expect(sheet.getByRole("alert")).toContainText("That setup token was used already");

	await token.fill(setupToken("household"));
	await connect.click();
	await expect(toast(page, "Connected 4 Accounts")).toBeVisible();
	await expect(sheet).toBeHidden();

	// Checking, savings, card and loan become Accounts with their balances; the brokerage doesn't.
	await expect(
		page.getByRole("link", { name: "Share Draft Checking, Checking, $3,184.22" }),
	).toBeVisible();
	await expect(page.getByRole("link", { name: /^Regular Savings, Savings, / })).toBeVisible();
	await expect(page.getByRole("link", { name: /^Visa Signature Rewards, / })).toBeVisible();
	await expect(page.getByRole("link", { name: /^Auto Loan, / })).toBeVisible();
	await expect(page.getByRole("link", { name: /Brokerage/ })).toHaveCount(0);

	const connection = bankConnections(page).getByRole("listitem");
	await expect(connection).toContainText("Prairie State Credit Union");
	await expect(connection).toContainText("4 Accounts · Up to date");

	// Its Import sits in the Account's history like a statement's, without the pending line.
	await page.getByRole("link", { name: /^Share Draft Checking, / }).click();
	await expect(page.getByRole("heading", { level: 1 })).toContainText("Share Draft Checking");
	const imports = page.getByRole("list", { name: "Imported statements" });
	await expect(imports.getByRole("listitem")).toHaveCount(1);
	await expect(imports).toContainText("From Prairie State Credit Union");
	await expect(imports).toContainText("2 Transactions and 1 deposit as income");
});

test("a Parent sees what the SimpleFIN Bridge asks them to read", async ({ browser }) => {
	const page = await signedInPage(browser, parent.email);
	await createHousehold(page, "The Rinks", "Alex");
	await page.getByRole("link", { name: "Goals", exact: true }).click();
	await bankConnections(page).getByRole("button", { name: "Connect with SimpleFIN" }).click();
	const sheet = page.getByRole("dialog", { name: "Connect with SimpleFIN" });
	await sheet.getByLabel("Setup token").fill(setupToken("NOTICE-household"));
	await sheet.getByRole("button", { name: "Connect" }).click();
	await expect(toast(page, "Connected 4 Accounts")).toBeVisible();

	// Plain text: the Bridge's markup doesn't show.
	const connection = bankConnections(page).getByRole("listitem");
	await expect(connection).toContainText("4 Accounts · Up to date");
	await expect(connection).toContainText("Your bank asks you to sign in again at the Bridge.");
	await expect(connection).not.toContainText("<b>");
});
