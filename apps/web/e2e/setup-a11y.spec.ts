import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { createTestParent } from "./parents";
import { savedBy, signedInPage } from "./session";

// axe on every step of the get-started wizard and on "Here's your Household" (#53), on a 393 px
// phone and at 1440, light and dark. Follows phone-a11y.spec.ts.

const sizes = [
	{
		name: "393 px phone",
		options: {
			viewport: { width: 393, height: 852 },
			deviceScaleFactor: 2,
			isMobile: true,
			hasTouch: true,
		},
	},
	{ name: "1440 desktop", options: { viewport: { width: 1440, height: 900 } } },
] as const;

async function axe(page: Page, where: string) {
	await page.evaluate(() => document.fonts.ready);
	for (const colorScheme of ["light", "dark"] as const) {
		await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
		const { violations } = await new AxeBuilder({ page })
			.withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
			.analyze();
		expect
			.soft(
				violations.map(
					(v) =>
						`${v.id}: ${v.nodes
							.map((n) => n.target.join(" "))
							.slice(0, 4)
							.join(", ")}`,
				),
				`${colorScheme} ${where}: axe violations`,
			)
			.toEqual([]);
	}
}

for (const size of sizes) {
	test(`axe finds no violations in the wizard or on the joined screen, ${size.name}`, async ({
		browser,
	}) => {
		test.setTimeout(240_000);
		const parent = await createTestParent();
		try {
			const page = await signedInPage(browser, parent.email, size.options);
			await page.goto("/welcome");
			await page.getByLabel("Household name").fill("The Checkers");
			await page.getByLabel("Your name").fill("Alex");
			await page.getByRole("button", { name: "Create Household" }).click();
			await expect(page).toHaveURL(/\/setup$/);
			const next = async (button: string, step: number) => {
				const saved = savedBy(page, "saveSetup");
				await page.getByRole("button", { name: button, exact: true }).click();
				await saved;
				await expect(page.getByText(`Step ${step} of 7`)).toBeVisible();
			};

			await expect(page.getByText("Step 1 of 7")).toBeVisible();
			await page.getByRole("radio", { name: /I’ll add things by hand/ }).check();
			await axe(page, "step 1");
			await next("Continue", 2);
			await page
				.getByRole("textbox", { name: "What lands in your account in a normal month, after tax?" })
				.fill("5,000");
			await axe(page, "step 2");
			await next("Continue", 3);
			await page.getByRole("checkbox", { name: "Mortgage or rent" }).check();
			await page.getByRole("textbox", { name: "Mortgage or rent amount" }).fill("1500");
			await axe(page, "step 3");
			await next("Continue", 4);
			await axe(page, "step 4");
			await next("Continue", 5);
			await page.getByRole("radio", { name: /Emergency fund/ }).check();
			await axe(page, "step 5");
			await next("Skip", 6);
			await axe(page, "step 6");
			await next("Skip", 7);
			await expect(page.locator('[data-summary="free-to-spend"]')).toBeVisible();
			await axe(page, "step 7");

			await page.goto("/joined");
			await expect(page.getByRole("heading", { name: "Here’s your Household" })).toBeVisible();
			await axe(page, "/joined");
			await page.context().close();
		} finally {
			await parent.remove();
		}
	});
}
