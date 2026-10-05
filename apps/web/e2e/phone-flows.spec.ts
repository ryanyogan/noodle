import { expect, type Page, test } from "@playwright/test";
import { continueToBank, historySheet } from "./bank-history";
import { createTestParent } from "./parents";
import { seedReportHistory } from "./reports-seed";
import { clientRendered, createPlannedHousehold, signedInPage, uploadStatement } from "./session";

// Three flows the sheet pass couldn't open headless (#52, #66), each start to finish on a phone:
// Upload statement, Connect a bank (against the fake Plaid API, AI_MODEL=stub) and Close month.
// Each sheet's primary action is in view when it opens, and each flow ends where it should.

const phone = {
	viewport: { width: 393, height: 852 },
	deviceScaleFactor: 2,
	isMobile: true,
	hasTouch: true,
};

let parent: Awaited<ReturnType<typeof createTestParent>>;
test.beforeEach(async () => {
	parent = await createTestParent();
});
test.afterEach(async () => {
	await parent?.remove();
});

const toast = (page: Page, text: RegExp) => page.getByRole("status").filter({ hasText: text });

test("on a phone a statement comes in, a bank connects and last month closes", async ({
	browser,
}) => {
	// Planning the month, seeding and three flows: past the 30 s default.
	test.setTimeout(120_000);
	const page = await signedInPage(browser, parent.email, phone);
	await createPlannedHousehold(page, {
		baseline: "6200",
		buckets: [
			["Groceries", "800"],
			["Eating out", "300"],
		],
	});
	// Last month planned and spent, so it waits to be closed.
	await seedReportHistory(parent.userId, 2);

	// Upload statement: to a new Visa Account, through the desktop helper, from Transactions:
	// on a phone it reaches Accounts through More.
	await page.goto("/transactions");
	await uploadStatement(
		page,
		[
			["CORNER HARDWARE", "42.17"],
			["SHELL OIL 5521", "38.00"],
		],
		true,
	);

	// Connect a bank: the chooser opens with its Start button in view.
	await page.goto("/accounts");
	await expect(page.getByRole("heading", { level: 1 })).toHaveText("Accounts");
	const chooser = page.getByRole("dialog", { name: "Which of these do you have already?" });
	// First the one question: how far back. It fits a phone, with its button in view.
	const howFar = historySheet(page);
	await expect(async () => {
		if (!(await howFar.isVisible())) {
			await page.getByRole("button", { name: "Connect a bank" }).first().click();
		}
		await expect(howFar).toBeVisible({ timeout: 2_000 });
	}).toPass(clientRendered);
	await expect(howFar.getByRole("radio")).toHaveCount(6);
	await expect(howFar.getByRole("button", { name: "Continue to your bank" })).toBeInViewport();
	await continueToBank(page);
	await expect(chooser).toBeVisible();
	const start = chooser.getByRole("button", { name: "Start bringing them in" });
	await expect(start).toBeInViewport();
	await start.click();
	await expect(toast(page, /^Bringing in \d+ Accounts? from First Platypus Bank\./)).toBeVisible();
	await expect(chooser).toBeHidden();
	await expect(page.getByRole("link", { name: /^Plaid Checking ••0000, / })).toBeVisible();

	// Close month: on This Month, the To do strip opens to last month's close, which ends it.
	await page.goto("/");
	const toDo = page.getByRole("region", { name: "To do" });
	const close = toDo.getByRole("button", { name: /^Close \w+$/ });
	await expect(async () => {
		// The phone strip is the first row; the desktop rows below it are hidden on a phone.
		const strip = toDo.locator("[data-slot=row-button]").first();
		if ((await strip.getAttribute("aria-expanded")) !== "true") await strip.click();
		await expect(close).toBeVisible({ timeout: 2_000 });
	}).toPass(clientRendered);
	await expect(close).toBeEnabled();
	await close.scrollIntoViewIfNeeded();
	await expect(close).toBeInViewport();
	await close.click();
	await expect(close).toBeHidden({ timeout: 10_000 });
	await page.context().close();
});
