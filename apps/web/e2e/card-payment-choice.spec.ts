import { expect, type Page, test } from "@playwright/test";
import { createTestParent } from "./parents";
import { accountKindLabel, choose, createPlannedHousehold, signedInPage } from "./session";

// "It's a card payment" (issue 136): one named choice on money out that asks which card. A card
// Noodle keeps by statements makes it a Transfer naming the card; a card that isn't in Noodle asks
// whether the payment counts as spending. Each answer is remembered, and listed on the Rules page.

let parent: Awaited<ReturnType<typeof createTestParent>>;

test.beforeEach(async () => {
	parent = await createTestParent();
});

test.afterEach(async () => {
	await parent?.remove();
});

const toast = (page: Page, text: string) => page.getByRole("status").filter({ hasText: text });

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
	await expect(page.locator("[data-slot=detail-title]:visible")).toContainText(account.name);
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
	await expect(toast(page, file).first()).toBeVisible();
}

const HEADER = "Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #";

/** Opens the detail of this month's unassigned line of `amount`, at its Transfer section. */
async function openLine(page: Page, amount: string) {
	const row = page.getByRole("button", {
		name: new RegExp(`, \\$${amount}, Unassigned, .*from Checking$`),
	});
	await expect(row).toBeVisible();
	await row.click();
	const sheet = page
		.locator("[role=dialog], [data-slot=transaction-detail]")
		.filter({ has: page.getByRole("heading", { name: "Transfer" }) });
	await expect(sheet.getByRole("button", { name: "It’s a card payment" })).toBeEnabled();
	return sheet;
}

test("“It’s a card payment” asks which card, names it on the Transfer, and remembers the wording", async ({
	browser,
}) => {
	test.slow();
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, { baseline: "5,000", buckets: [["Groceries", "1,200"]] });
	const thisMonth = page.url();
	const day = await today(page);

	// Visa is kept by statements; its own side of the payment hasn't come in.
	await uploadStatement(page, { name: "Visa", kind: "credit-card", balance: "300" }, "visa.csv", [
		HEADER,
		`DEBIT,${day},"REI #44 SEATTLE",-60.00,DEBIT_CARD,,`,
	]);
	await uploadStatement(
		page,
		{ name: "Checking", kind: "checking", balance: "2,500" },
		"checking.csv",
		[
			HEADER,
			`DEBIT,${day},"CARDMEMBER SERV WEB PYMT",-250.00,ACH_DEBIT,2250.00,`,
			`DEBIT,${day},"AMEX EPAYMENT ACH PMT",-400.00,ACH_DEBIT,1850.00,`,
		],
	);

	await page.goto(thisMonth.replace(/\/month\/(\d{4}-\d{2}).*$/, "/transactions/$1"));
	// A cold dev server builds the page first: rows open once it is hydrated.
	await expect(page.getByLabel("Bucket")).toBeEnabled({ timeout: 30_000 });

	// A card Noodle keeps by statements: a Transfer that names it.
	let sheet = await openLine(page, "250");
	await sheet.getByRole("button", { name: "It’s a card payment" }).click();
	let choice = sheet.getByTestId("card-payment-choice");
	await expect(choice).toContainText("Which card does it pay?");
	await choice.getByRole("button", { name: "Visa", exact: true }).click();
	await expect(toast(page, "marked as a Transfer to Visa")).toContainText(
		"Payments worded like it will be too.",
	);
	await expect(
		page.getByText("Transfer · Checking → Visa").filter({ visible: true }).first(),
	).toBeVisible();

	// A card that isn't in Noodle: is the payment the spending? Yes would plan it as a Commitment.
	sheet = await openLine(page, "400");
	await sheet.getByRole("button", { name: "It’s a card payment" }).click();
	choice = sheet.getByTestId("card-payment-choice");
	await choice.getByRole("button", { name: "A card that isn’t in Noodle" }).click();
	await expect(choice).toContainText("Count this payment as spending?");
	const yes = choice.getByRole("link", { name: "Yes, make a Commitment" });
	await expect(yes).toHaveAttribute("href", /\/plan\/\d{4}-\d{2}\/commitments\?.*amount=40000/);
	await expect(yes).toHaveAttribute("href", /paysDown=add/);
	// No: a Transfer with no other side, which counts nowhere.
	await choice.getByRole("button", { name: "No, it’s a Transfer" }).click();
	await expect(toast(page, "marked as a Transfer. Payments worded like it")).toBeVisible();
	await expect(
		page.getByText("Transfer out of Checking").filter({ visible: true }).first(),
	).toBeVisible();

	// Both answers are remembered, and can be removed on the Rules page.
	await page.goto(new URL("/review/rules", thisMonth).href);
	const remembered = page.getByTestId("card-payment-rules");
	// They are fetched once the page is hydrated, which a cold dev server takes a while over.
	await expect(remembered.getByTestId("card-payment-rule")).toHaveCount(2, { timeout: 30_000 });
	await expect(remembered).toContainText("Always a Transfer to Visa");
	await expect(remembered).toContainText("Always a Transfer to a card that isn’t in Noodle");
	const visa = remembered
		.getByTestId("card-payment-rule")
		.filter({ hasText: "Always a Transfer to Visa" });
	await expect(visa.getByRole("button", { name: /^Stop remembering / })).toBeEnabled();
	await visa.getByRole("button", { name: /^Stop remembering / }).click();
	await expect(toast(page, "No longer remembered")).toBeVisible();
	await expect(remembered.getByTestId("card-payment-rule")).toHaveCount(1);
});
