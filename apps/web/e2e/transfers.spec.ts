import { expect, type Page, test } from "@playwright/test";
import { createTestParent } from "./parents";
import { accountKindLabel, choose, createPlannedHousehold, signedInPage } from "./session";

let parent: Awaited<ReturnType<typeof createTestParent>>;

test.beforeEach(async () => {
	parent = await createTestParent();
});

test.afterEach(async () => {
	await parent?.remove();
});

const toast = (page: Page, text: string) => page.getByRole("status").filter({ hasText: text });
const bucketRow = (page: Page, name: string) =>
	page.getByRole("listitem", { name: new RegExp(`^${name}: `) });

/** Today where the browser (and so the Household) is, as a statement writes it. */
const today = (page: Page) =>
	page.evaluate(() =>
		new Date().toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" }),
	);

/** Adds an Account on the Accounts page, opens it, and uploads a CSV statement to it. */
async function uploadStatement(
	page: Page,
	account: { name: string; kind: "checking" | "credit-card"; balance: string },
	file: string,
	lines: string[],
) {
	await page.getByRole("link", { name: "Accounts", exact: true }).click();
	await expect(page.getByRole("heading", { level: 1 })).toHaveText("Accounts");
	// With an Account already there, the form waits behind Add Account.
	if (await page.getByRole("region", { name: "Totals" }).isVisible()) {
		await expect(async () => {
			await page.getByRole("button", { name: "Add Account" }).click();
			await expect(page.getByLabel("Name")).toBeVisible({ timeout: 1000 });
		}).toPass();
	}
	await page.getByLabel("Name").fill(account.name);
	await choose(page, "Kind", accountKindLabel(account.kind));
	await page
		.getByLabel(account.kind === "credit-card" ? "Owed now" : "Balance now")
		.fill(account.balance);
	await page.getByRole("button", { name: "Add Account" }).click();
	await page.getByRole("link", { name: new RegExp(`^${account.name}, `) }).click();
	await expect(page.getByRole("heading", { level: 1 })).toContainText(account.name);

	await page.getByRole("button", { name: "Upload statement" }).click();
	const sheet = page.getByRole("dialog", { name: "Upload a statement" });
	await sheet
		.getByLabel("Statement file")
		.setInputFiles({ name: file, mimeType: "text/csv", buffer: Buffer.from(lines.join("\n")) });
	await sheet
		.getByRole("button", {
			name: `Import ${lines.length - 1} line${lines.length === 2 ? "" : "s"}`,
		})
		.click();
	await expect(sheet).toBeHidden();
}

/** Opens this month's Transactions, once rows can be opened (the page is hydrated). */
async function openTransactions(page: Page, thisMonth: string) {
	await page.goto(thisMonth.replace(/\/month\/(\d{4}-\d{2}).*$/, "/transactions/$1"));
	await expect(page.getByLabel("Bucket")).toBeEnabled();
}

test("paying the card from checking is one Transfer, which counts nowhere", async ({ browser }) => {
	test.slow();
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, { baseline: "5,000", buckets: [["Groceries", "1,200"]] });
	const thisMonth = page.url();
	const day = await today(page);

	await uploadStatement(
		page,
		{ name: "Checking", kind: "checking", balance: "2,500" },
		"checking.csv",
		[
			"Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #",
			`DEBIT,${day},"VISA ONLINE PAYMENT",-500.00,ACH_DEBIT,2000.00,`,
			// A merchant categorization doesn't know (AI_MODEL=stub), so it stays unassigned.
			`DEBIT,${day},"CORNER STORE #1",-30.00,DEBIT_CARD,1970.00,`,
		],
	);
	await expect(toast(page, "checking.csv: 2 Transactions")).toBeVisible();
	// The card's side of the same payment pairs with it on the way in.
	await uploadStatement(page, { name: "Visa", kind: "credit-card", balance: "800" }, "visa.csv", [
		"Transaction Date,Description,Debit,Credit",
		`${day},AUTOPAY PAYMENT - THANK YOU,,500.00`,
	]);
	await expect(toast(page, "visa.csv: 1 Transaction; 1 Transfer")).toBeVisible();

	// Both sides are listed as the Transfer; neither can be assigned to a Bucket.
	await openTransactions(page, thisMonth);
	await expect(page.getByText("Transfer · Checking → Visa")).toHaveCount(2);
	await page
		.getByRole("button", { name: "VISA ONLINE PAYMENT, $500, Transfer, Checking to Visa" })
		.click();
	let sheet = page.getByRole("dialog", { name: "Transfer" });
	await expect(sheet).toContainText("AUTOPAY PAYMENT - THANK YOU");
	await expect(sheet).toContainText("Found automatically");
	await expect(sheet.getByLabel("Bucket")).toHaveCount(0);

	// Unmarked, the payment waits to be assigned, and the card's side is just money back.
	await sheet.getByRole("button", { name: "Unmark Transfer" }).click();
	await expect(toast(page, "VISA ONLINE PAYMENT no longer a Transfer")).toBeVisible();
	await expect(
		page.getByRole("button", {
			name: "VISA ONLINE PAYMENT, $500, Unassigned, For Everyone, from Checking",
		}),
	).toBeVisible();
	const card = page.getByRole("button", {
		name: "AUTOPAY PAYMENT - THANK YOU, −$500, Money back, from Visa",
	});
	await expect(card).toBeVisible();

	// A Parent marks it again from the card's side; it pairs with the payment again.
	await card.click();
	sheet = page.getByRole("dialog", { name: "Money back" });
	await sheet.getByRole("button", { name: "Mark as Transfer" }).click();
	await expect(toast(page, "AUTOPAY PAYMENT - THANK YOU marked as a Transfer")).toBeVisible();
	await expect(page.getByText("Transfer · Checking → Visa")).toHaveCount(2);
	await expect(page.getByText("Unassigned · Everyone · Checking")).toHaveCount(1);
});

test("money back linked as a Refund goes back to the purchase's Bucket", async ({ browser }) => {
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, { baseline: "5,000", buckets: [["Gear", "300"]] });
	const thisMonth = page.url();
	const day = await today(page);

	await page.getByRole("link", { name: "Quick Add" }).click();
	const quickAdd = page.getByRole("dialog", { name: "Quick Add" });
	await expect(quickAdd).toBeVisible();
	await page.keyboard.type("80");
	await quickAdd.getByLabel("Note").fill("REI jacket");
	await quickAdd.getByRole("button", { name: /^Gear/ }).click();
	await expect(quickAdd).toBeHidden();
	await expect(bucketRow(page, "Gear")).toContainText("$80 spent");

	await uploadStatement(page, { name: "Visa", kind: "credit-card", balance: "800" }, "visa.csv", [
		"Transaction Date,Description,Debit,Credit",
		`${day},REI #11 RETURN,,24.99`,
	]);
	await expect(toast(page, "visa.csv: 1 Transaction")).toBeVisible();

	// The jacket is the likely purchase it refunds.
	await openTransactions(page, thisMonth);
	await page
		.getByRole("button", { name: "REI #11 RETURN, −$24.99, Money back, from Visa" })
		.click();
	const sheet = page.getByRole("dialog", { name: "Money back" });
	await sheet.getByRole("button", { name: /^Link as a Refund for REI jacket, \$80,/ }).click();
	await expect(toast(page, "REI #11 RETURN linked as a Refund")).toBeVisible();
	const refund = page.getByRole("button", {
		name: "REI #11 RETURN, −$24.99, Refund, Gear, from Visa",
	});
	await expect(refund).toBeVisible();
	await expect(page.getByText("Refund · Gear · Visa")).toBeVisible();

	await page.goto(thisMonth);
	await expect(bucketRow(page, "Gear")).toContainText("$55.01 spent");

	// Unlinked, it counts nowhere again.
	await openTransactions(page, thisMonth);
	await refund.click();
	await expect(page.getByRole("dialog", { name: "Money back" })).toContainText("REI jacket");
	await page.getByRole("button", { name: "Unlink Refund" }).click();
	await expect(toast(page, "REI #11 RETURN unlinked")).toBeVisible();
	await expect(page.getByText("Money back · Visa")).toBeVisible();
	await page.goto(thisMonth);
	await expect(bucketRow(page, "Gear")).toContainText("$80 spent");
});
