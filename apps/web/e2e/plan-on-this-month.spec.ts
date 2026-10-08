import { expect, test } from "@playwright/test";
import { ulid } from "ulid";
import { createTestParent } from "./parents";
import { seedSql } from "./seed-sql";
import { createPlannedHousehold, hydrated, signedInPage } from "./session";

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
async function seedLastMonth(clerkUserId: string, month: string) {
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
	await seedSql(statements);
}

test("This Month shows the Plan: Free to Spend worked out and how last month ended", async ({
	browser,
}) => {
	// Planning the month and seeding take most of the default budget.
	test.slow();
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, { baseline: "5,000", buckets: [["Groceries", "1,200"]] });
	const month = /\/month\/(\d{4}-\d{2})/.exec(page.url())?.[1];
	if (!month) throw new Error(`No month in ${page.url()}`);
	await seedLastMonth(parent.userId, month);
	await page.reload();

	// Free to Spend, worked out part by part from take-home pay.
	const freeToSpend = page.getByRole("region", { name: "Free to Spend" });
	await expect(freeToSpend).toContainText("$3,150");
	// The first read is the figure and one line (issue 149): the working is behind one disclosure,
	// closed until asked for, and opened from the keyboard.
	const working = freeToSpend.getByRole("button", { name: "How this is worked out" });
	await expect(working).toHaveAttribute("aria-expanded", "false");
	await expect(freeToSpend.getByRole("list")).toHaveCount(0);
	await expect(freeToSpend.locator("p").nth(1)).toHaveText(
		/^On track · (\d+ days? left|last day of the month)$/,
	);
	await hydrated(working);
	await working.focus();
	await page.keyboard.press("Enter");
	await expect(working).toHaveAttribute("aria-expanded", "true");
	// The working, as a short ledger that ends in the figure above.
	const ledger = freeToSpend.getByRole("list", { name: "How this is worked out" });
	await expect(ledger.getByRole("listitem")).toHaveText([
		"Take-home pay$5,000",
		"Commitments$0",
		"Buckets−$1,700",
		"Goal funding−$150",
		"Free to Spend$3,150",
	]);
	// The line above already says how the month is going, so the panel does not say it again.
	await expect(freeToSpend.locator("[data-slot=free-sentence]")).toHaveCount(0);
	// Space closes it and opens it again.
	await page.keyboard.press("Space");
	await expect(ledger).toHaveCount(0);
	await page.keyboard.press("Space");
	await expect(ledger).toBeVisible();
	// Where take-home pay goes (#64): one bar, and its legend as a list of amounts.
	const breakdown = freeToSpend.getByRole("list", { name: "Where $5,000 take-home pay goes" });
	await expect(breakdown.getByRole("listitem").filter({ hasText: "Goals" })).toContainText("$150");
	await expect(breakdown.getByRole("listitem").filter({ hasText: "Free to Spend" })).toContainText(
		"$3,150",
	);
	// No second link to the Plan here: the Sidebar has it (#73).
	await expect(freeToSpend.getByRole("link", { name: "Plan" })).toHaveCount(0);

	// Goals aren't on This Month any more (#73): they're on the Goals page, and the breakdown
	// above has their funding.
	await expect(page.getByRole("region", { name: /^Goals/ })).toHaveCount(0);

	// On a phone, nothing scrolls sideways.
	await page.setViewportSize({ width: 390, height: 844 });
	await expect(breakdown).toBeVisible();
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
		true,
	);
	await page.setViewportSize({ width: 1280, height: 800 });

	// The Plan has the waterfall the breakdown sums up.
	await page.goto(`/plan/${month}#plan-waterfall`);
	await expect(page.getByRole("region", { name: "Where take-home pay goes" })).toBeVisible();

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
});
