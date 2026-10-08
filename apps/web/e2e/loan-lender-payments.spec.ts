import { expect, type Locator, type Page, test } from "@playwright/test";
import { measure } from "./overflow";
import { createTestParent } from "./parents";
import { seedSql } from "./seed-sql";
import {
	chooseKind,
	createPlannedHousehold,
	PAYMENT_COMMITMENT,
	reloadUntil,
	savedBy,
	signedInPage,
} from "./session";

// A payment to a lender the Household has a loan with lands in the loan (issue 153): with two
// instalment plans at one lender, Review suggests the one whose payment the charge is, asks which
// when the amount fits neither, and the Rule it offers files the next payment on arrival in the
// loan whose payment that one is. What's owed on each loan comes down by what was filed in it.

let parent: Awaited<ReturnType<typeof createTestParent>>;

test.beforeEach(async () => {
	parent = await createTestParent();
});

test.afterEach(async () => {
	await parent?.remove();
});

/** A day `back` days before today, in the browser's time zone, which is the Household's. */
const daysAgo = (page: Page, back: number) =>
	page.evaluate(
		(days) => new Date(Date.now() - days * 86_400_000).toLocaleDateString("en-CA"),
		back,
	) as Promise<string>;

/** The add-Account form on Accounts: its form when there are none yet, else its sheet. */
async function accountForm(page: Page, name: string): Promise<Locator> {
	await page.goto(new URL("/accounts", page.url()).href);
	await expect(page.getByRole("heading", { level: 1 })).toHaveText("Accounts");
	const first = await page.getByText("Accounts are where the money is").count();
	if (!first) await page.getByRole("button", { name: "Add Account" }).click();
	const form = first
		? page.getByRole("main")
		: page.getByRole("dialog", { name: "Add an Account" });
	await form.getByLabel("Name").fill(name);
	return form;
}

async function save(page: Page, form: Locator, name: string) {
	const saved = savedBy(page, "addAccount");
	await form.getByRole("button", { name: "Add Account" }).click();
	await saved;
	await expect(page.getByRole("link", { name: new RegExp(`^${name}, `) })).toBeVisible();
}

/** Adds a loan with its monthly Commitment, as the form offers. */
async function addLoan(page: Page, name: string, borrowed: string, payment: string) {
	const form = await accountForm(page, name);
	await chooseKind(form, "loan", undefined, true);
	await expect(form.getByRole("switch", { name: PAYMENT_COMMITMENT })).toBeChecked();
	await form.getByLabel("Borrowed").fill(borrowed);
	await form.getByLabel("Payment", { exact: true }).fill(payment);
	await form.getByLabel("Due day").fill("10");
	await save(page, form, name);
}

/** Uploads a checking statement with the lender's lines, dated today. */
async function arrive(page: Page, fileName: string, amounts: string[]) {
	const [year, month, day] = (await daysAgo(page, 0)).split("-");
	const csv = [
		"Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #",
		...amounts.map(
			(amount) =>
				`DEBIT,${month}/${day}/${year},"ZIPLINE.COM PAYMENTS",-${amount},ACH_DEBIT,3000.00,`,
		),
	].join("\n");
	await page.goto(new URL("/accounts", page.url()).href);
	await page.getByRole("link", { name: /^Everyday Checking, / }).click();
	await page.getByRole("button", { name: "Upload statement" }).click();
	const upload = page.getByRole("dialog", { name: "Upload a statement" });
	await upload
		.getByLabel("Statement file")
		.setInputFiles({ name: fileName, mimeType: "text/csv", buffer: Buffer.from(csv) });
	await upload.getByRole("button", { name: /^Import \d+ lines?$/ }).click();
	await expect(
		page.getByRole("status").filter({ hasText: `${fileName}: ${amounts.length} Transaction` }),
	).toBeVisible();
}

const owes = (page: Page, name: string, owed: string) =>
	page.getByRole("link", { name: new RegExp(`^${name}, Loan, \\$${owed} owed`) });

test("with two loans at one lender Review suggests the loan whose payment a charge is, asks which when the amount fits neither, and the Rule files the next payment in the other loan", async ({
	browser,
}) => {
	test.slow();
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, {
		baseline: "6,000",
		buckets: [["Groceries", "1,200"]],
	});
	await page.setViewportSize({ width: 1280, height: 900 });
	const checking = await accountForm(page, "Everyday Checking");
	await chooseKind(checking, "checking");
	await checking.getByLabel("Balance now").fill("4,000");
	await save(page, checking, "Everyday Checking");
	await addLoan(page, "Zipline sofa", "540", "45");
	await addLoan(page, "Zipline bike", "1,440", "120");
	// What's owed was said a few days ago, so a payment today comes off it (ADR-0050).
	const before = await daysAgo(page, 5);
	await seedSql([
		`update account_balances set as_of = '${before}' where account_id in (
			select a.id from accounts a join members m on m.household_id = a.household_id
			where m.clerk_user_id = '${parent.userId}' and a.kind = 'loan')`,
	]);

	// Two charges from the lender: one is the bike's payment to the cent, one is neither's.
	await arrive(page, "first.csv", ["120.00", "82.50"]);
	const review = new URL("/review?view=list", page.url()).href;
	const suggested = page.locator("[data-testid=review-card][data-lender=loan]");
	const asked = page.locator("[data-testid=review-card][data-lender=which]");
	await reloadUntil(page, review, () => expect(suggested).toHaveCount(1, { timeout: 2_000 }));
	await expect(suggested).toContainText("Looks like a payment on Zipline bike");
	await expect(suggested).toContainText("Files in Zipline bike");
	// The other names both loans with their payments, and has no Confirm of its own.
	await expect(asked).toHaveCount(1);
	await expect(asked).toContainText("Looks like a loan payment");
	const which = asked.getByTestId("review-which-loan");
	await expect(which.getByRole("button")).toHaveText([
		/Zipline sofa\s*\$45$/,
		/Zipline bike\s*\$120$/,
	]);

	// A 320px phone: both cards fit, and nothing scrolls sideways.
	await page.setViewportSize({ width: 320, height: 700 });
	await expect(which.getByRole("button").first()).toBeVisible();
	const size = await measure(page);
	expect(size.sticking).toEqual([]);
	expect(size.scrollWidth).toBeLessThanOrEqual(size.width);
	await page.setViewportSize({ width: 1280, height: 900 });

	// One tap files the suggestion in the bike's Commitment; the Rule offered is for the lender.
	const filed = savedBy(page, "updateTransaction");
	await suggested.getByRole("button", { name: "Confirm" }).click();
	await filed;
	const offer = page.locator("[data-sonner-toast]").filter({ hasText: "Always file “" });
	await expect(offer).toContainText(
		"as a loan payment? Each one goes in the loan whose payment it is, as this one did in Zipline bike.",
	);
	await offer.getByRole("button", { name: "Always file" }).click();
	await expect(page.getByRole("status").filter({ hasText: /Rule/ }).first()).toBeVisible();
	// The Rule leaves the charge that is neither loan's payment waiting: a Parent says which.
	await reloadUntil(page, review, () => expect(asked).toHaveCount(1, { timeout: 2_000 }));
	const picked = savedBy(page, "updateTransaction");
	await which.getByRole("button", { name: /Zipline bike/ }).click();
	await picked;
	await expect(page.getByTestId("review-card")).toHaveCount(0);

	// What's owed on the bike is down by both; the sofa's is as it was.
	await page.goto(new URL("/accounts", page.url()).href);
	await expect(owes(page, "Zipline bike", "1,237.50")).toBeVisible();
	await expect(owes(page, "Zipline sofa", "540")).toBeVisible();

	// The next payment is the sofa's: the Rule files it on arrival there, not where it was made.
	await arrive(page, "second.csv", ["45.00"]);
	await reloadUntil(page, new URL("/accounts", page.url()).href, () =>
		expect(owes(page, "Zipline sofa", "495")).toBeVisible({ timeout: 2_000 }),
	);
	await expect(owes(page, "Zipline bike", "1,237.50")).toBeVisible();
	await page.goto(review);
	await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
	await expect(page.getByTestId("review-card")).toHaveCount(0);
	await page.context().close();
});
