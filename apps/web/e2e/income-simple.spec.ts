import { expect, test } from "@playwright/test";
import { ulid } from "ulid";
import { settledAxe } from "./axe";
import { measure } from "./overflow";
import { createTestParent } from "./parents";
import { seedSql } from "./seed-sql";
import { createPlannedHousehold, signedInPage } from "./session";

test("salary and contractor pay are easy to scan, with details available on demand", async ({
	browser,
}) => {
	test.slow();
	const parent = await createTestParent();
	try {
		const page = await signedInPage(browser, parent.email, {
			viewport: { width: 1440, height: 1000 },
			colorScheme: "dark",
		});
		await createPlannedHousehold(page, { baseline: "19,000", buckets: [["Groceries", "1,200"]] });
		const month = /\/month\/(\d{4}-\d{2})/.exec(page.url())?.[1];
		if (!month) throw new Error(`No month in ${page.url()}`);
		const household = `(select household_id from members where clerk_user_id = '${parent.userId}')`;
		const member = `(select id from members where clerk_user_id = '${parent.userId}')`;
		const cori = ulid();
		const schedule = JSON.stringify({ kind: "twice-a-month", days: [1, 15] });
		await seedSql([
			`update members set name = 'Ryan', paycheck_cents = 660000, pay_schedule = '${schedule}' where clerk_user_id = '${parent.userId}'`,
			`insert into members (id, household_id, kind, name) values ('${cori}', ${household}, 'parent', 'Cori')`,
			`insert into income (id, household_id, date, amount_cents, note, pay_member_id) values ('${ulid()}', ${household}, '${month}-01', 661537, 'Gusto · Chromatic', ${member})`,
			`insert into income (id, household_id, date, amount_cents, note, pay_member_id) values ('${ulid()}', ${household}, '${month}-02', 30000, 'Chroma Software', ${member})`,
			`insert into income (id, household_id, date, amount_cents, note, pay_member_id) values ('${ulid()}', ${household}, '${month}-05', 14662, 'Remote online deposit', '${cori}')`,
			`insert into income (id, household_id, date, amount_cents, note, pay_member_id) values ('${ulid()}', ${household}, '${month}-07', 146500, 'Texas OAG', '${cori}')`,
			`insert into income (id, household_id, date, amount_cents, note, kind) values ('${ulid()}', ${household}, '${month}-07', 61800, 'Venmo', 'paid-back')`,
			`insert into pay_to_come (id, household_id, member_id, from_name, amount_cents, expected_on, recorded_on) values ('${ulid()}', ${household}, '${cori}', 'Larkspur Studio', 240000, '${month}-22', '${month}-01')`,
		]);
		await page.goto(`/plan/${month}/income`);
		await expect(page.getByTestId("income-summary")).toContainText("$8,526.99");
		await expect(page.getByTestId("pay-to-come")).toContainText("Larkspur Studio");
		const ryan = page.getByTestId("person-income").filter({ hasText: "Ryan" });
		const coriPay = page.getByTestId("person-income").filter({ hasText: "Cori" });
		await expect(ryan).toContainText("$6,915.37");
		await expect(ryan.getByTestId("expected-paycheck")).toHaveCount(2);
		await expect(coriPay).toContainText("$1,611.62");
		await expect(coriPay.getByTestId("pay-to-come-total")).toContainText("$2,400");
		await expect(coriPay.getByRole("button", { name: "Add pay to come" })).toBeVisible();
		await expect(page.getByText("Still expected", { exact: true })).toHaveCount(0);
		const other = page.getByTestId("other-money-in");
		const planning = page.getByTestId("income-planning");
		await expect(other).not.toHaveAttribute("open");
		await expect(planning).not.toHaveAttribute("open");
		await page.screenshot({ path: "/tmp/noodle-income-desktop.png", fullPage: true });
		expect((await (await settledAxe(page)).analyze()).violations).toEqual([]);
		await other.locator("summary").click();
		await expect(other.getByText("Venmo", { exact: true })).toBeVisible();
		await other.getByRole("button", { name: "Change what Venmo is" }).click();
		await expect(page.getByRole("dialog", { name: "Venmo" })).toBeVisible();
		await page.keyboard.press("Escape");
		await other.locator("summary").click();
		await planning.locator("summary").first().click();
		await expect(planning.getByTestId("pay-history")).toBeVisible();
		await planning.locator("summary").first().click();
		await page.setViewportSize({ width: 393, height: 852 });
		await page.screenshot({ path: "/tmp/noodle-income-phone.png", fullPage: true });
		let size = await measure(page);
		expect(size.sticking).toEqual([]);
		expect(size.scrollWidth).toBeLessThanOrEqual(size.width);
		await coriPay.getByRole("button", { name: "Add pay to come" }).click();
		await expect(page.getByRole("dialog", { name: "Pay Cori has earned" })).toBeVisible();
		await page.getByRole("dialog").getByLabel("Who it’s from").fill("A new client");
		await page.getByRole("dialog").getByLabel("Amount").fill("850");
		await page.getByRole("dialog").getByRole("button", { name: "Save", exact: true }).click();
		await expect(page.getByRole("dialog")).toBeHidden();
		await expect(coriPay.getByTestId("pay-to-come-total")).toContainText("$3,250");
		await expect(page.getByTestId("income-summary")).toContainText("$8,526.99");
		await page.setViewportSize({ width: 320, height: 720 });
		size = await measure(page);
		expect(size.sticking).toEqual([]);
		expect(size.scrollWidth).toBeLessThanOrEqual(size.width);
		await page.context().close();
	} finally {
		await parent.remove();
	}
});
