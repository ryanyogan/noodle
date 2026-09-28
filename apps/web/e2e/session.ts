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
