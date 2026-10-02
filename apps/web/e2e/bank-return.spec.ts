import { expect, type Page, test } from "@playwright/test";
import { createTestParent } from "./parents";
import { clientRendered, createHousehold, savedBy, signedInPage } from "./session";

// Plaid Link's edges (#71), against the fake Plaid (AI_MODEL=stub) and its stand-in Link, which
// `noodle.fake-link` in sessionStorage steers: a bank that logs the Parent in on its own page and
// comes back by /bank/return, from Accounts and from the get-started wizard; Link closing with an
// error; a link token that expired; and the same bank linked twice.

let parent: Awaited<ReturnType<typeof createTestParent>>;

test.beforeEach(async () => {
	parent = await createTestParent();
});

test.afterEach(async () => {
	await parent?.remove();
});

const toast = (page: Page, text: string) => page.getByRole("status").filter({ hasText: text });
const bankConnections = (page: Page) => page.getByRole("region", { name: "Bank Connections" });
const chooseSheet = (page: Page) =>
	page.getByRole("dialog", { name: "Which of these do you have already?" });
const fakeLink = (page: Page, act: string | null) =>
	page.evaluate((value) => {
		if (value) window.sessionStorage.setItem("noodle.fake-link", JSON.stringify(value));
		else window.sessionStorage.removeItem("noodle.fake-link");
	}, act);
/** The bank sending the Parent back: a page load of /bank/return with its state. */
const bankReturn = (page: Page) =>
	page.waitForRequest((request) => /\/bank\/return\?oauth_state_id=/.test(request.url()));

async function toAccounts(page: Page) {
	await createHousehold(page, "The Rinks", "Alex");
	await page.getByRole("link", { name: "Accounts", exact: true }).click();
	await expect(page.getByRole("heading", { level: 1 })).toHaveText("Accounts");
}

test("a bank that logs in on its own page comes back to Accounts", async ({ browser }) => {
	const page = await signedInPage(browser, parent.email);
	await toAccounts(page);
	await fakeLink(page, "oauth");
	const returned = bankReturn(page);
	await page.getByRole("button", { name: "Connect a bank" }).click();
	await returned;

	// Back where it started, with Choose Accounts open as after any Link.
	await expect(page).toHaveURL(/\/accounts$/);
	await chooseSheet(page).getByRole("button", { name: "Start bringing them in" }).click();
	await expect(toast(page, "Bringing in 4 Accounts from First Platypus Bank.")).toBeVisible();
	await expect(bankConnections(page).getByRole("listitem")).toContainText("First Platypus Bank");
});

test("it comes back to the get-started wizard, in a browser that kept nothing", async ({
	browser,
}) => {
	test.slow();
	const page = await signedInPage(browser, parent.email);
	await page.goto("/welcome");
	await page.getByLabel("Household name").fill("The Rinks");
	await page.getByLabel("Your name").fill("Alex");
	await page.getByRole("button", { name: "Create Household" }).click();
	await expect(page).toHaveURL(/\/setup$/);
	await page.getByRole("radio", { name: /Connect a bank/ }).check();
	const saved = savedBy(page, "saveSetup");
	await page.getByRole("button", { name: "Continue" }).click();
	await saved;
	await expect(page.getByText("Step 2 of 7")).toBeVisible();

	// The tab's own note of the Link is dropped, so the server's copy for the Parent is used.
	await fakeLink(page, "oauth-lost");
	const returned = bankReturn(page);
	await page.getByRole("button", { name: "Connect your bank" }).click();
	await returned;

	await expect(page).toHaveURL(/\/setup$/);
	await chooseSheet(page).getByRole("button", { name: "Start bringing them in" }).click();
	await expect(
		page.locator("[data-slot=card]").filter({ hasText: "First Platypus Bank is connected" }),
	).toBeVisible();
	await expect(page.getByText("Step 2 of 7")).toBeVisible();
});

test("arriving at the return address with nothing to finish says how to start again", async ({
	browser,
}) => {
	const page = await signedInPage(browser, parent.email);
	await toAccounts(page);
	await page.goto("/bank/return");
	await page.getByRole("link", { name: "Start connecting again" }).click();
	await expect(page).toHaveURL(/\/accounts$/);
	// While Accounts loads, the page being left is still in the document: look at the one that shows.
	await expect(page.locator("[data-slot=page-header]:visible")).toContainText(
		"Accounts",
		clientRendered,
	);
});

test("Link closing with an error says so in plain words, and trying again works", async ({
	browser,
}) => {
	const page = await signedInPage(browser, parent.email);
	await toAccounts(page);
	await fakeLink(page, "error");
	await page.getByRole("button", { name: "Connect a bank" }).click();
	const alert = page.getByRole("alert").filter({ hasText: "First Platypus Bank" });
	await expect(alert).toContainText(
		"First Platypus Bank didn’t respond. Try again, or upload a statement instead.",
	);
	await expect(alert).not.toContainText(/INSTITUTION|Plaid/);

	await fakeLink(page, null);
	await alert.getByRole("button", { name: "Try again" }).click();
	await expect(chooseSheet(page)).toBeVisible();
	await expect(alert).toHaveCount(0);
});

test("an expired link token gets a new one, and Link reopens", async ({ browser }) => {
	const page = await signedInPage(browser, parent.email);
	await toAccounts(page);
	await fakeLink(page, "expired");
	await page.getByRole("button", { name: "Connect a bank" }).click();
	await expect(chooseSheet(page)).toBeVisible();
});

test("linking the same bank again offers to reconnect it instead", async ({ browser }) => {
	const page = await signedInPage(browser, parent.email);
	await toAccounts(page);
	await page.getByRole("button", { name: "Connect a bank" }).click();
	await chooseSheet(page).getByRole("button", { name: "Start bringing them in" }).click();
	await expect(toast(page, "Bringing in 4 Accounts from First Platypus Bank.")).toBeVisible();
	const connection = bankConnections(page).getByRole("listitem");
	await expect(connection).toContainText("4 Accounts · Up to date");

	await bankConnections(page).getByRole("button", { name: "Connect a bank" }).click();
	const offer = page.getByRole("dialog", {
		name: "You’ve already connected First Platypus Bank. Reconnect it instead?",
	});
	await offer.getByRole("button", { name: "Reconnect First Platypus Bank" }).click();
	await expect(toast(page, "Reconnected.")).toBeVisible();
	await expect(offer).toBeHidden();
	await expect(connection).toHaveCount(1);
});
