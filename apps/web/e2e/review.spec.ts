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
async function uploadStatement(page: Page, lines: [string, string][], addAccount = false) {
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
		...lines.map(([what, amount]) => `${today},${what},${amount},`),
	].join("\n");
	await page.getByRole("button", { name: "Upload statement" }).click();
	const sheet = page.getByRole("dialog", { name: "Upload a statement" });
	await sheet
		.getByLabel("Statement file")
		.setInputFiles({ name: "visa.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
	await sheet.getByRole("button", { name: `Import ${lines.length} line` }).click();
	await expect(sheet).toBeHidden();
}

/** Swipes the top card sideways by `dx` pixels with a finger, as on a phone. */
async function touchSwipe(page: Page, dx: number) {
	const box = await card(page).boundingBox();
	if (!box) throw new Error("No card to swipe");
	const y = box.y + box.height / 2;
	const x = box.x + box.width / 2;
	const cdp = await page.context().newCDPSession(page);
	await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
	for (let step = 1; step <= 12; step++) {
		await cdp.send("Input.dispatchTouchEvent", {
			type: "touchMove",
			touchPoints: [{ x: x + (dx * step) / 12, y: y + step / 3 }],
		});
	}
	await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

/** Drags the top card sideways by `dx` pixels, as a swipe. */
async function swipe(page: Page, dx: number) {
	const box = await card(page).boundingBox();
	if (!box) throw new Error("No card to swipe");
	const x = box.x + box.width / 2;
	const y = box.y + box.height / 2;
	await page.mouse.move(x, y);
	await page.mouse.down();
	await page.mouse.move(x + dx, y + 4, { steps: 12 });
	await page.mouse.up();
}

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
	await expect(card(page)).toContainText("No guess");

	// Swiped left (once it can be): the editor, where the Parent picks the Bucket.
	await expect(page.getByRole("button", { name: "Change" })).toBeEnabled();
	await swipe(page, -220);
	await choose(editSheet(page), "Assigned to", "Fun");
	await editSheet(page).getByRole("button", { name: "Save" }).click();
	await expect(editSheet(page)).toBeHidden();
	await expect(
		page.getByRole("status").getByText("$19.99 (ACME WIDGETS LLC) filed in Fun"),
	).toBeVisible();
	await expect(page.getByText("All caught up")).toBeVisible();

	// And made a Rule of it.
	const offer = page.getByRole("region", { name: "Make a Rule" });
	await expect(offer).toContainText(/Always file “acme widgets.*” in Fun\?/);
	await offer.getByRole("button", { name: "Always file" }).click();
	await expect(offer).toBeHidden();
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

	// → confirms the guess; Undo puts the card back.
	await page.keyboard.press("ArrowRight");
	await expect(page.getByText("All caught up")).toBeVisible();
	await page.getByRole("status").getByRole("button", { name: "Undo" }).click();
	await expect(card(page).getByRole("heading", { name: "CORNER GAS MART" })).toBeVisible();

	// On a phone, a finger swiping right confirms it.
	const phone = await signedInPage(browser, parent.email, {
		viewport: { width: 393, height: 852 },
		isMobile: true,
		hasTouch: true,
	});
	await phone.goto(new URL("/review", thisMonth).href);
	await expect(card(phone).getByRole("heading", { name: "CORNER GAS MART" })).toBeVisible();
	await expect(phone.getByRole("button", { name: "Confirm" })).toBeEnabled();
	await touchSwipe(phone, 250);
	await expect(phone.getByText("All caught up")).toBeVisible();
	await phone
		.getByRole("region", { name: "Make a Rule" })
		.getByRole("button", { name: "Not now" })
		.click();

	// Filed for the other screen too.
	await page.reload();
	await expect(page.getByText("All caught up")).toBeVisible();

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
