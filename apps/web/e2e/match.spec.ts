import { expect, type Page } from "@playwright/test";
import {
	accountKindLabel,
	choose,
	createPlannedHousehold,
	pickQuickAddBucket,
	reloadUntil,
	signedInPage,
	waitForReview,
} from "./session";
import { type SharedParent, test } from "./worker-parent";

let parent: SharedParent;

test.beforeEach(async ({ sharedParent }) => {
	parent = sharedParent;
});

const quickAddSheet = (page: Page) => page.getByRole("dialog", { name: "Quick Add" });
const editSheet = (page: Page) =>
	page
		.locator("[role=dialog], [data-slot=transaction-detail]")
		.filter({ has: page.getByRole("heading", { name: "Edit Transaction" }) });
const toast = (page: Page, text: string) => page.getByRole("status").filter({ hasText: text });
const bucketRow = (page: Page, name: string) =>
	page.getByRole("listitem", { name: new RegExp(`^${name}: `) });

/** Quick Adds an amount with a note into a Bucket. */
async function quickAdd(page: Page, amount: string, bucket: string, note: string) {
	await page.getByRole("link", { name: "Quick Add" }).click();
	await expect(quickAddSheet(page)).toBeVisible();
	await page.keyboard.type(amount);
	await quickAddSheet(page).getByLabel("Note").fill(note);
	await pickQuickAddBucket(quickAddSheet(page), bucket);
	await expect(quickAddSheet(page)).toBeHidden();
}

/** Adds a credit card Account on the Accounts page and uploads a card statement to it. */
async function uploadCardStatement(page: Page, lines: [string, string][]) {
	await page.getByRole("link", { name: "Accounts", exact: true }).click();
	await expect(page.getByRole("heading", { level: 1 })).toHaveText("Accounts");
	await page.getByLabel("Name").fill("Visa");
	await choose(page, "Kind", accountKindLabel("credit-card"));
	await page.getByLabel("Owed now").fill("800");
	await page.getByRole("button", { name: "Add Account" }).click();
	await page.getByRole("link", { name: /^Visa, / }).click();
	await expect(page.locator("[data-slot=detail-title]:visible")).toContainText("Visa");

	// Dated today where the browser (and so the Household) is: the Quick Adds' day.
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

test("the bank's copy of a Quick Add is Matched, so it counts once", async ({ browser }) => {
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, { baseline: "5,000", buckets: [["Groceries", "1,200"]] });
	const thisMonth = page.url();
	await quickAdd(page, "42.17", "Groceries", "Trader Joe's");
	await quickAdd(page, "12", "Groceries", "Chipotle");
	await expect(bucketRow(page, "Groceries")).toContainText("$54.17 spent");

	// The same amount comes in on the card: Matched on the way in. Chipotle plus a tip isn't.
	await uploadCardStatement(page, [
		["TRADER JOE'S #552", "42.17"],
		["CHIPOTLE 1234", "14.40"],
	]);
	await expect(toast(page, "visa.csv: 2 Transactions; 1 Matched to a Quick Add")).toBeVisible();

	await page.goto(thisMonth);
	// The Matched copy adds nothing; the unassigned one waits to be assigned.
	await expect(bucketRow(page, "Groceries")).toContainText("$54.17 spent");
	// The background run names the card's lines: the tipped Chipotle is listed by its clean name.
	const transactions = thisMonth.replace(/\/month\/(\d{4}-\d{2}).*$/, "/transactions/$1");
	await reloadUntil(page, transactions, () =>
		expect(page.getByRole("button", { name: /^Chipotle, \$14\.40, / })).toBeVisible({
			timeout: 2_000,
		}),
	);
	// Rows open their detail once the page is hydrated, as the filters are.
	await expect(page.getByLabel("Bucket")).toBeEnabled();
	const groceries = page.getByRole("button", {
		name: "Trader Joe's, $42.17, Groceries, For Everyone, Matched in Visa",
	});
	await expect(groceries).toBeVisible();
	await expect(page.getByText("TRADER JOE'S #552")).toHaveCount(0);

	// The Quick Add shows its bank copy, and can be unmatched: then both are listed.
	await groceries.click();
	const bankCopy = editSheet(page).getByRole("region", { name: "Bank copy" });
	await expect(bankCopy).toContainText("Trader Joe's");
	await expect(bankCopy).toContainText("Matched automatically");
	await bankCopy.getByRole("button", { name: "Unmatch" }).click();
	await expect(editSheet(page)).toBeHidden();
	await expect(toast(page, "Trader Joe's unmatched")).toBeVisible();
	await expect(
		page.getByRole("button", { name: "Trader Joe's, $42.17, Groceries, For Everyone" }),
	).toBeVisible();
	await expect(
		page.getByRole("button", {
			name: "Trader Joe's, $42.17, Unassigned, For Everyone, from Visa",
		}),
	).toBeVisible();

	// Chipotle is Matched by hand to the tipped charge: a different amount, the same merchant.
	await page.getByRole("button", { name: "Chipotle, $12, Groceries, For Everyone" }).click();
	const possible = editSheet(page).getByRole("region", { name: "Possible match" });
	await possible.getByRole("button", { name: /^Match with Chipotle, \$14\.40/ }).click();
	await expect(editSheet(page)).toBeHidden();
	await expect(toast(page, "Chipotle Matched")).toBeVisible();
	await expect(
		page.getByRole("button", {
			name: "Chipotle, $12, Groceries, For Everyone, Matched in Visa",
		}),
	).toBeVisible();
	await expect(page.getByText("CHIPOTLE 1234")).toHaveCount(0);

	// Still matched after a reload, and unmatched stays unmatched.
	await page.reload();
	await expect(page.getByText("Matched in Visa")).toHaveCount(1);
	await expect(
		page.getByRole("button", { name: /^Trader Joe's, \$42\.17, .*, from Visa$/ }),
	).toHaveCount(1);
	await page.context().close();
});

test("Review asks whether a tipped bank line is a Quick Add's copy, and Matches it", async ({
	browser,
}) => {
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, { baseline: "5,000", buckets: [["Groceries", "1,200"]] });
	await quickAdd(page, "40", "Groceries", "Nopa");
	await quickAdd(page, "45", "Groceries", "Target");
	// Dinner plus a tip on the card, and something else of a similar size.
	await uploadCardStatement(page, [
		["NOPA SAN FRANCISCO", "48.00"],
		["SHELL OIL 5744", "44.10"],
	]);
	await expect(toast(page, "visa.csv: 2 Transactions")).toBeVisible();

	await waitForReview(page, new URL("/review", page.url()).href, "1 of 2");
	const card = page.getByTestId("review-card");
	const offer = page.getByRole("region", { name: /^Is this your Quick Add/ });
	// Shell is only a similar amount: nothing to Match it with. Skip to Nopa's line.
	const current = page.locator("[data-testid=review-card][data-current]");
	while (!(await current.textContent())?.toLowerCase().includes("nopa")) {
		await expect(offer).toHaveCount(0);
		await page.keyboard.press("ArrowDown");
	}
	await expect(offer).toHaveAccessibleName(/^Is this your Quick Add “Nopa” \(\$40, /);
	await expect(offer.getByRole("button", { name: /^Match with / })).toHaveCount(1);
	await offer.getByRole("button", { name: /^Match with Nopa, \$40/ }).click();
	await expect(toast(page, "Nopa Matched")).toBeVisible();
	// Matched, it leaves Review, and the dinner counts once, as the Quick Add.
	await expect(card.filter({ hasText: /nopa/i })).toHaveCount(0);
	// The Review tab says how many still wait.
	await expect(
		page.getByRole("navigation", { name: "Review pages" }).getByRole("link", { name: /^Review/ }),
	).toContainText("1");

	// Target's bank copy hasn't come in yet: its Match section says it's waiting for it.
	await page.goto(new URL("/transactions", page.url()).href);
	await expect(page.getByLabel("Bucket")).toBeEnabled();
	await page.getByRole("button", { name: /^Target, \$45, Groceries/ }).click();
	await expect(editSheet(page).getByRole("region", { name: "Waiting for bank" })).toContainText(
		"When the bank's copy comes in",
	);
	await page.context().close();
});
