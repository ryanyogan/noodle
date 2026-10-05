import { expect, type Locator, type Page, test } from "@playwright/test";
import { createTestParent } from "./parents";
import { createPlannedHousehold, signedInPage } from "./session";

// Forwarded Receipts: a Parent gets the Household's Receipt address on the Household page, and a
// receipt email they forward there (delivered to the Worker's email handler as Email Routing
// would, through the dev server's local email endpoint) becomes a Quick Add split across the
// Buckets its lines are for, read by the deterministic fake model.

let parent: Awaited<ReturnType<typeof createTestParent>>;

test.beforeEach(async () => {
	parent = await createTestParent();
});

test.afterEach(async () => {
	await parent?.remove();
});

const list = (page: Page) =>
	page.getByRole("grid", { name: /^Transactions in / }).locator("[data-slot=data-table-body]");
const editSheet = (page: Page) =>
	page
		.locator("[role=dialog], [data-slot=transaction-detail]")
		.filter({ has: page.getByRole("heading", { name: "Edit Transaction" }) });

/** A receipt email as a Parent forwards it, dated the day it arrives. */
const receiptEmail = (from: string, to: string, id: string, body: string) =>
	[
		`From: ${from}`,
		`To: ${to}`,
		"Subject: Fwd: your receipt",
		`Message-ID: <${id}@example.com>`,
		"MIME-Version: 1.0",
		"Content-Type: text/plain; charset=utf-8",
		"",
		body,
	].join("\r\n");

/** Delivers an email to the Worker, as Email Routing does. */
async function deliver(page: Page, from: string, to: string, raw: string) {
	const params = new URLSearchParams({ from, to });
	const response = await page.request.post(`/cdn-cgi/local/email?${params}`, {
		headers: { "Content-Type": "message/rfc822" },
		data: raw,
	});
	expect(response.ok()).toBe(true);
}

/** Waits for the ingest Queue to file a Receipt: its Transaction shows up in the list. */
async function waitForRow(page: Page, name: RegExp) {
	const row = list(page).getByRole("button", { name });
	await expect(async () => {
		await page.reload();
		await expect(row).toBeVisible({ timeout: 2_000 });
	}).toPass({ timeout: 30_000 });
	return row;
}

/** Opens a Transaction's detail, once the reloaded list responds to a tap. */
async function open(page: Page, row: Locator) {
	await expect(async () => {
		await row.click();
		await expect(editSheet(page)).toBeVisible({ timeout: 1_000 });
	}).toPass({ timeout: 10_000 });
}

test("a forwarded receipt becomes a Quick Add split across its Buckets", async ({ browser }) => {
	// Two Receipts through the ingest Queue.
	test.setTimeout(90_000);
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, {
		baseline: "5,000",
		buckets: [
			["Groceries", "800"],
			["Home", "300"],
		],
	});
	const transactions = page.url().replace(/\/month\/(\d{4}-\d{2}).*$/, "/transactions/$1");

	await page.goto("/household");
	const section = page.getByRole("region", { name: "Forward receipts" });
	await section.getByRole("button", { name: "Get an address" }).click();
	const address =
		(await section
			.locator("code")
			.filter({ hasText: /^receipts\+/ })
			.textContent()) ?? "";
	expect(address).toMatch(/^receipts\+[a-z0-9]{20}@/);

	// Sure of every item: split on its own, tax shared out.
	const costco = receiptEmail(
		parent.email,
		address,
		`costco-${Date.now()}`,
		[
			"COSTCO WHOLESALE",
			"E 1234 KS MILK 2GAL 7.49",
			"E 55 BANANAS 1.99",
			"1122 KS PAPER TOWEL 22.99",
			"0000 COUPON 4.00-",
			"3344 DETERGENT 17.99",
			"TAX 3.25",
			"TOTAL 49.71",
		].join("\r\n"),
	);
	await deliver(page, parent.email, address, costco);
	// Delivered again, as a retrying mail server might: still one Receipt.
	await deliver(page, parent.email, address, costco);

	await page.goto(transactions);
	const row = await waitForRow(page, /^costco( wholesale)?, \$49\.71/i);
	await expect(list(page).getByRole("button", { name: /^costco/i })).toHaveCount(1);
	await open(page, row);
	const receipt = editSheet(page).getByRole("region", { name: "Receipt" });
	await expect(receipt).toContainText("COSTCO WHOLESALE");
	await expect(receipt).toContainText("Split from its Receipt.");
	const parts = receipt.getByRole("list", { name: "Splits from the Receipt" });
	await expect(parts.getByRole("listitem")).toHaveCount(2);
	await expect(parts).toContainText("Home");
	await expect(parts).toContainText("$39.57");
	await expect(parts).toContainText("Groceries");
	await expect(parts).toContainText("$10.14");
	await receipt.getByText("6 lines").click();
	await expect(receipt).toContainText("COUPON");
	await page.keyboard.press("Escape");

	// Unsure of an item: it proposes Splits, which the Parent applies.
	await deliver(
		page,
		parent.email,
		address,
		receiptEmail(
			parent.email,
			address,
			`corner-${Date.now()}`,
			["Corner Store", "MILK 3.49", "HOME DECOR CANDLE 12.00", "TOTAL 15.49"].join("\r\n"),
		),
	);
	const corner = await waitForRow(page, /^Corner Store, \$15\.49/);
	await open(page, corner);
	const proposed = editSheet(page).getByRole("region", { name: "Receipt" });
	await proposed.getByRole("button", { name: "Apply these Splits" }).click();
	await expect(editSheet(page)).toBeHidden();
	await open(page, corner);
	await expect(editSheet(page).getByRole("region", { name: "Receipt" })).toContainText(
		"Split from its Receipt.",
	);
});
