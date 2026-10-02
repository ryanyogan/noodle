import { expect, type Page, test } from "@playwright/test";
import { createTestParent } from "./parents";
import { accountKindLabel, choose, createPlannedHousehold, signedInPage } from "./session";

// Categorization runs with its deterministic fake (AI_MODEL=stub, see vite.config.ts): it knows
// nothing about ACME, and guesses Gas, unsure, for a merchant with "gas" in its name.

let parent: Awaited<ReturnType<typeof createTestParent>>;

test.beforeEach(async () => {
	parent = await createTestParent();
});

test.afterEach(async () => {
	await parent?.remove();
});

const card = (page: Page) => page.getByTestId("review-card");
const editSheet = (page: Page) => page.getByRole("dialog", { name: "Edit Transaction" });

/** Uploads a card statement to the Visa Account, adding the Account first if it's new. */
async function uploadStatement(
	page: Page,
	lines: [what: string, amount: string, date?: string][],
	addAccount = false,
) {
	await page.getByRole("link", { name: "Accounts", exact: true }).click();
	await expect(page.getByRole("heading", { level: 1 })).toHaveText("Accounts");
	if (addAccount) {
		await page.getByLabel("Name").fill("Visa");
		await choose(page, "Kind", accountKindLabel("credit-card"));
		await page.getByLabel("Owed now").fill("800");
		await page.getByRole("button", { name: "Add Account" }).click();
	}
	await page.getByRole("link", { name: /^Visa, / }).click();
	await expect(page.locator("[data-slot=page-header]")).toContainText("Visa");

	// Dated today, so the lines land in the month the Plan was made for.
	const today = await page.evaluate(() => new Date().toLocaleDateString("en-US"));
	const csv = [
		"Transaction Date,Description,Debit,Credit",
		...lines.map(([what, amount, date]) => `${date ?? today},${what},${amount},`),
	].join("\n");
	await page.getByRole("button", { name: "Upload statement" }).click();
	const sheet = page.getByRole("dialog", { name: "Upload a statement" });
	await sheet
		.getByLabel("Statement file")
		.setInputFiles({ name: "visa.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
	await sheet.getByRole("button", { name: `Import ${lines.length} line` }).click();
	await expect(sheet).toBeHidden();
}

const status = (page: Page, text: string | RegExp) =>
	page.getByRole("status").filter({ hasText: text });

test("a card changed in Review makes a Rule that files the merchant's next statement line", async ({
	browser,
}) => {
	test.slow();
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, {
		baseline: "5,000",
		buckets: [
			["Groceries", "1,200"],
			["Gas", "300"],
			["Fun", "150"],
		],
	});
	const thisMonth = page.url();
	await uploadStatement(page, [["ACME WIDGETS LLC", "19.99"]], true);

	// This Month says something waits; categorization had no guess for it.
	await page.goto(thisMonth);
	await page.getByRole("link", { name: "1 to review" }).click();
	await expect(page.locator("[data-slot=page-header]")).toContainText("Review");
	// Inside Transactions, as far as the sidebar goes.
	await expect(
		page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Transactions" }),
	).toHaveClass(/(^| )bg-card( |$)/);
	await expect(card(page).getByRole("heading", { name: "ACME WIDGETS LLC" })).toBeVisible();
	await expect(card(page)).toContainText("$19.99");
	await expect(card(page)).toContainText("Visa");
	await expect(card(page)).toContainText("No suggestion — pick where it goes");
	await expect(card(page)).toContainText("New merchant");
	await expect(card(page).getByRole("button", { name: "Confirm" })).toHaveCount(0);

	// Picked from the card's own month's Buckets, it's filed there.
	await choose(card(page), "Where ACME WIDGETS LLC goes", "Fun");
	await expect(status(page, "$19.99 (ACME WIDGETS LLC) filed in Fun")).toBeVisible();
	await expect(page.getByText("Nothing to review")).toBeVisible();

	// And made a Rule of it.
	const offer = status(page, /Always file “acme widgets.*” in Fun\?/);
	await offer.getByRole("button", { name: "Always file" }).click();
	await expect(page.getByText(/Rule saved/)).toBeVisible();

	// The next statement: ACME is filed by the Rule; the gas station waits, with a guess.
	await uploadStatement(page, [
		["ACME WIDGETS LLC #778", "25.00"],
		["CORNER GAS MART", "40.00"],
	]);
	await page.goto(thisMonth.replace(/\/month\/(\d{4}-\d{2}).*$/, "/transactions/$1"));
	await expect(page.getByLabel("Bucket")).toBeEnabled();
	const acme = page.getByRole("button", {
		name: "ACME WIDGETS LLC #778, $25, Fun (filed automatically), For Everyone, from Visa",
	});
	await expect(acme).toBeVisible();
	await acme.click();
	await expect(editSheet(page).getByTestId("auto-filed-hint")).toContainText(
		"Filed automatically by a Rule.",
	);
	await page.keyboard.press("Escape");

	await page.getByRole("link", { name: "Review, 1 to review" }).click();
	await expect(card(page).getByRole("heading", { name: "CORNER GAS MART" })).toBeVisible();
	await expect(card(page)).toContainText("Gas");
	await expect(card(page)).toContainText("50% sure");
	await expect(card(page)).toContainText("We weren’t sure");
	await expect(card(page)).toContainText("Suggested:");

	// → confirms the guess; Undo puts the card back.
	await page.keyboard.press("ArrowRight");
	await expect(page.getByText("Nothing to review")).toBeVisible();
	await status(page, "filed in Gas").getByRole("button", { name: "Undo" }).click();
	await expect(card(page).getByRole("heading", { name: "CORNER GAS MART" })).toBeVisible();

	// On a phone, a tap on Confirm files it.
	const phone = await signedInPage(browser, parent.email, {
		viewport: { width: 393, height: 852 },
		isMobile: true,
		hasTouch: true,
	});
	await phone.goto(new URL("/review", thisMonth).href);
	await expect(card(phone).getByRole("heading", { name: "CORNER GAS MART" })).toBeVisible();
	await card(phone).getByRole("button", { name: "Confirm" }).tap();
	await expect(phone.getByText("Nothing to review")).toBeVisible();

	// Filed for the other screen too.
	await page.reload();
	await expect(page.getByText("Nothing to review")).toBeVisible();

	// The Rule, which filed one line; deleted, it's gone.
	await page.getByRole("link", { name: "Rules" }).click();
	const rule = page.getByRole("button", {
		name: /^acme widgets.*, Fun, For Everyone, Filed 1 so far$/,
	});
	await expect(rule).toBeEnabled();
	await rule.click();
	const sheet = page.getByRole("dialog", { name: "Edit Rule" });
	await sheet.getByRole("button", { name: "Delete Rule" }).click();
	await page.getByRole("alertdialog").getByRole("button", { name: "Delete Rule" }).click();
	await expect(page.getByText("No Rules yet")).toBeVisible();

	// A Rule can be added directly, and an edited one saved and used at once.
	await page.getByRole("button", { name: "Add Rule" }).click();
	const add = page.getByRole("dialog", { name: "Add a Rule" });
	await add.getByRole("button", { name: "Add Rule and file what matches" }).click();
	await expect(add).toContainText("Type a word from the merchant’s name.");
	await add.getByLabel("Merchant").fill("Corner Gas");
	await choose(add, "Bucket", "Gas");
	await add.getByRole("button", { name: "Add Rule and file what matches" }).click();
	await expect(add).toBeHidden();
	await expect(page.getByText(/Rule saved: corner gas goes in Gas/i)).toBeVisible();
	await page.getByRole("button", { name: /^corner gas, Gas, / }).click();
	const edit = page.getByRole("dialog", { name: "Edit Rule" });
	await expect(
		edit.getByRole("button", { name: "File what’s still unassigned now" }),
	).toBeEnabled();
	await choose(edit, "Bucket", "Fun");
	await edit.getByRole("button", { name: "Save and file what’s still unassigned" }).click();
	await expect(edit).toBeHidden();
	await expect(page.getByText(/Nothing unassigned matches corner gas/i)).toBeVisible();
	await expect(page.getByRole("button", { name: /^corner gas, Fun, / })).toBeVisible();
});

test("Review confirms a merchant's cards, or all with a suggestion, with one Undo, and says when a month has no Plan", async ({
	browser,
}) => {
	test.slow();
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, {
		baseline: "5,000",
		buckets: [
			["Groceries", "1,200"],
			["Gas", "300"],
		],
	});
	const thisMonth = page.url();
	// Mid last month: before the Plan, which starts this month.
	const lastMonth = await page.evaluate(() => {
		const now = new Date();
		return new Date(now.getFullYear(), now.getMonth() - 1, 15).toLocaleDateString("en-US");
	});
	await uploadStatement(
		page,
		[
			["CORNER GAS MART", "40.00"],
			["CORNER GAS MART", "22.50"],
			["VALLEY GAS STOP", "30.00"],
			["ACME WIDGETS LLC", "19.99", lastMonth],
		],
		true,
	);
	await page.goto(new URL("/review", thisMonth).href);
	await expect(card(page)).toHaveCount(4);
	await expect(page.getByRole("button", { name: "What’s “Review”?" })).toBeVisible();

	// A card from a month with no Plan says so, with a way to set it up, never an empty list.
	const acme = card(page).filter({ hasText: "ACME WIDGETS LLC" });
	await expect(acme).toContainText(/has no Plan yet/);
	await expect(acme.getByRole("combobox")).toHaveCount(0);
	await expect(acme.getByRole("link", { name: /^Set up .*’s Plan$/ })).toHaveAttribute(
		"href",
		/\/plan\/\d{4}-\d{2}\/buckets$/,
	);

	// Both of one merchant's cards at once; one Undo puts both back.
	await page
		.getByRole("button", { name: /^Confirm all 2 from “corner gas mart/ })
		.first()
		.click();
	await expect(status(page, "Filed 2 where Noodle suggested")).toBeVisible();
	await expect(card(page)).toHaveCount(2);
	await status(page, "Filed 2 where Noodle suggested")
		.getByRole("button", { name: "Undo" })
		.click();
	await expect(card(page)).toHaveCount(4);

	// Everything with a suggestion; what has none stays.
	await page.getByRole("button", { name: "Confirm all 3 with a suggestion" }).click();
	await expect(status(page, "Filed 3 where Noodle suggested")).toBeVisible();
	await expect(card(page)).toHaveCount(1);
	await expect(page.getByLabel("1 to review")).toBeVisible();
	await page.reload();
	await expect(card(page)).toHaveCount(1);
	await expect(card(page)).toContainText("ACME WIDGETS LLC");
});
