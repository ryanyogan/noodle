import { setupClerkTestingToken } from "@clerk/testing/playwright";
import {
	type Browser,
	type BrowserContextOptions,
	expect,
	type Page,
	test,
} from "@playwright/test";
import { createTestParent, newTestEmail, removeTestUserByEmail } from "./parents";
import { createHousehold, enterJoinedHousehold, setUpLater, signedInPage } from "./session";

async function invite(page: Page, email: string) {
	await page.getByLabel("Their email").fill(email);
	await page.getByRole("button", { name: /^Invite/ }).click();
}

/** Invites `email` from Household and copies the invite link with its Copy link button. */
async function inviteAndCopyLink(page: Page, email: string) {
	await invite(page, email);
	await expect(page.getByText(`Invited ${email}`)).toBeVisible();
	await expect(page.getByText("Send them this link. It works for 7 days.")).toBeVisible();
	await page.getByRole("button", { name: "Copy link" }).click();
	await expect(page.getByText("Invite link copied")).toBeVisible();
	const link = await page.evaluate(() => navigator.clipboard.readText());
	expect(link).toMatch(/\/invite\/[\w-]{43}$/);
	return new URL(link).pathname;
}

/** A browser that isn't signed in, with Clerk's testing token so its pages load in tests. */
async function signedOutPage(browser: Browser, options: BrowserContextOptions = {}) {
	const page = await (await browser.newContext(options)).newPage();
	await setupClerkTestingToken({ page });
	return page;
}

const clipboard = { permissions: ["clipboard-read", "clipboard-write"] };
const phone = { viewport: { width: 393, height: 852 } };

/** With SHOTS set to a folder, saves a full-page screenshot there to look at by hand. */
async function shot(page: Page, name: string) {
	if (process.env.SHOTS)
		await page.screenshot({ path: `${process.env.SHOTS}/${name}.png`, fullPage: true });
}

test("a Parent sends an invite link, and the other Parent signs up from it and joins", async ({
	browser,
}) => {
	test.slow();
	const first = await createTestParent();
	const secondEmail = newTestEmail();
	try {
		const firstPage = await signedInPage(browser, first.email, clipboard);
		await createHousehold(firstPage, "The Invites", "Alex");

		await firstPage.getByRole("link", { name: "Household" }).click();
		// A Parent can't invite themselves.
		await invite(firstPage, first.email.toUpperCase());
		await expect(firstPage.getByRole("alert")).toContainText("your own email");

		const link = await inviteAndCopyLink(firstPage, secondEmail);

		// Signed out, the link opens sign-up with their email filled in.
		const secondPage = await signedOutPage(browser, phone);
		await secondPage.goto(link);
		await expect(secondPage).toHaveURL(/\/sign-up\?invite=/);
		await expect(secondPage.getByText("Join The Invites on Noodle")).toBeVisible();
		const email = secondPage.locator("input[name=emailAddress]");
		await expect(email).toHaveValue(secondEmail);
		const password = secondPage.locator("input[name=password]");
		if (await password.isVisible()) await password.fill(`Noodle-${Date.now()}-pw!`);
		// Typing before Clerk has sent the code is refused, so wait for it to be sent.
		const sent = secondPage.waitForResponse(
			(r) => r.url().includes("prepare_verification") && r.ok(),
		);
		await secondPage.locator(".cl-formButtonPrimary").click();
		await sent;
		// Clerk's test addresses take the code 424242.
		const code = secondPage.getByRole("textbox", { name: "Enter verification code" });
		await code.click();
		await secondPage.keyboard.type("424242", { delay: 50 });

		// Signed up, they come back to the link to confirm.
		await expect(secondPage).toHaveURL(new RegExp(`${link}$`), { timeout: 20_000 });
		await secondPage.getByLabel("Your name").fill("Sam");
		await shot(secondPage, "accept-393");
		// The rest checks the Household on a laptop, where its name is in the sidebar.
		await secondPage.setViewportSize({ width: 1280, height: 800 });
		await secondPage.getByRole("button", { name: "Join The Invites" }).click();
		await enterJoinedHousehold(secondPage);

		// Both Parents now share one Household.
		await expect(secondPage).toHaveURL(/\/month\/\d{4}-\d{2}$/);
		await expect(secondPage.locator("[data-slot=page-header]:visible")).toContainText("This Month");
		await expect(secondPage.getByText("The Invites")).toBeVisible();

		await secondPage.getByRole("link", { name: "Household" }).click();
		await expect(secondPage.getByRole("listitem").filter({ hasText: "Alex" })).toBeVisible();
		await expect(secondPage.getByRole("listitem").filter({ hasText: "Sam" })).toBeVisible();
		// Two Parents is the limit, so there is nobody left to invite.
		await expect(secondPage.getByLabel("Their email")).toHaveCount(0);
		await expect(secondPage.getByRole("heading", { name: "Invite the other Parent" })).toHaveCount(
			0,
		);

		// The link works once; a made-up one never does.
		const later = await signedOutPage(browser);
		await later.goto(link);
		await expect(later.getByRole("heading", { name: "This invite has been used" })).toBeVisible();
		await later.goto(`/invite/${"x".repeat(43)}`);
		await expect(
			later.getByRole("heading", { name: "This invite link doesn’t work" }),
		).toBeVisible();
	} finally {
		await Promise.all([first.remove(), removeTestUserByEmail(secondEmail)]);
	}
});

test("someone signed in with another email is asked before joining from a link", async ({
	browser,
}) => {
	const inviter = await createTestParent();
	const other = await createTestParent();
	const invitedEmail = newTestEmail();
	try {
		const inviterPage = await signedInPage(browser, inviter.email, clipboard);
		await createHousehold(inviterPage, "The Lookalikes", "Alex");
		await inviterPage.getByRole("link", { name: "Household" }).click();
		const link = await inviteAndCopyLink(inviterPage, invitedEmail);

		const page = await signedInPage(browser, other.email, phone);
		await page.goto(link);
		await expect(page.getByRole("heading", { name: "Join The Lookalikes" })).toBeVisible();
		await expect(page.getByText(`This invite was for ${invitedEmail}. Join anyway?`)).toBeVisible();
		await page.getByLabel("Your name").fill("Jo");
		await expect(page.getByRole("button", { name: "Join anyway" })).toBeEnabled();
		expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
			393,
		);
		await shot(page, "wrong-email-393");
		await page.getByRole("button", { name: "Join anyway" }).click();
		await enterJoinedHousehold(page);
		await expect(page.getByText("The Lookalikes")).toBeVisible();
	} finally {
		await Promise.all([inviter.remove(), other.remove()]);
	}
});

test("a replaced invite can't be used, so a full Household never gets a third Parent", async ({
	browser,
}) => {
	test.slow();
	const first = await createTestParent();
	const replaced = await createTestParent();
	const second = await createTestParent();
	try {
		const firstPage = await signedInPage(browser, first.email);
		await createHousehold(firstPage, "The Replacements", "Alex");
		await firstPage.getByRole("link", { name: "Household" }).click();
		await invite(firstPage, replaced.email);
		await expect(firstPage.getByText(`Invited ${replaced.email}`)).toBeVisible();

		// The first invitee opens the invite, but it is replaced before they accept.
		const replacedPage = await signedInPage(browser, replaced.email);
		await replacedPage.goto("/welcome");
		await expect(replacedPage.getByRole("button", { name: "Join The Replacements" })).toBeVisible();

		await invite(firstPage, second.email);
		await expect(firstPage.getByText(`Invited ${second.email}`)).toBeVisible();
		const secondPage = await signedInPage(browser, second.email);
		await secondPage.goto("/welcome");
		await secondPage.getByLabel("Your name").fill("Sam");
		await secondPage.getByRole("button", { name: "Join The Replacements" }).click();
		await enterJoinedHousehold(secondPage);
		await expect(secondPage).toHaveURL(/\/month\//);

		await replacedPage.getByLabel("Your name").fill("Jo");
		await replacedPage.getByRole("button", { name: "Join The Replacements" }).click();
		await expect(replacedPage.getByRole("alert")).toContainText("can no longer be used");

		await firstPage.reload();
		await expect(firstPage.getByRole("main").getByRole("listitem")).toHaveCount(2);
		await expect(
			firstPage.getByRole("main").getByRole("listitem").filter({ hasText: "Jo" }),
		).toHaveCount(0);
	} finally {
		await Promise.all([first.remove(), replaced.remove(), second.remove()]);
	}
});

test("someone whose email wasn't invited is only offered to create a Household", async ({
	browser,
}) => {
	const inviter = await createTestParent();
	const invitee = await createTestParent();
	const outsider = await createTestParent();
	try {
		const inviterPage = await signedInPage(browser, inviter.email);
		await createHousehold(inviterPage, "The Closed Doors", "Alex");
		await inviterPage.getByRole("link", { name: "Household" }).click();
		await invite(inviterPage, invitee.email);
		await expect(inviterPage.getByText(`Invited ${invitee.email}`)).toBeVisible();

		const page = await signedInPage(browser, outsider.email);
		await page.goto("/welcome");
		await expect(page.getByRole("button", { name: "Create Household" })).toBeVisible();
		await expect(page.getByRole("button", { name: /^Join / })).toHaveCount(0);
	} finally {
		await Promise.all([inviter.remove(), invitee.remove(), outsider.remove()]);
	}
});

test("someone invited by mistake can start their own Household instead", async ({ browser }) => {
	const inviter = await createTestParent();
	const invitee = await createTestParent();
	try {
		const inviterPage = await signedInPage(browser, inviter.email);
		await createHousehold(inviterPage, "The Mix-Ups", "Alex");
		await inviterPage.getByRole("link", { name: "Household" }).click();
		await invite(inviterPage, invitee.email);
		await expect(inviterPage.getByText(`Invited ${invitee.email}`)).toBeVisible();

		const page = await signedInPage(browser, invitee.email);
		await page.goto("/welcome");
		await page.getByRole("button", { name: "Start my own Household instead" }).click();
		await page.getByLabel("Household name").fill("The Originals");
		await page.getByLabel("Your name").fill("Jo");
		await page.getByRole("button", { name: "Create Household" }).click();
		await setUpLater(page);
		await expect(page.locator("[data-slot=page-header]:visible")).toContainText("This Month");
		await expect(page.getByText("The Originals")).toBeVisible();
	} finally {
		await Promise.all([inviter.remove(), invitee.remove()]);
	}
});
