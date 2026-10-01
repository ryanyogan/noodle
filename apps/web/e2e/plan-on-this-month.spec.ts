import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { ulid } from "ulid";
import { createTestParent } from "./parents";
import { createPlannedHousehold, signedInPage } from "./session";

let parent: Awaited<ReturnType<typeof createTestParent>>;

test.beforeEach(async () => {
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

/**
 * Last month, closed by the Parent, written straight into the local D1: a Bucket that resets monthly, Fun,
 * whose $300 leftover was Swept into the Trip Goal, and a Bucket that carries over, Hockey, carrying $200
 * into this month. Both stay in the Plan this month. Trip ($1,200 by three months from now) has
 * $100 of Goal funding this month, and Rainy day (no target date) $50.
 */
function seedLastMonth(clerkUserId: string, month: string) {
	const household = `(select household_id from members where clerk_user_id = ${q(clerkUserId)})`;
	const member = `(select id from members where clerk_user_id = ${q(clerkUserId)})`;
	const last = addMonths(month, -1);
	const [account, goal, rainy, fun, hockey] = [ulid(), ulid(), ulid(), ulid(), ulid()];
	const statements = [
		`insert into baselines (household_id, month, amount_cents) values (${household}, ${q(last)}, 500000);`,
		`insert into accounts (id, household_id, name, kind) values (${q(account)}, ${household}, 'Savings', 'savings');`,
		`insert into goals (id, household_id, account_id, name, target_cents, target_date, from_month) values (${q(goal)}, ${household}, ${q(account)}, 'Trip', 120000, ${q(`${addMonths(month, 3)}-15`)}, ${q(month)});`,
		`insert into goals (id, household_id, account_id, name, target_cents, from_month) values (${q(rainy)}, ${household}, ${q(account)}, 'Rainy day', 500000, ${q(month)});`,
		`insert into buckets (id, household_id, name, color, position, from_month) values (${q(fun)}, ${household}, 'Fun', 2, 10, ${q(last)});`,
		`insert into bucket_allowances (household_id, bucket_id, month, amount_cents) values (${household}, ${q(fun)}, ${q(last)}, 30000);`,
		`insert into buckets (id, household_id, name, color, position, from_month) values (${q(hockey)}, ${household}, 'Hockey', 3, 11, ${q(last)});`,
		`insert into bucket_allowances (household_id, bucket_id, month, amount_cents) values (${household}, ${q(hockey)}, ${q(last)}, 20000);`,
		`insert into bucket_rolling (household_id, bucket_id, month, rolling) values (${household}, ${q(hockey)}, ${q(last)}, 1);`,
		`insert into moves (id, household_id, kind, month, from_bucket_id, amount_cents, created_by_member_id, to_goal_id) values (${q(ulid())}, ${household}, 'sweep', ${q(last)}, ${q(fun)}, 30000, ${member}, ${q(goal)});`,
		`insert into moves (id, household_id, kind, month, amount_cents, created_by_member_id, to_goal_id) values (${q(ulid())}, ${household}, 'goal-funding', ${q(month)}, 10000, ${member}, ${q(goal)});`,
		`insert into moves (id, household_id, kind, month, amount_cents, created_by_member_id, to_goal_id) values (${q(ulid())}, ${household}, 'goal-funding', ${q(month)}, 5000, ${member}, ${q(rainy)});`,
		`insert into month_closes (id, household_id, month, decided_by_member_id) values (${q(ulid())}, ${household}, ${q(last)}, ${member});`,
	];
	const file = join(mkdtempSync(join(tmpdir(), "noodle-plan-on-month-")), "seed.sql");
	writeFileSync(file, statements.join("\n"));
	execFileSync("bunx", ["wrangler", "d1", "execute", "noodle", "--local", `--file=${file}`], {
		stdio: "ignore",
	});
}

test("This Month shows the Plan: Free to Spend worked out, the Goals, and how last month ended", async ({
	browser,
}) => {
	// Planning the month and seeding through wrangler take most of the default budget.
	test.slow();
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, { baseline: "5,000", buckets: [["Groceries", "1,200"]] });
	const month = /\/month\/(\d{4}-\d{2})/.exec(page.url())?.[1];
	if (!month) throw new Error(`No month in ${page.url()}`);
	seedLastMonth(parent.userId, month);
	await page.reload();

	// Free to Spend, worked out part by part from take-home pay.
	const freeToSpend = page.getByRole("region", { name: "Free to Spend" });
	await expect(freeToSpend).toContainText("$3,150");
	const breakdown = freeToSpend.getByRole("link", { name: /take-home pay/ });
	await expect(breakdown).toHaveAccessibleName(
		"$5,000 take-home pay minus $1,700 Buckets minus $150 Goal funding",
	);

	// Each Goal: on track or behind, its months left, and funded against needed this month. The
	// header's funding is the breakdown's Goal funding, every Goal's; what's still needed is the
	// dated Goals'.
	const goals = page.getByRole("region", { name: /^Goals/ });
	await expect(goals).toContainText("$150 funded · $125 still needed");
	const trip = goals.getByRole("listitem", { name: "Trip" });
	await expect(trip).toContainText("On track");
	await expect(trip).toContainText("4 months left");
	await expect(trip).toContainText("$100");
	await expect(trip).toContainText("of $225 this month");

	// On a phone, nothing scrolls sideways.
	await page.setViewportSize({ width: 390, height: 844 });
	await expect(breakdown).toBeVisible();
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
		true,
	);
	await page.setViewportSize({ width: 1280, height: 800 });

	// The breakdown opens the Plan's waterfall.
	await breakdown.click();
	await expect(page).toHaveURL(new RegExp(`/plan/${month}#plan-waterfall$`));
	await expect(
		page.getByRole("region", { name: "From take-home pay to Free to Spend" }),
	).toBeVisible();

	// Last month shows how it ended: the Sweep, what rolled over, and who closed it.
	const last = addMonths(month, -1);
	await page.goto(`/month/${last}`);
	const ended = page.getByRole("region", { name: `How ${monthName(last)} ended` });
	await expect(ended).toContainText("Closed by you");
	const sweep = ended.getByRole("listitem").filter({ hasText: "Fun leftover" });
	await expect(sweep).toContainText("Swept to Trip");
	await expect(sweep).toContainText("$300");
	const rolled = ended.getByRole("listitem").filter({ hasText: "Hockey" });
	await expect(rolled).toContainText(`Carried over into ${monthName(month)}`);
	await expect(rolled).toContainText("$200");
	// This month has no Goals strip for an ended month.
	await expect(page.getByRole("region", { name: /^Goals/ })).toHaveCount(0);
});
