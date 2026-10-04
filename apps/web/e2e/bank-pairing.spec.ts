import { expect, type Page } from "@playwright/test";
import { signFakeWebhook } from "../src/server/plaid-fake-webhook-key";
import { seedSql } from "./seed-sql";
import {
	accountKindLabel,
	choose,
	createPlannedHousehold,
	pickQuickAddBucket,
	signedInPage,
} from "./session";
import { type SharedParent, test } from "./worker-parent";

// Connecting a bank pairs with the Accounts already there (ADR-0020), against the fake Plaid API
// (AI_MODEL=stub). A card kept with a statement and a Quick Add is chosen as the bank's card: it
// stays the same Account, the statement's line isn't brought in again, the Quick Add is Matched
// with the bank's copy, and a reconnect keeps the pairing. Stopping brings nothing in after.

let parent: SharedParent;

test.beforeEach(async ({ sharedParent }) => {
	parent = sharedParent;
});

const toast = (page: Page, text: string) => page.getByRole("status").filter({ hasText: text });
const bankConnections = (page: Page) => page.getByRole("region", { name: "Bank Connections" });
const chooseSheet = (page: Page) =>
	page.getByRole("dialog", { name: "Which of these do you have already?" });
const quickAddSheet = (page: Page) => page.getByRole("dialog", { name: "Quick Add" });
const accountsLink = (page: Page) => page.getByRole("link", { name: "Accounts", exact: true });

/** The fake bank's days are UTC days, back from today (plaid-fake.ts). */
const utcDaysAgo = (days: number) => new Date(Date.now() - days * 86_400_000);
const usDate = (at: Date) => `${at.getUTCMonth() + 1}/${at.getUTCDate()}/${at.getUTCFullYear()}`;
const monthOf = (at: Date) => at.toISOString().slice(0, 7);

/** The fake Plaid Item behind the Parent's Bank Connection. */
async function itemIdOf(clerkUserId: string): Promise<string> {
	const sql = `select b.external_id as item from bank_connections b join members m on m.household_id = b.household_id where m.clerk_user_id = '${clerkUserId.replaceAll("'", "''")}'`;
	const [results = []] = await seedSql([sql]);
	const item = results[0]?.item;
	if (!item) throw new Error("No Bank Connection for the Parent");
	return String(item);
}

async function plaidWebhook(page: Page, payload: Record<string, unknown>) {
	const body = JSON.stringify(payload);
	return page.request.post("/webhooks/plaid", {
		headers: {
			"Content-Type": "application/json",
			"Plaid-Verification": await signFakeWebhook(body),
		},
		data: body,
	});
}

test("connecting pairs with the card already there, and counts nothing twice", async ({
	browser,
}) => {
	test.slow();
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, { baseline: "5,000", buckets: [["Fun", "300"]] });
	const origin = new URL(page.url()).origin;

	// Netflix, Quick Added before the bank's copy came in.
	await page.getByRole("link", { name: "Quick Add" }).click();
	await expect(quickAddSheet(page)).toBeVisible();
	await page.keyboard.type("9.99");
	await quickAddSheet(page).getByLabel("Note").fill("Netflix");
	await pickQuickAddBucket(quickAddSheet(page), "Fun");
	await expect(quickAddSheet(page)).toBeHidden();

	// The Costco card, added by hand and kept with a statement that has Shell on it.
	await accountsLink(page).click();
	await page.getByLabel("Name").fill("Costco Anywhere Visa");
	await choose(page, "Kind", accountKindLabel("credit-card"));
	await page.getByLabel("Owed now").fill("300");
	await page.getByRole("button", { name: "Add Account" }).click();
	await page.getByRole("link", { name: /^Costco Anywhere Visa, / }).click();
	await expect(page.locator("[data-slot=detail-title]")).toContainText("Costco Anywhere Visa");
	await expect(
		page.locator("[data-slot=master-detail-detail]").getByText("Entered by hand"),
	).toBeVisible();
	const shellDay = utcDaysAgo(2);
	const csv = [
		"Transaction Date,Description,Debit,Credit",
		`${usDate(shellDay)},SHELL OIL 5741,38.50,`,
	].join("\n");
	await page.getByRole("button", { name: "Upload statement" }).click();
	const upload = page.getByRole("dialog", { name: "Upload a statement" });
	await upload
		.getByLabel("Statement file")
		.setInputFiles({ name: "costco.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
	await upload.getByRole("button", { name: "Import 1 line" }).click();
	await expect(toast(page, "costco.csv: 1 Transaction")).toBeVisible();
	await expect(
		page.locator("[data-slot=master-detail-detail]").getByText(/^From statements · last /),
	).toBeVisible();

	// Connecting asks which of the bank's accounts the Household has: the card is suggested.
	await accountsLink(page).click();
	await bankConnections(page).getByRole("button", { name: "Connect a bank" }).click();
	const picks = chooseSheet(page);
	const card = picks.getByLabel("Costco Anywhere Visa ••3333");
	await expect(card).toHaveText("Same as Costco Anywhere Visa");
	await expect(picks.getByLabel("Plaid Checking ••0000")).toHaveText("Add as a new Account");
	// A checking account can't be the card.
	await picks.getByLabel("Plaid Checking ••0000").click();
	await expect(page.getByRole("listbox").getByRole("option")).toHaveText([
		"Add as a new Account",
		"Leave it out",
	]);
	await page.keyboard.press("Escape");
	await expect(page.getByRole("listbox")).toBeHidden();
	await choose(picks, "Plaid Auto Loan ••4444", "Leave it out");
	await picks.getByRole("button", { name: "Start bringing them in" }).click();
	await expect(toast(page, "Bringing in 3 Accounts from First Platypus Bank.")).toBeVisible();

	// The card stays one Account, now connected; the loan was left out.
	const connection = bankConnections(page).getByRole("listitem");
	await expect(connection).toContainText("3 Accounts · Up to date");
	// What it brought in: the card's three and checking's two, one of them Matched.
	await expect(connection).toContainText("Brought in 5 Transactions · 1 Matched to Quick Adds");
	await expect(page.getByRole("link", { name: /^Costco Anywhere Visa, / })).toHaveCount(1);
	await expect(page.getByRole("link", { name: /••3333/ })).toHaveCount(0);
	await expect(page.getByRole("link", { name: /Auto Loan/ })).toHaveCount(0);
	await page.getByRole("link", { name: /^Costco Anywhere Visa, / }).click();
	await expect(
		page.locator("[data-slot=master-detail-detail]").getByText(/^Connected · First Platypus Bank/),
	).toBeVisible();
	// A live balance isn't typed over, and the bank brings in what statements did.
	await expect(page.getByRole("button", { name: "Update what’s owed" })).toHaveCount(0);
	await expect(page.getByRole("button", { name: "Upload statement" })).toHaveCount(0);
	const brought = page.getByRole("region", { name: "Brought in from First Platypus Bank" });
	await expect(brought.getByRole("listitem")).toHaveCount(2);
	await expect(brought).toContainText(
		"3 Transactions; 1 Matched to a Quick Add; 1 already in Noodle",
	);

	// Shell is listed once, as the statement had it.
	await page.goto(`${origin}/transactions/${monthOf(shellDay)}`);
	// By the raw text or, once the background run has named it, the clean name, but only once.
	await expect(page.getByRole("button", { name: /^(Shell|SHELL OIL 5741), / })).toHaveCount(1);
	// Netflix counts once: the Quick Add, Matched with the bank's copy.
	await page.goto(`${origin}/transactions/${monthOf(utcDaysAgo(0))}`);
	const netflix = page.getByRole("button", { name: /^Netflix/ });
	await expect(netflix).toHaveCount(1);
	await expect(netflix).toHaveAccessibleName(/Matched in Costco Anywhere Visa/);

	// The login lapses: the card says so, and a statement is the stop-gap meanwhile.
	await plaidWebhook(page, {
		webhook_type: "ITEM",
		webhook_code: "ERROR",
		item_id: await itemIdOf(parent.userId),
		error: { error_code: "ITEM_LOGIN_REQUIRED" },
	});
	await accountsLink(page).click();
	await expect(page.getByRole("link", { name: /^Costco Anywhere Visa, / })).toContainText(
		"Log in again",
	);
	await page.getByRole("link", { name: /^Costco Anywhere Visa, / }).click();
	await expect(page.getByRole("button", { name: "Upload statement" })).toBeVisible();

	// Reconnecting keeps the pairing.
	await accountsLink(page).click();
	await connection.getByRole("button", { name: "Reconnect First Platypus Bank" }).click();
	await expect(toast(page, "Reconnected.")).toBeVisible();
	await expect(connection).toContainText("3 Accounts · Up to date");
	await expect(page.getByRole("link", { name: /^Costco Anywhere Visa, / })).toContainText(
		"Connected · First Platypus Bank",
	);

	// Stopping keeps the card and all it has, kept by statements again.
	await page.getByRole("link", { name: /^Costco Anywhere Visa, / }).click();
	// A connected Account's actions share a menu; a sheet opened from it gives focus back to it.
	const actions = page.getByRole("button", { name: "More actions for Costco Anywhere Visa" });
	await actions.click();
	await page.getByRole("menuitem", { name: "Rename…" }).click();
	await expect(page.getByRole("dialog").getByRole("textbox")).toBeFocused();
	await page.keyboard.press("Escape");
	await expect(actions).toBeFocused();
	await page.keyboard.press("Enter");
	await expect(page.getByRole("menuitem", { name: "Rename…" })).toBeFocused();
	await page.keyboard.press("ArrowDown");
	await expect(page.getByRole("menuitem", { name: "Stop bringing in…" })).toBeFocused();
	await page.keyboard.press("Enter");
	await page
		.getByRole("alertdialog")
		.getByRole("button", { name: "Stop bringing in from First Platypus Bank" })
		.click();
	await expect(
		page.locator("[data-slot=master-detail-detail]").getByText(/^From statements · last /),
	).toBeVisible();
	await expect(page.getByRole("button", { name: "Upload statement" })).toBeVisible();
	await accountsLink(page).click();
	await expect(connection).toContainText("2 Accounts");
	await expect(page.getByRole("link", { name: /^Costco Anywhere Visa, / })).toHaveCount(1);
});
