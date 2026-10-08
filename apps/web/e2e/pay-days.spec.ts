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

// How each Parent is paid, on Plan › Income (issue 156, phase 1): hourly until a Parent says, or
// on a salary with one paycheck and its pay days, whose expected paychecks are listed for the
// month and read In once Income that is that Parent's pay has landed near the pay day.

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
const toast = (page: Page, text: string) => page.getByRole("status").filter({ hasText: text });
/** "Oct 1" for a day key, as the page says it. */
const shortDay = (day: string) =>
	new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", {
		month: "short",
		day: "numeric",
		timeZone: "UTC",
	});

async function choose(
	page: Page,
	sheet: ReturnType<Page["getByRole"]>,
	label: string,
	option: string,
) {
	await sheet.getByRole("combobox", { name: label, exact: true }).click();
	await page.getByRole("listbox").getByRole("option", { name: option, exact: true }).click();
	await expect(page.getByRole("listbox")).toBeHidden();
}

test("a Parent on a salary sees a paycheck for each pay day, In once their pay has landed near it; hourly lists none", async ({
	browser,
}) => {
	test.slow();
	const page = await signedInPage(browser, parent.email, {
		viewport: { width: 1280, height: 900 },
	});
	await createPlannedHousehold(page, { baseline: "5,000", buckets: [["Groceries", "1,200"]] });
	const month = /\/month\/(\d{4}-\d{2})/.exec(page.url())?.[1];
	if (!month) throw new Error(`No month in ${page.url()}`);
	await page.goto(`/plan/${month}/income`);

	// Hourly, or pay that varies, until a Parent says: nothing is listed and nothing else changes.
	const row = section(page).getByTestId("parent-pay");
	await expect(row).toHaveCount(1, clientRendered);
	await expect(row).toContainText("Hourly, or pay that varies");
	await expect(paychecks(page)).toHaveCount(0);
	const name = ((await row.locator("span").first().textContent()) ?? "").trim();
	expect(name).not.toBe("");

	// A salary: one paycheck, twice a month, starting from the 1st and the 15th.
	await row.getByRole("button", { name: `Edit how ${name} is paid` }).click();
	const sheet = page.getByRole("dialog", { name: `How ${name} is paid` });
	await choose(page, sheet, "Paid", "Salary");
	await expect(sheet.getByRole("combobox", { name: "How often" })).toContainText("Twice a month");
	await expect(sheet.getByRole("combobox", { name: "First pay day" })).toContainText("1st");
	await expect(sheet.getByRole("combobox", { name: "Second pay day" })).toContainText("15th");
	// Without an amount it isn't saved.
	await sheet.getByRole("button", { name: "Save" }).click();
	await expect(sheet.getByText("Enter what one paycheck usually is")).toBeVisible();
	await sheet.getByLabel("One paycheck").fill("2,500");
	await sheet.getByRole("button", { name: "Save" }).click();
	await expect(sheet).toBeHidden();
	await expect(toast(page, `${name} is paid a salary: $2,500 a paycheck`)).toBeVisible();
	await expect(row).toContainText(
		"Salary · $2,500 a paycheck · Twice a month, on the 1st and the 15th",
	);

	// Two expected paychecks, neither in: no Income is this Parent's pay yet.
	const first = `${month}-01`;
	await expect(paychecks(page)).toHaveCount(2);
	await expect(paychecks(page).nth(0)).toContainText(`Pay for ${shortDay(first)}`);
	await expect(paychecks(page).nth(1)).toContainText(`Pay for ${shortDay(`${month}-15`)}`);
	for (const index of [0, 1]) {
		await expect(paychecks(page).nth(index)).toContainText(/Expected|Hasn’t come in/);
		await expect(paychecks(page).nth(index)).toContainText("$2,500");
	}

	// Their pay lands the day before the 1st, a few dollars different: that pay day is In, with
	// what came and the day it posted. The Income itself stays where it landed, last month.
	const posted = new Date(Date.parse(`${first}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
	const household = `(select household_id from members where clerk_user_id = ${q(parent.userId)})`;
	const member = `(select id from members where clerk_user_id = ${q(parent.userId)})`;
	await seedSql([
		`insert into income (id, household_id, date, amount_cents, note, pay_member_id) values (${q(ulid())}, ${household}, ${q(posted)}, 248055, 'Harbor Freight Lines payroll', ${member})`,
	]);
	await page.reload();
	await expect(paychecks(page)).toHaveCount(2);
	await expect(paychecks(page).nth(0)).toHaveAttribute("data-state", "in");
	await expect(paychecks(page).nth(0)).toContainText("In");
	await expect(paychecks(page).nth(0)).toContainText("$2,480.55");
	await expect(paychecks(page).nth(0)).toContainText(`Posted ${shortDay(posted)}`);
	await expect(paychecks(page).nth(1)).not.toHaveAttribute("data-state", "in");
	await expect(page.getByTestId("income-summary")).not.toContainText("$2,480.55");

	// A phone: nothing runs off the side, with the list and with the form open.
	await page.setViewportSize({ width: 320, height: 720 });
	await expect(paychecks(page)).toHaveCount(2);
	let size = await measure(page);
	expect(size.sticking).toEqual([]);
	expect(size.scrollWidth).toBeLessThanOrEqual(size.width);
	await row.getByRole("button", { name: `Edit how ${name} is paid` }).click();
	await expect(sheet.getByLabel("One paycheck")).toHaveValue("2,500");
	size = await measure(page);
	expect(size.sticking).toEqual([]);
	expect(size.scrollWidth).toBeLessThanOrEqual(size.width);

	// Back to hourly: the list goes, and the server keeps it.
	await choose(page, sheet, "Paid", "Hourly, or pay that varies");
	await sheet.getByRole("button", { name: "Save" }).click();
	await expect(sheet).toBeHidden();
	await expect(row).toContainText("Hourly, or pay that varies");
	await expect(paychecks(page)).toHaveCount(0);
	await page.reload();
	await expect(row).toContainText("Hourly, or pay that varies");
	await expect(paychecks(page)).toHaveCount(0);
});

test("monthly pay on the 31st is listed on a shorter month's last day", async ({ browser }) => {
	test.slow();
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, { baseline: "5,000", buckets: [["Groceries", "1,200"]] });
	const month = /\/month\/(\d{4}-\d{2})/.exec(page.url())?.[1];
	if (!month) throw new Error(`No month in ${page.url()}`);
	await page.goto(`/plan/${month}/income`);
	const row = section(page).getByTestId("parent-pay");
	await row.getByRole("button", { name: /^Edit how .+ is paid$/ }).click();
	const sheet = page.getByRole("dialog", { name: /^How .+ is paid$/ });
	await choose(page, sheet, "Paid", "Salary");
	await sheet.getByLabel("One paycheck").fill("4,000");
	await choose(page, sheet, "How often", "Monthly");
	await expect(sheet.getByRole("combobox", { name: "Second pay day" })).toHaveCount(0);
	await choose(page, sheet, "Pay day", "31st");
	await expect(
		sheet.getByText("In a month without that day, it’s the month’s last day."),
	).toBeVisible();
	await sheet.getByRole("button", { name: "Save" }).click();
	await expect(sheet).toBeHidden();
	await expect(row).toContainText("Salary · $4,000 a paycheck · Monthly, on the 31st");

	const [year, monthNumber] = month.split("-").map(Number);
	const last = new Date(Date.UTC(year ?? 1970, monthNumber ?? 1, 0)).toISOString().slice(0, 10);
	await expect(paychecks(page)).toHaveCount(1);
	await expect(paychecks(page)).toContainText(`Pay for ${shortDay(last)}`);
});

test("pay every two weeks or weekly is counted from one pay day, and a month with a pay day more than most says so", async ({
	browser,
}) => {
	test.slow();
	const page = await signedInPage(browser, parent.email, {
		viewport: { width: 1280, height: 900 },
	});
	await createPlannedHousehold(page, { baseline: "5,000", buckets: [["Groceries", "1,200"]] });
	const month = /\/month\/(\d{4}-\d{2})/.exec(page.url())?.[1];
	if (!month) throw new Error(`No month in ${page.url()}`);
	await page.goto(`/plan/${month}/income`);
	const row = section(page).getByTestId("parent-pay");
	await row.getByRole("button", { name: /^Edit how .+ is paid$/ }).click();
	const sheet = page.getByRole("dialog", { name: /^How .+ is paid$/ });
	await choose(page, sheet, "Paid", "Salary");
	await sheet.getByLabel("One paycheck").fill("1,800");
	await choose(page, sheet, "How often", "Every two weeks");
	// One pay day in place of days of the month, and it isn't saved until one is picked.
	await expect(sheet.getByRole("combobox", { name: "First pay day" })).toHaveCount(0);
	await sheet.getByRole("button", { name: "Save" }).click();
	await expect(sheet.getByText("Pick one of the pay days")).toBeVisible();
	// Counted from the 1st: the 1st, the 15th and, in any month but a 28-day February, the 29th.
	const first = `${month}-01`;
	await pickDate(sheet, "A pay day", first);
	await sheet.getByRole("button", { name: "Save" }).click();
	await expect(sheet).toBeHidden();
	const weekday = new Date(`${first}T00:00:00Z`).toLocaleDateString("en-US", {
		weekday: "long",
		timeZone: "UTC",
	});
	await expect(row).toContainText(
		`Salary · $1,800 a paycheck · Every two weeks, on a ${weekday}, counted from ${shortDay(first)}`,
	);
	const [year, monthNumber] = month.split("-").map(Number);
	const days = new Date(Date.UTC(year ?? 1970, monthNumber ?? 1, 0)).getUTCDate();
	const twoWeekly = days >= 29 ? 3 : 2;
	await expect(paychecks(page)).toHaveCount(twoWeekly);
	await expect(paychecks(page).nth(1)).toContainText(`Pay for ${shortDay(`${month}-15`)}`);
	const more = section(page).getByTestId("extra-pay-day");
	if (twoWeekly === 3) {
		await expect(more).toContainText("has 3 pay days, one more than most months");
		await expect(more).toContainText("Extra income");
	} else await expect(more).toHaveCount(0);

	// Weekly, from the same day, kept by the server: every seventh day.
	await page.reload();
	await row.getByRole("button", { name: /^Edit how .+ is paid$/ }).click();
	await expect(sheet.getByRole("combobox", { name: "How often" })).toContainText("Every two weeks");
	await choose(page, sheet, "How often", "Weekly");
	await sheet.getByRole("button", { name: "Save" }).click();
	await expect(sheet).toBeHidden();
	await expect(row).toContainText(`Weekly, on ${weekday}s`);
	await expect(paychecks(page)).toHaveCount(days >= 29 ? 5 : 4);
	await expect(paychecks(page).nth(1)).toContainText(`Pay for ${shortDay(`${month}-08`)}`);

	// A phone: nothing runs off the side, with the list and with the form open.
	await page.setViewportSize({ width: 320, height: 720 });
	let size = await measure(page);
	expect(size.sticking).toEqual([]);
	expect(size.scrollWidth).toBeLessThanOrEqual(size.width);
	await row.getByRole("button", { name: /^Edit how .+ is paid$/ }).click();
	await expect(sheet.getByLabel("One paycheck")).toHaveValue("1,800");
	size = await measure(page);
	expect(size.sticking).toEqual([]);
	expect(size.scrollWidth).toBeLessThanOrEqual(size.width);
});

test("a pay day that hasn't come in is said on This Month and in the Check-in, until the pay is in", async ({
	browser,
}) => {
	test.slow();
	const page = await signedInPage(browser, parent.email, {
		viewport: { width: 1280, height: 900 },
	});
	await createPlannedHousehold(page, { baseline: "5,000", buckets: [["Groceries", "1,200"]] });
	const month = /\/month\/(\d{4}-\d{2})/.exec(page.url())?.[1];
	if (!month) throw new Error(`No month in ${page.url()}`);
	const ago = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
	// Paid monthly, on the day eight days ago: its five days after are over. Noodle has had
	// Income for twenty days, so the pay day a month before that is from before its records.
	const due = ago(8);
	const household = `(select household_id from members where clerk_user_id = ${q(parent.userId)})`;
	const member = `(select id from members where clerk_user_id = ${q(parent.userId)})`;
	const schedule = JSON.stringify({ kind: "monthly", day: Number(due.slice(8)) });
	await seedSql([
		`update members set paycheck_cents = 250000, pay_schedule = ${q(schedule)} where clerk_user_id = ${q(parent.userId)}`,
		`insert into income (id, household_id, date, amount_cents, note) values (${q(ulid())}, ${household}, ${q(ago(20))}, 4200, 'Interest earned')`,
	]);
	const said = new RegExp(`’s pay for ${shortDay(due)} hasn’t come in`);

	await page.goto(`/month/${month}`);
	const late = page.getByTestId("late-pay");
	await expect(late.getByRole("listitem")).toHaveCount(1);
	await expect(late).toContainText(said);
	await expect(late).toContainText("About $2,500 was due");
	await expect(page.getByRole("region", { name: "To do" })).toContainText("Pay hasn’t come in");

	// A phone: the closed strip names it, and nothing runs off the side with it open.
	await page.setViewportSize({ width: 320, height: 720 });
	const strip = page.getByRole("region", { name: "To do" }).getByRole("button").first();
	await expect(strip).toContainText("Pay hasn’t come in");
	await hydrated(strip);
	await strip.click();
	await expect(late).toContainText(said);
	let size = await measure(page);
	expect(size.sticking).toEqual([]);
	expect(size.scrollWidth).toBeLessThanOrEqual(size.width);

	// The Check-in says it too, over its cards, and the line leads to that month's Plan › Income.
	await page.goto("/check-in");
	await expect(late).toContainText(said);
	size = await measure(page);
	expect(size.sticking).toEqual([]);
	expect(size.scrollWidth).toBeLessThanOrEqual(size.width);
	await page.setViewportSize({ width: 1280, height: 900 });
	const link = late.getByRole("link", { name: said });
	await hydrated(link);
	await link.click();
	await expect(page).toHaveURL(new RegExp(`/plan/${due.slice(0, 7)}/income`));
	const row = paychecks(page).filter({ hasText: `Pay for ${shortDay(due)}` });
	await expect(row).toHaveAttribute("data-state", "late");
	await expect(row).toContainText("Hasn’t come in");

	// The pay lands a day after the pay day: it is In, and nothing says it hasn't come in.
	await seedSql([
		`insert into income (id, household_id, date, amount_cents, note, pay_member_id) values (${q(ulid())}, ${household}, ${q(ago(7))}, 251040, 'Harbor Freight Lines payroll', ${member})`,
	]);
	await page.reload();
	await expect(row).toHaveAttribute("data-state", "in");
	await page.goto(`/month/${month}`);
	await expect(page.getByRole("region", { name: "Free to Spend" })).toBeVisible();
	await expect(page.getByRole("heading", { name: "Buckets" })).toBeVisible();
	await expect(late).toHaveCount(0);
	await page.goto("/check-in");
	await expect(page.getByRole("heading", { name: "Check-in" })).toBeVisible();
	await expect(late).toHaveCount(0);
});
