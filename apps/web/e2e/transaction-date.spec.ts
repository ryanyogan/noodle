import { expect, type Page, test } from "@playwright/test";
import { ulid } from "ulid";
import { createTestParent } from "./parents";
import { seedSql } from "./seed-sql";
import { clientRendered, createPlannedHousehold, pickDate, savedBy, signedInPage } from "./session";

// A Parent changes the date of a Transaction (issue 148, ADR-0060): in the open row on a
// computer and in the phone's editor. One from a bank keeps the bank's own date under the field.

let parent: Awaited<ReturnType<typeof createTestParent>>;
test.beforeEach(async () => {
	parent = await createTestParent();
});
test.afterEach(async () => {
	await parent?.remove();
});

const q = (value: string) => `'${value.replaceAll("'", "''")}'`;
const household = () =>
	`(select household_id from members where clerk_user_id = ${q(parent.userId)})`;
const member = () => `(select id from members where clerk_user_id = ${q(parent.userId)})`;
const list = (page: Page) =>
	page.getByRole("grid", { name: /^Transactions in / }).locator("[data-slot=data-table-body]");
const row = (page: Page, title: string) =>
	list(page).getByRole("button", { name: new RegExp(`^${title},`, "i") });
/** The row, reading where it is filed ("Groceries", or "Unassigned"). */
const filed = (page: Page, title: string, where: string) =>
	list(page).getByRole("button", { name: new RegExp(`^${title},.*\\b${where}\\b`, "i") });
const toast = (page: Page, text: string | RegExp) =>
	page.getByRole("status").filter({ hasText: text });

const now = new Date();
const iso = (date: Date) =>
	`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
/** Yesterday, the first of this month, and the last day of the month before. */
const yesterday = iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
const first = iso(new Date(now.getFullYear(), now.getMonth(), 1));
const lastMonthEnd = iso(new Date(now.getFullYear(), now.getMonth(), 0));
const short = (day: string) =>
	new Date(`${day}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const full = (day: string) =>
	new Date(`${day}T12:00:00`).toLocaleDateString("en-US", {
		month: "short",
		day: "numeric",
		year: "numeric",
	});
const monthOf = (day: string) =>
	new Date(`${day}T12:00:00`).toLocaleDateString("en-US", { month: "long" });

/** Lines from the bank (in a Checking Account) or typed in, unfiled unless given a Bucket. */
async function seed(
	rows: { note: string; cents: number; date: string; bank?: boolean; bucket?: string }[],
) {
	const account = ulid();
	await seedSql([
		`insert into accounts (id, household_id, name, kind) values (${q(account)}, ${household()}, 'Checking', 'checking')`,
		...rows.map(
			({ note, cents, date, bank, bucket }) =>
				`insert into transactions (id, household_id, source, date, amount_cents, bucket_id, note, account_id, created_by_member_id) values (${q(ulid())}, ${household()}, ${bank ? "'import'" : "'quick-add'"}, ${q(date)}, ${cents}, ${bucket ? `(select id from buckets where household_id = ${household()} and name = ${q(bucket)} limit 1)` : "null"}, ${q(note)}, ${bank ? q(account) : "null"}, ${member()})`,
		),
	]);
}

async function openTransactions(page: Page, month?: string) {
	await page.goto(month ? `/transactions/${month}` : "/transactions");
	await expect(page.getByLabel("Search notes and merchants")).toBeEnabled(clientRendered);
}

const dateField = (page: Page) => page.getByLabel("Date", { exact: true });
const bankHint = (page: Page) => page.getByTestId("bank-date-hint");

/** Picks a day in the open editor and saves; resolves once the server has answered. */
async function moveTo(page: Page, day: string) {
	await pickDate(page, "Date", day);
	const saved = savedBy(page, "changeTransactionDate");
	await page.getByRole("button", { name: "Save", exact: true }).click();
	await saved;
}

test("a bank line moves to another day of its month, keeps the bank's date, and can be put back", async ({
	browser,
}) => {
	test.skip(now.getDate() < 3, "needs two days of this month that have come");
	test.slow();
	const page = await signedInPage(browser, parent.email, {
		viewport: { width: 1440, height: 900 },
	});
	await createPlannedHousehold(page, { baseline: "6200", buckets: [["Groceries", "800"]] });
	await seed([{ note: "Alpha Market", cents: 4321, date: yesterday, bank: true }]);
	await openTransactions(page);

	await row(page, "Alpha Market").click();
	await expect(dateField(page)).toHaveText(full(yesterday));
	await expect(bankHint(page)).toBeHidden();
	await pickDate(page, "Date", first);
	// Said before it is saved: what the bank says, and the way back.
	await expect(bankHint(page)).toContainText(`From your bank: ${short(yesterday)}`);
	const saved = savedBy(page, "changeTransactionDate");
	await page.getByRole("button", { name: "Save", exact: true }).click();
	await saved;
	const moved = toast(page, `Moved to ${short(first)}`);
	await expect(moved).toBeVisible();
	// Within the month the toast names no month.
	await expect(moved).not.toContainText("·");

	await row(page, "Alpha Market").click();
	await expect(dateField(page)).toHaveText(full(first));
	await expect(bankHint(page)).toContainText(`From your bank: ${short(yesterday)}`);
	await page.getByRole("button", { name: "Cancel", exact: true }).click();

	// Undo puts the day back, and with it nothing of the bank's is left to say.
	const undone = savedBy(page, "changeTransactionDate");
	await moved.getByRole("button", { name: "Undo" }).click();
	await undone;
	await row(page, "Alpha Market").click();
	await expect(dateField(page)).toHaveText(full(yesterday));
	await expect(bankHint(page)).toBeHidden();

	// Moved again, then "Put it back" in the form.
	await moveTo(page, first);
	await expect(toast(page, `Moved to ${short(first)}`)).toBeVisible();
	await row(page, "Alpha Market").click();
	await bankHint(page).getByRole("button", { name: "Put it back" }).click();
	await expect(dateField(page)).toHaveText(full(yesterday));
	await expect(bankHint(page)).toBeHidden();
	const back = savedBy(page, "changeTransactionDate");
	await page.getByRole("button", { name: "Save", exact: true }).click();
	await back;
	await expect(toast(page, `Moved to ${short(yesterday)}`)).toBeVisible();
	// And it is what the server kept.
	await openTransactions(page);
	await row(page, "Alpha Market").click();
	await expect(dateField(page)).toHaveText(full(yesterday));
	await expect(bankHint(page)).toBeHidden();
	await page.context().close();
});

test("a line moved into last month leaves this month's list and is in last month's, unassigned where that Plan lacked its Bucket, and Undo files it again; a closed month refuses", async ({
	browser,
}) => {
	test.slow();
	const page = await signedInPage(browser, parent.email, {
		viewport: { width: 1440, height: 900 },
	});
	await createPlannedHousehold(page, { baseline: "6200", buckets: [["Groceries", "800"]] });
	await seed([
		{ note: "Alpha Market", cents: 4321, date: first, bank: true },
		{ note: "Gamma Grocer", cents: 1500, date: first, bank: true, bucket: "Groceries" },
	]);
	await openTransactions(page);
	const thisMonth = new URL(page.url()).pathname;

	// Filed in a Bucket that last month's Plan didn't have: it moves all the same, and is filed
	// nowhere there. The message says so.
	const unassigned = `Moved to ${short(lastMonthEnd)} · ${monthOf(lastMonthEnd)}. Groceries wasn’t in ${monthOf(lastMonthEnd)}’s Plan, so it isn’t filed anywhere now.`;
	await expect(filed(page, "Gamma Grocer", "Groceries")).toBeVisible();
	await row(page, "Gamma Grocer").click();
	await moveTo(page, lastMonthEnd);
	await expect(toast(page, unassigned)).toBeVisible();
	await expect(row(page, "Gamma Grocer")).toHaveCount(0);

	// Undo puts back its day and its Bucket together: here again, in Groceries.
	const undone = savedBy(page, "changeTransactionDate");
	await toast(page, unassigned).getByRole("button", { name: "Undo" }).click();
	await undone;
	await expect(filed(page, "Gamma Grocer", "Groceries")).toBeVisible();
	await openTransactions(page);
	await expect(filed(page, "Gamma Grocer", "Groceries")).toBeVisible();

	// Moved again, and left there.
	await row(page, "Gamma Grocer").click();
	await moveTo(page, lastMonthEnd);
	await expect(toast(page, unassigned)).toBeVisible();
	await expect(row(page, "Gamma Grocer")).toHaveCount(0);

	// Not filed anywhere yet: only its day is sent, and it goes.
	await row(page, "Alpha Market").click();
	await moveTo(page, lastMonthEnd);
	// The plain message: nothing was unassigned, so it ends at the month.
	await expect(
		toast(page, new RegExp(`Moved to ${short(lastMonthEnd)} · ${monthOf(lastMonthEnd)}(?!\\.)`)),
	).toBeVisible();
	await expect(row(page, "Alpha Market")).toHaveCount(0);
	// The pane left with its row.
	await expect(page).toHaveURL((url) => url.pathname === thisMonth);
	await expect(dateField(page)).toHaveCount(0);

	await openTransactions(page, lastMonthEnd.slice(0, 7));
	await expect(row(page, "Alpha Market")).toBeVisible();
	// The one that was in Groceries is in last month's list, filed nowhere.
	await expect(filed(page, "Gamma Grocer", "Unassigned")).toBeVisible();

	// Last month is closed: nothing moves out of it.
	await seedSql([
		`insert into month_closes (id, household_id, month) values (${q(ulid())}, ${household()}, ${q(lastMonthEnd.slice(0, 7))})`,
	]);
	await row(page, "Alpha Market").click();
	await expect(bankHint(page)).toContainText(`From your bank: ${short(first)}`);
	await moveTo(page, first);
	await expect(
		toast(page, `${monthOf(lastMonthEnd)} is closed, so nothing moves into or out of it.`),
	).toBeVisible();
	await expect(row(page, "Alpha Market")).toBeVisible();
	await page.context().close();
});

test("on a phone the editor changes a typed-in line's date", async ({ browser }) => {
	test.slow();
	const page = await signedInPage(browser, parent.email, {
		viewport: { width: 393, height: 852 },
		hasTouch: true,
		isMobile: true,
	});
	await createPlannedHousehold(page, { baseline: "6200", buckets: [["Groceries", "800"]] });
	await seed([{ note: "Delta Diner", cents: 2250, date: first, bucket: "Groceries" }]);
	await openTransactions(page);
	await page.getByRole("button", { name: /^Delta Diner,/i }).click();
	await expect(dateField(page)).toHaveText(full(first));
	// Nothing sideways at 393 with the extra field.
	expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(393);
	await moveTo(page, lastMonthEnd);
	// A typed-in line simply changes; filed in a Bucket last month's Plan lacks, it is left
	// unassigned there.
	await expect(
		toast(
			page,
			`Moved to ${short(lastMonthEnd)} · ${monthOf(lastMonthEnd)}. Groceries wasn’t in ${monthOf(lastMonthEnd)}’s Plan, so it isn’t filed anywhere now.`,
		),
	).toBeVisible();
	await expect(page.getByRole("button", { name: /^Delta Diner,/i })).toHaveCount(0);
	await page.context().close();
});
