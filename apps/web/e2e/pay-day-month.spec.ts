import { expect, type Page, test } from "@playwright/test";
import { ulid } from "ulid";
import { measure } from "./overflow";
import { createTestParent } from "./parents";
import { seedSql } from "./seed-sql";
import { createPlannedHousehold, signedInPage } from "./session";

// A paycheck counts on its pay day (issue 156, phase 2; ADR-0063): once a Parent says how they
// are paid, the paycheck the bank posted on the last day of last month for the 1st is this
// month's Income, and from the line a Parent can send it back or say the pay day by hand.

let parent: Awaited<ReturnType<typeof createTestParent>>;

test.beforeEach(async () => {
	parent = await createTestParent();
});

test.afterEach(async () => {
	await parent?.remove();
});

const q = (value: string) => `'${value.replaceAll("'", "''")}'`;
const section = (page: Page) => page.getByTestId("pay-days");
const paychecks = (page: Page) => section(page).getByTestId("expected-paycheck");
const summary = (page: Page) => page.getByTestId("income-summary");
const toast = (page: Page, text: string) => page.getByRole("status").filter({ hasText: text });
/** "Oct 1" for a day key, as the page says it. */
const shortDay = (day: string) =>
	new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", {
		month: "short",
		day: "numeric",
		timeZone: "UTC",
	});
const monthName = (month: string) =>
	new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });

/** A toast stays while the pointer rests on it, and can cover what is pressed next. */
async function gone(page: Page, text: string) {
	await expect(toast(page, text)).toBeVisible();
	await page.mouse.move(2, 2);
	await expect(toast(page, text)).toBeHidden({ timeout: 15_000 });
}

async function choose(
	page: Page,
	within: ReturnType<Page["locator"]>,
	label: string,
	option: string,
) {
	await within.getByRole("combobox", { name: label, exact: true }).click();
	await page.getByRole("listbox").getByRole("option", { name: option, exact: true }).click();
	await expect(page.getByRole("listbox")).toBeHidden();
}

async function noSidewaysScroll(page: Page) {
	const size = await measure(page);
	expect(size.sticking).toEqual([]);
	expect(size.scrollWidth).toBeLessThanOrEqual(size.width);
}

test("a paycheck posted on the last day of last month for the 1st is this month's Income, and a Parent can send it back or say the pay day by hand", async ({
	browser,
}) => {
	test.slow();
	const page = await signedInPage(browser, parent.email, {
		viewport: { width: 1280, height: 900 },
	});
	await createPlannedHousehold(page, { baseline: "5,000", buckets: [["Groceries", "1,200"]] });
	const month = /\/month\/(\d{4}-\d{2})/.exec(page.url())?.[1];
	if (!month) throw new Error(`No month in ${page.url()}`);
	const first = `${month}-01`;
	const posted = new Date(Date.parse(`${first}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
	const last = posted.slice(0, 7);

	// Money in that counts as Income and is nobody's pay yet, posted the day before the 1st.
	const incomeId = ulid();
	const household = `(select household_id from members where clerk_user_id = ${q(parent.userId)})`;
	await seedSql([
		`insert into income (id, household_id, date, amount_cents, note) values (${q(incomeId)}, ${household}, ${q(posted)}, 248055, 'Harbor Freight Lines payroll')`,
	]);
	await page.goto(`/plan/${month}/income`);
	await expect(summary(page)).not.toContainText("$2,480.55");

	// The Parent says how they are paid: $2,500 on the 1st and the 15th.
	const row = section(page).getByTestId("parent-pay");
	const name = ((await row.locator("span").first().textContent()) ?? "").trim();
	await row.getByRole("button", { name: `Edit how ${name} is paid` }).click();
	const sheet = page.getByRole("dialog", { name: `How ${name} is paid` });
	await choose(page, sheet, "Paid", "Salary");
	await sheet.getByLabel("One paycheck").fill("2,500");
	await sheet.getByRole("button", { name: "Save" }).click();
	await expect(sheet).toBeHidden();
	await gone(page, `${name} is paid a salary: $2,500 a paycheck`);

	// The deposit is the pay for the 1st: In, with the day it posted, and this month's Income.
	await expect(paychecks(page)).toHaveCount(2);
	await expect(paychecks(page).nth(0)).toHaveAttribute("data-state", "in");
	await expect(paychecks(page).nth(0)).toContainText("$2,480.55");
	await expect(paychecks(page).nth(0)).toContainText(`Posted ${shortDay(posted)}`);
	await expect(summary(page)).toContainText("$2,480.55");
	const table = page
		.getByRole("table", { name: /Income/ })
		.or(page.getByRole("grid", { name: /Income/ }));
	await expect(table.first()).toContainText("Harbor Freight Lines payroll");
	await expect(table.first()).toContainText(`pay for ${shortDay(first)}`);
	await expect(section(page).getByTestId("pay-not-moved")).toHaveCount(0);
	// Last month no longer has it.
	await page.goto(`/plan/${last}/income`);
	await expect(page.getByRole("heading", { name: "Income this month" })).toBeVisible();
	await expect(summary(page)).not.toContainText("$2,480.55");

	// Transactions still lists it on the day it landed, saying which pay day it is the pay for.
	await page.goto(`/transactions/${last}`);
	const line = page
		.locator("[data-transaction]")
		.filter({ hasText: "Harbor Freight Lines payroll" });
	await expect(line).toHaveCount(1);
	await expect(line.locator("[data-slot=row-pay-for]")).toHaveText(`pay for ${shortDay(first)}`);

	// From the line: "Not a paycheck for a pay day" sends it back to the month it landed in.
	await page.goto(`/transactions/${last}/${incomeId}`);
	const editor = page.getByRole("region", { name: "Harbor Freight Lines payroll" });
	const choice = editor.getByRole("combobox", { name: "This is the pay for…" });
	await expect(choice).toContainText(`Pay for ${shortDay(first)}`);
	await expect(editor).toContainText(
		`It landed ${shortDay(posted)} and counts in ${monthName(month)}’s Income.`,
	);
	await choose(page, editor, "This is the pay for…", "Not a paycheck for a pay day");
	await gone(page, `Counts in ${monthName(last)}, the month it landed`);
	await expect(choice).toContainText("Not a paycheck for a pay day");
	await expect(editor).toContainText(
		`It counts in ${monthName(last)}’s Income, the month it landed.`,
	);
	await page.goto(`/plan/${last}/income`);
	await expect(summary(page)).toContainText("$2,480.55");
	await page.goto(`/plan/${month}/income`);
	await expect(paychecks(page)).toHaveCount(2);
	await expect(summary(page)).not.toContainText("$2,480.55");
	// Said by hand, so the pay day is not read as In from it again.
	await expect(paychecks(page).nth(0)).not.toHaveAttribute("data-state", "in");
	await page.goto(`/transactions/${last}`);
	await expect(line).toHaveCount(1);
	await expect(line).not.toContainText("pay for");

	// And the pay day by hand moves it again; the server keeps it.
	await page.goto(`/transactions/${last}/${incomeId}`);
	await choose(page, editor, "This is the pay for…", `Pay for ${shortDay(first)}`);
	await gone(page, `Counts as the pay for ${shortDay(first)}`);
	await page.goto(`/plan/${month}/income`);
	await expect(paychecks(page).nth(0)).toHaveAttribute("data-state", "in");
	await expect(summary(page)).toContainText("$2,480.55");
	await page.goto(`/plan/${last}/income`);
	await expect(page.getByRole("heading", { name: "Income this month" })).toBeVisible();
	await expect(summary(page)).not.toContainText("$2,480.55");
	// This Month counts it too.
	await page.goto(`/month/${month}`);
	await expect(
		page
			.getByRole("region", { name: "Income" })
			.getByText("$2,480.55 received of $5,000 usual take-home pay"),
	).toBeVisible();

	// A phone: nothing runs off the side on Plan › Income, the row, or the line with its choice.
	await page.setViewportSize({ width: 320, height: 720 });
	await page.goto(`/plan/${month}/income`);
	await expect(paychecks(page)).toHaveCount(2);
	await expect(page.getByText(`pay for ${shortDay(first)}`).first()).toBeVisible();
	await noSidewaysScroll(page);
	await page.goto(`/transactions/${last}`);
	await expect(line).toHaveCount(1);
	await expect(line.getByText(`pay for ${shortDay(first)} · Typed in`)).toBeVisible();
	await noSidewaysScroll(page);
	await page.goto(`/transactions/${last}/${incomeId}`);
	await expect(choice).toContainText(`Pay for ${shortDay(first)}`);
	await noSidewaysScroll(page);
});
