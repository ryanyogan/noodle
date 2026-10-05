import { expect, type Page, test } from "@playwright/test";
import { ulid } from "ulid";
import { signFakeWebhook } from "../src/server/plaid-fake-webhook-key";
import { createTestParent } from "./parents";
import { seedSql } from "./seed-sql";
import {
	clientRendered,
	createHousehold,
	createPlannedHousehold,
	savedBy,
	signedInPage,
} from "./session";

// Deleting Transactions (#97, ADR-0045): Select mode on the Transactions page, "select all that
// match", the facts before anything goes, the snapshot taken first, and a bank line that stays
// deleted when the bank syncs again.

let parent: Awaited<ReturnType<typeof createTestParent>>;
test.beforeEach(async () => {
	parent = await createTestParent();
});
test.afterEach(async () => {
	await parent?.remove();
});

const q = (value: string) => `'${value.replaceAll("'", "''")}'`;
const list = (page: Page) => page.getByRole("list", { name: /^Transactions in / });
const row = (page: Page, title: string) =>
	list(page).getByRole("button", { name: new RegExp(`^${title},`, "i") });
const bar = (page: Page) => page.getByRole("region", { name: "Selecting Transactions" });
const toast = (page: Page, text: string) => page.getByRole("status").filter({ hasText: text });
const SNAPSHOT_FIRST =
	"Noodle took a snapshot first, so you can put them back from Snapshots in Household settings.";

/** Quick Adds with these notes and amounts (in cents), this month or the month before. */
async function seed(rows: [note: string, cents: number, lastMonth?: boolean][]) {
	const household = `(select household_id from members where clerk_user_id = ${q(parent.userId)})`;
	const member = `(select id from members where clerk_user_id = ${q(parent.userId)})`;
	const now = new Date();
	const first = (monthsBack: number) =>
		new Date(Date.UTC(now.getFullYear(), now.getMonth() - monthsBack, 1))
			.toISOString()
			.slice(0, 10);
	await seedSql(
		rows.map(
			([note, cents, lastMonth]) =>
				`insert into transactions (id, household_id, source, date, amount_cents, note, created_by_member_id) values (${q(ulid())}, ${household}, 'quick-add', ${q(first(lastMonth ? 1 : 0))}, ${cents}, ${q(note)}, ${member})`,
		),
	);
}

async function openTransactions(page: Page) {
	await page.goto("/transactions");
	await expect(page.getByLabel("Search notes and merchants")).toBeEnabled(clientRendered);
}

test("select all that match a search, read the facts, delete, and find a snapshot taken first", async ({
	browser,
}) => {
	test.slow();
	const page = await signedInPage(browser, parent.email, {
		viewport: { width: 1440, height: 900 },
	});
	await createPlannedHousehold(page, { baseline: "6200", buckets: [["Groceries", "800"]] });
	await seed([
		["zebra apple", 1025],
		["zebra banana", 2025],
		["zebra cherry", 3025],
		["yak date", 700],
		["yak elder", 800],
		["zebra fig", 4025, true],
		["zebra grape", 5025, true],
	]);
	await openTransactions(page);
	await expect(list(page).getByRole("button")).toHaveCount(5);

	// Select mode: a tap selects instead of opening.
	await page.getByRole("button", { name: "Select", exact: true }).click();
	await expect(bar(page)).toContainText("0 selected");
	await row(page, "zebra apple").click();
	await expect(row(page, "zebra apple")).toHaveAttribute("aria-pressed", "true");
	await expect(bar(page)).toContainText("1 selected");
	await expect(page.getByRole("heading", { name: "Edit Transaction" })).toHaveCount(0);
	await row(page, "zebra apple").click();
	await expect(bar(page)).toContainText("0 selected");

	// Everything a search matches, in this month, or in it and every month before.
	await page.getByLabel("Search notes and merchants").fill("zebra");
	await expect(list(page).getByRole("button")).toHaveCount(3);
	await expect(
		bar(page).getByRole("button", { name: /^Select all 3 that match in / }),
	).toBeVisible();
	await bar(page)
		.getByRole("button", { name: /^Select all 5 that match in .+ and every month before$/ })
		.click();
	await expect(bar(page)).toContainText("5 selected");
	await expect(row(page, "zebra banana")).toHaveAttribute("aria-pressed", "true");
	await row(page, "zebra banana").click();
	await expect(bar(page)).toContainText("4 selected");
	await row(page, "zebra banana").click();
	await expect(bar(page)).toContainText("5 selected");

	// The facts first; nothing has gone yet.
	await bar(page).getByRole("button", { name: "Delete" }).click();
	const sheet = page.getByRole("dialog", { name: "Delete 5 Transactions?" });
	await expect(sheet).toContainText("5 Transactions from ");
	await expect(sheet).toContainText("adding up to $151.25.");
	await expect(sheet).toContainText(
		"Noodle takes a snapshot first, so you can put them back from Snapshots in Household settings.",
	);
	await expect(sheet).toContainText(
		"Money in (pay and other deposits) isn’t in this list and stays.",
	);
	await expect(list(page).getByRole("button")).toHaveCount(3);

	await sheet.getByRole("button", { name: "Delete 5 Transactions" }).click();
	await expect(toast(page, "Deleted 5 Transactions.")).toHaveText(
		`Deleted 5 Transactions. ${SNAPSHOT_FIRST}`,
	);
	await expect(sheet).toBeHidden();
	await expect(bar(page)).toHaveCount(0);
	await expect(page.getByText("Nothing matches")).toBeVisible();

	// Gone for good: after a reload only the others are left, last month included.
	await openTransactions(page);
	await expect(list(page).getByRole("button")).toHaveCount(2);
	await expect(row(page, "yak date")).toBeVisible();
	// Last month's two went with them: only the two that didn't match are left anywhere.
	const [counted = []] = await seedSql([
		`select count(*) as n from transactions where household_id = (select household_id from members where clerk_user_id = ${q(parent.userId)})`,
	]);
	expect(Number(counted[0]?.n)).toBe(2);

	// The snapshot taken first is the newest in the history, and can be restored.
	await page.goto("/household");
	const taken = page
		.getByRole("region", { name: "Snapshots" })
		.getByRole("listitem")
		.filter({ hasText: "Before deleting Transactions" })
		.first();
	await expect(taken).toBeVisible();
	await expect(taken.getByRole("button", { name: /^Restore the snapshot from/ })).toBeVisible();
});

test("on a phone, Select is in the header and two tapped Transactions are deleted together", {
	tag: "@phone",
}, async ({ browser }) => {
	test.slow();
	const page = await signedInPage(browser, parent.email, { viewport: { width: 393, height: 852 } });
	await createPlannedHousehold(page, { baseline: "6200", buckets: [["Groceries", "800"]] });
	await seed([
		["zebra apple", 1025],
		["zebra banana", 2025],
		["yak date", 700],
	]);
	await openTransactions(page);
	await page.getByRole("button", { name: "Select", exact: true }).click();
	await row(page, "zebra apple").click();
	await row(page, "zebra banana").click();
	await expect(bar(page)).toContainText("2 selected");
	// No sheet opened for a row: it was only selected.
	await expect(page.getByRole("dialog")).toHaveCount(0);
	// Nothing runs off the side of the screen while selecting.
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
		true,
	);

	await bar(page).getByRole("button", { name: "Delete" }).click();
	const sheet = page.getByRole("dialog", { name: "Delete 2 Transactions?" });
	await expect(sheet).toContainText("adding up to $30.50.");
	await sheet.getByRole("button", { name: "Delete 2 Transactions" }).click();
	await expect(toast(page, "Deleted 2 Transactions.")).toHaveText(
		`Deleted 2 Transactions. ${SNAPSHOT_FIRST}`,
	);
	await expect(list(page).getByRole("button")).toHaveCount(1);
	await expect(row(page, "yak date")).toBeVisible();

	// Cancel leaves Select mode with nothing changed.
	await page.getByRole("button", { name: "Select", exact: true }).click();
	await row(page, "yak date").click();
	await bar(page).getByRole("button", { name: "Cancel" }).click();
	await expect(bar(page)).toHaveCount(0);
	await expect(row(page, "yak date")).toBeVisible();
});

test("a deleted bank line can be put back with Undo, and once deleted doesn't come back when the bank syncs", async ({
	browser,
}) => {
	test.slow();
	const page = await signedInPage(browser, parent.email, {
		viewport: { width: 1440, height: 900 },
	});
	await createHousehold(page, "The Rinks", "Alex");
	await page.getByRole("link", { name: "Accounts", exact: true }).click();
	await page.getByRole("button", { name: "Connect a bank" }).click();
	await page
		.getByRole("dialog", { name: "Which of these do you have already?" })
		.getByRole("button", { name: "Start bringing them in" })
		.click();
	await expect(
		page.getByRole("region", { name: "Bank Connections" }).getByRole("listitem"),
	).toContainText("4 Accounts · Up to date");

	await page
		.getByRole("navigation", { name: "Main" })
		.getByRole("link", { name: "Transactions" })
		.click();
	const netflix = page.getByRole("button", { name: /^Netflix \(pending\), \$9\.99, / });
	await expect(netflix).toBeVisible();
	const pane = page
		.locator("[role=dialog], [data-slot=transaction-detail]")
		.filter({ has: page.getByRole("heading", { name: "Edit Transaction" }) });
	const deleteIt = async () => {
		await netflix.click();
		await pane.getByRole("button", { name: "Delete" }).click();
		const confirm = page.getByRole("alertdialog");
		await expect(confirm).toContainText("it won’t come back when your bank syncs");
		await confirm.getByRole("button", { name: "Delete Transaction" }).click();
		// Off the toasts: one under the pointer waits, and the delete waits with it.
		await page.mouse.move(0, 0);
	};

	// Undo within ten seconds: it never left.
	await deleteIt();
	const deleted = toast(page, "Deleted. It won’t come back when your bank syncs.");
	await expect(deleted).toBeVisible();
	await expect(netflix).toHaveCount(0);
	await deleted.getByRole("button", { name: "Undo" }).click();
	await expect(netflix).toBeVisible();

	// Deleted for good once the Undo has gone and the delete has been sent.
	const sent = savedBy(page, "deleteTransaction");
	await deleteIt();
	await expect(netflix).toHaveCount(0);
	expect((await sent).ok()).toBe(true);
	await expect(deleted).toHaveCount(0, { timeout: 20_000 });

	// The bank says there's news: Netflix posted in place of the pending charge, Target is pending.
	const [results = []] = await seedSql([
		`select b.external_id as item from bank_connections b join members m on m.household_id = b.household_id where m.clerk_user_id = ${q(parent.userId)}`,
	]);
	const body = JSON.stringify({
		webhook_type: "TRANSACTIONS",
		webhook_code: "SYNC_UPDATES_AVAILABLE",
		item_id: String(results[0]?.item),
	});
	const synced = await page.request.post("/webhooks/plaid", {
		headers: {
			"Content-Type": "application/json",
			"Plaid-Verification": await signFakeWebhook(body),
		},
		data: body,
	});
	expect(synced.status()).toBe(200);
	// Target shows the sync landed; the deleted Netflix did not come back as its posted copy.
	await expect(page.getByRole("button", { name: /^Target \(pending\), \$45, / })).toBeVisible();
	await expect(page.getByRole("button", { name: /^Netflix/ })).toHaveCount(0);
	await page.reload();
	await expect(page.getByRole("button", { name: /^Target \(pending\), \$45, / })).toBeVisible();
	await expect(page.getByRole("button", { name: /^Netflix/ })).toHaveCount(0);
});
