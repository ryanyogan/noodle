import { expect, type Page, test } from "@playwright/test";
import { createTestParent } from "./parents";
import { accountKindLabel, choose, createPlannedHousehold, signedInPage } from "./session";

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
