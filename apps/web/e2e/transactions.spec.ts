import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { ulid } from "ulid";
import { settledAxe } from "./axe";
import { createTestParent } from "./parents";
import { seedSql } from "./seed-sql";
import {
	accountKindLabel,
	choose,
	clientRendered,
	createPlannedHousehold,
	hydrated,
	pickQuickAddBucket,
	reloadUntil,
	savedBy,
	serverFn,
	signedInPage,
} from "./session";

let parent: Awaited<ReturnType<typeof createTestParent>>;

test.beforeEach(async () => {
	parent = await createTestParent();
});

test.afterEach(async () => {
	await parent?.remove();
});

const plan = {
	baseline: "5,000",
	buckets: [
		["Groceries", "1,200"],
		["Hockey", "400"],
	] as [string, string][],
};

const quickAddSheet = (page: Page) => page.getByRole("dialog", { name: "Quick Add" });
const editSheet = (page: Page) =>
	page
		.locator("[role=dialog], [data-slot=transaction-detail]")
		.filter({ has: page.getByRole("heading", { name: "Edit Transaction" }) });
const nav = (page: Page) => page.getByRole("navigation", { name: "Main" });
const list = (page: Page) =>
	page.getByRole("grid", { name: /^Transactions in / }).locator("[data-slot=data-table-body]");
const row = (page: Page, title: string) =>
	list(page).getByRole("button", { name: new RegExp(`^${title},`) });
const bucketRow = (page: Page, name: string) =>
	page.getByRole("listitem", { name: new RegExp(`^${name}: `) });

/** A Household with Leo as a Child, Buckets planned, and two Quick Adds; ends on This Month. */
async function setUp(page: Page) {
	await createPlannedHousehold(page, plan);
	await page.goto("/household");
	await page.getByLabel("Add a Child").fill("Leo");
	await page.getByRole("button", { name: "Add Child" }).click();
	await expect(page.getByRole("button", { name: "Edit Leo" })).toBeVisible();
	await quickAdd(page, "85.50", "Groceries", "Costco");
	await quickAdd(page, "64.99", "Groceries", "Pro Hockey Life");
	await nav(page).getByRole("link", { name: "This Month" }).click();
	await expect(bucketRow(page, "Groceries")).toContainText("$150.49 spent");
}

async function quickAdd(
	page: Page,
	amount: string,
	bucket: string,
	note: string,
	forName?: string,
) {
	await page.getByRole("link", { name: "Quick Add" }).first().click();
	await expect(quickAddSheet(page)).toBeVisible();
	await page.keyboard.type(amount);
	await quickAddSheet(page).getByLabel("Note").fill(note);
	if (forName) {
		await quickAddSheet(page)
			.getByRole("button", { name: /^For: / })
			.click();
		await quickAddSheet(page)
			.getByRole("radiogroup", { name: "For" })
			.getByRole("radio", { name: forName })
			.click();
	}
	await pickQuickAddBucket(quickAddSheet(page), bucket);
	await expect(quickAddSheet(page)).toBeHidden();
}

async function openTransactions(page: Page) {
	await nav(page).getByRole("link", { name: "Transactions" }).click();
	await expect(page.locator("[data-slot=page-header]:visible")).toContainText("Transactions");
}

test("editing a Transaction reassigns its spending on This Month at once", async ({ browser }) => {
	const page = await signedInPage(browser, parent.email);
	await setUp(page);
	await openTransactions(page);

	// Newest first, under the day they happened.
	await expect(list(page).locator("[data-slot=data-table-group]").first()).toHaveText(/^Today/);
	await expect(list(page).locator("button:not([role=checkbox]):not([data-cell])")).toHaveCount(2);
	await expect(
		list(page).locator("button:not([role=checkbox]):not([data-cell])").first(),
	).toHaveAccessibleName("Pro Hockey Life, $64.99, Groceries, For Everyone");

	await row(page, "Pro Hockey Life").click();
	await expect(editSheet(page)).toBeVisible();
	await editSheet(page).getByLabel("Amount").fill("70");
	await choose(editSheet(page), "Assigned to", "Hockey");
	await editSheet(page)
		.getByRole("toolbar", { name: "For" })
		.getByRole("button", { name: "Leo" })
		.click();
	await editSheet(page).getByLabel("Name").fill("Skates");
	await editSheet(page).getByRole("button", { name: "Save" }).click();
	await expect(editSheet(page)).toBeHidden();
	await expect(row(page, "Skates")).toHaveAccessibleName("Skates, $70, Hockey, For Leo");
	await expect(page.getByRole("status").filter({ hasText: "saved" })).toHaveText(
		"$64.99 (Pro Hockey Life) saved",
	);

	await nav(page).getByRole("link", { name: "This Month" }).click();
	await expect(bucketRow(page, "Groceries")).toContainText("$85.50 spent");
	await expect(bucketRow(page, "Hockey")).toContainText("$70 spent");
	await page.reload();
	await expect(bucketRow(page, "Groceries")).toContainText("$85.50 spent");
	await expect(bucketRow(page, "Hockey")).toContainText("$70 spent");

	// Leo's cost moved with it.
	await page.goto("/reports?view=people");
	await expect(
		page.getByRole("region", { name: "Leo", exact: true }).getByRole("row", { name: /^Total/ }),
	).toHaveText(/Total\$70\$70/, clientRendered);
	await page.context().close();
});

test("a failed edit or delete is undone and can be retried", async ({ browser }) => {
	const page = await signedInPage(browser, parent.email);
	await setUp(page);
	await openTransactions(page);

	const update = serverFn("updateTransaction");
	await page.route(update, (route) => route.fulfill({ status: 500, body: "Server error" }));
	await row(page, "Costco").click();
	await choose(editSheet(page), "Assigned to", "Hockey");
	await editSheet(page).getByRole("button", { name: "Save" }).click();
	const failed = page.getByRole("status").filter({ hasText: "Couldn’t save" });
	await expect(failed).toContainText("Couldn’t save your change to $85.50 (Costco)");
	await expect(row(page, "Costco")).toHaveAccessibleName("Costco, $85.50, Groceries, For Everyone");
	await page.unroute(update);

	const remove = serverFn("deleteTransaction");
	await page.route(remove, (route) => route.fulfill({ status: 500, body: "Server error" }));
	await row(page, "Costco").click();
	await editSheet(page).getByRole("button", { name: "Delete" }).click();
	await page.getByRole("alertdialog").getByRole("button", { name: "Delete Transaction" }).click();
	// Off the toasts: one under the pointer waits, and the delete waits with it.
	await page.mouse.move(0, 0);
	// Said at once, with an Undo; the delete itself is sent once the Undo has gone (#97).
	await expect(
		page.getByRole("status").filter({ hasText: "$85.50 (Costco) deleted" }),
	).toBeVisible();
	const notDeleted = page.getByRole("status").filter({ hasText: "Couldn’t delete" });
	await expect(notDeleted).toContainText("Couldn’t delete $85.50 (Costco), so it’s back.", {
		timeout: 20_000,
	});
	await expect(row(page, "Costco")).toBeVisible();

	await page.unroute(remove);
	await notDeleted.getByRole("button", { name: "Retry" }).click();
	await expect(row(page, "Costco")).toHaveCount(0);
	await expect(list(page).locator("button:not([role=checkbox]):not([data-cell])")).toHaveCount(1);

	await nav(page).getByRole("link", { name: "This Month" }).click();
	await expect(bucketRow(page, "Groceries")).toContainText("$64.99 spent");
	await page.reload();
	await expect(bucketRow(page, "Groceries")).toContainText("$64.99 spent");
	await page.context().close();
});

test("the list filters by Bucket and by who it was For", async ({ browser }) => {
	const page = await signedInPage(browser, parent.email);
	await setUp(page);
	await quickAdd(page, "40", "Hockey", "Ice time", "Leo");
	await openTransactions(page);
	await expect(list(page).locator("button:not([role=checkbox]):not([data-cell])")).toHaveCount(3);
	// The month's total comes from the server, so it counts every page, not just those loaded.
	await expect(page.getByText(/^Spent in /)).toBeVisible();
	await expect(page.getByTestId("month-total")).toHaveText("$190.49");

	await choose(page, "Bucket", "Hockey");
	await expect(page).toHaveURL(/bucket=/);
	await expect(list(page).locator("button:not([role=checkbox]):not([data-cell])")).toHaveCount(1);
	await expect(row(page, "Ice time")).toBeVisible();
	await expect(page.getByText("Total for these filters")).toBeVisible();
	await expect(page.getByTestId("month-total")).toHaveText("$40");

	await choose(page, "Bucket", "All Buckets");
	await choose(page, "For", "Leo");
	await expect(list(page).locator("button:not([role=checkbox]):not([data-cell])")).toHaveCount(1);
	await expect(row(page, "Ice time")).toBeVisible();

	await choose(page, "For", "Everyone (shared)");
	await expect(list(page).locator("button:not([role=checkbox]):not([data-cell])")).toHaveCount(2);
	await expect(row(page, "Ice time")).toHaveCount(0);

	// The filters are in the URL, so a reload keeps them.
	await page.reload();
	await expect(page.getByRole("combobox", { name: "For", exact: true })).toHaveText(
		"Everyone (shared)",
	);
	await expect(list(page).locator("button:not([role=checkbox]):not([data-cell])")).toHaveCount(2);

	await choose(page, "Bucket", "Hockey");
	await expect(page.getByText("Nothing matches")).toBeVisible();
	await page.context().close();
});

test("at 1440 a long list draws every row as the page scrolls, and its card ends with the last one", async ({
	browser,
}) => {
	const page = await signedInPage(browser, parent.email);
	await page.setViewportSize({ width: 1440, height: 900 });
	const created = await createPlannedHousehold(page, plan);
	if (!created) throw new Error("The Household wasn't made directly, so its IDs aren't known");
	const { householdId, parentId, month, bucketIds } = created;
	// 60 rows over a few days: more than a page of 50 and several windows tall.
	// Through the Worker (seedSql): `wrangler d1 execute` was a second process on the SQLite file,
	// and a test running beside this one met "database is locked" (#108).
	const sql = (value: string) => `'${value.replaceAll("'", "''")}'`;
	const days = Math.min(new Date().getDate(), 4);
	await seedSql(
		Array.from({ length: 60 }, (_, index) => {
			const day = String(1 + (index % days)).padStart(2, "0");
			const note = `Row ${String(index + 1).padStart(2, "0")}`;
			// A real ULID: the list's next page is asked for by the last row's ID, which is checked.
			const id = ulid();
			return `insert into transactions (id, household_id, source, date, amount_cents, bucket_id, note, created_by_member_id) values (${sql(id)}, ${sql(householdId)}, 'quick-add', ${sql(`${month}-${day}`)}, ${1_000 + index}, ${sql(bucketIds.Groceries ?? "")}, ${sql(note)}, ${sql(parentId)})`;
		}),
	);
	await page.goto(`/transactions/${month}`);
	await expect(page.locator("[data-slot=page-header]:visible")).toContainText("Transactions");
	const rows = list(page).locator("button:not([role=checkbox]):not([data-cell])");
	await expect(rows.first()).toBeVisible();

	// To the end of the page, again each time a page of rows loads, until all 60 are there.
	await expect
		.poll(
			async () => {
				await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
				return rows.count();
			},
			{ timeout: 20_000 },
		)
		.toBe(60);
	await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
	// The oldest day's rows are drawn and on screen, not a blank stretch of card (#73).
	const oldest = list(page).locator("[data-slot=list-row]").last();
	await expect(oldest).toContainText(/Row/i);
	await expect(oldest).toBeInViewport();
	// No empty stretch under the last row: the card ends within a row of it.
	await expect
		.poll(() =>
			list(page).evaluate((ul) => {
				const items = [...ul.querySelectorAll("[data-slot=list-row]")];
				const last = Math.max(...items.map((li) => li.getBoundingClientRect().bottom));
				const height = items.at(-1)?.getBoundingClientRect().height ?? 0;
				const card = (ul.parentElement ?? ul).getBoundingClientRect().bottom;
				return card - last <= height;
			}),
		)
		.toBe(true);
	// Back at the top the newest rows are still drawn.
	await page.evaluate(() => window.scrollTo(0, 0));
	await expect(rows.first()).toBeInViewport();
	await page.context().close();
});

test("at xl, Date and Amount sort the list", async ({ browser }) => {
	const page = await signedInPage(browser, parent.email);
	await page.setViewportSize({ width: 1440, height: 900 });
	await setUp(page);
	await quickAdd(page, "40", "Hockey", "Ice time", "Leo");
	await openTransactions(page);
	const rows = list(page).locator("button:not([role=checkbox]):not([data-cell])");
	await expect(rows).toHaveText([/Ice time/, /Pro Hockey Life/, /Costco/]);
	await expect(page.getByRole("button", { name: "Date, newest first" })).toHaveAttribute(
		"aria-pressed",
		"true",
	);

	await page.getByRole("button", { name: "Sort by amount" }).click();
	await expect(page).toHaveURL(/sort=largest/);
	await expect(rows).toHaveText([/Costco/, /Pro Hockey Life/, /Ice time/]);
	await page.getByRole("button", { name: "Amount, largest first" }).click();
	await expect(page).toHaveURL(/sort=smallest/);
	await expect(rows).toHaveText([/Ice time/, /Pro Hockey Life/, /Costco/]);
	// Sorting isn't filtering: the total stays the month's.
	await expect(page.getByTestId("month-total")).toHaveText("$190.49");

	await page.getByRole("button", { name: "Sort by date" }).click();
	await expect(page).not.toHaveURL(/sort=/);
	await page.getByRole("button", { name: "Date, newest first" }).click();
	await expect(page).toHaveURL(/sort=oldest/);
	await expect(rows).toHaveText([/Costco/, /Pro Hockey Life/, /Ice time/]);
	await page.context().close();
});

test("at xl, Name, Assigned to and Account sort the list, and the column says which way", async ({
	browser,
}) => {
	const page = await signedInPage(browser, parent.email);
	await page.setViewportSize({ width: 1440, height: 900 });
	await setUp(page);
	await quickAdd(page, "40", "Hockey", "Ice time", "Leo");
	await openTransactions(page);
	const rows = list(page).locator("button:not([role=checkbox]):not([data-cell])");
	const header = (name: RegExp) => page.getByRole("columnheader", { name });
	// The checkbox column and the six columns of words.
	await expect(page.getByRole("columnheader")).toHaveCount(7);
	await expect(header(/^Date/)).toHaveAttribute("aria-sort", "descending");
	await expect(header(/name$/i)).not.toHaveAttribute("aria-sort");

	await page.getByRole("button", { name: "Sort by name" }).click();
	await expect(page).toHaveURL(/sort=name-az/);
	await expect(header(/^Name/)).toHaveAttribute("aria-sort", "ascending");
	await expect(header(/date$/i)).not.toHaveAttribute("aria-sort");
	await expect(rows).toHaveText([/Costco/, /Ice time/, /Pro Hockey Life/]);
	await page.getByRole("button", { name: "Name, A to Z" }).click();
	await expect(page).toHaveURL(/sort=name-za/);
	await expect(header(/^Name/)).toHaveAttribute("aria-sort", "descending");
	await expect(rows).toHaveText([/Pro Hockey Life/, /Ice time/, /Costco/]);
	// The order is in the address, so a reload keeps it.
	await page.reload();
	await expect(header(/^Name/)).toHaveAttribute("aria-sort", "descending");
	await expect(rows).toHaveText([/Pro Hockey Life/, /Ice time/, /Costco/]);

	// Groceries before Hockey; the two in Groceries stay oldest first.
	await page.getByRole("button", { name: "Sort by assigned to" }).click();
	await expect(page).toHaveURL(/sort=assigned-az/);
	await expect(header(/^Assigned to/)).toHaveAttribute("aria-sort", "ascending");
	await expect(rows).toHaveText([/Costco/, /Pro Hockey Life/, /Ice time/]);
	await page.getByRole("button", { name: "Sort by account" }).click();
	await expect(page).toHaveURL(/sort=account-az/);
	await expect(header(/^Account/)).toHaveAttribute("aria-sort", "ascending");
	await expect(rows).toHaveCount(3);
	// Sorting isn't filtering: the total stays the month's.
	await expect(page.getByTestId("month-total")).toHaveText("$190.49");
	const results = await (await settledAxe(page))
		.withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
		.analyze();
	expect(results.violations.map((violation) => violation.id)).toEqual([]);
	await page.context().close();
});

test("on a phone, a Sort menu beside Filters orders the list and the address keeps it", {
	tag: "@phone",
}, async ({ browser }) => {
	const page = await signedInPage(browser, parent.email, {
		viewport: { width: 393, height: 852 },
		isMobile: true,
		hasTouch: true,
	});
	// The Household is made at desktop width, where the helpers' links are.
	await page.setViewportSize({ width: 1280, height: 900 });
	await setUp(page);
	await page.setViewportSize({ width: 393, height: 852 });
	await page.goto("/transactions");
	const rows = list(page).locator("button:not([role=checkbox]):not([data-cell])");
	await expect(rows).toHaveText([/Pro Hockey Life/, /Costco/]);
	// No column names to sort by at this width.
	await expect(page.getByRole("columnheader")).toHaveCount(0);

	const sort = page.getByRole("combobox", { name: "Sort", exact: true });
	await expect(sort).toHaveText("Newest first");
	const box = await sort.boundingBox();
	expect(box?.height).toBeGreaterThanOrEqual(44);
	await sort.click();
	const options = page.getByRole("listbox").getByRole("option");
	await expect(options).toHaveText([
		"Newest first",
		"Oldest first",
		"Largest first",
		"Smallest first",
		"Name A–Z",
		"Name Z–A",
		"Assigned to A–Z",
		"Assigned to Z–A",
		"Account A–Z",
		"Account Z–A",
	]);
	// The open menu itself: while it is open the page behind it is hidden from assistive tech.
	const open = await (await settledAxe(page))
		.include("[role=listbox]")
		.withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
		.analyze();
	expect(open.violations.map((violation) => violation.id)).toEqual([]);
	await options.filter({ hasText: "Name A–Z" }).click();
	await expect(page.getByRole("listbox")).toBeHidden();
	await expect(page).toHaveURL(/sort=name-az/);
	await expect(sort).toHaveText("Name A–Z");
	await expect(rows).toHaveText([/Costco/, /Pro Hockey Life/]);

	await page.reload();
	await expect(page).toHaveURL(/sort=name-az/);
	await expect(sort).toHaveText("Name A–Z");
	await expect(rows).toHaveText([/Costco/, /Pro Hockey Life/]);
	await choose(page, "Sort", "Largest first");
	await expect(page).toHaveURL(/sort=largest/);
	await expect(rows).toHaveText([/Costco/, /Pro Hockey Life/]);
	await choose(page, "Sort", "Newest first");
	await expect(page).not.toHaveURL(/sort=/);

	// Nothing scrolls sideways, down to the narrowest phone.
	for (const width of [393, 320]) {
		await page.setViewportSize({ width, height: 852 });
		await expect(sort).toBeVisible();
		expect(
			await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
		).toBe(false);
	}
	await page.context().close();
});

test("the list searches notes, and the editor says what's missing before it saves", async ({
	browser,
}) => {
	const page = await signedInPage(browser, parent.email);
	await setUp(page);
	await openTransactions(page);

	await page.getByLabel("Search notes and merchants").fill("hockey");
	await expect(page).toHaveURL(/q=hockey/);
	await expect(list(page).locator("button:not([role=checkbox]):not([data-cell])")).toHaveCount(1);
	await expect(row(page, "Pro Hockey Life")).toBeVisible();
	await page.reload();
	await expect(page.getByLabel("Search notes and merchants")).toHaveValue("hockey");
	await expect(list(page).locator("button:not([role=checkbox]):not([data-cell])")).toHaveCount(1);
	await page.getByLabel("Search notes and merchants").fill("");
	await expect(list(page).locator("button:not([role=checkbox]):not([data-cell])")).toHaveCount(2);

	// An empty amount is said beside the form, not by the browser, and nothing is saved.
	await row(page, "Costco").click();
	await editSheet(page).getByLabel("Amount").fill("");
	await editSheet(page).getByRole("button", { name: "Save" }).click();
	await expect(editSheet(page).getByRole("alert")).toHaveText(
		"Enter the amount in dollars, like 12 or 85.50.",
	);
	await expect(editSheet(page).getByLabel("Amount")).toHaveAttribute("aria-invalid", "true");
	// Closing it gives focus back to the row it was opened from.
	await page.keyboard.press("Escape");
	await expect(editSheet(page)).toBeHidden();
	await expect(row(page, "Costco")).toBeFocused();
	await expect(row(page, "Costco")).toHaveAccessibleName("Costco, $85.50, Groceries, For Everyone");
	await page.context().close();
});

test("an Account lists its Transactions, and Transactions filters by it", async ({ browser }) => {
	const page = await signedInPage(browser, parent.email);
	await setUp(page);
	await quickAdd(page, "12", "Hockey", "Chipotle");

	// A card whose statement has Costco's bank copy, a tipped Chipotle, and Trader Joe's.
	await page.getByRole("link", { name: "Accounts", exact: true }).click();
	await page.getByLabel("Name").fill("Visa");
	await choose(page, "Kind", accountKindLabel("credit-card"));
	await page.getByLabel("Owed now").fill("800");
	await page.getByRole("button", { name: "Add Account" }).click();
	await page.getByRole("link", { name: /^Visa, / }).click();
	const today = await page.evaluate(() => new Date().toLocaleDateString("en-US"));
	const csv = [
		"Transaction Date,Description,Debit,Credit",
		`${today},COSTCO WHSE #1042,85.50,`,
		`${today},CHIPOTLE 1234,14.40,`,
		`${today},TRADER JOE'S #552,42.17,`,
	].join("\n");
	await page.getByRole("button", { name: "Upload statement" }).click();
	const upload = page.getByRole("dialog", { name: "Upload a statement" });
	await upload
		.getByLabel("Statement file")
		.setInputFiles({ name: "visa.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
	await upload.getByRole("button", { name: "Import 3 lines" }).click();
	await expect(upload).toBeHidden();

	// The Account's page lists them: Costco as its Matched Quick Add, the others as brought in.
	const latest = page.getByRole("list", { name: "Latest Transactions in Visa" });
	await expect(latest.getByRole("button")).toHaveCount(3);
	await expect(
		latest.getByRole("button", {
			name: /^Costco, \$85\.50, Groceries, For Everyone, Matched in Visa$/,
		}),
	).toBeVisible();
	await expect(latest.getByRole("button", { name: /^Trader Joe/i })).toBeVisible();

	// Matching keeps what was typed in the editor: the note is saved with the Match.
	await page.getByRole("link", { name: "All in Transactions" }).click();
	await expect(page).toHaveURL(/account=/);
	await expect(page.getByRole("combobox", { name: "Account", exact: true })).not.toHaveText(
		"All Accounts",
	);
	await expect(list(page).locator("button:not([role=checkbox]):not([data-cell])")).toHaveCount(3);
	await choose(page, "Account", "All Accounts");
	await expect(row(page, "Pro Hockey Life")).toHaveAccessibleName(
		"Pro Hockey Life, $64.99, Groceries, For Everyone, waiting for the bank’s copy",
	);
	// Its "Waiting for bank" badge is whole from 1280px; under that it is a dot with the words in
	// a tooltip, so the name beside it isn't cut (issue 120). The row's name says it either way.
	const waitingRow = list(page)
		.getByRole("row")
		.filter({ has: page.getByRole("button", { name: /^Pro Hockey Life,/ }) });
	// The badge is its words' parent (as the tooltip's trigger it has that slot's name, not a badge's).
	const waitingWords = waitingRow.getByText("Waiting for bank", { exact: true });
	const waitingBadge = waitingWords.locator("xpath=..");
	const waitingTip = page.locator("[data-slot=tooltip-content]", { hasText: "Waiting for bank" });
	const nameCut = () =>
		row(page, "Pro Hockey Life")
			.locator("span.truncate")
			.evaluate((node) => node.scrollWidth > node.clientWidth);
	for (const width of [1440, 1280, 1279, 1024]) {
		await page.setViewportSize({ width, height: 720 });
		await expect(waitingBadge).toBeVisible();
		const box = await waitingBadge.boundingBox();
		await page.mouse.move(0, 0);
		await waitingBadge.hover();
		if (width >= 1280) {
			expect(box?.width).toBeGreaterThan(80);
			expect((await waitingWords.boundingBox())?.width).toBeGreaterThan(60);
			await expect(waitingTip).toBeHidden();
		} else {
			expect(box?.width).toBe(18);
			expect(box?.height).toBe(18);
			await expect(waitingTip).toBeVisible();
			expect(await nameCut()).toBe(false);
		}
		await expect(row(page, "Pro Hockey Life")).toHaveAccessibleName(/waiting for the bank’s copy$/);
	}
	await page.mouse.move(0, 0);
	await page.setViewportSize({ width: 1280, height: 720 });
	// The bank's copy is named "Chipotle" too: open the Quick Add.
	await list(page)
		.getByRole("button", { name: /^Chipotle, \$12,/ })
		.click();
	await editSheet(page).getByLabel("Name").fill("Chipotle lunch");
	const possible = editSheet(page).getByRole("region", { name: "Possible match" });
	await possible.getByRole("button", { name: /^Match with chipotle( 1234)?, \$14\.40/i }).click();
	await expect(editSheet(page)).toBeHidden();
	await expect(row(page, "Chipotle lunch")).toHaveAccessibleName(
		"Chipotle lunch, $12, Hockey, For Everyone, Matched in Visa",
	);
	await page.reload();
	await expect(row(page, "Chipotle lunch")).toHaveAccessibleName(
		"Chipotle lunch, $12, Hockey, For Everyone, Matched in Visa",
	);
	await page.context().close();
});

test("on a phone, Transactions is in the tab bar either side of Quick Add", {
	tag: "@phone",
}, async ({ browser }) => {
	const page = await signedInPage(browser, parent.email, {
		viewport: { width: 393, height: 852 },
		isMobile: true,
		hasTouch: true,
	});
	await createPlannedHousehold(page, plan);
	await expect(nav(page).getByRole("link")).toHaveText([
		"Month",
		"Transactions",
		"Quick Add",
		"Goals",
		"More",
	]);
	await nav(page).getByRole("link", { name: "Transactions" }).tap();
	await expect(page.locator("[data-slot=page-header]:visible")).toContainText("Transactions");
	await expect(page.getByText(/^No Transactions in /)).toBeVisible();
	// It says how to get some in.
	await expect(
		page.getByRole("link", { name: "Connect a bank or upload a statement" }),
	).toBeVisible();
	await expect(page.getByRole("main").getByRole("link", { name: "Quick Add" })).toBeVisible();
	const overflows = await page.evaluate(
		() => document.documentElement.scrollWidth > window.innerWidth,
	);
	expect(overflows).toBe(false);
	await page.context().close();
});

test("a Transaction from the bank is renamed, its others follow when asked, and the bank's name comes back", async ({
	browser,
}) => {
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, plan);
	// An Account with a statement in it: two lines from the same coffee shop ("STUMPTOWN COFFEE").
	// Dated today: the Plan's Buckets are this month's, so an earlier month has none to assign to.
	const today = await page.evaluate(() =>
		new Date().toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" }),
	);
	const statement = readFileSync(
		join(
			import.meta.dirname,
			"..",
			"..",
			"..",
			"packages",
			"domain",
			"fixtures",
			"statements",
			"checking.csv",
		),
		"utf8",
	).replace(/\b\d\d\/\d\d\/\d{4}\b/g, today);
	await page.getByRole("link", { name: "Accounts", exact: true }).click();
	await expect(page.getByRole("heading", { level: 1 })).toHaveText("Accounts");
	await page.getByLabel("Name").fill("Everyday Checking");
	await choose(page, "Kind", accountKindLabel("checking"));
	await page.getByLabel("Balance now").fill("2,500");
	await page.getByRole("button", { name: "Add Account" }).click();
	await page.getByRole("link", { name: /^Everyday Checking, / }).click();
	await expect(page.locator("[data-slot=detail-title]")).toContainText("Everyday Checking");
	await page.getByRole("button", { name: "Upload statement" }).click();
	const upload = page.getByRole("dialog", { name: "Upload a statement" });
	await upload
		.getByLabel("Statement file")
		.setInputFiles({ name: "checking.csv", mimeType: "text/csv", buffer: Buffer.from(statement) });
	await upload.getByRole("button", { name: "Import 6 lines" }).click();
	await expect(upload).toBeHidden();

	const called = (name: string) =>
		page.getByRole("button", { name: new RegExp(`^${name}, \\$4\\.50,`, "i") });
	await reloadUntil(page, page.url().replace(/\/accounts\/.*$/, "/transactions"), () =>
		expect(called("Stumptown Coffee")).toHaveCount(2, { timeout: 2_000 }),
	);
	// Rows open their detail once the page is hydrated.
	await expect(page.getByLabel("Bucket")).toBeEnabled();

	// The name is the first field; the bank's own wording stays underneath once it differs.
	await called("Stumptown Coffee").first().click();
	await expect(editSheet(page).getByLabel("Name")).toHaveValue("Stumptown Coffee");
	await editSheet(page).getByLabel("Name").fill("Morning coffee");
	await expect(editSheet(page).getByText("From your bank: STUMPTOWN COFFEE")).toBeVisible();
	await choose(editSheet(page), "Assigned to", "Groceries");
	await editSheet(page).getByRole("button", { name: "Save" }).click();
	await expect(editSheet(page)).toBeHidden();
	await expect(called("Morning coffee")).toHaveCount(1);

	// Offered once, in plain words; taking it renames the other and is remembered.
	const offer = page
		.getByRole("status")
		.filter({ hasText: "Call every Stumptown Coffee “Morning coffee”? 1 other" });
	await expect(offer).toBeVisible();
	await offer.getByRole("button", { name: "Rename all" }).click();
	await expect(
		page.getByRole("status").filter({ hasText: "1 more now called “Morning coffee”" }),
	).toBeVisible();
	await expect(called("Morning coffee")).toHaveCount(2);
	await page.reload();
	await expect(called("Morning coffee")).toHaveCount(2);
	await expect(called("Stumptown Coffee")).toHaveCount(0);
	// Found by its new name and by the bank's wording.
	await page.getByLabel("Search notes and merchants").fill("morning");
	await expect(called("Morning coffee")).toHaveCount(2);
	await page.getByLabel("Search notes and merchants").fill("stumptown");
	await expect(called("Morning coffee")).toHaveCount(2);
	await page.getByLabel("Search notes and merchants").fill("");

	// "Use the bank's name" puts one back; the other keeps the Parent's.
	await expect(page.getByLabel("Bucket")).toBeEnabled();
	await page
		.getByRole("button", { name: /^Morning coffee, \$4\.50, Groceries/ })
		.first()
		.click();
	await expect(editSheet(page).getByText("From your bank: STUMPTOWN COFFEE")).toBeVisible();
	await editSheet(page).getByRole("button", { name: "Use the bank’s name" }).click();
	await expect(editSheet(page).getByLabel("Name")).toHaveValue("Stumptown Coffee");
	await editSheet(page).getByRole("button", { name: "Save" }).click();
	await expect(editSheet(page)).toBeHidden();
	await expect(called("Stumptown Coffee")).toHaveCount(1);
	await expect(called("Morning coffee")).toHaveCount(1);
	await page.reload();
	await expect(called("Stumptown Coffee")).toHaveCount(1);
	await expect(called("Morning coffee")).toHaveCount(1);
	await page.context().close();
});

// Editing in a cell of the table (issue 99): where it shows columns, not on stacked rows.
const renameButton = (page: Page, title: string) =>
	list(page).getByRole("button", { name: `Rename ${title}`, exact: true });
const nameField = (page: Page, title: string) =>
	list(page).getByRole("textbox", { name: `Name of ${title}` });
const refileButton = (page: Page, title: string, now: string) =>
	list(page).getByRole("button", { name: `Refile ${title}, now ${now}`, exact: true });
const said = (page: Page, text: string | RegExp) =>
	page.getByRole("status").filter({ hasText: text });

test("a Transaction is renamed in its Name cell: Esc gives up, Enter saves, and the name is there after a reload", async ({
	browser,
}) => {
	const page = await signedInPage(browser, parent.email);
	await setUp(page);
	await openTransactions(page);

	// Esc gives the edit up: the name is as it was, and focus is back on the cell's button.
	await renameButton(page, "Costco").click();
	await expect(nameField(page, "Costco")).toBeFocused();
	await expect(nameField(page, "Costco")).toHaveValue("Costco");
	await nameField(page, "Costco").fill("Never mind");
	await page.keyboard.press("Escape");
	await expect(nameField(page, "Costco")).toHaveCount(0);
	await expect(row(page, "Costco")).toBeVisible();
	await expect(renameButton(page, "Costco")).toBeFocused();

	// F2 on the row starts it too; Enter saves, and nothing else about the row changes.
	await row(page, "Costco").locator("xpath=ancestor::*[@data-slot='list-row']").focus();
	await page.keyboard.press("F2");
	await nameField(page, "Costco").fill("Costco run");
	const saved = savedBy(page, "updateTransaction");
	await page.keyboard.press("Enter");
	await saved;
	await expect(row(page, "Costco run")).toHaveAccessibleName(
		"Costco run, $85.50, Groceries, For Everyone",
	);
	await expect(said(page, "Renamed")).toContainText("Renamed to “Costco run”");
	// The row did not open: renaming is not opening.
	await expect(editSheet(page)).toBeHidden();

	// Leaving the field saves as well.
	await renameButton(page, "Pro Hockey Life").click();
	await nameField(page, "Pro Hockey Life").fill("Skates");
	const blurred = savedBy(page, "updateTransaction");
	await page.locator("[data-slot=page-header]:visible").click();
	await blurred;
	await expect(row(page, "Skates")).toBeVisible();

	await page.reload();
	await expect(row(page, "Costco run")).toHaveAccessibleName(
		"Costco run, $85.50, Groceries, For Everyone",
	);
	await expect(row(page, "Skates")).toBeVisible();
	await page.context().close();
});

test("a Transaction is refiled in its Assigned to cell, Undo puts it back, and This Month's Buckets move", async ({
	browser,
}) => {
	const page = await signedInPage(browser, parent.email);
	await setUp(page);
	await openTransactions(page);

	const refile = async (from: string, to: string) => {
		await refileButton(page, "Pro Hockey Life", from).click();
		const saved = savedBy(page, "updateTransaction");
		await page.getByRole("option", { name: to, exact: true }).click();
		await saved;
	};
	await refile("Groceries", "Hockey");
	await expect(row(page, "Pro Hockey Life")).toHaveAccessibleName(
		"Pro Hockey Life, $64.99, Hockey, For Everyone",
	);
	await expect(said(page, "filed in")).toContainText("Pro Hockey Life filed in Hockey");
	await expect(editSheet(page)).toBeHidden();

	// Undo writes it back where it was.
	const undone = savedBy(page, "updateTransaction");
	await said(page, "filed in").getByRole("button", { name: "Undo" }).click();
	await undone;
	await expect(row(page, "Pro Hockey Life")).toHaveAccessibleName(
		"Pro Hockey Life, $64.99, Groceries, For Everyone",
	);

	await refile("Groceries", "Hockey");
	await nav(page).getByRole("link", { name: "This Month" }).click();
	await expect(bucketRow(page, "Groceries")).toContainText("$85.50 spent");
	await expect(bucketRow(page, "Hockey")).toContainText("$64.99 spent");
	await page.reload();
	await expect(bucketRow(page, "Hockey")).toContainText("$64.99 spent");
	await page.context().close();
});

test("a Bucket is created from the Assigned to cell's picker, and the Transaction is filed in it", async ({
	browser,
}) => {
	const page = await signedInPage(browser, parent.email);
	await setUp(page);
	await openTransactions(page);

	await refileButton(page, "Pro Hockey Life", "Groceries").click();
	await page.getByPlaceholder("Search or create").fill("Skates");
	await page.getByRole("option", { name: "Create Bucket “Skates”" }).click();

	const step = page.getByRole("dialog", { name: "New Bucket" });
	await expect(step.getByLabel("Name")).toHaveValue("Skates");
	// Naming the Bucket opened neither the row nor its editor.
	await expect(editSheet(page)).toBeHidden();
	const saved = savedBy(page, "updateTransaction");
	await step.getByRole("button", { name: "Create and file here" }).click();
	await saved;
	await expect(step).toBeHidden();
	await expect(row(page, "Pro Hockey Life")).toHaveAccessibleName(
		"Pro Hockey Life, $64.99, Skates, For Everyone",
	);
	await expect(said(page, "filed in")).toContainText("Pro Hockey Life filed in Skates");
	await expect(editSheet(page)).toBeHidden();

	// The new Bucket is in the Plan with the Transaction in it, and stays after a reload.
	await page.reload();
	await expect(refileButton(page, "Pro Hockey Life", "Skates")).toBeVisible();
	await nav(page).getByRole("link", { name: "This Month" }).click();
	await expect(bucketRow(page, "Skates")).toContainText("$64.99 spent");
	await page.context().close();
});

test("a cell's change made on a Transaction another screen has changed since is left out: the cell shows how it is now", async ({
	browser,
}) => {
	test.slow();
	const page = await signedInPage(browser, parent.email);
	await setUp(page);
	await openTransactions(page);
	await page.waitForURL(/\/transactions\//);
	await expect(row(page, "Costco")).toBeVisible();
	// From here this screen hears nothing new about its rows, as a laptop asleep wouldn't.
	await page.route(serverFn("getTransactions"), (route) => route.abort());

	// Another screen in the same Household renames it.
	const other = await signedInPage(browser, parent.email);
	await other.goto(page.url());
	await hydrated(renameButton(other, "Costco"));
	await renameButton(other, "Costco").click();
	await nameField(other, "Costco").fill("Big shop");
	const renamed = savedBy(other, "updateTransaction");
	await other.keyboard.press("Enter");
	await renamed;

	// This screen refiles the row it still shows as it was: refused, said once, and the cell is
	// back to Groceries on the row as the other screen left it.
	await refileButton(page, "Costco", "Groceries").click();
	await page.getByRole("option", { name: "Hockey", exact: true }).click();
	await expect(said(page, "changed on another screen")).toHaveCount(1);
	await expect(row(page, "Big shop")).toHaveAccessibleName(
		"Big shop, $85.50, Groceries, For Everyone",
	);
	await expect(refileButton(page, "Big shop", "Groceries")).toBeVisible();

	await page.unroute(serverFn("getTransactions"));
	await other.context().close();
	await page.context().close();
});

/** `n` months before a month, as its key. */
const monthsBefore = (month: string, n: number) => {
	const [year = 1970, m = 1] = month.split("-").map(Number);
	const date = new Date(Date.UTC(year, m - 1 - n, 1));
	return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
};

/** A planned Household with a Transaction this month, two last month, one two months back and one five. */
async function setUpMonths(page: Page) {
	const created = await createPlannedHousehold(page, plan);
	if (!created) throw new Error("The Household wasn't made directly, so its IDs aren't known");
	const { householdId, parentId, month, bucketIds } = created;
	const sql = (value: string) => `'${value.replaceAll("'", "''")}'`;
	const rows: [note: string, back: number, cents: number, bucket: string][] = [
		["Now A", 0, 1_000, "Groceries"],
		["Last B", 1, 2_000, "Groceries"],
		["Last C", 1, 500, "Hockey"],
		["Older D", 2, 4_000, "Groceries"],
		["Far E", 5, 8_000, "Groceries"],
	];
	await seedSql([
		// The Buckets were planned this month: here they have been in the Plan for half a year, so
		// an earlier month's Transaction has that month's Buckets to be filed in.
		`update buckets set from_month = ${sql(monthsBefore(month, 6))} where household_id = ${sql(householdId)}`,
		...rows.map(
			([note, back, cents, bucket]) =>
				`insert into transactions (id, household_id, source, date, amount_cents, bucket_id, note, created_by_member_id) values (${sql(ulid())}, ${sql(householdId)}, 'quick-add', ${sql(`${monthsBefore(month, back)}-01`)}, ${cents}, ${sql(bucketIds[bucket] ?? "")}, ${sql(note)}, ${sql(parentId)})`,
		),
	]);
	return { month };
}

test("more than a month: the range changes the rows, their month headings and the total, and its link shows it again", async ({
	browser,
}) => {
	const page = await signedInPage(browser, parent.email);
	await page.setViewportSize({ width: 1440, height: 900 });
	const { month } = await setUpMonths(page);
	await page.goto(`/transactions/${month}`);
	const rows = list(page).locator("button:not([role=checkbox]):not([data-cell])");
	const headings = list(page).locator("[data-slot=list-month-label]");
	await expect(rows).toHaveCount(1);
	await expect(page.getByTestId("month-total")).toHaveText("$10");
	await expect(headings).toHaveCount(0);

	// The last 3 months, ending at the month in the address: each month under its name.
	await hydrated(page.getByLabel("Months"));
	await choose(page, "Months", "Last 3 months");
	await expect(page).toHaveURL(/range=3m/);
	await expect(rows).toHaveCount(4);
	await expect(headings).toHaveCount(3);
	await expect(page.getByText(/^Spent \w{3}( \d{4})? – \w{3} \d{4}$/)).toBeVisible();
	await expect(page.getByTestId("month-total")).toHaveText("$75");
	// A row of another month names its Bucket.
	await expect(row(page, "Last C")).toHaveAccessibleName(/^Last C, \$5, Hockey/);

	await choose(page, "Months", "All time");
	await expect(page).toHaveURL(/range=all/);
	await expect(rows).toHaveCount(5);
	await expect(page.getByText("Spent, all time")).toBeVisible();
	await expect(page.getByTestId("month-total")).toHaveText("$155");

	// The address alone shows the same list, and a filter and an order work over all of it.
	await page.goto(`/transactions/${month}?range=3m`);
	await expect(rows).toHaveCount(4);
	await expect(page.getByTestId("month-total")).toHaveText("$75");
	await hydrated(page.getByLabel("Bucket"));
	await choose(page, "Bucket", "Hockey");
	await expect(rows).toHaveCount(1);
	await expect(row(page, "Last C")).toBeVisible();
	await expect(page.getByText(/^These filters, /)).toBeVisible();
	await expect(page.getByTestId("month-total")).toHaveText("$5");

	await page.goto(`/transactions/${month}?range=3m&sort=largest`);
	await expect(rows).toHaveCount(4);
	await expect(rows.first()).toHaveAccessibleName(/^Older D,/);
	await expect(rows.last()).toHaveAccessibleName(/^Last C,/);
	// By amount the months are mixed: no month headings.
	await expect(headings).toHaveCount(0);

	// The month arrows keep the range: one month back, the last 3 months end there.
	await page.goto(`/transactions/${monthsBefore(month, 1)}?range=3m`);
	await expect(rows).toHaveCount(3);
	await expect(page.getByTestId("month-total")).toHaveText("$65");
	await page.context().close();
});

test("more than a month: a row of another month is refiled where it is, in its own month's Plan, and that month's Buckets move", async ({
	browser,
}) => {
	const page = await signedInPage(browser, parent.email);
	await page.setViewportSize({ width: 1440, height: 900 });
	const { month } = await setUpMonths(page);
	await page.goto(`/transactions/${month}?range=3m`);
	await hydrated(page.getByLabel("Months"));
	await refileButton(page, "Last B", "Groceries").click();
	const saved = savedBy(page, "updateTransaction");
	await page.getByRole("option", { name: "Hockey", exact: true }).click();
	await saved;
	await expect(row(page, "Last B")).toHaveAccessibleName(/^Last B, \$20, Hockey/);
	// Still the list of three months, at its address.
	await expect(page).toHaveURL(/range=3m/);
	await expect(list(page).locator("[data-slot=list-month-label]")).toHaveCount(3);

	await page.goto(`/month/${monthsBefore(month, 1)}`);
	await expect(bucketRow(page, "Hockey")).toContainText("$25 spent");
	await page.context().close();
});

test("a month that is over: its row's picker finds its Buckets but offers no new one, and says why", async ({
	browser,
}) => {
	const page = await signedInPage(browser, parent.email);
	await page.setViewportSize({ width: 1440, height: 900 });
	const { month } = await setUpMonths(page);
	await page.goto(`/transactions/${month}?range=3m`);
	await hydrated(page.getByLabel("Months"));
	const refile = (title: string) =>
		list(page).getByRole("button", { name: new RegExp(`^Refile ${title}, now `) });

	// Last month's Plan is closed: its Buckets can be searched, and nothing can be created in it.
	await refile("Last B").click();
	await expect(page.getByPlaceholder("Search or create")).toHaveCount(0);
	await page.getByPlaceholder("Find a Bucket").fill("Skates");
	await expect(page.getByText(PAST_PLAN)).toBeVisible();
	await expect(page.getByRole("option")).toHaveCount(0);
	await page.getByPlaceholder("Find a Bucket").fill("Hock");
	await expect(page.getByRole("option")).toHaveText(["Hockey"]);
	await page.keyboard.press("Escape");

	// This month's still offers a new Bucket by the name typed.
	await refile("Now A").click();
	await page.getByPlaceholder("Search or create").fill("Skates");
	await expect(page.getByRole("option", { name: "Create Bucket “Skates”" })).toBeVisible();
	await page.context().close();
});

test("more than a month: all in the range are selected and deleted across its months, and File in… is off with its reason", async ({
	browser,
}) => {
	const page = await signedInPage(browser, parent.email);
	await page.setViewportSize({ width: 1440, height: 900 });
	const { month } = await setUpMonths(page);
	await page.goto(`/transactions/${month}?range=3m`);
	await hydrated(page.getByLabel("Months"));
	const rows = list(page).locator("button:not([role=checkbox]):not([data-cell])");
	await expect(rows).toHaveCount(4);
	const bar = page.getByRole("region", { name: "Selecting Transactions" });
	const box = (title: string) =>
		list(page).getByRole("checkbox", { name: new RegExp(`^Select ${title},`, "i") });

	// One tick, then everything in the three months.
	await box("Now A").click();
	await expect(bar).toContainText("1 selected");
	await bar.getByRole("button", { name: /^Select all 4 in \w{3}( \d{4})? – \w{3} \d{4}$/ }).click();
	await expect(bar).toContainText("4 selected");
	await expect(box("Older D")).toBeChecked();

	// Filing is one month at a time: the button is off and says why.
	const fileIn = bar.getByRole("button", { name: "File in…" });
	await expect(fileIn).toBeDisabled();
	await expect(fileIn).toHaveAttribute(
		"title",
		"Transactions are filed one month at a time: show This month to file these",
	);

	// All but one, from three different months, are deleted together.
	await box("Last C").click();
	await expect(bar).toContainText("3 selected");
	await bar.getByRole("button", { name: "Delete" }).click();
	const sheet = page.getByRole("dialog", { name: "Delete 3 Transactions?" });
	await expect(sheet).toContainText("adding up to $70.");
	await sheet.getByRole("button", { name: "Delete 3 Transactions" }).click();
	await expect(said(page, "Deleted 3 Transactions.")).toBeVisible();
	await expect(bar).toHaveCount(0);
	await expect(rows).toHaveCount(1);
	await expect(row(page, "Last C")).toBeVisible();

	// The one left out of the range (five months back) is still there.
	await page.goto(`/transactions/${month}?range=all`);
	await expect(rows).toHaveCount(2);
	await expect(row(page, "Far E")).toBeVisible();
	await page.context().close();
});

/**
 * A planned Household whose Buckets start this month, with a Transaction four months back, before
 * its first Plan (issue 117): unassigned and waiting in Review, as imported bank history is.
 */
async function setUpBeforePlan(page: Page) {
	const created = await createPlannedHousehold(page, plan);
	if (!created) throw new Error("The Household wasn't made directly, so its IDs aren't known");
	const { householdId, parentId, month } = created;
	const sql = (value: string) => `'${value.replaceAll("'", "''")}'`;
	const old = ulid();
	const before = monthsBefore(month, 4);
	await seedSql([
		`insert into transactions (id, household_id, source, date, amount_cents, note, created_by_member_id) values (${sql(old)}, ${sql(householdId)}, 'quick-add', ${sql(`${before}-10`)}, 4200, 'Old F', ${sql(parentId)})`,
		`insert into categorizations (transaction_id, household_id, member_id, outcome, merchant, created_at) values (${sql(old)}, ${sql(householdId)}, ${sql(parentId)}, 'review', 'old f', unixepoch() * 1000)`,
		`insert into transactions (id, household_id, source, date, amount_cents, note, created_by_member_id) values (${sql(ulid())}, ${sql(householdId)}, 'quick-add', ${sql(`${month}-01`)}, 1000, 'Now A', ${sql(parentId)})`,
	]);
	return { month, before };
}

const PAST_PLAN =
	/^Nothing in \w+( \d{4})? matches, and a past month’s Plan can’t be given a new Bucket\.$/;
const NO_BUCKETS =
	/^\w+( \d{4})? had no Buckets yet\. Transactions from before your Plan can stay Unassigned, or file this one without a Bucket\.$/;

test("a Transaction from before the first Plan: its picker says the month had no Buckets, and it is filed without a Bucket and leaves Review", async ({
	browser,
}) => {
	const page = await signedInPage(browser, parent.email);
	await page.setViewportSize({ width: 1440, height: 900 });
	const { month } = await setUpBeforePlan(page);
	await page.goto(`/transactions/${month}?range=all`);
	await hydrated(page.getByLabel("Months"));
	const waits = nav(page).getByRole("link", { name: "1 to review" });
	await expect(waits).toBeVisible();
	const refile = (title: string) =>
		list(page).getByRole("button", { name: new RegExp(`^Refile ${title}, now `) });
	const note = page.getByTestId("no-buckets");

	// A month with Buckets keeps its picker: a search, the Buckets, and a new one by name.
	await refile("Now A").click();
	await expect(page.getByPlaceholder("Search or create")).toBeVisible();
	await expect(page.getByRole("option", { name: "Groceries", exact: true })).toBeVisible();
	await expect(note).toHaveCount(0);
	await page.keyboard.press("Escape");

	// The month before the Plan: one sentence instead of an empty list, and nothing to search or
	// create (a past month's Plan can't be given a Bucket).
	await refile("Old F").click();
	await expect(note.getByRole("paragraph")).toHaveText(NO_BUCKETS);
	await expect(page.getByPlaceholder("Search or create")).toHaveCount(0);
	await expect(page.getByRole("option")).toHaveCount(0);
	const filed = savedBy(page, "fileWithoutBucket");
	await note.getByRole("button", { name: "File without a Bucket" }).click();
	await filed;
	await expect(said(page, /filed without a Bucket\. It has left Review\.$/)).toBeVisible();
	// It is still in the list, Unassigned, and Review no longer asks about it.
	await expect(row(page, "Old F")).toBeVisible();
	await expect(waits).toHaveCount(0);

	// Its editor under the row says the same where the Bucket would be chosen.
	await row(page, "Old F").click();
	await expect(editSheet(page).getByTestId("no-buckets").getByRole("paragraph")).toHaveText(
		NO_BUCKETS,
	);
	await expect(editSheet(page).getByRole("combobox", { name: "Assigned to" })).toHaveCount(0);
	await page.context().close();
});

test("a month before the first Plan: File in… says it had no Buckets, and its Transaction's editor says why it can't be split or saved", async ({
	browser,
}) => {
	const page = await signedInPage(browser, parent.email);
	await page.setViewportSize({ width: 1440, height: 900 });
	const { before } = await setUpBeforePlan(page);
	await page.goto(`/transactions/${before}`);
	await hydrated(page.getByLabel("Search notes and merchants"));

	// The selection's File in…: the sentence, with nothing to search, create or file without.
	await list(page)
		.getByRole("checkbox", { name: /^Select Old F,/i })
		.click();
	const bar = page.getByRole("region", { name: "Selecting Transactions" });
	await bar.getByRole("button", { name: "File in…" }).click();
	const note = page.getByTestId("no-buckets");
	await expect(note.getByRole("paragraph")).toHaveText(
		/^\w+( \d{4})? had no Buckets yet\. Transactions from before your Plan can stay Unassigned\.$/,
	);
	await expect(note.getByRole("button")).toHaveCount(0);
	await expect(page.getByPlaceholder(/^(Search or create|Find a Bucket)$/)).toHaveCount(0);
	await page.keyboard.press("Escape");
	await bar.getByRole("button", { name: "Cancel" }).click();

	// Its editor: no Split to start (a Split belongs to a Bucket), and Save says why it can't.
	await row(page, "Old F").click();
	const sheet = editSheet(page);
	await expect(sheet.getByTestId("no-split")).toHaveText(
		/^It can’t be split: each Split belongs to a Bucket, and \w+( \d{4})? had none\.$/,
	);
	await expect(sheet.getByRole("button", { name: "Split", exact: true })).toHaveCount(0);
	await sheet.getByRole("button", { name: "Save", exact: true }).click();
	await expect(
		sheet.getByText(
			/had no Buckets, so there’s nothing to assign this to and changes to it can’t be saved\.$/,
		),
	).toBeVisible();
	await expect(sheet.getByText("Choose the Bucket or Commitment it belongs to.")).toHaveCount(0);
	await page.context().close();
});

test("on a phone, a Transaction from before the first Plan says so in its sheet and is filed without a Bucket there", {
	tag: "@phone",
}, async ({ browser }) => {
	const page = await signedInPage(browser, parent.email, {
		viewport: { width: 393, height: 852 },
		isMobile: true,
		hasTouch: true,
	});
	// The Household is made at desktop width, where the helpers' links are.
	await page.setViewportSize({ width: 1280, height: 900 });
	const { before } = await setUpBeforePlan(page);
	await page.setViewportSize({ width: 393, height: 852 });
	// The month before the Plan, at its own address.
	await page.goto(`/transactions/${before}`);
	await hydrated(page.getByLabel("Search notes and merchants"));
	await row(page, "Old F").click();
	const note = editSheet(page).getByTestId("no-buckets");
	await expect(note.getByRole("paragraph")).toHaveText(NO_BUCKETS);
	await expect(editSheet(page).getByRole("combobox", { name: "Assigned to" })).toHaveCount(0);
	// Nothing to split between, said in place of the button.
	await expect(editSheet(page).getByTestId("no-split")).toBeVisible();
	await expect(editSheet(page).getByRole("button", { name: "Split", exact: true })).toHaveCount(0);
	const filed = savedBy(page, "fileWithoutBucket");
	await note.getByRole("button", { name: "File without a Bucket" }).click();
	await filed;
	await expect(said(page, /filed without a Bucket\. It has left Review\.$/)).toBeVisible();
	await expect(editSheet(page)).toHaveCount(0);
	await expect(row(page, "Old F")).toBeVisible();
	await page.context().close();
});
