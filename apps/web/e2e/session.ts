import { clerk, setupClerkTestingToken } from "@clerk/testing/playwright";
import {
	type Browser,
	type BrowserContextOptions,
	expect,
	type Locator,
	type Page,
} from "@playwright/test";

/**
 * The budget for the first expect after a full page load (goto, reload) of a route that renders
 * only in the browser (`ssr: "data-only"`: Reports and Explore). Until the dev server has served
 * the page's whole module graph (Recharts included) it is only a skeleton: about 3s on a laptop,
 * 4-6s or more on a 2-vCPU CI runner, past expect's 5s. Arriving by a link from the running app
 * needs none of it, so use it only where the full load is the point or there is no link.
 */
export const clientRendered = { timeout: 20_000 };

/** A fresh browser context signed in as `email`. */
export async function signedInPage(
	browser: Browser,
	email: string,
	options: BrowserContextOptions = {},
): Promise<Page> {
	const page = await (await browser.newContext(options)).newPage();
	await setupClerkTestingToken({ page });
	// `/` would redirect here anyway: sign-in is the one page that loads Clerk without signing in.
	await page.goto("/sign-in");
	await clerk.signIn({ page, emailAddress: email });
	return page;
}

/** From the get-started wizard a new Household lands on, leaves it for This Month. */
export async function setUpLater(page: Page) {
	await expect(page).toHaveURL(/\/setup$/);
	await page.getByRole("link", { name: "Set up later" }).click();
	await expect(page).toHaveURL(/\/month\//);
}

/** After joining a Household, leaves "Here's your Household" for This Month. */
export async function enterJoinedHousehold(page: Page) {
	await expect(page).toHaveURL(/\/joined$/);
	await page.getByRole("link", { name: "Go to This Month" }).click();
	await expect(page).toHaveURL(/\/month\//);
}

/** Creates a Household from /welcome, leaves the get-started wizard, and waits for This Month. */
export async function createHousehold(page: Page, householdName: string, parentName: string) {
	await page.goto("/welcome");
	await page.getByLabel("Household name").fill(householdName);
	await page.getByLabel("Your name").fill(parentName);
	await page.getByRole("button", { name: "Create Household" }).click();
	await setUpLater(page);
	// The URL changes before the page loads; clicking on before then can lose the click.
	await expect(page.locator("[data-slot=page-header]:visible")).toContainText("This Month");
}

/** True for calls to the named server function (its id is base64url JSON naming the export). */
export const serverFn = (name: string) => (url: URL) => {
	const id = url.pathname.split("/_serverFn/")[1];
	return !!id && Buffer.from(id, "base64url").toString().includes(`"${name}_`);
};

/** Waits for the next response from the named server function. */
export const savedBy = (page: Page, name: string) =>
	page.waitForResponse((response) => serverFn(name)(new URL(response.url())));

/** Switches between a month's This Month and its Plan, from either one's overview. */
export async function switchTo(page: Page, view: "Month" | "Plan") {
	await page
		.getByRole("navigation", { name: "Month and Plan" })
		.getByRole("link", { name: view })
		.click();
	// While the other one loads, React keeps the page being left in the document, hidden, beside the
	// pending header: look at the one that shows.
	await expect(page.locator("[data-slot=page-header]:visible")).toContainText(
		view === "Month" ? "This Month" : "Plan",
	);
}

/**
 * Creates a Household and plans this month from setting up the Plan: take-home pay and Buckets
 * with allowances ("1,200"), in order. Ends on This Month.
 */
export async function createPlannedHousehold(
	page: Page,
	{ baseline, buckets }: { baseline: string; buckets: [name: string, allowance: string][] },
) {
	await createHousehold(page, "The Rinks", "Alex");
	await page.getByRole("link", { name: "Set up the Plan" }).click();
	await page.getByRole("textbox", { name: "Take-home pay" }).fill(baseline);
	const takeHomePaySaved = savedBy(page, "setTakeHomePay");
	await page.getByRole("button", { name: "Set take-home pay" }).click();
	await takeHomePaySaved;
	await page.getByRole("link", { name: "Add Buckets" }).click();
	await expect(page.locator("nav[aria-label='Plan pages'] [aria-current=page]")).toHaveText(
		"Buckets",
	);
	await addBucketsInSheet(page, buckets);
	await page
		.getByRole("navigation", { name: "Plan pages" })
		.getByRole("link", { name: "Overview" })
		.click();
	await switchTo(page, "Month");
}

/**
 * Adds `buckets` (name, monthly amount) to the Plan from its Buckets page, through the Add Buckets
 * sheet: a starter row when one has the name, otherwise "Add your own". Only these are added.
 */
export async function addBucketsInSheet(page: Page, buckets: [name: string, allowance: string][]) {
	const open = page.getByRole("button", { name: "Add Buckets", exact: true });
	await expect(open).toBeEnabled();
	await page.waitForLoadState("networkidle");
	await open.click();
	const sheet = page.getByRole("dialog", { name: "Add Buckets" });
	await expect(sheet).toBeVisible();
	// Start from nothing ticked: the sheet ticks suggestions and the Parent's Personal Allowance.
	for (const box of await sheet.getByRole("checkbox", { checked: true }).all()) {
		await box.setChecked(false);
	}
	for (const [name, allowance] of buckets) {
		if ((await sheet.getByRole("checkbox", { name, exact: true }).count()) === 0) {
			await sheet.getByRole("button", { name: "Add your own" }).click();
			await sheet.getByRole("textbox", { name: "Name of your own Bucket" }).last().fill(name);
		}
		const amount = sheet.getByRole("textbox", { name: `${name} amount`, exact: true });
		const tick = sheet.getByRole("checkbox", { name: new RegExp(`^(Add )?${name}$`) });
		// Typing ticks the row, but when the sheet already suggests this very amount `fill` changes
		// nothing (no input event), so tick it the way a Parent who keeps the suggestion would.
		await amount.fill(allowance);
		await tick.setChecked(true);
		await expect(amount).toHaveValue(allowance);
	}
	await expect(sheet.getByRole("button", { name: /^Add \d+ Buckets?$/ })).toBeVisible();
	const saved = savedBy(page, "addBuckets");
	await sheet.getByRole("button", { name: /^Add \d+ Buckets?$/ }).click();
	await expect(sheet).toBeHidden();
	for (const [name] of buckets) {
		await expect(page.getByRole("button", { name: `Edit ${name}`, exact: true })).toBeVisible();
	}
	await saved;
}

/**
 * Picks `option` from a shadcn Select or Combobox (a combobox that opens a listbox) named
 * `label`.
 */
export async function choose(scope: Page | Locator, label: string, option: string) {
	const page = "page" in scope ? scope.page() : scope;
	await scope.getByRole("combobox", { name: label, exact: true }).click();
	await page.getByRole("listbox").getByRole("option", { name: option, exact: true }).click();
	await expect(page.getByRole("listbox")).toBeHidden();
}

/**
 * Picks a day (yyyy-mm-dd) in a DatePicker: opens it by its label, sets the calendar's year and
 * month dropdowns, then clicks the day. No typing, as a person would.
 */
export async function pickDate(scope: Page | Locator, label: string, iso: string) {
	const page = "page" in scope ? scope.page() : scope;
	const [year, month] = iso.split("-").map(Number);
	await scope.getByLabel(label, { exact: true }).click();
	const calendar = page.locator('[data-slot="date-picker-content"]');
	await calendar.getByLabel("Choose the Year").selectOption(String(year));
	await calendar.getByLabel("Choose the Month").selectOption(String((month ?? 1) - 1));
	await calendar.locator(`button[data-day="${iso}"]`).click();
	await expect(calendar).toBeHidden();
}

const accountKindLabels: Record<string, string> = {
	checking: "Checking",
	savings: "Savings",
	"credit-card": "Credit card",
	loan: "Loan",
};

/** An Account kind's name in the Kind select ("credit-card" → "Credit card"). */
export const accountKindLabel = (kind: string) => accountKindLabels[kind] ?? kind;

/** Uploads a card statement to the Visa Account, adding the Account first if it's new. */
/**
 * Opens Review once the background run has filed or guessed the lines just brought in: filing
 * happens a moment after an import (ADR-0027), longer on CI, so it reloads until the stack says
 * `stackText` ("1 of 3").
 */
export async function waitForReview(page: Page, reviewUrl: string, stackText: string) {
	await expect(async () => {
		await page.goto(reviewUrl);
		await expect(page.getByTestId("review-stack")).toContainText(stackText, {
			timeout: 2_000,
		});
	}).toPass({ timeout: 20_000 });
}

export async function uploadStatement(
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
	await expect(page.locator("[data-slot=detail-title]:visible")).toContainText("Visa");

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
