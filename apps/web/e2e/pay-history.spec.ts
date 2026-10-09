import { expect, type Page, test } from "@playwright/test";
import { ulid } from "ulid";
import { measure } from "./overflow";
import { createTestParent } from "./parents";
import { seedSql } from "./seed-sql";
import {
	clientRendered,
	createPlannedHousehold,
	hydrated,
	pickDate,
	signedInPage,
} from "./session";

// What a Parent's pay has been, what to plan on, and a lean month (issue 159, phase b): Plan ›
// Income shows a Parent whose pay varies their last twelve months, suggests the second-lowest as
// the pay to count on, and says what is in so far with the pay to come against the rest.

let parent: Awaited<ReturnType<typeof createTestParent>>;

test.beforeEach(async () => {
	parent = await createTestParent();
});

test.afterEach(async () => {
	await parent?.remove();
});

const q = (value: string) => `'${value.replaceAll("'", "''")}'`;
const history = (page: Page) => page.getByTestId("pay-history");
const planOn = (page: Page) => history(page).getByTestId("plan-on");
const lean = (page: Page) => page.getByTestId("lean-month");
const toast = (page: Page, text: string) => page.getByRole("status").filter({ hasText: text });
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

// The twelve months before this one, oldest first: one freak month ($900), five months back
// from the newest of them.
const PAID = [4000, 4200, 3900, 5000, 4100, 900, 4300, 4800, 3800, 4500, 4000, 4600];

test("a Parent whose pay varies sees what it has been, takes what to plan on, and a lean month says what is to come", async ({
	browser,
}) => {
	test.slow();
	const page = await signedInPage(browser, parent.email, {
		viewport: { width: 1440, height: 900 },
	});
	await createPlannedHousehold(page, { baseline: "5,000", buckets: [["Groceries", "1,200"]] });
	const month = /\/month\/(\d{4}-\d{2})/.exec(page.url())?.[1];
	if (!month) throw new Error(`No month in ${page.url()}`);
	const [year = 1970, monthOf = 1] = month.split("-").map(Number);
	const household = `(select household_id from members where clerk_user_id = ${q(parent.userId)})`;
	const member = `(select id from members where clerk_user_id = ${q(parent.userId)})`;
	const monthsBack = (back: number) => Date.UTC(year, monthOf - 1 - back, 15);
	await seedSql(
		PAID.map(
			(dollars, i) =>
				`insert into income (id, household_id, date, amount_cents, note, pay_member_id) values (${q(ulid())}, ${household}, ${q(day(monthsBack(PAID.length - i)))}, ${dollars * 100}, 'Consulting', ${member})`,
		),
	);
	await page.goto(`/plan/${month}/income`);

	// Twelve months and this one as bars, with the averages, the lowest and the highest.
	await expect(history(page)).toHaveCount(1, clientRendered);
	await expect(history(page).getByTestId("pay-month")).toHaveCount(13);
	await expect(history(page).locator('[data-testid="pay-month"][data-counted]')).toHaveCount(12);
	await expect(history(page).getByTestId("pay-average-recent")).toHaveText(
		/Average, last 6 months\s*\$4,333/,
	);
	await expect(history(page).getByTestId("pay-average-year")).toHaveText(
		/Average, last 12 months\s*\$4,008/,
	);
	const freak = new Date(monthsBack(7)).toLocaleString("en-US", { month: "long", timeZone: "UTC" });
	await expect(history(page).getByTestId("pay-lowest")).toContainText("$900");
	await expect(history(page).getByTestId("pay-lowest")).toContainText(freak);
	await expect(history(page).getByTestId("pay-highest")).toContainText("$5,000");
	await expect(history(page).getByTestId("pay-history-so-far")).toHaveCount(0);

	// What to plan on: the second-lowest month, said so it can be checked, and nothing changed.
	await expect(planOn(page)).toContainText("To plan on: $3,800 a month.");
	await expect(planOn(page)).toContainText("In 11 of the last 12 months");
	await expect(planOn(page)).toContainText(`Only ${freak} ($900) was lower`);
	await expect(planOn(page)).toContainText("That makes a take-home pay of $3,800.");
	await expect(planOn(page)).toContainText("Your Plan counts on $5,000.");
	const takeHome = page.getByTestId("take-home-pay");
	await expect(takeHome).toContainText("$5,000");
	// One figure for one press: the three-month offer stands down.
	await expect(page.getByRole("button", { name: /as what you can count on/ })).toHaveCount(0);

	// Pay to come, expected by the month's last day: the month says what is in so far and what
	// is to come against the rest.
	const add = page.getByRole("button", { name: "Add pay to come" });
	await hydrated(add);
	await add.click();
	const sheet = page.getByRole("dialog");
	await sheet.getByLabel("Who it’s from").fill("Larkspur Studio");
	await sheet.getByLabel("Amount").fill("1,800");
	await pickDate(sheet, "Expected", day(Date.UTC(year, monthOf, 0)));
	await sheet.getByRole("button", { name: "Save" }).click();
	await expect(sheet).toBeHidden();
	await expect(lean(page)).toHaveCount(1);
	// "In so far" until the month's last five days, "short" in them.
	await expect(lean(page)).toContainText(
		/\$0 of the \$5,000 your Plan counts on is in so far, \$5,000 to go\.|is \$5,000 short of the \$5,000 your Plan counts on/,
	);
	await expect(lean(page)).toContainText("$1,800 of pay to come is expected by");
	await expect(lean(page)).toContainText("which would leave $3,200 to go.");
	await page.screenshot({ path: "test-results/shots/pay-history-1440.png", fullPage: true });

	// One press takes it, from this month on, with Undo; the month is then read against it.
	const use = planOn(page).getByRole("button", { name: "Use $3,800 as your take-home pay" });
	await use.click();
	await expect(toast(page, "Take-home pay is $3,800 from")).toBeVisible();
	await expect(takeHome).toContainText("$3,800");
	await expect(planOn(page)).toContainText("take-home pay of $3,800 already counts on this");
	await expect(use).toHaveCount(0);
	await expect(lean(page)).toContainText("which would leave $2,000 to go.");

	// A phone: nothing runs off the side.
	await page.setViewportSize({ width: 393, height: 852 });
	await expect(history(page).getByTestId("pay-month")).toHaveCount(13);
	const size = await measure(page);
	expect(size.sticking).toEqual([]);
	expect(size.scrollWidth).toBeLessThanOrEqual(size.width);
	await page.screenshot({ path: "test-results/shots/pay-history-393.png", fullPage: true });

	// This Month says the same.
	await page.goto(`/month/${month}`);
	await expect(lean(page)).toHaveCount(1, clientRendered);
	await expect(lean(page)).toContainText("$1,800 of pay to come is expected by");
});

test("with three months of pay it says so, and suggests nothing yet", async ({ browser }) => {
	const page = await signedInPage(browser, parent.email, {
		viewport: { width: 1440, height: 900 },
	});
	await createPlannedHousehold(page, { baseline: "5,000", buckets: [["Groceries", "1,200"]] });
	const month = /\/month\/(\d{4}-\d{2})/.exec(page.url())?.[1];
	if (!month) throw new Error(`No month in ${page.url()}`);
	const [year = 1970, monthOf = 1] = month.split("-").map(Number);
	const household = `(select household_id from members where clerk_user_id = ${q(parent.userId)})`;
	const member = `(select id from members where clerk_user_id = ${q(parent.userId)})`;
	await seedSql(
		[3000, 2400, 3600].map(
			(dollars, i) =>
				`insert into income (id, household_id, date, amount_cents, note, pay_member_id) values (${q(ulid())}, ${household}, ${q(day(Date.UTC(year, monthOf - 4 + i, 15)))}, ${dollars * 100}, 'Consulting', ${member})`,
		),
	);
	await page.goto(`/plan/${month}/income`);
	await expect(history(page)).toHaveCount(1, clientRendered);
	await expect(history(page).locator('[data-testid="pay-month"][data-counted]')).toHaveCount(3);
	await expect(history(page).getByTestId("pay-average-recent")).toHaveText(
		/Average, 3 months so far\s*\$3,000/,
	);
	await expect(history(page).getByTestId("pay-average-year")).toHaveCount(0);
	await expect(history(page).getByTestId("pay-history-so-far")).toContainText("3 months so far");
	await expect(planOn(page)).toHaveCount(0);
});
