import { expect, type Page, test } from "@playwright/test";
import { createTestParent } from "./parents";
import {
	addBucketsInSheet,
	choose,
	chooseKind,
	createPlannedHousehold,
	reloadUntil,
	signedInPage,
} from "./session";

// Categorization runs with its deterministic fake (AI_MODEL=stub, see vite.config.ts): it knows
// Costco is groceries and Shell is gas, and nothing about ACME.

let parent: Awaited<ReturnType<typeof createTestParent>>;

test.beforeEach(async () => {
	parent = await createTestParent();
});

test.afterEach(async () => {
	await parent?.remove();
});

const editSheet = (page: Page) =>
	page
		.locator("[role=dialog], [data-slot=transaction-detail]")
		.filter({ has: page.getByRole("heading", { name: "Edit Transaction" }) });

/** Adds a credit card Account on the Accounts page and uploads a card statement to it. */
async function uploadCardStatement(page: Page, lines: [string, string][]) {
	await page.getByRole("link", { name: "Accounts", exact: true }).click();
	await expect(page.getByRole("heading", { level: 1 })).toHaveText("Accounts");
	await page.getByLabel("Name").fill("Visa");
	await chooseKind(page, "credit-card");
	await page.getByLabel("Owed now").fill("800");
	await page.getByRole("button", { name: "Add Account" }).click();
	await page.getByRole("link", { name: /^Visa, / }).click();
	await expect(page.locator("[data-slot=detail-title]:visible")).toContainText("Visa");

	// Dated today, so the lines land in the month the Plan was made for.
	const today = await page.evaluate(() => new Date().toLocaleDateString("en-US"));
	const csv = [
		"Transaction Date,Description,Debit,Credit",
		...lines.map(([what, amount]) => `${today},${what},${amount},`),
	].join("\n");
	await page.getByRole("button", { name: "Upload statement" }).click();
	const sheet = page.getByRole("dialog", { name: "Upload a statement" });
	await sheet
		.getByLabel("Statement file")
		.setInputFiles({ name: "visa.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
	await sheet.getByRole("button", { name: `Import ${lines.length} lines` }).click();
	await expect(sheet).toBeHidden();
}

test("imported Transactions are filed automatically, marked, and a Parent can change them", async ({
	browser,
}) => {
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, {
		baseline: "5,000",
		buckets: [
			["Groceries", "1,200"],
			["Gas", "300"],
		],
	});
	const thisMonth = page.url();
	await uploadCardStatement(page, [
		["COSTCO WHSE #1234", "61.20"],
		["SHELL OIL 5741", "38.05"],
		["ACME WIDGETS LLC", "19.99"],
	]);

	// Filed and named by the background run a moment after the upload.
	const shell = page.getByRole("button", {
		name: "Shell, $38.05, Gas (filed automatically), For Everyone, from Visa",
	});
	await reloadUntil(page, thisMonth.replace(/\/month\/(\d{4}-\d{2}).*$/, "/transactions/$1"), () =>
		expect(shell).toBeVisible({ timeout: 2_000 }),
	);
	await expect(page.getByLabel("Search notes and merchants")).toBeEnabled();
	const costco = page.getByRole("button", {
		name: "Costco, $61.20, Groceries (filed automatically), For Everyone, from Visa",
	});
	await expect(costco).toBeVisible();
	// Unsure: left for Review, unassigned and unmarked.
	await expect(
		page.getByRole("button", {
			name: "Acme Widgets, $19.99, Unassigned, For Everyone, from Visa",
		}),
	).toBeVisible();
	await expect(page.getByRole("img", { name: "Filed automatically" })).toHaveCount(2);

	// The marker opens the Transaction, which says how it was filed; a Parent changes it.
	await costco.click();
	await expect(editSheet(page).getByTestId("auto-filed-hint")).toContainText(
		"Filed automatically, as a best guess.",
	);
	await choose(editSheet(page), "Assigned to", "Gas");
	await expect(editSheet(page).getByTestId("auto-filed-hint")).toHaveCount(0);
	await editSheet(page).getByRole("button", { name: "Save" }).click();
	await expect(editSheet(page)).toBeHidden();
	await expect(
		page.getByRole("button", {
			name: "Costco, $61.20, Gas, For Everyone, from Visa",
		}),
	).toBeVisible();
	await expect(page.getByRole("img", { name: "Filed automatically" })).toHaveCount(1);

	// Still so after a reload: the Parent's choice is theirs, not categorization's.
	await page.reload();
	await expect(
		page.getByRole("button", {
			name: "Costco, $61.20, Gas, For Everyone, from Visa",
		}),
	).toBeVisible();
	await expect(page.getByRole("img", { name: "Filed automatically" })).toHaveCount(1);
});

test("Review looks again once the Plan has a Bucket for what waits there", async ({ browser }) => {
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, { baseline: "5,000", buckets: [["Groceries", "1,200"]] });
	const thisMonth = page.url();
	await uploadCardStatement(page, [
		["SHELL OIL 5741", "38.05"],
		["ACME WIDGETS LLC", "19.99"],
	]);

	const review = new URL("/review", thisMonth).toString();
	await page.goto(review);
	await expect(page.getByLabel("2 to review")).toBeVisible();
	await page.getByRole("button", { name: "Look again" }).click();
	await expect(page.getByText("Looked again: still no suggestions")).toBeVisible();

	// The stub knows Shell is gas, and suggests (unsure) a Bucket named in the merchant.
	await page.goto(thisMonth.replace(/\/month\/(\d{4}-\d{2}).*$/, "/plan/$1#buckets"));
	await addBucketsInSheet(page, [
		["Gas", "300"],
		["Acme", "50"],
	]);

	await page.goto(review);
	await page.getByRole("button", { name: "Look again" }).click();
	await expect(page.getByText(/1 with a suggestion/)).toBeVisible();
	await expect(page.getByLabel("1 to review")).toBeVisible();
});
