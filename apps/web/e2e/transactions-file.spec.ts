import { expect, type Page, test } from "@playwright/test";
import { ulid } from "ulid";
import { createTestParent } from "./parents";
import { seedSql } from "./seed-sql";
import { clientRendered, createPlannedHousehold, signedInPage } from "./session";

// "File in…" on the Transactions page's selection bar (issue 99, ADR-0055): many Transactions
// filed in one Bucket at once, what was left said in the message, and its Undo.

let parent: Awaited<ReturnType<typeof createTestParent>>;
test.beforeEach(async () => {
	parent = await createTestParent();
});
test.afterEach(async () => {
	await parent?.remove();
});

const q = (value: string) => `'${value.replaceAll("'", "''")}'`;
const list = (page: Page) =>
	page.getByRole("grid", { name: /^Transactions in / }).locator("[data-slot=data-table-body]");
const line = (page: Page, title: string) =>
	list(page).locator("[data-slot=list-row]").filter({ hasText: title });
const bar = (page: Page) => page.getByRole("region", { name: "Selecting Transactions" });
const toast = (page: Page, text: string) => page.getByRole("status").filter({ hasText: text });
const bucketRow = (page: Page, name: string) =>
	page.getByRole("listitem", { name: new RegExp(`^${name}: `) });

/** Quick Adds this month with these notes and amounts (in cents); `split` in two unassigned parts. */
async function seed(rows: [note: string, cents: number, split?: boolean][]) {
	const household = `(select household_id from members where clerk_user_id = ${q(parent.userId)})`;
	const member = `(select id from members where clerk_user_id = ${q(parent.userId)})`;
	const now = new Date();
	const first = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1)).toISOString().slice(0, 10);
	await seedSql(
		rows.flatMap(([note, cents, split]) => {
			const id = ulid();
			return [
				`insert into transactions (id, household_id, source, date, amount_cents, note, created_by_member_id) values (${q(id)}, ${household}, 'quick-add', ${q(first)}, ${cents}, ${q(note)}, ${member})`,
				...(split
					? [0, 1].map(
							(position) =>
								`insert into splits (id, household_id, transaction_id, position, amount_cents) values (${q(ulid())}, ${household}, ${q(id)}, ${position}, ${cents / 2})`,
						)
					: []),
			];
		}),
	);
}

async function tick(page: Page, titles: string[]) {
	for (const title of titles) await line(page, title).getByRole("checkbox").click();
}

async function fileIn(page: Page, bucket: string) {
	await bar(page).getByRole("button", { name: "File in…" }).click();
	await page.getByRole("option", { name: bucket }).click();
}

test("three ticked, one a Split: File in… files two, says what it skipped, and Undo puts them back", async ({
	browser,
}) => {
	test.slow();
	const page = await signedInPage(browser, parent.email, {
		viewport: { width: 1440, height: 900 },
	});
	await createPlannedHousehold(page, {
		baseline: "6200",
		buckets: [
			["Groceries", "800"],
			["Fun", "200"],
		],
	});
	await seed([
		["zebra apple", 1000],
		["zebra banana", 2000],
		["zebra cherry", 4000, true],
		["yak date", 700],
	]);
	await page.goto("/transactions");
	await expect(page.getByLabel("Search notes and merchants")).toBeEnabled(clientRendered);

	await tick(page, ["zebra apple", "zebra banana", "zebra cherry"]);
	await expect(bar(page).getByRole("status")).toHaveText("3 selected");
	await fileIn(page, "Groceries");
	const filed = toast(page, "Filed 2 in Groceries. 1 skipped: 1 Split.");
	await expect(filed).toBeVisible();
	// The selecting is over, and the rows say where they are now; the others are as they were.
	await expect(bar(page)).toHaveCount(0);
	await expect(line(page, "zebra apple")).toContainText("Groceries");
	await expect(line(page, "zebra banana")).toContainText("Groceries");
	await expect(line(page, "zebra cherry")).not.toContainText("Groceries");
	await expect(line(page, "yak date")).not.toContainText("Groceries");

	// Undo puts the whole batch back.
	await filed.getByRole("button", { name: "Undo" }).click();
	await expect(toast(page, "Put back where they were.")).toBeVisible();
	await expect(line(page, "zebra apple")).not.toContainText("Groceries");
	await expect(line(page, "zebra banana")).not.toContainText("Groceries");

	// Filed again, This Month counts them in the Bucket.
	await tick(page, ["zebra apple", "zebra banana"]);
	await fileIn(page, "Groceries");
	await expect(toast(page, "Filed 2 in Groceries.")).toBeVisible();
	await page.goto("/month");
	await expect(bucketRow(page, "Groceries")).toContainText("$30 spent");
	await page.context().close();
});

test("File in… with a For: the ticked rows are filed For that Child, and Undo puts both back", async ({
	browser,
}) => {
	test.slow();
	const page = await signedInPage(browser, parent.email, {
		viewport: { width: 1440, height: 900 },
	});
	await createPlannedHousehold(page, {
		baseline: "6200",
		buckets: [
			["Groceries", "800"],
			["Fun", "200"],
		],
	});
	const household = `(select household_id from members where clerk_user_id = ${q(parent.userId)})`;
	await seedSql([
		`insert into members (id, household_id, kind, name) values (${q(ulid())}, ${household}, 'child', 'Mia')`,
	]);
	await seed([
		["zebra apple", 1000],
		["zebra banana", 2000],
	]);
	await page.goto("/transactions");
	await expect(page.getByLabel("Search notes and merchants")).toBeEnabled(clientRendered);

	await tick(page, ["zebra apple", "zebra banana"]);
	// For is as each row has it until a Parent says otherwise.
	const as = (name: string) => bar(page).getByRole("button", { name, exact: true });
	await expect(as("As it is")).toHaveAttribute("aria-pressed", "true");
	await as("Mia").click();
	await expect(as("Mia")).toHaveAttribute("aria-pressed", "true");
	await expect(as("As it is")).toHaveAttribute("aria-pressed", "false");
	await fileIn(page, "Groceries");
	const filed = toast(page, "Filed 2 in Groceries, For Mia.");
	await expect(filed).toBeVisible();
	await expect(line(page, "zebra apple")).toContainText("Groceries");

	// Undo puts the Bucket and the For back: filed again For Mia, both are filed anew, not "already there".
	await filed.getByRole("button", { name: "Undo" }).click();
	await expect(toast(page, "Put back where they were.")).toBeVisible();
	await expect(line(page, "zebra apple")).not.toContainText("Groceries");
	await tick(page, ["zebra apple", "zebra banana"]);
	await as("Mia").click();
	await fileIn(page, "Groceries");
	await expect(toast(page, "Filed 2 in Groceries, For Mia.")).toBeVisible();
	// The list is read again, so the next filing goes on the versions this one left.
	await page.reload();
	await expect(page.getByLabel("Search notes and merchants")).toBeEnabled(clientRendered);

	// They are For Mia now: the same filing again finds them already there, a different For does not.
	await tick(page, ["zebra apple", "zebra banana"]);
	await as("Mia").click();
	await fileIn(page, "Groceries");
	await expect(toast(page, "Nothing was filed in Groceries. 2 were already there.")).toBeVisible();
	await tick(page, ["zebra apple", "zebra banana"]);
	await as("Everyone").click();
	await fileIn(page, "Groceries");
	await expect(toast(page, "Filed 2 in Groceries, For Everyone.")).toBeVisible();
	await page.context().close();
});
