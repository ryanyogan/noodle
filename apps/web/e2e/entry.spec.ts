import AxeBuilder from "@axe-core/playwright";
import { setupClerkTestingToken } from "@clerk/testing/playwright";
import { type APIRequestContext, expect, type Page, test } from "@playwright/test";
import { createTestParent } from "./parents";
import { createHousehold, signedInPage } from "./session";

// `/` never renders a page (#59): the server answers it with a redirect, before any HTML, so
// there's nothing to flash. Asking for it without following redirects checks exactly that.
async function expectRedirect(request: APIRequestContext, to: string) {
	const response = await request.get("/", { maxRedirects: 0 });
	expect(response.status()).toBe(307);
	expect(new URL(response.headers().location ?? "", "http://localhost").pathname).toBe(to);
}

/** Waits for Clerk's card to mount, after hydration. */
const clerkCard = (page: Page) =>
	expect(page.locator(".cl-formButtonPrimary")).toBeVisible({ timeout: 15_000 });

test("signed out, / opens sign-in", async ({ page }) => {
	await expectRedirect(page.request, "/sign-in");
	await page.goto("/");
	await expect(page).toHaveURL(/\/sign-in$/);
	await clerkCard(page);
	await expect(page).toHaveTitle("Sign in · Noodle");
	await expect(page.getByText("Know what you can spend, every day.")).toBeVisible();
});

test("signed in without a Household, / opens Welcome; with one, This Month", async ({
	browser,
}) => {
	const parent = await createTestParent();
	try {
		const page = await signedInPage(browser, parent.email);
		await expectRedirect(page.request, "/welcome");
		await page.goto("/");
		await expect(page).toHaveURL(/\/welcome$/);

		await createHousehold(page, "The Entries", "Alex");
		await expectRedirect(page.request, "/month");
		await page.goto("/");
		await expect(page).toHaveURL(/\/month\/\d{4}-\d{2}$/);
		await page.context().close();
	} finally {
		await parent.remove();
	}
});

test("sign-in and sign-up link to each other", async ({ page }) => {
	await setupClerkTestingToken({ page });
	await page.goto("/sign-in");
	await clerkCard(page);
	await page.locator(".cl-footerActionLink").click();
	await expect(page).toHaveURL(/\/sign-up/);
	await clerkCard(page);
	await expect(page).toHaveTitle("Create your account · Noodle");
	await page.locator(".cl-footerActionLink").click();
	await expect(page).toHaveURL(/\/sign-in/);
	await clerkCard(page);
});

for (const size of [
	{ name: "phone", width: 393, height: 852 },
	{ name: "desktop", width: 1440, height: 900 },
]) {
	test(`sign-in and sign-up pass axe on a ${size.name}`, async ({ page }) => {
		await page.setViewportSize({ width: size.width, height: size.height });
		await setupClerkTestingToken({ page });
		for (const path of ["/sign-in", "/sign-up"]) {
			await page.goto(path);
			await clerkCard(page);
			await page.evaluate(() => document.fonts.ready);
			const points = page.getByText("AI files your spending");
			if (size.name === "phone") await expect(points).toBeHidden();
			else await expect(points).toBeVisible();
			for (const colorScheme of ["light", "dark"] as const) {
				await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
				const { violations } = await new AxeBuilder({ page })
					.withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
					.analyze();
				expect
					.soft(
						violations.map(
							(v) =>
								`${v.id}: ${v.nodes.map((n) => `${n.target.join(" ")} ${n.html.slice(0, 160)} ${n.failureSummary}`).join(", ")}`,
						),
						`${path} ${colorScheme}`,
					)
					.toEqual([]);
			}
		}
	});
}
