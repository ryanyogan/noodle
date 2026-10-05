import { expect, type Page, test } from "@playwright/test";
import { createTestParent } from "./parents";
import { enterJoinedHousehold, savedBy, signedInPage } from "./session";

// A Parent's decision in #72: a Personal Allowance is never made up for the other Parent, so
// Plan › Buckets says whose is still to set until they set it, and drops the note live.

const PAY = "What lands in your account in a normal month, after tax?";

/** With SHOTS_DIR set, pictures of the page at 1440 and 393 wide, for looking at by hand. */
async function shots(page: Page, name: string) {
	const dir = process.env.SHOTS_DIR;
	if (!dir) return;
	const before = page.viewportSize();
	for (const [width, height] of [
		[1440, 900],
		[393, 852],
	] as const) {
		await page.setViewportSize({ width, height });
		await page.waitForTimeout(400);
		await page.screenshot({ path: `${dir}/${name}-${width}.png`, fullPage: true });
	}
	if (before) await page.setViewportSize(before);
}

test("Plan › Buckets says whose Personal Allowance is still to set, until they set it", async ({
	browser,
}) => {
	test.slow();
	const first = await createTestParent();
	const second = await createTestParent();
	try {
		const page = await signedInPage(browser, first.email);
		await page.goto("/welcome");
		await page.getByLabel("Household name").fill("The Pair");
		await page.getByLabel("Your name").fill("Alex");
		await page.getByRole("button", { name: "Create Household" }).click();
		await expect(page).toHaveURL(/\/setup$/);
		const next = async (button: string, step: number) => {
			const saved = savedBy(page, "saveSetup");
			await page.getByRole("button", { name: button, exact: true }).click();
			await saved;
			await expect(page.getByText(`Step ${step} of 7`)).toBeVisible();
		};
		await page.getByRole("radio", { name: /I’ll add things by hand/ }).check();
		await next("Continue", 2);
		await page.getByRole("textbox", { name: PAY }).fill("5,000");
		await next("Continue", 3);
		await next("Continue", 4);
		await next("Continue", 5);
		await next("Skip", 6);
		await page.getByLabel("Their email").fill(second.email);
		await page.getByRole("button", { name: "Invite", exact: true }).click();
		await expect(page.getByText(`Invited ${second.email}`)).toBeVisible();
		await next("Continue", 7);
		await page.getByRole("button", { name: "Go to This Month" }).click();
		await expect(page).toHaveURL(/\/month\//);
		const month = new URL(page.url()).pathname.split("/")[2];

		// Sam joins and doesn't set a Personal Allowance yet: none is made up for him.
		const sam = await signedInPage(browser, second.email);
		await sam.goto("/welcome");
		await sam.getByLabel("Your name").fill("Sam");
		await sam.getByRole("button", { name: "Join The Pair" }).click();
		await expect(sam).toHaveURL(/\/joined$/);

		await page.goto(`/plan/${month}#buckets`);
		const note = page.getByText("still to set: Sam’s Personal Allowance");
		await expect(note.first()).toBeVisible();
		await shots(page, "still-to-set");

		// Sam sets his; Alex's page drops the note without a reload.
		await sam.getByRole("textbox", { name: "Your Personal Allowance each month" }).fill("100");
		const allowance = savedBy(sam, "addPersonalAllowance");
		await sam.getByRole("button", { name: "Add your Personal Allowance" }).click();
		await allowance;
		await enterJoinedHousehold(sam);
		await expect(note).toHaveCount(0, { timeout: 20_000 });
		await page.reload();
		await expect(page.getByRole("button", { name: /^Edit / }).first()).toBeVisible();
		await expect(note).toHaveCount(0);
	} finally {
		await Promise.all([first.remove(), second.remove()]);
	}
});
