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
