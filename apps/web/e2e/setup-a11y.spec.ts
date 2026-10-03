import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { createTestParent } from "./parents";
import { savedBy, signedInPage } from "./session";

// axe on every step of the get-started wizard and on "Here's your Household" (#53), on a 393 px
// phone and at 1440, light and dark. Follows phone-a11y.spec.ts.

const sizes = [
	{
		name: "393 px phone",
		tag: ["@phone"],
		options: {
			viewport: { width: 393, height: 852 },
			deviceScaleFactor: 2,
			isMobile: true,
			hasTouch: true,
		},
	},
	{ name: "1440 desktop", tag: [], options: { viewport: { width: 1440, height: 900 } } },
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
	test(`axe finds no violations in the wizard or on the joined screen, ${size.name}`, {
		tag: [...size.tag],
	}, async ({ browser }) => {
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

/** Creates a Household and goes to Take-home pay on the given spending path. */
async function spendingPath(page: Page, path: RegExp) {
	await page.goto("/welcome");
	await page.getByLabel("Household name").fill("The Checkers");
	await page.getByLabel("Your name").fill("Alex");
	await page.getByRole("button", { name: "Create Household" }).click();
	await expect(page).toHaveURL(/\/setup$/);
	await page.getByRole("radio", { name: path }).check();
	const saved = savedBy(page, "saveSetup");
	await page.getByRole("button", { name: "Continue", exact: true }).click();
	await saved;
	await expect(page.getByText("Step 2 of 7")).toBeVisible();
}

for (const size of sizes) {
	test(`axe finds no violations on the statement and bank cards, ${size.name}`, {
		tag: [...size.tag],
	}, async ({ browser }) => {
		test.setTimeout(240_000);
		const parent = await createTestParent();
		const other = await createTestParent();
		try {
			// The statement card: naming the Account, choosing the file, and once it's in.
			const page = await signedInPage(browser, parent.email, size.options);
			await spendingPath(page, /Upload a statement/);
			await axe(page, "statement card");
			await page.getByLabel("Which account is this from?").fill("Checking");
			await page.getByRole("button", { name: "Choose the statement" }).click();
			await expect(page.getByLabel("Statement file")).toBeAttached();
			await axe(page, "statement card, choosing the file");
			await page.getByLabel("Statement file").setInputFiles({
				name: "checking.csv",
				mimeType: "text/csv",
				buffer: Buffer.from(
					"Transaction Date,Description,Debit,Credit\n09/02/2026,COSTCO WHSE #0123,180.00,\n09/03/2026,CHIPOTLE 1234,21.50,",
				),
			});
			await expect(page.getByRole("button", { name: "Clear" })).toBeVisible();
			await axe(page, "statement card, file chosen");
			await page.getByRole("button", { name: /^Import \d+ lines$/ }).click();
			await expect(page.getByText("checking.csv is in for Checking")).toBeVisible();
			await axe(page, "statement card, imported");
			await page.context().close();

			// The bank card: before connecting, Choose Accounts, and once connected.
			const bank = await signedInPage(browser, other.email, size.options);
			await spendingPath(bank, /Connect a bank/);
			await axe(bank, "bank card");
			await bank.getByRole("button", { name: "Connect your bank" }).click();
			const choose = bank.getByRole("dialog", { name: "Which of these do you have already?" });
			await expect(choose).toBeVisible();
			await axe(bank, "Choose Accounts");
			await choose.getByRole("button", { name: "Start bringing them in" }).click();
			await expect(bank.getByText("First Platypus Bank is connected")).toBeVisible();
			await axe(bank, "bank card, connected");
			await bank.context().close();
		} finally {
			await parent.remove();
			await other.remove();
		}
	});
}
