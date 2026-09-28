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
}

/** True for calls to the named server function (its id is base64url JSON naming the export). */
export const serverFn = (name: string) => (url: URL) => {
	const id = url.pathname.split("/_serverFn/")[1];
	return !!id && Buffer.from(id, "base64url").toString().includes(`"${name}_`);
};

/**
 * Creates a Household and plans this month from the Plan editor: a Baseline and Buckets with
 * allowances ("1,200"), in order. Ends on This Month.
 */
export async function createPlannedHousehold(
	page: Page,
	{ baseline, buckets }: { baseline: string; buckets: [name: string, allowance: string][] },
) {
	await createHousehold(page, "The Rinks", "Alex");
	await page.getByRole("link", { name: "Set up the Plan" }).click();
	const baselineInput = page.getByLabel("Baseline", { exact: true });
	await baselineInput.fill(baseline);
	await baselineInput.press("Enter");
	for (const [name, allowance] of buckets) {
		await page.getByLabel("New Bucket").fill(name);
		await page.getByLabel("Monthly allowance").fill(allowance);
		await page.getByRole("button", { name: "Add Bucket" }).click();
		await expect(page.getByLabel(`${name} allowance`)).toBeVisible();
	}
	// Let the Plan's saves land before leaving the editor.
	await expect(page.getByLabel(`${buckets.at(-1)?.[0]} allowance`)).toHaveValue(
		buckets.at(-1)?.[1] ?? "",
	);
	await page.getByRole("link", { name: "Back to This Month" }).click();
	await expect(page.getByRole("heading", { level: 1 })).toContainText("This Month");
}
