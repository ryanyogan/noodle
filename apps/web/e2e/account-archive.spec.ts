import { expect, type Page, test } from "@playwright/test";
import { signFakeWebhook } from "../src/server/plaid-fake-webhook-key";
import { settledAxe } from "./axe";
import { continueToBank } from "./bank-history";
import { createTestParent } from "./parents";
import { seedSql } from "./seed-sql";
import { createPlannedHousehold, signedInPage } from "./session";

// Archiving an Account and unlinking one from its bank (ADR-0046), with the fake bank: one
// Account stops syncing while the others go on; an archived Account leaves Accounts with its
// Transactions kept, and Restore brings it back.

let parent: Awaited<ReturnType<typeof createTestParent>>;

test.beforeEach(async () => {
	parent = await createTestParent();
});

test.afterEach(async () => {
	await parent?.remove();
});

const BANK = "First Platypus Bank";
const toast = (page: Page, text: string | RegExp) =>
	page.getByRole("status").filter({ hasText: text });
const bankConnections = (page: Page) => page.getByRole("region", { name: "Bank Connections" });
const chooseSheet = (page: Page) =>
	page.getByRole("dialog", { name: "Which of these do you have already?" });
const accountsLink = (page: Page) => page.getByRole("link", { name: "Accounts", exact: true });
const checking = (page: Page) => page.getByRole("link", { name: /^Plaid Checking/ });
const more = (page: Page) => page.getByRole("region", { name: "More" });

/** One value from the local D1, for the Parent's Household. */
async function d1(
	clerkUserId: string,
	select: string,
	from: string,
): Promise<string | number | null> {
	const id = clerkUserId.replaceAll("'", "''");
	const sql = `select ${select} as v from ${from} x join members m on m.household_id = x.household_id where m.clerk_user_id = '${id}'`;
	const [results = []] = await seedSql([sql]);
	return results[0]?.v ?? null;
}

/** How many Transactions are in the Parent's "Plaid Checking" Account. */
const inChecking = async (clerkUserId: string) =>
	Number(
		await d1(
			clerkUserId,
			"coalesce(sum(x.account_id in (select a.id from accounts a where a.name like 'Plaid Checking%')), 0)",
			"transactions",
		),
	);

/** The open confirm passes axe and nothing on the page scrolls sideways. */
async function sheetIsSound(page: Page) {
	const { violations } = await (await settledAxe(page))
		.include("[role=alertdialog]")
		.withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
		.analyze();
	expect(violations.map((v) => v.id)).toEqual([]);
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
		true,
	);
}

test("one Account stops syncing while the others go on; an archived Account is put away and restored", async ({
	browser,
}) => {
	test.slow();
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, { baseline: "5,000", buckets: [["Fun", "300"]] });

	await accountsLink(page).click();
	await page.getByRole("button", { name: "Connect a bank" }).click();
	await continueToBank(page);
	await expect(chooseSheet(page)).toBeVisible();
	await chooseSheet(page).getByRole("button", { name: "Start bringing them in" }).click();
	const connection = bankConnections(page).getByRole("listitem");
	await expect(connection).toContainText("Up to date");
	await expect(connection).toContainText(/Brought in \d+ Transactions/);
	const item = String(await d1(parent.userId, "x.external_id", "bank_connections"));
	const accounts = await page.getByRole("link", { name: /••\d{4}, / }).count();
	const syncing = Number((await connection.textContent())?.match(/(\d+) Accounts?/)?.[1]);
	expect(syncing).toBeGreaterThan(1);
	const before = await inChecking(parent.userId);
	expect(before).toBeGreaterThan(0);

	// Stop syncing one Account, asked first on a 320px phone.
	await checking(page).click();
	await expect(more(page)).toBeVisible();
	await page.setViewportSize({ width: 320, height: 700 });
	const stop = more(page).getByRole("button", { name: `Stop syncing with ${BANK}` });
	expect((await stop.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
		true,
	);
	await stop.click();
	const stopping = page.getByRole("alertdialog", { name: `Stop syncing with ${BANK}` });
	await expect(stopping).toContainText(`Its Transactions stay. Nothing new comes in from ${BANK}`);
	await expect(stopping).toContainText(`Your other Accounts at ${BANK} keep syncing`);
	await sheetIsSound(page);
	await stopping.getByRole("button", { name: `Stop syncing with ${BANK}` }).click();
	await expect(toast(page, "is kept by hand or by statements now.")).toBeVisible();
	await page.setViewportSize({ width: 1440, height: 900 });
	await expect(more(page).getByRole("button", { name: /^Stop syncing/ })).toHaveCount(0);

	// The bank says there's news: nothing new lands on the unlinked Account, and the Bank
	// Connection goes on with the others.
	const body = JSON.stringify({
		webhook_type: "TRANSACTIONS",
		webhook_code: "SYNC_UPDATES_AVAILABLE",
		item_id: item,
	});
	const answer = await page.request.post("/webhooks/plaid", {
		headers: {
			"Content-Type": "application/json",
			"Plaid-Verification": await signFakeWebhook(body),
		},
		data: body,
	});
	expect(answer.ok()).toBe(true);
	await page.waitForTimeout(1500);
	expect(await inChecking(parent.userId)).toBe(before);
	expect(await d1(parent.userId, "x.credential", "bank_connections")).not.toBe("");
	await accountsLink(page).click();
	await expect(page.getByRole("region", { name: "Totals" })).toBeVisible();
	await expect(connection).toContainText(`${syncing - 1} Account`);
	await expect(connection).toContainText("Up to date");
	await expect(connection).not.toContainText("Plaid Checking");

	// Archive it: asked first, then gone from Accounts with its Transactions kept.
	await checking(page).click();
	await expect(more(page)).toBeVisible();
	await page.setViewportSize({ width: 320, height: 700 });
	const archive = more(page).getByRole("button", { name: "Archive this Account" });
	expect((await archive.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
	await archive.click();
	const archiving = page.getByRole("alertdialog", { name: "Archive this Account" });
	await expect(archiving).toContainText("leaves Accounts, the pickers and the totals");
	await expect(archiving).toContainText("Its Transactions stay, and past months still count them.");
	await expect(archiving).toContainText("Restore, under Archived on Accounts");
	await sheetIsSound(page);
	await archiving.getByRole("button", { name: "Archive this Account" }).click();
	await expect(toast(page, "is archived.")).toBeVisible();
	await expect(page).toHaveURL(/\/accounts$/);
	await page.setViewportSize({ width: 1440, height: 900 });
	await expect(checking(page)).toHaveCount(0);
	await expect(page.getByRole("link", { name: /••\d{4}, / })).toHaveCount(accounts - 1);
	expect(await inChecking(parent.userId)).toBe(before);

	// Restore, from the Archived fold at the bottom of Accounts.
	const fold = page.getByRole("button", { name: /^Archived/ });
	await expect(fold).toHaveAttribute("aria-expanded", "false");
	await fold.click();
	const archived = page.getByRole("list", { name: "Archived Accounts" });
	await expect(archived.getByRole("listitem")).toHaveCount(1);
	await archived.getByRole("button", { name: /^Restore Plaid Checking/ }).click();
	await expect(toast(page, "is back in Accounts")).toBeVisible();
	await expect(checking(page)).toHaveCount(1);
	await expect(page.getByRole("button", { name: /^Archived/ })).toHaveCount(0);
	expect(await inChecking(parent.userId)).toBe(before);
});
