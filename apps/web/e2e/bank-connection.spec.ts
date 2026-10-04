import { expect, type Page } from "@playwright/test";
import { signFakeWebhook } from "../src/server/plaid-fake-webhook-key";
import { seedSql } from "./seed-sql";
import { createHousehold, signedInPage } from "./session";
import { type SharedParent, test } from "./worker-parent";

// Connecting a bank through Plaid Link, against the fake Plaid API (AI_MODEL=stub): its Accounts
// appear at once, and the Import Workflow, started from the ingest Queue, brings in their
// Transactions. Then Plaid's webhooks, signed with the fake's key: new transactions sync the
// bank (a pending charge posts in its place), and a lapsed login waits for a reconnect.

let parent: SharedParent;

test.beforeEach(async ({ sharedParent }) => {
	parent = sharedParent;
});

const toast = (page: Page, text: string) => page.getByRole("status").filter({ hasText: text });
const bankConnections = (page: Page) => page.getByRole("region", { name: "Bank Connections" });
const nav = (page: Page) => page.getByRole("navigation", { name: "Main" });
const chooseSheet = (page: Page) =>
	page.getByRole("dialog", { name: "Which of these do you have already?" });

/** Connects the fake bank, keeping Noodle's suggestion for each of its accounts. */
async function connectBank(page: Page, accounts = 4) {
	await page.getByRole("button", { name: "Connect a bank" }).click();
	await chooseSheet(page).getByRole("button", { name: "Start bringing them in" }).click();
	await expect(
		toast(page, `Bringing in ${accounts} Accounts from First Platypus Bank.`),
	).toBeVisible();
	await expect(chooseSheet(page)).toBeHidden();
}

/** The fake Plaid Item behind the Parent's Bank Connection. */
async function itemIdOf(clerkUserId: string): Promise<string> {
	const sql = `select b.external_id as item from bank_connections b join members m on m.household_id = b.household_id where m.clerk_user_id = '${clerkUserId.replaceAll("'", "''")}'`;
	const [results = []] = await seedSql([sql]);
	const item = results[0]?.item;
	if (!item) throw new Error("No Bank Connection for the Parent");
	return String(item);
}

/** A webhook from (the fake) Plaid, signed as Plaid signs one. */
async function plaidWebhook(page: Page, payload: Record<string, unknown>, signed = true) {
	const body = JSON.stringify(payload);
	return page.request.post("/webhooks/plaid", {
		headers: {
			"Content-Type": "application/json",
			...(signed ? { "Plaid-Verification": await signFakeWebhook(body) } : {}),
		},
		data: body,
	});
}

test("a Parent connects a bank, and its Accounts and Transactions come in", async ({ browser }) => {
	const page = await signedInPage(browser, parent.email);
	await createHousehold(page, "The Rinks", "Alex");
	await page.getByRole("link", { name: "Accounts", exact: true }).click();
	await expect(page.getByRole("heading", { level: 1 })).toHaveText("Accounts");

	// Nothing's here yet, so each account there is added as a new Account.
	await page.getByRole("button", { name: "Connect a bank" }).click();
	await expect(chooseSheet(page).getByLabel("Plaid Checking ••0000")).toHaveText(
		"Add as a new Account",
	);
	await chooseSheet(page).getByRole("button", { name: "Start bringing them in" }).click();
	await expect(toast(page, "Bringing in 4 Accounts from First Platypus Bank.")).toBeVisible();

	// Checking, savings, card and loan become Accounts with their balances; the brokerage doesn't.
	await expect(
		page.getByRole("link", { name: "Plaid Checking ••0000, Checking, $1,250.40" }),
	).toBeVisible();
	await expect(page.getByRole("link", { name: /^Kids Savings ••1111, Savings, / })).toBeVisible();
	await expect(page.getByRole("link", { name: /^Costco Anywhere Visa ••3333, / })).toBeVisible();
	await expect(page.getByRole("link", { name: /^Plaid Auto Loan ••4444, / })).toBeVisible();
	await expect(page.getByRole("link", { name: /Brokerage/ })).toHaveCount(0);

	// The Import Workflow finishes, and the screen hears of it.
	const connection = bankConnections(page).getByRole("listitem");
	await expect(connection).toContainText("First Platypus Bank");
	await expect(connection).toContainText("4 Accounts · Up to date");

	// Its Import sits in the Account's history like a statement's.
	await page.getByRole("link", { name: /^Plaid Checking ••0000, / }).click();
	await expect(page.locator("[data-slot=detail-title]")).toContainText("Plaid Checking");
	const imports = page.getByRole("list", { name: "Imported statements" });
	await expect(imports.getByRole("listitem")).toHaveCount(1);
	await expect(imports).toContainText("From First Platypus Bank");
	await expect(imports).toContainText("2 Transactions and 1 deposit as income");

	// The same login again is refused rather than doubled.
	await page.getByRole("link", { name: "Accounts", exact: true }).click();
	await bankConnections(page).getByRole("button", { name: "Connect a bank" }).click();
	// Noodle sees it's the same bank and accounts, and offers to reconnect instead (#71). A Parent
	// who says it's a different login goes on, and the same Item is still refused.
	await page
		.getByRole("dialog", { name: /already connected First Platypus Bank/ })
		.getByRole("button", { name: "It’s a different login" })
		.click();
	await expect(toast(page, "That bank is connected already.")).toBeVisible();
	await expect(bankConnections(page).getByRole("listitem")).toHaveCount(1);
});

test("Plaid's webhooks sync the bank, and a lapsed login is reconnected", async ({ browser }) => {
	test.slow();
	const page = await signedInPage(browser, parent.email);
	await createHousehold(page, "The Rinks", "Alex");
	await page.getByRole("link", { name: "Accounts", exact: true }).click();
	await connectBank(page);
	const connection = bankConnections(page).getByRole("listitem");
	await expect(connection).toContainText("4 Accounts · Up to date");
	const itemId = await itemIdOf(parent.userId);

	// Netflix is still pending at the bank, and says so.
	await nav(page).getByRole("link", { name: "Transactions" }).click();
	await expect(page.locator("[data-slot=page-header]:visible")).toContainText("Transactions");
	await expect(page.getByRole("button", { name: /^Netflix \(pending\), \$9\.99, / })).toBeVisible();

	// A webhook nobody signed does nothing.
	const unsigned = await plaidWebhook(
		page,
		{ webhook_type: "TRANSACTIONS", webhook_code: "SYNC_UPDATES_AVAILABLE", item_id: itemId },
		false,
	);
	expect(unsigned.status()).toBe(401);

	// Plaid says there's news: Netflix posted, for a little more, in its place; Target is pending.
	const synced = await plaidWebhook(page, {
		webhook_type: "TRANSACTIONS",
		webhook_code: "SYNC_UPDATES_AVAILABLE",
		item_id: itemId,
	});
	expect(synced.status()).toBe(200);
	await expect(page.getByRole("button", { name: /^Netflix, \$10\.49, / })).toBeVisible();
	await expect(page.getByRole("button", { name: /^Netflix/ })).toHaveCount(1);
	await expect(page.getByRole("button", { name: /^Target \(pending\), \$45, / })).toBeVisible();

	// The login lapses: the Bank Connection waits for the Parent to log in again.
	await plaidWebhook(page, {
		webhook_type: "ITEM",
		webhook_code: "ERROR",
		item_id: itemId,
		error: { error_code: "ITEM_LOGIN_REQUIRED" },
	});
	await page.getByRole("link", { name: "Accounts", exact: true }).click();
	await expect(connection).toContainText("The bank wants you to log in again.");
	await connection.getByRole("button", { name: "Reconnect First Platypus Bank" }).click();
	await expect(toast(page, "Reconnected.")).toBeVisible();
	await expect(connection).toContainText("4 Accounts · Up to date");
	await expect(connection.getByRole("button", { name: /Reconnect/ })).toHaveCount(0);
});

test("a bank that's down, has a new account, or was revoked says so on its row", async ({
	browser,
}) => {
	test.slow();
	const page = await signedInPage(browser, parent.email);
	await createHousehold(page, "The Rinks", "Alex");
	await page.getByRole("link", { name: "Accounts", exact: true }).click();
	await connectBank(page);
	const connection = bankConnections(page).getByRole("listitem");
	await expect(connection).toContainText("4 Accounts · Up to date · Last updated");
	const itemId = await itemIdOf(parent.userId);
	const item = (webhook_code: string, more: Record<string, unknown> = {}) =>
		plaidWebhook(page, { webhook_type: "ITEM", webhook_code, item_id: itemId, ...more });

	// The bank is down: the row says so, and doesn't ask for a login.
	expect((await item("ERROR", { error: { error_code: "INSTITUTION_DOWN" } })).status()).toBe(200);
	await page.reload();
	await expect(connection).toContainText("Your bank isn’t answering right now.");
	await expect(connection.getByRole("button", { name: /Reconnect/ })).toHaveCount(0);

	// The next sync that works clears it. Plaid sending that webhook twice changes nothing.
	const news = {
		webhook_type: "TRANSACTIONS",
		webhook_code: "SYNC_UPDATES_AVAILABLE",
		item_id: itemId,
	};
	expect((await plaidWebhook(page, news)).status()).toBe(200);
	expect((await plaidWebhook(page, news)).status()).toBe(200);
	await expect(async () => {
		await page.reload();
		await expect(connection).toContainText("4 Accounts · Up to date", { timeout: 3000 });
		await expect(connection).not.toContainText("isn’t answering", { timeout: 3000 });
	}).toPass({ timeout: 45_000 });

	// The bank has a new account: the row offers it, through Link and then Choose Accounts.
	expect((await item("NEW_ACCOUNTS_AVAILABLE")).status()).toBe(200);
	await page.reload();
	await expect(connection).toContainText("First Platypus Bank has a new account. Add it?");
	await connection
		.getByRole("button", { name: "Add the new account at First Platypus Bank" })
		.click();
	await expect(page.getByRole("dialog")).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(page.getByRole("dialog")).toBeHidden();
	await expect(connection).not.toContainText("has a new account");

	// The Parent turned access off at the bank: it's disconnected, and its Accounts stay.
	expect((await item("USER_PERMISSION_REVOKED")).status()).toBe(200);
	await page.reload();
	await expect(connection).toContainText("4 Accounts");
	await expect(connection).toContainText("Access was turned off at the bank");
	// Only Disconnect, which deletes what's left of the link (#61).
	await expect(connection.getByRole("button")).toHaveCount(1);
	await expect(
		connection.getByRole("button", { name: "Disconnect First Platypus Bank" }),
	).toBeVisible();
});
