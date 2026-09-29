import { execFileSync } from "node:child_process";
import { expect, type Page, test } from "@playwright/test";
import { signFakeWebhook } from "../src/server/plaid-fake-webhook-key";
import { createTestParent } from "./parents";
import { createHousehold, signedInPage } from "./session";

// Connecting a bank through Plaid Link, against the fake Plaid API (AI_MODEL=stub): its Accounts
// appear at once, and the Import Workflow, started from the ingest Queue, brings in their
// Transactions. Then Plaid's webhooks, signed with the fake's key: new transactions sync the
// bank (a pending charge posts in its place), and a lapsed login waits for a reconnect.

let parent: Awaited<ReturnType<typeof createTestParent>>;

test.beforeEach(async () => {
	parent = await createTestParent();
});

test.afterEach(async () => {
	await parent?.remove();
});

const toast = (page: Page, text: string) => page.getByRole("status").filter({ hasText: text });
const bankConnections = (page: Page) => page.getByRole("region", { name: "Bank Connections" });
const nav = (page: Page) => page.getByRole("navigation", { name: "Main" });

/** The fake Plaid Item behind the Parent's Bank Connection. */
function itemIdOf(clerkUserId: string): string {
	const sql = `select b.external_id as item from bank_connections b join members m on m.household_id = b.household_id where m.clerk_user_id = '${clerkUserId.replaceAll("'", "''")}'`;
	const output = execFileSync(
		"bunx",
		["wrangler", "d1", "execute", "noodle", "--local", "--json", `--command=${sql}`],
		{ encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
	);
	const [{ results }] = JSON.parse(output) as [{ results: { item: string }[] }];
	const item = results[0]?.item;
	if (!item) throw new Error("No Bank Connection for the Parent");
	return item;
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

test("Plaid's webhooks sync the bank, and a lapsed login is reconnected", async ({ browser }) => {
	test.slow();
	const page = await signedInPage(browser, parent.email);
	await createHousehold(page, "The Rinks", "Alex");
	await page.getByRole("link", { name: "Goals", exact: true }).click();
	await bankConnections(page).getByRole("button", { name: "Connect a bank" }).click();
	const connection = bankConnections(page).getByRole("listitem");
	await expect(connection).toContainText("4 Accounts · Up to date");
	const itemId = itemIdOf(parent.userId);

	// Netflix is still pending at the bank, and says so.
	await nav(page).getByRole("link", { name: "Transactions" }).click();
	await expect(page.getByRole("heading", { level: 1 })).toContainText("Transactions");
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
	await page.getByRole("link", { name: "Goals", exact: true }).click();
	await expect(connection).toContainText("The bank wants you to log in again.");
	await connection.getByRole("button", { name: "Reconnect First Platypus Bank" }).click();
	await expect(toast(page, "Reconnected.")).toBeVisible();
	await expect(connection).toContainText("4 Accounts · Up to date");
	await expect(connection.getByRole("button", { name: /Reconnect/ })).toHaveCount(0);
});
