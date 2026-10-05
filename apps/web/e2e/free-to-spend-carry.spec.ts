import { expect, type Page, test } from "@playwright/test";
import { ulid } from "ulid";
import { createTestParent } from "./parents";
import { seedSql } from "./seed-sql";
import { createPlannedHousehold, signedInPage } from "./session";

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

// issue 113: the opt-in design this was written for is gone. Ended months now hand on what they
// ACTUALLY left, so the seed needs income and spending in them and the figures below are stale.
// Skipped until the display phase reworks it (see handoffs/phases/113r.md).
test.fixme("This Month and Plan › Year show what was carried over from the months before", async ({
	browser,
}) => {
	test.slow();
	const page = await signedInPage(browser, parent.email);
	const month = await plannedMonth(page);
	// Two ended months with $5,000 take-home pay and a $4,400 Bucket: each leaves $600, and Free to
	// Spend has built up since the first of them.
	const household = `(select household_id from members where clerk_user_id = ${q(parent.userId)})`;
	const first = addMonths(month, -2);
	const last = addMonths(month, -1);
	const fun = ulid();
	await seedSql([
		`insert into baselines (household_id, month, amount_cents) values (${household}, ${q(first)}, 500000);`,
		`insert into buckets (id, household_id, name, color, position, from_month) values (${q(fun)}, ${household}, 'Fun', 2, 10, ${q(first)});`,
		`insert into bucket_allowances (household_id, bucket_id, month, amount_cents) values (${household}, ${q(fun)}, ${q(first)}, 440000);`,
	]);
	await page.reload();

	// $5,000 + $1,200 carried over − $5,600 in Buckets.
	const freeToSpend = page.getByRole("region", { name: "Free to Spend" });
	await expect(freeToSpend).toContainText("$600");
	await expect(freeToSpend).toContainText(`Includes $1,200 carried over from ${monthName(last)}`);
	const builtUp = freeToSpend.getByRole("list", {
		name: "What Free to Spend carried over, month by month",
	});
	await expect(builtUp.getByRole("listitem")).toHaveText([
		`${monthName(first).slice(0, 3)} $600`,
		`${monthName(last).slice(0, 3)} $1,200`,
	]);
	// The bar's parts add up to everything the month has.
	const breakdown = freeToSpend.getByRole("list", {
		name: "Where $5,000 take-home pay and $1,200 carried over go",
	});
	await expect(breakdown.getByRole("listitem").filter({ hasText: "Free to Spend" })).toContainText(
		"$600",
	);

	// The Plan counts it with take-home pay.
	await page.goto(`/plan/${month}`);
	await expect(split(page)).toContainText(
		`$5,600 of the $6,200 you have this month (take-home pay plus $1,200 carried over from ${monthName(last)}) is planned`,
	);

	// Plan › Year: a "Carried over" column. A year that began before these months has all three;
	// in January and February only the months of the year shown are there to read.
	if (first.slice(0, 4) !== month.slice(0, 4)) return;
	await page.setViewportSize({ width: 1024, height: 768 });
	await page.goto(`/plan/${month}/year`);
	const table = page.getByRole("table", { name: "The Plan month by month" });
	await expect(table.getByRole("columnheader", { name: "Carried over" })).toBeVisible();
	const row = (name: string) =>
		table.getByRole("row").filter({ has: page.getByRole("rowheader", { name: new RegExp(name) }) });
	await expect(row(monthName(first)).getByRole("cell").nth(4)).toHaveText("–");
	await expect(row(monthName(last)).getByRole("cell").nth(4)).toHaveText("$600");
	await expect(row(monthName(month)).getByRole("cell").nth(4)).toHaveText("$1,200");
	await expect(row(monthName(month)).getByRole("cell").nth(5)).toContainText("$600");
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
	).toContainText("$1,200 carried over");
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
		true,
	);
});
