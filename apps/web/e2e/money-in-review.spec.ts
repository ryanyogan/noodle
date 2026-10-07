import { expect, type Page, test } from "@playwright/test";
import { ulid } from "ulid";
import { createTestParent } from "./parents";
import { seedSql } from "./seed-sql";
import {
	accountKindLabel,
	choose,
	createPlannedHousehold,
	hydrated,
	signedInPage,
} from "./session";

// Money in from a bank, start to end (issues 131 and 133): what a person sent waits in Review,
// where naming it Income asks whose pay it is and naming it a Transfer asks which Account it came
// from; Plan › Income says a Parent's range when their pay varies and offers its low end as what
// to count on; and a Rule gives the next Import's deposit to its Parent.

let parent: Awaited<ReturnType<typeof createTestParent>>;

test.beforeEach(async () => {
	parent = await createTestParent();
});

test.afterEach(async () => {
	await parent?.remove();
});

const PAY = "ACME CORP PAYROLL 0042";
const STEADY = "BRIGHT CO DIRECT DEP 7781";
const CASEY = "Zelle payment from CASEY LOWE 24816357";
const JORDAN = "Zelle payment from JORDAN PIKE 99887766";

const toast = (page: Page, text: string | RegExp) =>
	page.getByRole("status").filter({ hasText: text });
const income = (page: Page) => page.getByRole("region", { name: "Income" });

async function addAccount(page: Page, name: string, kind: "checking" | "savings", balance: string) {
	await page.getByRole("link", { name: "Accounts", exact: true }).click();
	await expect(page.getByRole("heading", { level: 1 })).toHaveText("Accounts");
	if (await page.getByRole("region", { name: "Totals" }).isVisible()) {
		await expect(async () => {
			await page.getByRole("button", { name: "Add Account" }).click();
			await expect(page.getByLabel("Name")).toBeVisible({ timeout: 1000 });
		}).toPass();
	}
	await page.getByLabel("Name").fill(name);
	await choose(page, "Kind", accountKindLabel(kind));
	await page.getByLabel("Balance now").fill(balance);
	await page.getByRole("button", { name: "Add Account" }).click();
	await expect(page.getByRole("link", { name: new RegExp(`^${name}, `) })).toBeVisible();
}

/** Money into the checking Account, as its bank's CSV says it. */
async function upload(
	page: Page,
	file: string,
	lines: [date: string, what: string, amount: string][],
) {
	await page.getByRole("link", { name: "Accounts", exact: true }).click();
	await page.getByRole("link", { name: /^Everyday Checking, / }).click();
	await expect(page.locator("[data-slot=detail-title]:visible")).toContainText("Everyday Checking");
	const csv = [
		"Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #",
		...lines.map(
			([date, what, amount]) => `CREDIT,${date},"${what}",${amount},ACH_CREDIT,9000.00,`,
		),
	].join("\n");
	await page.getByRole("button", { name: "Upload statement" }).click();
	const sheet = page.getByRole("dialog", { name: "Upload a statement" });
	await sheet
		.getByLabel("Statement file")
		.setInputFiles({ name: file, mimeType: "text/csv", buffer: Buffer.from(csv) });
	await sheet.getByRole("button", { name: /^Import \d+ lines?$/ }).click();
	await expect(sheet).toBeHidden();
	await expect(toast(page, file).first()).toBeVisible();
}

test("money in is named in Review with whose pay and its Account, and Plan › Income says a Parent’s range", async ({
	browser,
}) => {
	test.slow();
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, { baseline: "5,000", buckets: [["Groceries", "1,200"]] });
	const thisMonth = page.url();
	const month = /\/month\/(\d{4}-\d{2})/.exec(thisMonth)?.[1];
	if (!month) throw new Error(`No month in ${thisMonth}`);
	await addAccount(page, "Ally savings", "savings", "10,000");
	await addAccount(page, "Everyday Checking", "checking", "4,000");

	// Four months of two paychecks, one that varies, and two people sending money this month.
	const [year, monthOf] = month.split("-").map(Number) as [number, number];
	const today = await page.evaluate(() => {
		const now = new Date();
		return `${String(now.getMonth() + 1).padStart(2, "0")}/${String(now.getDate()).padStart(2, "0")}/${now.getFullYear()}`;
	});
	const before = (back: number) => {
		const day = new Date(year, monthOf - 1 - back, 15);
		return `${String(day.getMonth() + 1).padStart(2, "0")}/15/${day.getFullYear()}`;
	};
	await upload(page, "checking.csv", [
		[before(3), PAY, "2100.00"],
		[before(3), STEADY, "2500.00"],
		[before(2), PAY, "2900.00"],
		[before(2), STEADY, "2500.00"],
		[before(1), PAY, "2500.00"],
		[before(1), STEADY, "2500.00"],
		[today, PAY, "1840.00"],
		[today, STEADY, "2500.00"],
		[today, CASEY, "300.00"],
		[today, JORDAN, "75.00"],
	]);

	// Review: what people sent waits, and nothing says the Parent is done.
	await page.goto(new URL("/review", thisMonth).href);
	const waiting = page.getByTestId("money-in-review");
	const row = (who: string) => waiting.getByTestId("money-in-row").filter({ hasText: who });
	await expect(row("CASEY LOWE")).toBeVisible({ timeout: 30_000 });
	await expect(row("JORDAN PIKE")).toBeVisible();
	await expect(page.getByText("Money in still to look at")).toBeVisible();
	await expect(page.getByText("Nothing to review")).toHaveCount(0);

	// Income asks whose pay it is, there in Review.
	const whosePay = row("CASEY LOWE").getByTestId("whose-pay-offer");
	await expect(async () => {
		if (!(await whosePay.isVisible()))
			await row("CASEY LOWE")
				.getByRole("button", { name: "Income", exact: true })
				.click({ timeout: 2_000 });
		await expect(whosePay).toBeVisible({ timeout: 3_000 });
	}).toPass();
	const first = whosePay
		.getByRole("group", { name: "Whose pay is it?" })
		.getByRole("button")
		.first();
	const name = ((await first.textContent()) ?? "").trim();
	expect(name).not.toBe("The Household");
	await first.click();
	await expect(toast(page, `$300 is ${name}’s pay`)).toBeVisible();
	await expect(whosePay).toContainText(`Always treat deposits from ${CASEY} as ${name}’s pay?`);
	await whosePay.getByRole("button", { name: "Not now" }).click();
	await expect(row("CASEY LOWE")).toHaveCount(0);

	// A Transfer asks which Account it came from, and remembers the pair.
	await row("JORDAN PIKE").getByRole("button", { name: "Transfer", exact: true }).click();
	const pair = row("JORDAN PIKE").getByTestId("account-pair-offer");
	await pair.getByRole("button", { name: "Ally savings" }).click();
	await expect(pair).toContainText(
		"Always treat money from Ally savings into Everyday Checking as a Transfer?",
	);
	await pair.getByRole("button", { name: "Yes, always" }).click();
	await expect(
		toast(page, "Money from Ally savings into Everyday Checking is always a Transfer now"),
	).toBeVisible();
	await expect(waiting).toHaveCount(0);
	await expect(page.getByText("Nothing to review")).toBeVisible();

	// Plan › Income: the Transfer isn't Income; the varying paycheck is said to be this Parent's.
	await page.goto(`/plan/${month}/income`);
	const table = income(page).getByRole("table", { name: /^Income in / });
	await expect(table).toContainText("ACME CORP PAYROLL");
	await expect(table).not.toContainText("JORDAN PIKE");
	const whose = table.getByRole("combobox", { name: /^Whose pay is \$1,840 from / });
	await expect(async () => {
		await whose.click({ timeout: 2_000 });
		await expect(page.getByRole("option", { name, exact: true })).toBeVisible({ timeout: 2_000 });
	}).toPass();
	await page.getByRole("option", { name, exact: true }).click();
	const said = toast(page, `$1,840 is ${name}’s pay`);
	await said.getByRole("button", { name: /^Always treat deposits from .+ as .+’s pay$/ }).click();
	// Said once the month's lists have been read again, which a busy server takes a while over.
	await expect(toast(page, /pay from now on, and 3 already here are too/)).toBeVisible({
		timeout: 30_000,
	});

	// Three full months of it, so the range is said, and its low end is offered to count on.
	const totals = income(page).getByRole("region", { name: "Whose pay" });
	await expect(totals).toContainText("$2,140 so far · usually $2,100–$2,900");
	// The offer sits with the Take-home pay, above the Income list.
	await page.getByRole("button", { name: "Use $4,600 as what you can count on" }).click();
	await expect(toast(page, /^Take-home pay is \$4,600 from /)).toBeVisible();
	await expect(income(page)).toContainText("of $4,600 usual take-home pay");

	// The Rule says whose pay it sets, and the next Import's paycheck is that Parent's unasked.
	await page.goto(new URL("/review/rules", thisMonth).href);
	const rules = page.getByTestId("money-in-rules");
	await expect(rules).toContainText(`Always Income, ${name}’s pay`, { timeout: 30_000 });
	await upload(page, "more.csv", [[today, PAY, "500.00"]]);
	await page.goto(`/plan/${month}/income`);
	// Whose pay is said once the month's money in has been read, after the table's rows are there.
	await expect(table.getByRole("combobox", { name: /^Whose pay is \$500 from / })).toContainText(
		name,
		{ timeout: 30_000 },
	);
	await expect(totals).toContainText("$2,640 so far");
	await page.context().close();
});

// Money into checking that reads as a refund waits in Review with Refund suggested (issue 141):
// it is nobody's Income meanwhile, a tax refund is still Income, and naming it a Refund goes on to
// its purchase, whose Bucket gets the money back.
test("a refund into checking waits in Review with Refund first, and counts nowhere as Income until it is named", async ({
	browser,
}) => {
	test.setTimeout(240_000);
	const page = await signedInPage(browser, parent.email);
	await page.setViewportSize({ width: 1440, height: 900 });
	const made = await createPlannedHousehold(page, {
		baseline: "5,000",
		buckets: [["Kids", "300"]],
	});
	const kids = made?.bucketIds.Kids;
	if (!kids) throw new Error("The Household wasn't made directly");
	const thisMonth = page.url();
	const month = /\/month\/(\d{4}-\d{2})/.exec(thisMonth)?.[1];
	if (!month) throw new Error(`No month in ${thisMonth}`);
	await addAccount(page, "Everyday Checking", "checking", "4,000");

	// The purchase the refund is for, earlier this month (a Quick Add, written straight in).
	const q = (value: string) => `'${value.replaceAll("'", "''")}'`;
	const household = `(select household_id from members where clerk_user_id = ${q(parent.userId)})`;
	const member = `(select id from members where clerk_user_id = ${q(parent.userId)})`;
	await seedSql([
		`insert into transactions (id, household_id, source, date, amount_cents, note, bucket_id, created_by_member_id) values (${q(ulid())}, ${household}, 'quick-add', ${q(`${month}-01`)}, 6000, 'Amazon order', ${q(kids)}, ${member});`,
	]);

	const today = await page.evaluate(() => {
		const now = new Date();
		return `${String(now.getMonth() + 1).padStart(2, "0")}/${String(now.getDate()).padStart(2, "0")}/${now.getFullYear()}`;
	});
	await upload(page, "refunds.csv", [
		[today, "AMAZON REFUND 42.10", "42.10"],
		[today, "IRS TREAS 310 TAX REFUND", "310.00"],
		[today, PAY, "1840.00"],
		[today, CASEY, "300.00"],
	]);

	// Review: the refund and what a person sent wait; the tax refund and the paycheck don't.
	await page.goto(new URL("/review", thisMonth).href);
	const waiting = page.getByTestId("money-in-review");
	const row = (what: string) => waiting.getByTestId("money-in-row").filter({ hasText: what });
	await expect(row("AMAZON REFUND")).toBeVisible({ timeout: 30_000 });
	await expect(row("CASEY LOWE")).toBeVisible();
	await expect(waiting.getByTestId("money-in-row")).toHaveCount(2);
	await expect(waiting).toContainText("or that reads as a refund");

	// Refund is first and described as suggested, and isn't chosen: nothing is pressed.
	const kinds = (what: string) =>
		row(what)
			.getByRole("group", { name: /^What is this money\?/ })
			.getByRole("button");
	await expect(kinds("AMAZON REFUND").first()).toHaveText("Refund");
	await expect(kinds("AMAZON REFUND").first()).toHaveAttribute("aria-pressed", "false");
	await expect(kinds("AMAZON REFUND").first()).toHaveAttribute("data-suggested", "");
	await expect(kinds("AMAZON REFUND").first()).toHaveAccessibleDescription(
		"This reads as a Refund, so it’s first. It isn’t one until you say so.",
	);
	await expect(row("AMAZON REFUND").getByTestId("money-in-suggested")).toBeVisible();
	// What a person sent has nothing suggested: Income is first, as everywhere.
	await expect(kinds("CASEY LOWE").first()).toHaveText("Income");
	await expect(row("CASEY LOWE").getByTestId("money-in-suggested")).toHaveCount(0);
	await page.setViewportSize({ width: 393, height: 852 });
	await expect(row("AMAZON REFUND").getByTestId("money-in-suggested")).toBeVisible();
	await page.setViewportSize({ width: 1440, height: 900 });

	// Meanwhile it is nobody's Income: only the paycheck and the tax refund are received.
	await page.goto(`/month/${month}`);
	await expect(page.getByRole("region", { name: "Income" })).toContainText("$2,150 received", {
		timeout: 30_000,
	});
	await page.goto(`/plan/${month}/income`);
	const table = income(page).getByRole("table", { name: /^Income in / });
	await expect(table).toContainText("IRS TREAS 310 TAX REFUND", { timeout: 30_000 });
	await expect(table).toContainText("ACME CORP PAYROLL");
	await expect(table).not.toContainText("AMAZON REFUND");
	await expect(table).not.toContainText("CASEY LOWE");

	// Pressing Refund goes on to its purchase.
	await page.goto(new URL("/review", thisMonth).href);
	const refund = kinds("AMAZON REFUND").first();
	await expect(refund).toBeVisible({ timeout: 30_000 });
	await hydrated(refund);
	await refund.click();
	const linking = row("AMAZON REFUND").getByTestId("refund-link");
	await expect(linking).toContainText("Which purchase is this a Refund for?");
	await linking.getByRole("button", { name: "Link to Amazon order, $60" }).click();
	await expect(toast(page, "Linked.")).toBeVisible();
	await expect(linking).toContainText("A Refund for Amazon order");
	await row("AMAZON REFUND")
		.getByRole("button", { name: /^Done with / })
		.click();
	await expect(row("AMAZON REFUND")).toHaveCount(0);

	// The purchase's Bucket has the money back, and it still isn't Income.
	await page.goto(`/month/${month}`);
	await expect(page.getByRole("region", { name: "Income" })).toContainText("$2,150 received", {
		timeout: 30_000,
	});
	await expect
		.poll(async () => (await page.locator("main").innerText()).replace(/\s+/g, " "))
		.toContain("Kids $17.90 spent");
	await page.context().close();
});
