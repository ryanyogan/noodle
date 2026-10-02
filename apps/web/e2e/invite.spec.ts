import { expect, type Page, test } from "@playwright/test";
import { createTestParent } from "./parents";
import { createHousehold, setUpLater, signedInPage } from "./session";

async function invite(page: Page, email: string) {
	await page.getByLabel("Their email").fill(email);
	await page.getByRole("button", { name: /^Invite/ }).click();
}

test("a Parent invites the other Parent, who joins the same Household", async ({ browser }) => {
	const first = await createTestParent();
	const second = await createTestParent();
	try {
		const firstPage = await signedInPage(browser, first.email);
		await createHousehold(firstPage, "The Invites", "Alex");

		await firstPage.getByRole("link", { name: "Household" }).click();
		// A Parent can't invite themselves.
		await invite(firstPage, first.email.toUpperCase());
		await expect(firstPage.getByRole("alert")).toContainText("your own email");

		await invite(firstPage, second.email);
		await expect(firstPage.getByText(`Invited ${second.email}`)).toBeVisible();

		const secondPage = await signedInPage(browser, second.email);
		await secondPage.goto("/month");
		await expect(secondPage).toHaveURL(/\/welcome/);
		await secondPage.getByLabel("Your name").fill("Sam");
		await secondPage.getByRole("button", { name: "Join The Invites" }).click();

		// Both Parents now share one Household.
		await expect(secondPage).toHaveURL(/\/month\/\d{4}-\d{2}$/);
		await expect(secondPage.locator("[data-slot=page-header]")).toContainText("This Month");
		await expect(secondPage.getByText("The Invites")).toBeVisible();

		await secondPage.getByRole("link", { name: "Household" }).click();
		await expect(secondPage.getByRole("listitem").filter({ hasText: "Alex" })).toBeVisible();
		await expect(secondPage.getByRole("listitem").filter({ hasText: "Sam" })).toBeVisible();
		// Two Parents is the limit, so there is nobody left to invite.
		await expect(secondPage.getByLabel("Their email")).toHaveCount(0);
		await expect(secondPage.getByRole("heading", { name: "Invite the other Parent" })).toHaveCount(
			0,
		);
	} finally {
		await Promise.all([first.remove(), second.remove()]);
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
		await expect(secondPage).toHaveURL(/\/month\//);

		await replacedPage.getByLabel("Your name").fill("Jo");
		await replacedPage.getByRole("button", { name: "Join The Replacements" }).click();
		await expect(replacedPage.getByRole("alert")).toContainText("can no longer be used");

		await firstPage.reload();
		await expect(firstPage.getByRole("listitem")).toHaveCount(2);
		await expect(firstPage.getByRole("listitem").filter({ hasText: "Jo" })).toHaveCount(0);
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
		await expect(page.locator("[data-slot=page-header]")).toContainText("This Month");
		await expect(page.getByText("The Originals")).toBeVisible();
	} finally {
		await Promise.all([inviter.remove(), invitee.remove()]);
	}
});
