import { expect, type Page, test } from "@playwright/test";
import { createTestParent } from "./parents";
import { createHousehold, signedInPage, switchTo } from "./session";

// The first Plan, drafted from a new Household's first statement. The draft's model runs with its
// deterministic fake (AI_MODEL=stub, see vite.config.ts): it knows Costco is groceries, Chipotle
// is eating out, Shell is gas, and Netflix's name; everything else keeps its plain name.

let parent: Awaited<ReturnType<typeof createTestParent>>;

test.beforeEach(async () => {
	parent = await createTestParent();
});

test.afterEach(async () => {
	await parent?.remove();
});

/** About three months of a checking Account's history, ending today. */
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
	for (const [ago, amount] of [
		[79, "41.20"],
		[61, "38.75"],
		[44, "52.10"],
		[30, "35.00"],
		[9, "47.65"],
	] as const) {
		debit(ago, "SHELL OIL 5741", amount);
	}
	return ["Transaction Date,Description,Debit,Credit", ...lines].join("\n");
}

/** Adds a checking Account on the Goals page and uploads its statement. */
async function uploadHistory(page: Page) {
	await page.getByRole("link", { name: "Goals", exact: true }).click();
	await expect(page.getByRole("heading", { level: 1 })).toHaveText("Goals");
	await page.getByLabel("Name").fill("Checking");
	await page.getByLabel("Kind").selectOption("checking");
	await page.getByLabel("Balance now").fill("3,000");
	await page.getByRole("button", { name: "Add Account" }).click();
	await page.getByRole("link", { name: /^Checking, / }).click();
	await expect(page.getByRole("heading", { level: 1 })).toContainText("Checking");
	const csv = history();
	await page.getByRole("button", { name: "Upload statement" }).click();
	const sheet = page.getByRole("dialog", { name: "Upload a statement" });
	await sheet
		.getByLabel("Statement file")
		.setInputFiles({ name: "checking.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
	await sheet.getByRole("button", { name: /^Import \d+ lines$/ }).click();
	await expect(sheet).toBeHidden();
}

test("a new Household's first Plan is drafted from its history, and a Parent decides each part", async ({
	browser,
}) => {
	const page = await signedInPage(browser, parent.email);
	await createHousehold(page, "The Rinks", "Alex");
	const thisMonth = page.url();

	// With nothing to draft from yet, setting up says where statements go.
	await switchTo(page, "Plan");
	const setUp = page.getByRole("region", { name: "Set up the Plan" });
	await expect(setUp).toContainText("Upload about three months of them");

	await uploadHistory(page);
	await page.goto(thisMonth);
	await switchTo(page, "Plan");

	// Drafted after the upload answered; the Plan shows it once it's ready.
	const draft = page.getByRole("region", { name: "Drafted from your history" });
	await expect(draft).toBeVisible({ timeout: 15_000 });
	const row = (name: string) => draft.getByRole("listitem", { name, exact: true });

	// Two paychecks a month, every two weeks.
	await expect(row("Baseline")).toContainText("$5,000");
	await expect(row("Baseline")).toContainText("every two weeks");
	await row("Baseline").getByRole("button", { name: "Add" }).click();
	await expect(row("Baseline")).toBeHidden();
	await expect(setUp).toContainText("$5,000 a month");

	// A Commitment changed before it's added, and one skipped.
	await expect(row("Netflix")).toContainText("$15.49");
	await row("Netflix").getByRole("button", { name: "Change" }).click();
	await row("Netflix").getByRole("textbox", { name: "Name" }).fill("Netflix Premium");
	await row("Netflix").getByRole("textbox", { name: "Amount" }).fill("22.99");
	await row("Netflix").getByRole("button", { name: "Add" }).click();
	await expect(row("Netflix")).toBeHidden();
	await expect(row("Rocket Mortgage Pmt")).toContainText("$2,100");
	await row("Rocket Mortgage Pmt").getByRole("button", { name: "Skip" }).click();
	await expect(row("Rocket Mortgage Pmt")).toBeHidden();

	// Buckets and their allowances from what was actually spent.
	await expect(row("Groceries")).toContainText("Costco");
	await expect(row("Eating out")).toBeVisible();
	await expect(row("Gas")).toBeVisible();
	await draft.getByRole("button", { name: "Add all Buckets" }).click();

	// Everything decided: the draft and setting up are done.
	await expect(draft).toBeHidden();
	await expect(setUp).toBeHidden();
	await page
		.getByRole("link", { name: /^Commitments/ })
		.first()
		.click();
	await expect(page.getByRole("link", { name: "Netflix Premium" })).toBeVisible();
	await expect(page.getByText("Rocket Mortgage")).toHaveCount(0);

	// Still so after a reload: nothing is drafted again.
	await page.reload();
	await expect(page.getByRole("link", { name: "Netflix Premium" })).toBeVisible();
	await page.goto(thisMonth);
	await switchTo(page, "Plan");
	await expect(page.getByRole("region", { name: "Drafted from your history" })).toHaveCount(0);
	await expect(page.getByRole("region", { name: "Set up the Plan" })).toHaveCount(0);
});
