import { expect, type Page, type Route, test } from "@playwright/test";
import { createTestParent } from "./parents";
import { createPlannedHousehold, serverFn, signedInPage } from "./session";

let parent: Awaited<ReturnType<typeof createTestParent>>;

test.beforeEach(async () => {
	parent = await createTestParent();
});

test.afterEach(async () => {
	await parent?.remove();
});

const summary = (page: Page) => page.getByRole("region", { name: "Free to Spend" });
const freeToSpend = (page: Page) => summary(page).getByRole("definition").last();
const amount = (page: Page, commitment: string) =>
	page.getByLabel(`${commitment} amount`, { exact: true });
const addForm = (page: Page) => page.getByRole("form", { name: "Add a Commitment" });
const commitmentRow = (page: Page, name: string) =>
	page.getByRole("listitem", { name: new RegExp(`^${name}: `) });

/** Plans $9,000 with a $1,200 Groceries Bucket, opens the Plan editor, and returns its month. */
async function openPlan(page: Page) {
	await createPlannedHousehold(page, { baseline: "9,000", buckets: [["Groceries", "1,200"]] });
	await page.getByRole("link", { name: "Edit Plan" }).click();
	await expect(freeToSpend(page)).toHaveText("$7,800");
	const month = /\/month\/(\d{4}-\d{2})\//.exec(page.url())?.[1];
	if (!month) throw new Error(`No month in ${page.url()}`);
	return month;
}

function nextMonth(month: string) {
	const [year = 0, m = 0] = month.split("-").map(Number);
	return m === 12 ? `${year + 1}-01` : `${year}-${String(m + 1).padStart(2, "0")}`;
}

async function addCommitment(
	page: Page,
	{
		name,
		due,
		cadence,
		dueDate,
	}: { name: string; due: string; cadence?: string; dueDate?: string },
) {
	const form = addForm(page);
	await form.getByLabel("New Commitment").fill(name);
	await form.getByLabel("Amount due").fill(due);
	if (cadence) await form.getByLabel("How often").selectOption({ label: cadence });
	if (dueDate) await form.getByLabel("Due on").fill(dueDate);
	await form.getByRole("button", { name: "Add Commitment" }).click();
	await expect(amount(page, name)).toBeVisible();
}

test("a Parent adds, edits, and ends Commitments, and Free to Spend follows", async ({
	browser,
}) => {
	const page = await signedInPage(browser, parent.email);
	const month = await openPlan(page);
	const [year = 0, m = 0] = month.split("-").map(Number);
	const daysInMonth = new Date(Date.UTC(year, m, 0)).getUTCDate();

	// Monthly, due on the 1st by default.
	await addCommitment(page, { name: "Mortgage", due: "2,500" });
	await expect(freeToSpend(page)).toHaveText("$5,300");
	await expect(summary(page)).toContainText("Commitments−$2,500");

	// Yearly, due this month: the whole amount comes out of this month.
	await addCommitment(page, {
		name: "Car insurance",
		due: "900",
		cadence: "Yearly",
		dueDate: `${year + 1}-${month.slice(5)}-15`,
	});
	await expect(freeToSpend(page)).toHaveText("$4,400");

	// Every two weeks from the 1st: due on the 1st, 15th, and (most months) the 29th.
	const daycareCharges = daysInMonth >= 29 ? 3 : 2;
	await addCommitment(page, {
		name: "Daycare",
		due: "500",
		cadence: "Every two weeks",
		dueDate: `${month}-01`,
	});
	await expect(freeToSpend(page)).toHaveText(
		`$${(4_400 - 500 * daycareCharges).toLocaleString("en-US")}`,
	);
	await expect(page.getByRole("listitem").filter({ hasText: "Daycare" })).toContainText(
		`$${(500 * daycareCharges).toLocaleString("en-US")} this month`,
	);

	// Edit the amount inline, and move the insurance to next month.
	await amount(page, "Mortgage").fill("2,600");
	await amount(page, "Mortgage").press("Enter");
	await page.getByRole("button", { name: "Edit Car insurance" }).click();
	await page
		.getByLabel("Due on", { exact: true })
		.first()
		.fill(`${nextMonth(month)}-15`);
	await page.getByRole("button", { name: "Save", exact: true }).click();
	await expect(page.getByRole("listitem").filter({ hasText: "Car insurance" })).toContainText(
		"not in",
	);
	const afterEdits = 9_000 - 1_200 - 2_600 - 500 * daycareCharges;
	await expect(freeToSpend(page)).toHaveText(`$${afterEdits.toLocaleString("en-US")}`);

	// Everything above was saved, not just shown.
	await page.reload();
	await expect(freeToSpend(page)).toHaveText(`$${afterEdits.toLocaleString("en-US")}`);
	await expect(amount(page, "Mortgage")).toHaveValue("2,600");
	await expect(page.getByRole("listitem").filter({ hasText: "Car insurance" })).toContainText(
		"Yearly · due",
	);

	// This Month shows what's expected against what's been paid.
	await page.getByRole("link", { name: "Back to This Month" }).click();
	await expect(page.getByRole("heading", { level: 1 })).toContainText("This Month");
	const hero = page.getByRole("region", { name: "Free to Spend" });
	await expect(hero).toContainText(`$${afterEdits.toLocaleString("en-US")}`);
	await expect(commitmentRow(page, "Mortgage")).toHaveAccessibleName(
		"Mortgage: $0 paid of $2,600 expected",
	);
	await expect(commitmentRow(page, "Car insurance")).toHaveCount(0);

	// Ending a Commitment takes it out of this month's Plan.
	await page.getByRole("link", { name: "Edit Plan" }).click();
	await page.getByRole("button", { name: "Edit Mortgage" }).click();
	await page.getByRole("button", { name: "End", exact: true }).click();
	await page.getByRole("button", { name: "End Mortgage" }).click();
	await expect(amount(page, "Mortgage")).toHaveCount(0);
	const afterEnd = afterEdits + 2_600;
	await expect(freeToSpend(page)).toHaveText(`$${afterEnd.toLocaleString("en-US")}`);
	await page.reload();
	await expect(amount(page, "Mortgage")).toHaveCount(0);
	await expect(freeToSpend(page)).toHaveText(`$${afterEnd.toLocaleString("en-US")}`);
	await page.context().close();
});

test("a payment that differs from what's expected is flagged", async ({ browser }) => {
	const page = await signedInPage(browser, parent.email);
	await openPlan(page);
	await addCommitment(page, { name: "Mortgage", due: "2,500" });
	await addCommitment(page, { name: "Phone", due: "80" });
	await page.getByRole("link", { name: "Back to This Month" }).click();

	const mortgage = commitmentRow(page, "Mortgage");
	await mortgage.getByRole("button", { name: "Record payment" }).click();
	await mortgage.getByLabel("Amount paid to Mortgage").fill("2,550");
	await mortgage.getByRole("button", { name: "Record", exact: true }).click();
	await expect(mortgage).toHaveAccessibleName(
		"Mortgage: $2,550 paid of $2,500 expected, $50 more than expected",
	);
	await expect(mortgage).toContainText("$50 more than expected");

	const phone = commitmentRow(page, "Phone");
	await phone.getByRole("button", { name: "Record payment" }).click();
	await phone.getByRole("button", { name: "Record", exact: true }).click();
	await expect(phone).toHaveAccessibleName("Phone: $80 paid of $80 expected");
	await expect(phone).toContainText("Paid");
	await expect(phone.getByRole("button", { name: "Record payment" })).toHaveCount(0);
	await expect(page.getByRole("region", { name: "Commitments" })).toContainText(
		"$2,630 of $2,580 paid",
	);

	// A payment is already-planned money: Free to Spend doesn't move.
	await expect(
		page.getByRole("region", { name: "Free to Spend" }).getByText("$5,220", { exact: true }),
	).toBeVisible();
	await page.reload();
	await expect(mortgage).toHaveAccessibleName(/\$50 more than expected$/);
	await expect(phone).toHaveAccessibleName("Phone: $80 paid of $80 expected");
	await page.context().close();
});

test("a failed save is undone and can be retried", async ({ browser }) => {
	const page = await signedInPage(browser, parent.email);
	await openPlan(page);

	const add = serverFn("addCommitment");
	await page.route(add, (route) => route.fulfill({ status: 500, body: "Server error" }));
	const form = addForm(page);
	await form.getByLabel("New Commitment").fill("Netflix");
	await form.getByLabel("Amount due").fill("15.99");
	await form.getByRole("button", { name: "Add Commitment" }).click();
	await expect(form.getByRole("alert")).toContainText("We couldn’t save that change");
	await expect(amount(page, "Netflix")).toHaveCount(0);
	await expect(freeToSpend(page)).toHaveText("$7,800");

	await page.unroute(add);
	await form.getByRole("button", { name: "Try again" }).click();
	await expect(amount(page, "Netflix")).toHaveValue("15.99");
	await expect(freeToSpend(page)).toHaveText("$7,784.01");
	await expect(page.getByRole("alert")).toHaveCount(0);

	// An edit that fails rolls back too.
	const update = serverFn("updateCommitment");
	await page.route(update, (route) => route.fulfill({ status: 500, body: "Server error" }));
	await amount(page, "Netflix").fill("22.99");
	await amount(page, "Netflix").press("Enter");
	await expect(page.getByRole("alert")).toContainText("We couldn’t save that change");
	await expect(amount(page, "Netflix")).toHaveValue("15.99");
	await expect(freeToSpend(page)).toHaveText("$7,784.01");
	await page.unroute(update);
	await page.getByRole("button", { name: "Try again" }).click();
	await expect(freeToSpend(page)).toHaveText("$7,777.01");

	await page.reload();
	await expect(amount(page, "Netflix")).toHaveCount(1);
	await expect(amount(page, "Netflix")).toHaveValue("22.99");
	await page.context().close();
});

test("a Commitment or payment delivered twice is recorded once", async ({ browser }) => {
	const page = await signedInPage(browser, parent.email);
	await openPlan(page);
	// Deliver each request to the server twice, as a retry after a lost response would.
	const twice = async (route: Route) => {
		await route.fetch();
		await route.continue();
	};
	await page.route(serverFn("addCommitment"), twice);
	const saved = page.waitForResponse((response) =>
		serverFn("addCommitment")(new URL(response.url())),
	);
	await addCommitment(page, { name: "Rent", due: "2,000" });
	await saved;
	await page.reload();
	await expect(amount(page, "Rent")).toHaveCount(1);
	await expect(freeToSpend(page)).toHaveText("$5,800");

	await page.route(serverFn("addCommitmentPayment"), twice);
	await page.getByRole("link", { name: "Back to This Month" }).click();
	const rent = commitmentRow(page, "Rent");
	await rent.getByRole("button", { name: "Record payment" }).click();
	await rent.getByRole("button", { name: "Record", exact: true }).click();
	await expect(page.getByRole("status").filter({ hasText: "paid to" })).toHaveText(
		"$2,000 paid to Rent",
	);
	await page.reload();
	await expect(rent).toHaveAccessibleName("Rent: $2,000 paid of $2,000 expected");
	await page.context().close();
});
