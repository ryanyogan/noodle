import { expect, type Page, test } from "@playwright/test";
import { ulid } from "ulid";
import { createTestParent } from "./parents";
import { seedSql } from "./seed-sql";
import { choose, createPlannedHousehold, openToDo, signedInPage } from "./session";

// The month-end decision (issue 113): "Close <Month>" has one row for the Free to Spend the month
// ended with: keep it in Free to Spend, where it is already carried over, or send it to a Goal.

let parent: Awaited<ReturnType<typeof createTestParent>>;

test.beforeEach(async () => {
	// This Month offers to close the month before in the month's first week only.
	test.skip(new Date().getDate() > 7, "Close is offered in the first week of a month");
	parent = await createTestParent();
});

test.afterEach(async () => {
	await parent?.remove();
});

const monthName = (month: string) =>
	new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-US", {
		month: "long",
		timeZone: "UTC",
	});

function addMonths(month: string, count: number) {
	const [year = 0, m = 0] = month.split("-").map(Number);
	return new Date(Date.UTC(year, m - 1 + count, 1)).toISOString().slice(0, 7);
}

const q = (value: string) => `'${value.replaceAll("'", "''")}'`;
const freeToSpend = (page: Page) => page.getByRole("region", { name: "Free to Spend" });
const toDo = (page: Page) => page.getByRole("region", { name: "To do" });

/**
 * A Household planned this month ($5,000 take-home pay, Groceries $1,200) whose last month had
 * $5,000 of income recorded and `spent` dollars of spending, with two Goals: Rainy day, the
 * emergency Goal, and Trip. Last month has no Buckets, so no leftovers to Sweep.
 */
async function endedMonth(page: Page, spent: number) {
	await createPlannedHousehold(page, { baseline: "5,000", buckets: [["Groceries", "1,200"]] });
	const month = /\/month\/(\d{4}-\d{2})/.exec(page.url())?.[1];
	if (!month) throw new Error(`No month in ${page.url()}`);
	const last = addMonths(month, -1);
	const household = `(select household_id from members where clerk_user_id = ${q(parent.userId)})`;
	const member = `(select id from members where clerk_user_id = ${q(parent.userId)})`;
	const [account, rainy, trip] = [ulid(), ulid(), ulid()];
	await seedSql([
		`insert into baselines (household_id, month, amount_cents) values (${household}, ${q(last)}, 500000);`,
		`insert into income (id, household_id, date, amount_cents, note, created_by_member_id) values (${q(ulid())}, ${household}, ${q(`${last}-03`)}, 500000, 'Paycheck', ${member});`,
		`insert into transactions (id, household_id, source, date, amount_cents, note, created_by_member_id) values (${q(ulid())}, ${household}, 'quick-add', ${q(`${last}-12`)}, ${spent * 100}, 'Everything that month', ${member});`,
		`insert into accounts (id, household_id, name, kind) values (${q(account)}, ${household}, 'Savings', 'savings');`,
		`insert into goals (id, household_id, account_id, name, target_cents, from_month) values (${q(trip)}, ${household}, ${q(account)}, 'Trip', 120000, ${q(last)});`,
		`insert into goals (id, household_id, account_id, name, target_cents, from_month) values (${q(rainy)}, ${household}, ${q(account)}, 'Rainy day', 500000, ${q(last)});`,
		`update households set emergency_goal_id = ${q(rainy)} where id = ${household};`,
	]);
	await page.reload();
	return { month, last };
}

/** A picture for the handoff, only when asked for (SHOTS is a folder). */
async function shot(page: Page, name: string) {
	if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/${name}.png` });
}

test("Free to Spend a month ended with is kept, carried over, unless a Parent sends it", async ({
	browser,
}) => {
	test.slow();
	const page = await signedInPage(browser, parent.email);
	await page.setViewportSize({ width: 1440, height: 900 });
	// $5,000 in and $4,588 out: last month ended with $412.
	const { month, last } = await endedMonth(page, 4588);
	const carried = freeToSpend(page).locator("[data-slot=free-carried-in]");
	await expect(carried).toHaveText(`$3,800 this month · $412 carried over from ${monthName(last)}`);

	// One row for it in Close, kept unless the Parent says otherwise.
	await openToDo(page, `Close ${monthName(last)}`);
	await expect(toDo(page)).toContainText("Free to Spend to decide");
	const row = toDo(page).getByRole("listitem").filter({ hasText: "Free to Spend" });
	await expect(row).toContainText("$412 left");
	const where = toDo(page).getByRole("combobox", { name: "Where the Free to Spend left goes" });
	await expect(where).toContainText("Keep it in Free to Spend");
	await expect(toDo(page)).toContainText(
		`What’s left in Free to Spend is carried over into ${monthName(month)} unless you send it to a Goal.`,
	);
	await shot(page, "close-row-1440");
	// One more row, not a tall block, and the same on a phone.
	expect((await row.boundingBox())?.height ?? 0).toBeLessThan(130);
	await page.setViewportSize({ width: 393, height: 852 });
	const close = toDo(page).getByRole("button", { name: `Close ${monthName(last)}`, exact: true });
	await expect(async () => {
		const strip = toDo(page).locator("[data-slot=row-button]").first();
		if ((await strip.getAttribute("aria-expanded")) !== "true") await strip.click();
		await expect(close.last()).toBeVisible({ timeout: 2_000 });
	}).toPass({ timeout: 15_000 });
	await close.last().scrollIntoViewIfNeeded();
	await shot(page, "close-row-393");
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
		true,
	);
	await close.last().click();
	await expect(close).toHaveCount(0, { timeout: 10_000 });
	await page.setViewportSize({ width: 1440, height: 900 });

	// Nothing moved: the same amount is still carried over, and last month says so.
	await page.reload();
	await expect(carried).toHaveText(`$3,800 this month · $412 carried over from ${monthName(last)}`);
	await page.goto(`/month/${last}`);
	const ended = page.getByRole("region", { name: `How ${monthName(last)} ended` });
	await expect(ended).toContainText("Closed by you");
	const kept = ended.getByRole("listitem").filter({ hasText: "Free to Spend" });
	await expect(kept).toContainText(`Carried over into ${monthName(month)}`);
	await expect(kept).toContainText("$412");
	await shot(page, "ended-kept-1440");
});

test("Free to Spend sent to a Goal at Close is Goal funding, and is no longer carried over", async ({
	browser,
}) => {
	test.slow();
	const page = await signedInPage(browser, parent.email);
	await page.setViewportSize({ width: 1440, height: 900 });
	const { month, last } = await endedMonth(page, 4588);
	await expect(freeToSpend(page)).toContainText("$4,212");

	await openToDo(page, `Close ${monthName(last)}`);
	const where = toDo(page).getByRole("combobox", { name: "Where the Free to Spend left goes" });
	await where.click();
	// The emergency Goal on top.
	await expect(page.getByRole("option")).toHaveText([
		"Keep it in Free to Spend",
		"Send to Rainy day",
		"Send to Trip",
	]);
	await page.keyboard.press("Escape");
	await choose(toDo(page), "Where the Free to Spend left goes", "Send to Trip");
	await shot(page, "close-row-send-1440");
	await toDo(page)
		.getByRole("button", { name: `Close ${monthName(last)}`, exact: true })
		.last()
		.click();
	await expect(page.getByText(`${monthName(last)} closed`)).toBeVisible();

	// This month's Free to Spend is its own $3,800: the $412 is no longer carried over.
	await page.reload();
	await expect(freeToSpend(page)).toContainText("$3,800");
	await expect(freeToSpend(page).locator("[data-slot=free-carried-in]")).toHaveCount(0);
	// Last month says where it went, and that nothing was left to carry over.
	await page.goto(`/month/${last}`);
	const ended = page.getByRole("region", { name: `How ${monthName(last)} ended` });
	const sent = ended.getByRole("listitem").filter({ hasText: "Free to Spend" });
	await expect(sent).toHaveCount(1);
	await expect(sent).toContainText("Sent to Trip as Goal funding");
	await expect(sent).toContainText("$412");
	await expect(ended).not.toContainText(`Carried over into ${monthName(month)}`);
	await shot(page, "ended-sent-1440");
	// The Goal grew by it.
	await page.goto("/goals");
	await expect(page.getByRole("link", { name: /^Trip, \$412 of \$1,200/ })).toBeVisible();
});

test("a month that ended short has no Free to Spend row, and nothing to close", async ({
	browser,
}) => {
	const page = await signedInPage(browser, parent.email);
	// $5,000 in and $5,230 out.
	const { last } = await endedMonth(page, 5230);
	await expect(freeToSpend(page).locator("[data-slot=free-carried-in]")).toHaveText(
		`$3,800 this month · $230 short carried over from ${monthName(last)}`,
	);
	await expect(page.getByRole("button", { name: `Close ${monthName(last)}` })).toHaveCount(0);
});
