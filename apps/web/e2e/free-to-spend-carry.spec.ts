import { expect, type Page, test } from "@playwright/test";
import { ulid } from "ulid";
import { createTestParent } from "./parents";
import { seedSql } from "./seed-sql";
import { createPlannedHousehold, openFreeWorking, signedInPage } from "./session";

// Free to Spend carried over (issue 113): what a month ends with is carried over into the next one,
// and This Month, the Plan and Plan › Year say so.

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

const split = (page: Page) => page.getByRole("region", { name: "Where take-home pay goes" });
async function plannedMonth(page: Page) {
	await createPlannedHousehold(page, { baseline: "5,000", buckets: [["Groceries", "1,200"]] });
	const month = /\/month\/(\d{4}-\d{2})/.exec(page.url())?.[1];
	if (!month) throw new Error(`No month in ${page.url()}`);
	return month;
}

const health = (page: Page) => page.getByRole("region", { name: "Things to check" });
const freeToSpend = (page: Page) => page.getByRole("region", { name: "Free to Spend" });

/**
 * An ended month as the ledger reads it: take-home pay set from it on, and real rows for what came
 * in and what was spent. An ended month hands on only what its rows say.
 */
function endedMonth(userId: string, month: string, income: number, spent: number) {
	const household = `(select household_id from members where clerk_user_id = ${q(userId)})`;
	const member = `(select id from members where clerk_user_id = ${q(userId)})`;
	return [
		`insert into baselines (household_id, month, amount_cents) values (${household}, ${q(month)}, 500000);`,
		`insert into income (id, household_id, date, amount_cents, note, created_by_member_id) values (${q(ulid())}, ${household}, ${q(`${month}-03`)}, ${income * 100}, 'Paycheck', ${member});`,
		`insert into transactions (id, household_id, source, date, amount_cents, note, created_by_member_id) values (${q(ulid())}, ${household}, 'quick-add', ${q(`${month}-12`)}, ${spent * 100}, 'Everything that month', ${member});`,
	];
}

/** Groceries' allowance in one month ahead only: back to $1,200 the month after. */
function groceriesIn(userId: string, month: string, dollars: number) {
	const household = `(select household_id from members where clerk_user_id = ${q(userId)})`;
	const groceries = `(select id from buckets where household_id = ${household} and name = 'Groceries')`;
	const row = (m: string, cents: number) =>
		`insert into bucket_allowances (household_id, bucket_id, month, amount_cents) values (${household}, ${groceries}, ${q(m)}, ${cents});`;
	return [row(month, dollars * 100), row(addMonths(month, 1), 120000)];
}

test("money two ended months left is carried over, and covers a month ahead that is short on its own", async ({
	browser,
}) => {
	test.slow();
	const page = await signedInPage(browser, parent.email);
	const month = await plannedMonth(page);
	const first = addMonths(month, -2);
	const last = addMonths(month, -1);
	const next = addMonths(month, 1);
	// $5,000 in and $4,400 out, then $5,000 in and $4,290 out: $600, then $1,310 carried over.
	// Next month Groceries takes $5,500, $500 more than the pay: short alone, covered by the carry.
	await seedSql([
		...endedMonth(parent.userId, first, 5000, 4400),
		...endedMonth(parent.userId, last, 5000, 4290).slice(1),
		...groceriesIn(parent.userId, next, 5500),
	]);
	await page.reload();

	// $3,800 of its own ($5,000 less $1,200 in Buckets) and $1,310 carried over.
	await expect(freeToSpend(page)).toContainText("$5,110");
	await expect(freeToSpend(page).locator("[data-slot=free-carried-in]")).toHaveText(
		`$3,800 this month · $1,310 carried over from ${monthName(last)}`,
	);
	// Each month's carry and where the pay goes are part of the working (issue 149).
	await openFreeWorking(page);
	// The line above is the split here, so how the month is going is said in the panel.
	await expect(freeToSpend(page).locator("[data-slot=free-sentence]")).toContainText(
		"$5,110 free to spend",
	);
	await expect(
		freeToSpend(page)
			.getByRole("list", { name: "How this is worked out" })
			.getByRole("listitem")
			.filter({ hasText: "Carried over" }),
	).toHaveText(`Carried over from ${monthName(last)}+$1,310`);
	await expect(
		freeToSpend(page)
			.getByRole("list", { name: "What each month carried over into the next" })
			.getByRole("listitem"),
	).toHaveText([`${monthName(first).slice(0, 3)} $600`, `${monthName(last).slice(0, 3)} $1,310`]);
	// The bar's parts add up to everything the month has.
	const breakdown = freeToSpend(page).getByRole("list", {
		name: "Where $5,000 take-home pay and $1,310 carried over go",
	});
	await expect(breakdown.getByRole("listitem").filter({ hasText: "Free to Spend" })).toContainText(
		"$5,110",
	);

	// The ended month says what it handed on.
	await page.goto(`/month/${last}`);
	await expect(page.locator("[data-slot=free-handed-on]")).toHaveText(
		`Ended with $1,310, carried over into ${monthName(month)}`,
	);

	// The Plan counts it with take-home pay, and has nothing to warn of: next month is covered.
	await page.goto(`/plan/${month}`);
	await expect(split(page)).toContainText(
		`$1,200 of the $6,310 you have this month (take-home pay plus $1,310 carried over from ${monthName(last)}) is planned. $5,110 is Free to Spend.`,
	);
	await expect(health(page)).toHaveCount(0);

	// Plan › Year: a "Carried over" column; next month is $500 short alone and reads $4,610.
	if (first.slice(0, 4) !== next.slice(0, 4)) return;
	await page.setViewportSize({ width: 1024, height: 768 });
	await page.goto(`/plan/${month}/year`);
	const table = page.getByRole("table", { name: "The Plan month by month" });
	await expect(table.getByRole("columnheader", { name: "Carried over" })).toBeVisible();
	const row = (name: string) =>
		table.getByRole("row").filter({ has: page.getByRole("rowheader", { name: new RegExp(name) }) });
	await expect(row(monthName(first)).getByRole("cell").nth(4)).toHaveText("–");
	await expect(row(monthName(last)).getByRole("cell").nth(4)).toHaveText("$600");
	await expect(row(monthName(month)).getByRole("cell").nth(4)).toHaveText("$1,310");
	await expect(row(monthName(month)).getByRole("cell").nth(5)).toContainText("$5,110");
	await expect(row(monthName(next)).getByRole("cell").nth(4)).toHaveText("$5,110");
	const covered = row(monthName(next)).getByRole("cell").nth(5);
	await expect(covered).toContainText("$4,610");
	await expect(covered).not.toContainText("−");
	// At 1024 the last column, Free to Spend, is all on the card (it was cut off).
	const fits = await table.evaluate((node) => {
		const head = node.querySelector("thead th:last-child");
		const card = node.closest("[data-slot=card]") ?? node.parentElement;
		if (!head || !card) return false;
		return head.getBoundingClientRect().right <= card.getBoundingClientRect().right + 1;
	});
	expect(fits).toBe(true);

	// On a phone the month's line says it instead.
	await page.setViewportSize({ width: 393, height: 852 });
	await expect(
		page
			.getByRole("listitem")
			.filter({ hasText: monthName(month) })
			.first(),
	).toContainText("$1,310 carried over");
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
		true,
	);
});

test("a month that ended short is carried over too, and a month ahead it leaves below zero is flagged with where to look", async ({
	browser,
}) => {
	test.slow();
	const page = await signedInPage(browser, parent.email);
	const month = await plannedMonth(page);
	const last = addMonths(month, -1);
	const next = addMonths(month, 1);
	// $3,000 in and $3,230 out: $230 short. Next month Groceries takes $9,000, $4,000 more than
	// the pay, and this month leaves only $3,570.
	await seedSql([
		...endedMonth(parent.userId, last, 3000, 3230),
		...groceriesIn(parent.userId, next, 9000),
	]);
	await page.reload();

	await expect(freeToSpend(page)).toContainText("$3,570");
	await expect(freeToSpend(page).locator("[data-slot=free-carried-in]")).toHaveText(
		`$3,800 this month · $230 short carried over from ${monthName(last)}`,
	);
	// The parts add up to the pay less the shortfall.
	await openFreeWorking(page);
	await expect(
		freeToSpend(page)
			.getByRole("list", { name: "How this is worked out" })
			.getByRole("listitem")
			.filter({ hasText: "carried over" }),
	).toHaveText(`Short carried over from ${monthName(last)}−$230`);
	const breakdown = freeToSpend(page).getByRole("list", {
		name: "Where $5,000 take-home pay goes, less $230 short carried over",
	});
	await expect(breakdown.getByRole("listitem").filter({ hasText: "Free to Spend" })).toContainText(
		"$3,570",
	);

	await page.goto(`/month/${last}`);
	await expect(page.locator("[data-slot=free-handed-on]")).toHaveText(
		`Ended $230 short, carried over into ${monthName(month)}`,
	);
	// An ended month's headline is what it ended with, not what its Plan left free (issue 120).
	await expect(page.locator("[data-slot=free-headline]")).toHaveText("−$230");

	await page.goto(`/plan/${month}`);
	await expect(split(page)).toContainText(
		`$1,200 of the $4,770 you have this month (take-home pay less $230 short carried over from ${monthName(last)}) is planned. $3,570 is Free to Spend.`,
	);
	// Things to check says what the figure is made of and names the month's largest amount.
	await page.getByRole("button", { name: /^Things to check/ }).click();
	await expect(
		health(page).getByRole("link", { name: `Free to Spend goes below zero in ${monthName(next)}` }),
	).toBeVisible();
	await expect(health(page)).toContainText(
		`${monthName(next)} starts with $3,570 carried over, and its Plan uses $4,000 more than its take-home pay, which leaves −$430. Its largest: Groceries $9,000. Or change its take-home pay.`,
	);
	await expect(health(page).getByRole("link", { name: "Groceries" })).toHaveAttribute(
		"href",
		new RegExp(`/plan/${next}/buckets/`),
	);
	await expect(health(page).getByRole("link", { name: "take-home pay" })).toHaveAttribute(
		"href",
		`/plan/${next}/income`,
	);

	if (last.slice(0, 4) !== next.slice(0, 4)) return;
	await page.setViewportSize({ width: 1024, height: 768 });
	await page.goto(`/plan/${month}/year`);
	const table = page.getByRole("table", { name: "The Plan month by month" });
	const row = (name: string) =>
		table.getByRole("row").filter({ has: page.getByRole("rowheader", { name: new RegExp(name) }) });
	await expect(row(monthName(month)).getByRole("cell").nth(4)).toHaveText("−$230");
	await expect(row(monthName(month)).getByRole("cell").nth(5)).toContainText("$3,570");
	await expect(row(monthName(next)).getByRole("cell").nth(5)).toContainText("−$430");
	await page.setViewportSize({ width: 393, height: 852 });
	await expect(
		page
			.getByRole("listitem")
			.filter({ hasText: monthName(month) })
			.first(),
	).toContainText("$230 short carried over");
});
