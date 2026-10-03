import { execFileSync } from "node:child_process";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { signFakeWebhook } from "../src/server/plaid-fake-webhook-key";
import { createTestParent } from "./parents";
import { createPlannedHousehold, signedInPage } from "./session";

// Disconnecting a bank (#61), against the fake Plaid API: asked first in plain words, its
// Accounts and Transactions stay, kept by hand, nothing more comes in (a webhook for it is
// ignored), and connecting the same bank again pairs with the same Accounts (ADR-0020).

const SHOTS = process.env.SHOTS_DIR;

let parent: Awaited<ReturnType<typeof createTestParent>>;

test.beforeEach(async () => {
	parent = await createTestParent();
});

test.afterEach(async () => {
	await parent?.remove();
});

const toast = (page: Page, text: string | RegExp) =>
	page.getByRole("status").filter({ hasText: text });
const bankConnections = (page: Page) => page.getByRole("region", { name: "Bank Connections" });
const chooseSheet = (page: Page) =>
	page.getByRole("dialog", { name: "Which of these do you have already?" });
const accountsLink = (page: Page) => page.getByRole("link", { name: "Accounts", exact: true });
const checking = (page: Page) => page.getByRole("link", { name: /^Plaid Checking/ });

/** One value from the local D1, for the Parent's Household. */
function d1(clerkUserId: string, select: string, from: string): string | number | null {
	const id = clerkUserId.replaceAll("'", "''");
	const sql = `select ${select} as v from ${from} x join members m on m.household_id = x.household_id where m.clerk_user_id = '${id}'`;
	const output = execFileSync(
		"bunx",
		["wrangler", "d1", "execute", "noodle", "--local", "--json", `--command=${sql}`],
		{ encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
	);
	const [{ results }] = JSON.parse(output) as [{ results: { v: string | number | null }[] }];
	return results[0]?.v ?? null;
}

async function connectBank(page: Page) {
	await accountsLink(page).click();
	// The empty Accounts page has it in its ways to add an Account; otherwise it's in Bank Connections.
	await page.getByRole("button", { name: "Connect a bank" }).click();
	await expect(chooseSheet(page)).toBeVisible();
}

test("disconnecting keeps the Accounts by hand, and connecting again pairs with them", async ({
	browser,
}) => {
	test.slow();
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, { baseline: "5,000", buckets: [["Fun", "300"]] });

	await connectBank(page);
	await expect(chooseSheet(page).getByLabel("Plaid Checking ··0000")).toHaveText(
		"Add as a new Account",
	);
	await chooseSheet(page).getByRole("button", { name: "Start bringing them in" }).click();
	const connection = bankConnections(page).getByRole("listitem");
	await expect(connection).toContainText("Up to date");
	await expect(connection).toContainText(/Brought in \d+ Transactions/);
	const item = String(d1(parent.userId, "x.external_id", "bank_connections"));
	const transactions = Number(d1(parent.userId, "count(*)", "transactions"));
	expect(transactions).toBeGreaterThan(0);
	const accounts = await page.getByRole("link", { name: /··\d{4}, / }).count();

	// Asked first, saying what stays and what goes.
	await page.setViewportSize({ width: 393, height: 852 });
	await connection.getByRole("button", { name: "Disconnect First Platypus Bank" }).click();
	const dialog = page.getByRole("alertdialog", { name: "Disconnect First Platypus Bank" });
	await expect(dialog).toContainText("Its Accounts stay, with their Transactions and statements");
	await expect(dialog).toContainText("Quick Add or by uploading a statement");
	await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
	const { violations } = await new AxeBuilder({ page })
		.include("[role=alertdialog]")
		.withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
		.analyze();
	expect(violations.map((v) => v.id)).toEqual([]);
	if (SHOTS) await page.screenshot({ path: `${SHOTS}/disconnect-393.png` });
	await dialog.getByRole("button", { name: "Disconnect First Platypus Bank" }).click();
	await expect(toast(page, "First Platypus Bank is disconnected.")).toBeVisible();
	await page.setViewportSize({ width: 1440, height: 900 });

	// The Accounts and their Transactions stay, kept by hand; the token is gone.
	await expect(bankConnections(page).getByRole("listitem")).toHaveCount(0);
	await expect(page.getByRole("link", { name: /··\d{4}, / })).toHaveCount(accounts);
	expect(Number(d1(parent.userId, "count(*)", "transactions"))).toBe(transactions);
	expect(d1(parent.userId, "x.credential", "bank_connections")).toBe("");
	await checking(page).click();
	await expect(
		page
			.locator("[data-slot=master-detail-detail]")
			.getByText(/^(Entered by hand|From statements)/),
	).toBeVisible();
	await expect(page.getByRole("button", { name: "Upload statement" })).toBeVisible();

	// A webhook for the old link brings nothing in.
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
	expect(Number(d1(parent.userId, "count(*)", "transactions"))).toBe(transactions);

	// Connecting the same bank again pairs with the same Accounts. Back on Accounts first: pressed
	// while the Account's page is still leaving, Connect a bank's sheet went with it.
	await accountsLink(page).click();
	await expect(page).toHaveURL(/\/accounts$/);
	await expect(page.getByText("Pick an Account to see it here.")).toBeVisible();
	await connectBank(page);
	await expect(chooseSheet(page).getByLabel("Plaid Checking ··0000")).toHaveText(
		"Same as Plaid Checking ··0000",
	);
	await chooseSheet(page).getByRole("button", { name: "Start bringing them in" }).click();
	await expect(bankConnections(page).getByRole("listitem")).toContainText("Up to date");
	await expect(page.getByRole("link", { name: /··\d{4}, / })).toHaveCount(accounts);
	await expect(checking(page)).toContainText("Connected · First Platypus Bank");
	// Nothing came in twice.
	expect(Number(d1(parent.userId, "count(*)", "transactions"))).toBe(transactions);
});
