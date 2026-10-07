import { expect, type Page, test } from "@playwright/test";
import { ulid } from "ulid";
import { createTestParent } from "./parents";
import { seedSql } from "./seed-sql";
import { createPlannedHousehold, hydrated, signedInPage } from "./session";

// A Refund that lands in checking can be linked to its purchase (issue 131, ADR-0057): skates of
// $45 bought last month; $20 comes back this month. A Parent says it is a Refund, picks the
// purchase, and the purchase's Bucket has the money back this month; Unlink takes it off again.

let parent: Awaited<ReturnType<typeof createTestParent>>;

test.beforeEach(async () => {
	parent = await createTestParent();
});

test.afterEach(async () => {
	await parent?.remove();
});

const q = (value: string) => `'${value.replaceAll("'", "''")}'`;
const pad = (n: number) => String(n).padStart(2, "0");
const toast = (page: Page, text: string) => page.getByRole("status").filter({ hasText: text });
const words = async (page: Page) => (await page.locator("main").innerText()).replace(/\s+/g, " ");

test("a Refund in checking is linked to its purchase, whose Bucket gets the money back this month", async ({
	browser,
}) => {
	test.setTimeout(240_000);
	const page = await signedInPage(browser, parent.email);
	await page.setViewportSize({ width: 1440, height: 900 });
	const today = new Date();
	const before = new Date(today.getFullYear(), today.getMonth() - 1, 1);
	const now = `${today.getFullYear()}-${pad(today.getMonth() + 1)}`;
	const last = `${before.getFullYear()}-${pad(before.getMonth() + 1)}`;
	const made = await createPlannedHousehold(page, {
		baseline: "5,000",
		buckets: [["Kids", "300"]],
	});
	const kids = made?.bucketIds.Kids;
	if (!kids) throw new Error("The Household wasn't made directly");

	// Last month's purchase, written straight into the local D1 (a Quick Add dated then).
	const household = `(select household_id from members where clerk_user_id = ${q(parent.userId)})`;
	const member = `(select id from members where clerk_user_id = ${q(parent.userId)})`;
	const skates = ulid();
	await seedSql([
		`insert into transactions (id, household_id, source, date, amount_cents, note, bucket_id, created_by_member_id) values (${q(skates)}, ${household}, 'quick-add', ${q(`${last}-20`)}, 4500, 'Pure Hockey skates', ${q(kids)}, ${member});`,
	]);

	// The money lands this month.
	await page.goto(`/month/${now}`);
	const income = page.getByRole("region", { name: "Income" });
	const add = income.getByRole("button", { name: "Add income" });
	await hydrated(add);
	await add.click();
	const sheet = page.getByRole("dialog", { name: "Add income" });
	await sheet.getByLabel("Amount").fill("20");
	await sheet.getByLabel("Note").fill("Pure Hockey");
	await sheet.getByRole("button", { name: "Add income" }).click();
	await expect(sheet).toBeHidden();
	await expect(income).toContainText("$20 received");
	// Shown before it is saved: let the write land before leaving the page.
	await page.waitForLoadState("networkidle");
	expect(await words(page)).toContain("Kids $0 spent $300 of $300");

	// A Parent says it is a Refund: the row stays open and asks which purchase it is for.
	await page.goto(`/transactions/${now}`);
	const row = page
		.getByRole("region", { name: "Money in" })
		.getByTestId("money-in-row")
		.filter({ hasText: "Pure Hockey" });
	const change = row.getByRole("button", { name: "Change what Pure Hockey is" });
	await expect(change).toBeVisible({ timeout: 30_000 });
	await hydrated(change);
	await change.click();
	await row.getByRole("button", { name: "Refund", exact: true }).click();
	await expect(row.getByTestId("money-in-kind")).toHaveText("Refund");
	const linking = row.getByTestId("refund-link");
	await expect(linking).toContainText("Which purchase is this a Refund for?");
	const purchases = linking.getByTestId("refund-purchase");
	await expect(purchases).toHaveCount(1);
	await expect(purchases).toContainText("Pure Hockey skates");
	await expect(purchases).toContainText("$45");
	await purchases.getByRole("button", { name: "Link to Pure Hockey skates, $45" }).click();
	await expect(toast(page, "Linked.")).toBeVisible();
	await expect(linking).toContainText("A Refund for Pure Hockey skates");
	await expect(linking).toContainText("Its Bucket or Commitment got $20 back");

	// It counts this month in the purchase's Bucket, never as Income; last month is untouched.
	await page.goto(`/month/${now}`);
	await expect(page.getByRole("region", { name: "Income" })).toContainText("$0 received", {
		timeout: 30_000,
	});
	expect(await words(page)).toContain("Kids −$20 spent $320 of $300");
	const [kept = []] = await seedSql([
		`select transaction_id, counts_on from refund_links where household_id = ${household};`,
	]);
	expect(kept.map((link) => link.transaction_id)).toEqual([skates]);
	expect(String(kept[0]?.counts_on).slice(0, 7)).toBe(now);

	// Unlink takes it off again, and the question is back.
	await page.goto(`/transactions/${now}`);
	await expect(change).toBeVisible({ timeout: 30_000 });
	await hydrated(change);
	await change.click();
	const unlink = linking.getByRole("button", { name: "Unlink" });
	await unlink.click();
	await expect(toast(page, "Unlinked.")).toBeVisible();
	await expect(linking).toContainText("Which purchase is this a Refund for?");
	await page.goto(`/month/${now}`);
	await expect(page.getByRole("region", { name: "Income" })).toContainText("$0 received", {
		timeout: 30_000,
	});
	expect(await words(page)).toContain("Kids $0 spent $300 of $300");
	await page.context().close();
});
