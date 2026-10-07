import { expect, type Page, test } from "@playwright/test";
import { ulid } from "ulid";
import { createTestParent } from "./parents";
import { seedSql } from "./seed-sql";
import { createPlannedHousehold, hydrated, signedInPage } from "./session";

// Money back and the edits around it (issue 141, ADR-0058). A purchase whose money back counted in
// a month that has ended keeps its amount and where it is filed, and can't be deleted, each said
// in plain words; its name can still change. And Owed back said on a Split that is gone can be
// changed, or put on the whole purchase. The rows no screen can make today (a restore in an ended
// month, an item naming a Split that is gone) are written straight into the local D1.

let parent: Awaited<ReturnType<typeof createTestParent>>;

test.beforeEach(async () => {
	parent = await createTestParent();
});

test.afterEach(async () => {
	await parent?.remove();
});

const q = (value: string) => `'${value.replaceAll("'", "''")}'`;
const pad = (n: number) => String(n).padStart(2, "0");
const toast = (page: Page, text: string | RegExp) =>
	page.getByRole("status").filter({ hasText: text });
const pane = (page: Page) =>
	page
		.locator("[role=dialog], [data-slot=transaction-detail]")
		.filter({ has: page.getByRole("heading", { name: "Edit Transaction" }) });

async function household(page: Page) {
	const made = await createPlannedHousehold(page, {
		baseline: "5,000",
		buckets: [
			["Kids", "300"],
			["Groceries", "800"],
		],
	});
	const kids = made?.bucketIds.Kids;
	if (!kids) throw new Error("The Household wasn't made directly");
	return {
		kids,
		household: `(select household_id from members where clerk_user_id = ${q(parent.userId)})`,
		member: `(select id from members where clerk_user_id = ${q(parent.userId)})`,
	};
}

test("a purchase whose money back counted in an ended month keeps its amount and can’t be deleted, and says why", async ({
	browser,
}) => {
	test.setTimeout(240_000);
	const page = await signedInPage(browser, parent.email);
	await page.setViewportSize({ width: 1440, height: 900 });
	const ids = await household(page);
	const today = new Date();
	const before = new Date(today.getFullYear(), today.getMonth() - 1, 1);
	const last = `${before.getFullYear()}-${pad(before.getMonth() + 1)}`;
	// The purchase is in the running month, whose Plan has its Bucket to save it in again; the
	// Refund linked to it counted last month, which is all the guard reads.
	const now = `${today.getFullYear()}-${pad(today.getMonth() + 1)}`;
	const skates = ulid();
	const refund = ulid();
	await seedSql([
		`insert into transactions (id, household_id, source, date, amount_cents, note, bucket_id, created_by_member_id) values (${q(skates)}, ${ids.household}, 'quick-add', ${q(`${now}-01`)}, 4500, 'Pure Hockey skates', ${q(ids.kids)}, ${ids.member});`,
		`insert into income (id, household_id, date, amount_cents, note, kind) values (${q(refund)}, ${ids.household}, ${q(`${last}-20`)}, 2000, 'Pure Hockey', 'refund');`,
		`insert into refund_links (income_id, household_id, transaction_id, counts_on) values (${q(refund)}, ${ids.household}, ${q(skates)}, ${q(`${last}-20`)});`,
	]);

	await page.goto(`/transactions/${now}`);
	const row = page.getByRole("button", { name: /^Pure Hockey skates, \$45, / });
	await expect(row).toBeVisible({ timeout: 30_000 });
	await hydrated(row);

	// Its amount: refused in plain words, and it is as it was.
	await row.click();
	await pane(page).getByLabel("Amount").fill("40");
	await pane(page).getByRole("button", { name: "Save", exact: true }).click();
	await expect(
		toast(
			page,
			"Money back on $45 (Pure Hockey skates) counted in a month that has ended, so its amount and where it’s filed stay as they are. You can still change its note and who it’s For.",
		),
	).toBeVisible();
	await expect(row).toBeVisible();
	await expect(page.getByRole("button", { name: /^Pure Hockey skates, \$40, / })).toHaveCount(0);

	// Its name is still its own, once the amount is what it was (the form keeps what was typed).
	// A pane that is still folding away after a Save reads as visible: wait for it to go first.
	await expect(page.locator("[data-slot=transaction-detail][data-closing]")).toHaveCount(0);
	if (!(await pane(page).isVisible())) await row.click();
	await pane(page).getByLabel("Amount").fill("45");
	await pane(page).getByLabel("Name").fill("Skates for Mia");
	await pane(page).getByRole("button", { name: "Save", exact: true }).click();
	const renamed = page.getByRole("button", { name: /^Skates for Mia, \$45, / });
	await expect(renamed).toBeVisible();
	await expect
		.poll(
			async () =>
				(await seedSql([`select note from transactions where id = ${q(skates)}`]))[0]?.[0]?.note,
		)
		.toBe("Skates for Mia");

	// Deleting it: it comes back once the Undo has gone, and says why.
	// A pane that is still folding away after a Save reads as visible: wait for it to go first.
	await expect(page.locator("[data-slot=transaction-detail][data-closing]")).toHaveCount(0);
	if (!(await pane(page).isVisible())) await renamed.click();
	await pane(page).getByRole("button", { name: "Delete" }).click();
	await page.getByRole("alertdialog").getByRole("button", { name: "Delete Transaction" }).click();
	await page.mouse.move(0, 0);
	await expect(
		toast(page, /counted in a month that has ended, so it can’t be deleted\.$/),
	).toBeVisible({ timeout: 40_000 });
	await expect(renamed).toBeVisible();
	const [kept = []] = await seedSql([
		`select amount_cents, note from transactions where id = ${q(skates)}`,
	]);
	expect(kept).toEqual([{ amount_cents: 4500, note: "Skates for Mia" }]);
	await page.context().close();
});

test("Owed back said on a Split that is gone can be changed, and put on the whole purchase", async ({
	browser,
}) => {
	test.setTimeout(240_000);
	const page = await signedInPage(browser, parent.email);
	await page.setViewportSize({ width: 1440, height: 900 });
	const ids = await household(page);
	const today = new Date();
	const now = `${today.getFullYear()}-${pad(today.getMonth() + 1)}`;
	const camp = ulid();
	const item = ulid();
	await seedSql([
		`insert into transactions (id, household_id, source, date, amount_cents, note, bucket_id, created_by_member_id) values (${q(camp)}, ${ids.household}, 'quick-add', ${q(`${now}-01`)}, 8000, 'Hockey camp', ${q(ids.kids)}, ${ids.member});`,
		`insert into owed_back (id, household_id, transaction_id, split_id, who, amount_cents) values (${q(item)}, ${ids.household}, ${q(camp)}, ${q(ulid())}, 'Casey', 4000);`,
	]);

	await page.goto(`/transactions/${now}`);
	const row = page.getByRole("button", { name: /^Hockey camp, \$80, / });
	await expect(row).toBeVisible({ timeout: 30_000 });
	await hydrated(row);
	await row.click();
	const owed = page.getByTestId("owed-back").filter({ visible: true });
	const loose = owed.getByTestId("owed-back-split");
	await expect(loose).toContainText("A Split that has changed since: Owed back $40 · Casey");
	// Not only taking it off: it can be changed, and moved to the whole purchase.
	await expect(loose.getByRole("button", { name: "Nobody’s paying this back" })).toBeVisible();
	await expect(loose.getByRole("button", { name: "Put it on the whole purchase" })).toBeVisible();
	await expect(owed.getByTestId("owed-back-whole")).toHaveCount(0);

	await loose.getByRole("button", { name: "Change" }).click();
	const amount = loose.getByLabel("How much");
	await amount.fill("30");
	await amount.blur();
	await loose.getByRole("button", { name: "Save" }).click();
	await expect(toast(page, "Owed back $30 · Casey")).toBeVisible();
	await expect(loose).toContainText("Owed back $30 · Casey");

	await loose.getByRole("button", { name: "Put it on the whole purchase" }).click();
	const whole = owed.getByTestId("owed-back-whole");
	await expect(whole).toContainText("Owed back $30 · Casey");
	await expect(owed.getByTestId("owed-back-split")).toHaveCount(0);
	// The one item it was: same ID, now on the whole purchase.
	const [rows = []] = await seedSql([
		`select id, split_id, amount_cents from owed_back where transaction_id = ${q(camp)}`,
	]);
	expect(rows).toEqual([{ id: item, split_id: null, amount_cents: 3000 }]);
	await page.context().close();
});
