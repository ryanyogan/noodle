import { setupClerkTestingToken } from "@clerk/testing/playwright";
import {
	type Browser,
	type BrowserContextOptions,
	expect,
	type Page,
	test,
} from "@playwright/test";
import { createTestParent, newTestEmail, removeTestUserByEmail } from "./parents";
import {
	clientRendered,
	createHousehold,
	enterJoinedHousehold,
	setUpLater,
	signedInPage,
} from "./session";

async function invite(page: Page, email: string) {
	await page.getByLabel("Their email").fill(email);
	await page.getByRole("button", { name: /^Invite/ }).click();
}

/** Invites `email` from Household and copies the invite link with its Copy link button. */
async function inviteAndCopyLink(page: Page, email: string) {
	await invite(page, email);
	await expect(page.getByText(`Invited ${email}`)).toBeVisible();
	await expect(page.getByText(`We sent an invite to ${email}.`)).toBeVisible();
	await page.getByRole("button", { name: "Copy link" }).click();
	await expect(page.getByText("Invite link copied")).toBeVisible();
	const link = await page.evaluate(() => navigator.clipboard.readText());
	expect(link).toMatch(/\/invite\/[\w-]{43}$/);
	return new URL(link).pathname;
}

type OutboxEmail = { to: string; subject: string; text: string; html: string };

/** The emails sent to `to`, from the dev outbox AI_MODEL=stub keeps instead of sending. */
async function outbox(page: Page, to: string): Promise<OutboxEmail[]> {
	const response = await page.request.get(`/api/dev/outbox?to=${encodeURIComponent(to)}`);
	expect(response.ok()).toBe(true);
	return response.json();
}

/** Checks the one invite email sent to `to` and gives its link's path, from the text and the button. */
async function emailedLink(page: Page, to: string, inviter: string, household: string) {
	const emails = await outbox(page, to);
	expect(emails).toHaveLength(1);
	const email = emails[0];
	if (!email) throw new Error(`No email to ${to}`);
	expect(email.to).toBe(to);
	expect(email.subject).toBe(`${inviter} invited you to ${household} on Noodle`);
	expect(email.text).toContain(
		`${inviter} invited you to plan ${household}’s money together on Noodle`,
	);
	expect(email.text).toContain("This link works for 7 days.");
	const url = email.text.match(/https?:\/\/\S+\/invite\/[\w-]{43}/)?.[0] ?? "";
	// Links point at the app the inviter is using (APP_ORIGIN in production).
	expect(new URL(url).origin).toBe(new URL(page.url()).origin);
	expect(email.html).toContain(`href="${url}"`);
	return new URL(url).pathname;
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

		await invite(firstPage, secondEmail);
		await expect(firstPage.getByText(`We sent an invite to ${secondEmail}.`)).toBeVisible();
		// Copy link is there too, as a second way to send it.
		await expect(firstPage.getByRole("button", { name: "Copy link" })).toBeVisible();
		const link = await emailedLink(firstPage, secondEmail, "Alex", "The Invites");

		// Signed out, the link from the email opens sign-up with their email filled in.
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

test("when the invite email can't be sent, the Parent is told to copy the link instead", async ({
	browser,
}) => {
	const inviter = await createTestParent();
	const invitedEmail = newTestEmail();
	try {
		const page = await signedInPage(browser, inviter.email, { ...clipboard, ...phone });
		await createHousehold(page, "The Postmen", "Alex");
		await page.goto("/household");
		await invite(page, invitedEmail);
		await expect(page.getByText(`We sent an invite to ${invitedEmail}.`)).toBeVisible();
		await shot(page, "sent-393");

		// The dev outbox refuses fail@example.com, as a real send might fail.
		await invite(page, "fail@example.com");
		await expect(page.getByText("Invited fail@example.com")).toBeVisible();
		await expect(page.getByRole("alert")).toContainText("Couldn’t send. Copy the link instead.");
		await page.getByRole("button", { name: "Copy link" }).click();
		const link = await page.evaluate(() => navigator.clipboard.readText());
		expect(link).toMatch(/\/invite\/[\w-]{43}$/);
		expect(await outbox(page, "fail@example.com")).toHaveLength(0);
		expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
			393,
		);
		await shot(page, "failed-393");
	} finally {
		await inviter.remove();
	}
});

/** Makes the open invite to `to` look sent `days` ago (the dev seam, AI_MODEL=stub only). */
async function ageInvite(page: Page, to: string, days: number) {
	const response = await page.request.post(
		`/api/dev/invite-age?to=${encodeURIComponent(to)}&days=${days}`,
	);
	expect(response.ok()).toBe(true);
}

/** The link in the newest email to `to`. */
async function newestLink(page: Page, to: string) {
	const emails = await outbox(page, to);
	const url = emails.at(-1)?.text.match(/https?:\/\/\S+\/invite\/[\w-]{43}/)?.[0] ?? "";
	return new URL(url).pathname;
}

test("a Parent resends an invite for a new link, and cancels it", async ({ browser }) => {
	test.slow();
	const inviter = await createTestParent();
	const invitedEmail = newTestEmail();
	try {
		const page = await signedInPage(browser, inviter.email, { ...clipboard, ...phone });
		await createHousehold(page, "The Resenders", "Alex");
		await page.goto("/household");
		await invite(page, invitedEmail);
		await expect(page.getByText("Sent today · expires in 7 days")).toBeVisible();
		const first = await newestLink(page, invitedEmail);

		// Resend waits a minute between emails.
		await page.getByRole("button", { name: "Resend" }).click();
		await expect(page.getByRole("alert")).toContainText("You can resend in a minute.");

		await ageInvite(page, invitedEmail, 2);
		await page.reload();
		await expect(page.getByText("Sent 2 days ago · expires in 5 days")).toBeVisible();
		await expect(page.getByText("Resend it for a new one.")).toBeVisible();
		await shot(page, "pending-393");
		if (process.env.SHOTS) {
			await page.emulateMedia({ colorScheme: "dark" });
			await shot(page, "pending-393-dark");
			await page.emulateMedia({ colorScheme: "light" });
		}

		await page.getByRole("button", { name: "Resend" }).click();
		await expect(page.getByText(`We sent an invite to ${invitedEmail}.`)).toBeVisible();
		await expect(page.getByText("Sent today · expires in 7 days")).toBeVisible();
		await expect(page.getByRole("button", { name: "Copy link" })).toBeVisible();
		await shot(page, "resent-393");
		expect(await outbox(page, invitedEmail)).toHaveLength(2);
		const second = await newestLink(page, invitedEmail);
		expect(second).not.toBe(first);

		// The new link works; the first one no longer does.
		const other = await signedOutPage(browser);
		await other.goto(first);
		await expect(
			other.getByRole("heading", { name: "This invite link doesn’t work" }),
		).toBeVisible();
		await other.goto(second);
		await expect(other).toHaveURL(/\/sign-up\?invite=/);

		// Run out: it says when, and Resend is still there.
		await ageInvite(page, invitedEmail, 8);
		await page.reload();
		await expect(page.getByText("Ran out", { exact: true })).toBeVisible();
		await expect(page.getByText(`The invite to ${invitedEmail} ran out on`)).toBeVisible();
		// Enabled once the page has hydrated, which can take a while on CI.
		await expect(page.getByRole("button", { name: "Resend" })).toBeEnabled(clientRendered);
		await shot(page, "expired-393");

		// Cancelling asks first, and then its link doesn't work.
		await page.getByRole("button", { name: "Cancel invite" }).click();
		await page.getByRole("alertdialog").getByRole("button", { name: "Cancel invite" }).click();
		await expect(page.getByText(`Invited ${invitedEmail}`)).toHaveCount(0);
		await expect(page.getByRole("button", { name: "Invite", exact: true })).toBeVisible();
		await other.goto(second);
		await expect(
			other.getByRole("heading", { name: "This invite link doesn’t work" }),
		).toBeVisible();
	} finally {
		await inviter.remove();
	}
});

test("the inviter sees the other Parent join without reloading", async ({ browser }) => {
	const inviter = await createTestParent();
	const invitee = await createTestParent();
	try {
		const inviterPage = await signedInPage(browser, inviter.email, clipboard);
		await createHousehold(inviterPage, "The Live Ones", "Alex");
		await inviterPage.getByRole("link", { name: "Household" }).click();
		const link = await inviteAndCopyLink(inviterPage, invitee.email);

		const page = await signedInPage(browser, invitee.email);
		await page.goto(link);
		await page.getByLabel("Your name").fill("Sam");
		await page.getByRole("button", { name: "Join The Live Ones" }).click();
		await enterJoinedHousehold(page);

		// The Household Agent tells the inviter's open page, which shows Sam with no reload.
		await expect(
			inviterPage.getByRole("main").getByRole("listitem").filter({ hasText: "Sam" }),
		).toBeVisible({ timeout: 15_000 });
		await expect(inviterPage.getByText(`Invited ${invitee.email}`)).toHaveCount(0);
	} finally {
		await Promise.all([inviter.remove(), invitee.remove()]);
	}
});
