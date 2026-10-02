import { expect, type Page, test } from "@playwright/test";
import { createTestParent } from "./parents";
import { savedBy, signedInPage } from "./session";

// The get-started wizard's statement and bank paths (#53), with the fakes (AI_MODEL=stub): Hello
// starts the Setup Workflow, the header reports its jobs, and once the plan draft lands the steps
// fill in, marked "Suggested from your spending", without replacing what a Parent typed.

let parent: Awaited<ReturnType<typeof createTestParent>>;

test.beforeEach(async () => {
	parent = await createTestParent();
});

test.afterEach(async () => {
	await parent?.remove();
});

const PAY = "What lands in your account in a normal month, after tax?";
const SUGGESTED = "Suggested from your spending";
const reading = (page: Page) => page.getByText(/Reading your spending… \d of \d done/).first();
const spendingIn = (page: Page) =>
	page.getByText("Your spending is in. We’ll use it to suggest amounts.").first();

/** About three months of a checking Account's history, ending today (as onboarding-draft's). */
function history(): string {
	const day = (daysAgo: number) => {
		const date = new Date();
		date.setDate(date.getDate() - daysAgo);
		return date.toLocaleDateString("en-US");
	};
	const lines: string[] = [];
	const debit = (daysAgo: number, what: string, amount: string) =>
		lines.push(`${day(daysAgo)},${what},${amount},`);
	for (let ago = 84; ago >= 0; ago -= 14) lines.push(`${day(ago)},ACME CORP PAYROLL PPD,,2500.00`);
	for (const ago of [80, 50, 20]) {
		debit(ago, "ROCKET MORTGAGE PMT", "2100.00");
		debit(ago - 2, "NETFLIX.COM 866-579-7172 CA", "15.49");
	}
	for (let ago = 83; ago >= 0; ago -= 7) debit(ago, "COSTCO WHSE #0123", "180.00");
	for (let ago = 81; ago >= 0; ago -= 10) debit(ago, "CHIPOTLE 1234", `${20 + (ago % 7)}.50`);
	for (const ago of [79, 61, 44, 30, 9]) debit(ago, "SHELL OIL 5741", "41.20");
	return ["Transaction Date,Description,Debit,Credit", ...lines].join("\n");
}

/** Creates a Household, chooses how spending comes in on Hello, and lands on Take-home pay. */
async function begin(browser: Parameters<typeof signedInPage>[0], path: RegExp) {
	const page = await signedInPage(browser, parent.email);
	await page.goto("/welcome");
	await page.getByLabel("Household name").fill("The Importers");
	await page.getByLabel("Your name").fill("Alex");
	await page.getByRole("button", { name: "Create Household" }).click();
	await expect(page).toHaveURL(/\/setup$/);
	await page.getByRole("radio", { name: path }).check();
	const saved = savedBy(page, "saveSetup");
	await page.getByRole("button", { name: "Continue" }).click();
	await saved;
	await expect(page.getByText("Step 2 of 7")).toBeVisible();
	// The Setup Workflow is going, and the header says so.
	await expect(reading(page)).toBeVisible();
	return page;
}

/** In the wizard itself: names the Account the statement is from, and uploads its file. */
async function uploadHere(page: Page) {
	await page.getByLabel("Which account is this from?").fill("Checking");
	await page.getByRole("button", { name: "Choose the statement" }).click();
	await page.getByLabel("Statement file").setInputFiles({
		name: "checking.csv",
		mimeType: "text/csv",
		buffer: Buffer.from(history()),
	});
	await page.getByRole("button", { name: /^Import \d+ lines$/ }).click();
	await expect(page.getByText("checking.csv is in for Checking")).toBeVisible();
	// It was all done here: no other tab, and still on the step.
	expect(page.context().pages()).toHaveLength(1);
	await expect(page.getByText("Step 2 of 7")).toBeVisible();
}

const next = async (page: Page, step: number) => {
	const saved = savedBy(page, "saveSetup");
	await page.getByRole("button", { name: "Continue", exact: true }).click();
	await saved;
	await expect(page.getByText(`Step ${step} of 7`)).toBeVisible();
};

test("statement: the Setup Workflow reads it and steps 2 to 4 fill in from the plan draft", async ({
	browser,
}) => {
	test.slow();
	const page = await begin(browser, /Upload a statement/);
	const pay = page.getByRole("textbox", { name: PAY });
	await expect(pay).toHaveValue("");
	await expect(page.getByRole("link", { name: /Accounts/ })).toHaveCount(0);
	await uploadHere(page);

	// The wizard stayed put; the header follows the jobs, and the guess fills the empty field.
	await expect(spendingIn(page)).toBeVisible({ timeout: 60_000 });
	await expect(pay).not.toHaveValue("");
	await expect(page.getByText(`${SUGGESTED}. Change it if it’s off.`)).toBeVisible();
	await next(page, 3);

	// Step 3: the bills found in the history, ticked and marked.
	await expect(page.getByText(SUGGESTED).first()).toBeVisible();
	await expect(page.getByRole("checkbox", { checked: true }).first()).toBeVisible();
	await next(page, 4);

	// Step 4: Buckets with amounts from the spending.
	await expect(page.getByText(SUGGESTED).first()).toBeVisible();
	await expect(page.getByRole("textbox", { name: "Groceries amount" })).not.toHaveValue("");
	await next(page, 5);

	// It's on the Plan.
	await page.getByRole("link", { name: "Set up later" }).click();
	await expect(page).toHaveURL(/\/month\//);
	await expect(page.getByRole("link", { name: "Continue setup" })).toBeVisible();
});

test("statement: take-home pay typed before the suggestion arrives is kept", async ({
	browser,
}) => {
	test.slow();
	const page = await begin(browser, /Upload a statement/);
	const pay = page.getByRole("textbox", { name: PAY });
	await pay.fill("4,321");
	await uploadHere(page);
	await expect(spendingIn(page)).toBeVisible({ timeout: 60_000 });
	// Give a late fill the chance to happen before saying it didn't.
	await page.waitForTimeout(1500);
	await expect(pay).toHaveValue(/^4,?321(\.00)?$/);
	await expect(page.getByText(`${SUGGESTED}. Change it if it’s off.`)).toHaveCount(0);
	const set = savedBy(page, "setTakeHomePay");
	await next(page, 3);
	await set;
	await page.goto("/plan");
	await expect(page.getByText(/\$4,321/).first()).toBeVisible();
});

test("bank: connecting the fake bank runs the Setup Workflow to the end", async ({ browser }) => {
	test.slow();
	const page = await begin(browser, /Connect a bank/);
	const pay = page.getByRole("textbox", { name: PAY });
	await pay.fill("5,000");

	// Plaid Link (its stand-in here) and Choose Accounts open in the wizard itself.
	await page.getByRole("button", { name: "Connect your bank" }).click();
	await page
		.getByRole("dialog", { name: "Which of these do you have already?" })
		.getByRole("button", { name: "Start bringing them in" })
		.click();
	// The card names the bank and says how the reading stands (it may be done already).
	const card = page
		.locator("[data-slot=card]")
		.filter({ hasText: "First Platypus Bank is connected" });
	await expect(card).toBeVisible();
	await expect(card.getByRole("status")).toHaveText(
		/(Reading|Sorting) your spending…|Your spending is in/,
	);
	expect(page.context().pages()).toHaveLength(1);
	await expect(page.getByText("Step 2 of 7")).toBeVisible();

	await expect(spendingIn(page)).toBeVisible({ timeout: 60_000 });
	await expect(pay).toHaveValue(/^5,?000(\.00)?$/);
	await next(page, 3);
	await next(page, 4);
	// Left to plan counts down from the pay the Parent typed, whatever the bank suggested.
	await expect(page.getByText(/Left to plan:/)).toContainText("$");
});
