import { clerk, setupClerkTestingToken } from "@clerk/testing/playwright";
import { type Browser, type BrowserContextOptions, expect, type Page } from "@playwright/test";

/** A fresh browser context signed in as `email`. */
export async function signedInPage(
	browser: Browser,
	email: string,
	options: BrowserContextOptions = {},
): Promise<Page> {
	const page = await (await browser.newContext(options)).newPage();
	await setupClerkTestingToken({ page });
	await page.goto("/");
	await clerk.signIn({ page, emailAddress: email });
	return page;
}

/** Creates a Household from /welcome and waits for This Month. */
export async function createHousehold(page: Page, householdName: string, parentName: string) {
	await page.goto("/welcome");
	await page.getByLabel("Household name").fill(householdName);
	await page.getByLabel("Your name").fill(parentName);
	await page.getByRole("button", { name: "Create Household" }).click();
	await expect(page).toHaveURL(/\/month\//);
	// The URL changes before the page loads; clicking on before then can lose the click.
	await expect(page.getByRole("heading", { level: 1 })).toContainText("This Month");
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
	await expect(page.getByRole("heading", { level: 1 })).toContainText(
		view === "Month" ? "This Month" : "Plan",
	);
}

/**
 * Creates a Household and plans this month from setting up the Plan: a Baseline and Buckets
 * with allowances ("1,200"), in order. Ends on This Month.
 */
export async function createPlannedHousehold(
	page: Page,
	{ baseline, buckets }: { baseline: string; buckets: [name: string, allowance: string][] },
) {
	await createHousehold(page, "The Rinks", "Alex");
	await page.getByRole("link", { name: "Set up the Plan" }).click();
	await page.getByRole("textbox", { name: "Baseline" }).fill(baseline);
	const baselineSaved = savedBy(page, "setBaseline");
	await page.getByRole("button", { name: "Set Baseline" }).click();
	await baselineSaved;
	await page.getByRole("link", { name: "Add Buckets" }).click();
	await expect(page.getByRole("heading", { level: 1 })).toContainText("Buckets");
	for (const [name, allowance] of buckets) {
		await page.getByLabel("New Bucket").fill(name);
		await page.getByLabel("Monthly allowance").fill(allowance);
		// Let each save land before leaving the Plan.
		const saved = savedBy(page, "addBucket");
		await page.getByRole("button", { name: "Add Bucket" }).click();
		await expect(page.getByRole("button", { name: `Edit ${name}` })).toBeVisible();
		await saved;
	}
	await page.getByRole("link", { name: "Back to Plan" }).click();
	await switchTo(page, "Month");
}
