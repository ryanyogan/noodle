import { expect, test } from "@playwright/test";
import { createTestParent } from "./parents";
import { chooseKind, createPlannedHousehold, hydrated, signedInPage } from "./session";

// Money in named in Review while a card payment waits there too (issue 142): a Transfer still
// asks which Account it came from, and a shop's refund through PayPal gets Refund suggested only
// when something was bought at that shop through PayPal.

let parents: Awaited<ReturnType<typeof createTestParent>>[] = [];

test.afterEach(async () => {
	await Promise.all(parents.map((p) => p.remove()));
	parents = [];
});

test("with a card payment waiting in Review, a Transfer in still asks which Account it came from, and PayPal money back from a shop bought at is a Refund", async ({
	browser,
}) => {
	test.setTimeout(300_000);
	const alex = await createTestParent();
	parents.push(alex);
	const page = await signedInPage(browser, alex.email, { viewport: { width: 1440, height: 900 } });
	await createPlannedHousehold(page, { baseline: "5,000", buckets: [["Groceries", "600"]] });
	const toast = (text: string) => page.getByRole("status").filter({ hasText: text });

	const addAccount = async (name: string, kind: "checking" | "savings" | "credit-card") => {
		await page.goto("/accounts");
		await expect(page.getByRole("heading", { level: 1 })).toHaveText("Accounts");
		await expect(async () => {
			if (!(await page.getByLabel("Name").isVisible()))
				await page.getByRole("button", { name: "Add Account" }).click({ timeout: 2_000 });
			await expect(page.getByLabel("Name")).toBeVisible({ timeout: 1_000 });
		}).toPass();
		await page.getByLabel("Name").fill(name);
		await chooseKind(page, kind);
		await page.getByLabel(kind === "credit-card" ? "Owed now" : "Balance now").fill("900");
		await page.getByRole("button", { name: "Add Account" }).last().click();
		await expect(page.getByRole("link", { name: new RegExp(`^${name}, `) })).toBeVisible();
	};
	await addAccount("Visa", "credit-card");
	await addAccount("Ally savings", "savings");
	await addAccount("Checking", "checking");

	// Checking's statement: money a person sent, a payment to the card, something bought through
	// PayPal, part of it refunded, and money back through PayPal from a shop nothing was bought at.
	const us = await page.evaluate(() => {
		const now = new Date();
		const mm = String(now.getMonth() + 1).padStart(2, "0");
		const dd = String(now.getDate()).padStart(2, "0");
		return `${mm}/${dd}/${now.getFullYear()}`;
	});
	await page.getByRole("link", { name: /^Checking, / }).click();
	await expect(page.locator("[data-slot=detail-title]:visible")).toContainText("Checking");
	await page.getByRole("button", { name: "Upload statement" }).click();
	const sheet = page.getByRole("dialog", { name: "Upload a statement" });
	await sheet.getByLabel("Statement file").setInputFiles({
		name: "checking.csv",
		mimeType: "text/csv",
		buffer: Buffer.from(
			[
				"Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #",
				`CREDIT,${us},"Zelle payment from JORDAN PIKE 99887766",75.00,ACH_CREDIT,2815.00,`,
				`DEBIT,${us},"CARDMEMBER SERV WEB PYMT",-250.00,ACH_DEBIT,2565.00,`,
				`DEBIT,${us},"PAYPAL *NIKE COM 4029357733",-80.00,ACH_DEBIT,2485.00,`,
				`CREDIT,${us},"PAYPAL *NIKE COM REFUND",30.00,ACH_CREDIT,2515.00,`,
				`CREDIT,${us},"PAYPAL *ETSY INC REFUND",12.00,ACH_CREDIT,2527.00,`,
			].join("\n"),
		),
	});
	await sheet.getByRole("button", { name: "Import 5 lines" }).click();
	await expect(sheet).toBeHidden();
	await expect(toast("checking.csv").first()).toBeVisible();

	// Review holds the card payment (money out) and the money in, side by side.
	await page.goto("/review");
	const moneyIn = page.getByTestId("money-in-review");
	const row = (who: string) => moneyIn.getByTestId("money-in-row").filter({ hasText: who });
	await expect(row("JORDAN PIKE")).toBeVisible({ timeout: 30_000 });
	await expect(page.getByTestId("review-card").first()).toBeVisible({ timeout: 60_000 });
	await hydrated(row("JORDAN PIKE").getByRole("button", { name: "Transfer", exact: true }));

	// The shop's refund matches the purchase at Nike through PayPal: Refund is first, and says why.
	await expect(row("NIKE").locator("[data-suggested]")).toHaveText("Refund");
	await expect(row("NIKE").getByTestId("money-in-suggested")).toContainText(
		"something you bought there through PayPal",
	);
	// Nothing was bought at Etsy: PayPal's wording alone still reads as a person paying back.
	await expect(row("ETSY").locator("[data-suggested]")).toHaveText("Paid back");

	// Pressed once, with the card payment still waiting: the row stays and asks where it came from.
	await row("JORDAN PIKE").getByRole("button", { name: "Transfer", exact: true }).click();
	const pair = row("JORDAN PIKE").getByTestId("account-pair-offer");
	await expect(pair).toBeVisible({ timeout: 15_000 });
	await expect(page.getByTestId("review-card").first()).toBeVisible();
	await pair.getByRole("button", { name: "Ally savings" }).click();
	await pair.getByRole("button", { name: "Yes, always" }).click();
	await expect(
		toast("Money from Ally savings into Checking is always a Transfer now"),
	).toBeVisible();
	await expect(row("JORDAN PIKE")).toHaveCount(0);
});
