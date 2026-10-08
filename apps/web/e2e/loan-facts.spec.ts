import { expect, type Locator, type Page, test } from "@playwright/test";
import { measure } from "./overflow";
import { createTestParent } from "./parents";
import {
	chooseKind,
	createPlannedHousehold,
	PAYMENT_COMMITMENT,
	savedBy,
	signedInPage,
} from "./session";

// A loan has its facts (issue 153): what was borrowed, the payment, its due day and the payments
// left. Adding one offers a monthly Commitment for its payments, on to start with, which lands
// under Loans on Plan › Commitments; the loan's page lists the payments still to come and the day
// it is paid off. Turned off, only the Account is added, and its page offers the Commitment later.

let parent: Awaited<ReturnType<typeof createTestParent>>;

test.beforeEach(async () => {
	parent = await createTestParent();
});

test.afterEach(async () => {
	await parent?.remove();
});

const table = (page: Page) => page.getByRole("grid", { name: /^Commitments in/ });
const groupNames = (page: Page) => table(page).locator("[data-commitment-group]");
const row = (page: Page, name: string) => table(page).getByRole("row").filter({ hasText: name });

/** The add-Account form on Accounts (its sheet once the Household has one), with a loan chosen. */
async function loanForm(page: Page, name: string): Promise<Locator> {
	await page.goto(new URL("/accounts", page.url()).href);
	await expect(page.getByRole("heading", { level: 1 })).toHaveText("Accounts");
	const first = await page.getByText("Accounts are where the money is").count();
	if (!first) await page.getByRole("button", { name: "Add Account" }).click();
	const form = first
		? page.getByRole("main")
		: page.getByRole("dialog", { name: "Add an Account" });
	await form.getByLabel("Name").fill(name);
	await chooseKind(form, "loan", undefined, true);
	return form;
}

async function add(page: Page, form: Locator, name: string) {
	const saved = savedBy(page, "addAccount");
	await form.getByRole("button", { name: "Add Account" }).click();
	await saved;
	await expect(page.getByRole("link", { name: new RegExp(`^${name}, `) })).toBeVisible();
}

test("a loan added with its facts gets a Commitment under Loans and shows its payments to come; with the choice off it gets none until its page adds one", async ({
	browser,
}) => {
	test.slow();
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, {
		baseline: "6,000",
		buckets: [["Groceries", "1,200"]],
		commitments: [{ name: "Fiber internet", amountCents: 7_500, cadence: "monthly", dueDay: 1 }],
	});
	const month = /\/month\/(\d{4}-\d{2})/.exec(page.url())?.[1];
	await page.setViewportSize({ width: 1280, height: 900 });

	// The choice is on to start with, and then the payment and its due day are needed.
	let form = await loanForm(page, "Sofa instalments");
	const offer = form.getByRole("switch", { name: PAYMENT_COMMITMENT });
	await expect(offer).toBeChecked();
	await form.getByLabel("Borrowed").fill("1,000");
	await form.getByRole("button", { name: "Add Account" }).click();
	await expect(
		form.getByText("Say what one payment is, or turn off the Commitment below."),
	).toBeVisible();
	await expect(
		form.getByText("Say the day it’s due, or turn off the Commitment below."),
	).toBeVisible();
	await form.getByLabel("Payment", { exact: true }).fill("300");
	await form.getByLabel("Due day").fill("28");
	// Nothing typed under "Owed now": it owes what was borrowed.
	await add(page, form, "Sofa instalments");
	await expect(
		page.getByRole("link", { name: /^Sofa instalments, Loan, \$1,000 owed/ }),
	).toBeVisible();

	// Its Commitment is in the Plan under Loans, named after it, with the payment and the due day.
	await page.goto(`/plan/${month}/commitments`);
	await expect(page.getByRole("button", { name: "Add Commitment", exact: true })).toBeEnabled();
	await expect(groupNames(page)).toHaveText(["Loans", "Bills"]);
	await expect(row(page, "Sofa instalments")).toContainText("$300");
	await expect(row(page, "Sofa instalments")).toContainText("Pays down Sofa instalments");
	await expect(row(page, "Sofa instalments")).toContainText(/28/);

	// The loan's own page: its facts, the payments to come (the last is what's left) and the day
	// it is paid off.
	await page.goto("/accounts");
	await page.getByRole("link", { name: /^Sofa instalments, / }).click();
	const loan = page.getByRole("region", { name: "Loan", exact: true });
	await expect(loan).toContainText("Borrowed");
	await expect(loan).toContainText("$1,000");
	await expect(loan).toContainText("Paid so far");
	await expect(loan).toContainText("Due on the 28th");
	await expect(loan.locator("[data-slot=stat]").filter({ hasText: "Payments left" })).toContainText(
		"4",
	);
	await expect(loan.locator("[data-slot=stat]").filter({ hasText: "Paid off" })).toContainText(
		/28, 20\d\d/,
	);
	const toCome = page.getByRole("list", { name: "Payments to come on Sofa instalments" });
	await expect(toCome.getByRole("listitem")).toHaveCount(4);
	await expect(toCome.getByRole("listitem").nth(0)).toContainText("$300");
	await expect(toCome.getByRole("listitem").nth(0)).toContainText("Payment 1 of 4");
	await expect(toCome.getByRole("listitem").nth(3)).toContainText("$100");
	await expect(toCome.getByRole("listitem").nth(3)).toContainText("Last payment");
	// It has its Commitment, so none is offered.
	await expect(page.getByRole("button", { name: "Add a monthly Commitment" })).toHaveCount(0);
	await expect(page.getByRole("region", { name: "Payments", exact: true })).toContainText(
		"Paid down by Sofa instalments",
	);

	// Its facts can be changed there. The payment is its Commitment's too, so it can't be left
	// unsaid; $500 with two left is two payments, and the Commitment is $500 from this month on.
	await loan.getByRole("button", { name: "Edit Sofa instalments’s loan" }).click();
	const sheet = page.getByRole("dialog", { name: "Sofa instalments’s loan" });
	await expect(sheet.getByLabel("Borrowed")).toHaveValue("1,000");
	await sheet.getByLabel("Payment", { exact: true }).fill("");
	await sheet.getByLabel("Payments left").fill("2");
	await sheet.getByRole("button", { name: "Save", exact: true }).click();
	await expect(sheet.getByText("Say what one payment is.")).toBeVisible();
	await sheet.getByLabel("Payment", { exact: true }).fill("500");
	const factsSaved = savedBy(page, "setLoanFacts");
	await sheet.getByRole("button", { name: "Save", exact: true }).click();
	await factsSaved;
	await expect(sheet).toBeHidden();
	await expect(toCome.getByRole("listitem")).toHaveCount(2);
	await expect(toCome.getByRole("listitem").nth(1)).toContainText("$500");
	await page.reload();
	await expect(toCome.getByRole("listitem")).toHaveCount(2);

	// A second loan at the same lender, with the choice turned off: no Commitment.
	form = await loanForm(page, "Mattress instalments");
	await form.getByRole("switch", { name: PAYMENT_COMMITMENT }).click();
	await form.getByLabel("Borrowed").fill("600");
	await form.getByLabel("Owed now").fill("450");
	await add(page, form, "Mattress instalments");
	await page.goto(`/plan/${month}/commitments`);
	await expect(page.getByRole("button", { name: "Add Commitment", exact: true })).toBeEnabled();
	await expect(table(page)).toContainText("Sofa instalments");
	await expect(table(page)).not.toContainText("Mattress instalments");

	// Its page offers the same later, asking for the payment and its due day first.
	await page.goto("/accounts");
	await page.getByRole("link", { name: /^Mattress instalments, / }).click();
	await expect(page.getByRole("region", { name: "Loan", exact: true })).toContainText("$150");
	await page.getByRole("button", { name: "Add a monthly Commitment" }).click();
	const asking = page.getByRole("dialog", { name: PAYMENT_COMMITMENT });
	await asking.getByRole("button", { name: "Add Commitment" }).click();
	await expect(asking.getByText("Say what one payment is.")).toBeVisible();
	await asking.getByLabel("Payment", { exact: true }).fill("150");
	await asking.getByLabel("Due day").fill("5");
	const added = savedBy(page, "addPaymentCommitment");
	await asking.getByRole("button", { name: "Add Commitment" }).click();
	await added;
	await expect(asking).toBeHidden();
	await expect(page.getByRole("button", { name: "Add a monthly Commitment" })).toHaveCount(0);
	await expect(
		page
			.getByRole("list", { name: "Payments to come on Mattress instalments" })
			.getByRole("listitem"),
	).toHaveCount(3);
	await page.goto(`/plan/${month}/commitments`);
	await expect(page.getByRole("button", { name: "Add Commitment", exact: true })).toBeEnabled();
	await expect(groupNames(page)).toHaveText(["Loans", "Bills"]);
	await expect(row(page, "Mattress instalments")).toContainText("$150");

	// A 320px phone: the loan's page and the add form scroll nowhere sideways.
	await page.setViewportSize({ width: 320, height: 700 });
	await page.goto("/accounts");
	await page.getByRole("link", { name: /^Sofa instalments, / }).click();
	await expect(page.getByRole("region", { name: "Loan", exact: true })).toBeVisible();
	let size = await measure(page);
	expect(size.sticking).toEqual([]);
	expect(size.scrollWidth).toBeLessThanOrEqual(size.width);
	form = await loanForm(page, "Bike instalments");
	await expect(form.getByRole("switch", { name: PAYMENT_COMMITMENT })).toBeVisible();
	size = await measure(page);
	expect(size.sticking).toEqual([]);
	expect(size.scrollWidth).toBeLessThanOrEqual(size.width);
});
