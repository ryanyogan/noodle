import { expect, type Page, test } from "@playwright/test";
import { measure } from "./overflow";
import { createTestParent } from "./parents";
import { chooseKind, createPlannedHousehold, savedBy, signedInPage } from "./session";

// A loan's payments are held against its schedule, and paying it off ends its Commitment (issue
// 153): each month's payments read paid or partly paid on the loan's page, a new payment on the
// loan changes its Commitment's amount, and once nothing is owed the page and Plan › Commitments
// say "Paid off" with the day, next month no longer plans it, and deleting the payment that paid
// it off plans it again.

let parent: Awaited<ReturnType<typeof createTestParent>>;

test.beforeEach(async () => {
	parent = await createTestParent();
});

test.afterEach(async () => {
	await parent?.remove();
});

const NAME = "Sofa instalments";
const table = (page: Page) => page.getByRole("grid", { name: /^Commitments in/ });
const row = (page: Page) => table(page).getByRole("row").filter({ hasText: NAME });
const loan = (page: Page) => page.getByRole("region", { name: "Loan", exact: true });
const made = (page: Page) => page.getByRole("list", { name: `Payments made on ${NAME}` });
const toCome = (page: Page) => page.getByRole("list", { name: `Payments to come on ${NAME}` });
const stat = (page: Page, label: string) =>
	loan(page).locator("[data-slot=stat]").filter({ hasText: label });

/** A day `back` days before today, in the browser's time zone, which is the Household's. */
const daysAgo = (page: Page, back: number) =>
	page.evaluate(
		(days) => new Date(Date.now() - days * 86_400_000).toLocaleDateString("en-CA"),
		back,
	) as Promise<string>;

/** A statement (QFX) with no lines, ending owing `owed` on `day`. */
function statement(day: string, owed: string) {
	const d = day.replaceAll("-", "");
	return `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<?OFX OFXHEADER="200" VERSION="220" SECURITY="NONE" OLDFILEUID="NONE" NEWFILEUID="NONE"?>
<OFX><CREDITCARDMSGSRSV1><CCSTMTTRNRS><TRNUID>0</TRNUID>
<STATUS><CODE>0</CODE><SEVERITY>INFO</SEVERITY></STATUS>
<CCSTMTRS><CURDEF>USD</CURDEF><CCACCTFROM><ACCTID>7781</ACCTID></CCACCTFROM>
<BANKTRANLIST><DTSTART>${d}</DTSTART><DTEND>${d}</DTEND>
<STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>${d}</DTPOSTED><TRNAMT>-1.00</TRNAMT><FITID>fee-1</FITID><NAME>LATE NOTICE FEE</NAME></STMTTRN>
</BANKTRANLIST>
<LEDGERBAL><BALAMT>-${owed}</BALAMT><DTASOF>${d}</DTASOF></LEDGERBAL>
</CCSTMTRS></CCSTMTTRNRS></CREDITCARDMSGSRSV1></OFX>`;
}

async function openLoan(page: Page) {
	await page.goto(new URL("/accounts", page.url()).href);
	await page.getByRole("link", { name: new RegExp(`^${NAME}, `) }).click();
	await expect(loan(page)).toBeVisible();
}

async function openCommitments(page: Page, month: string) {
	await page.goto(new URL(`/plan/${month}/commitments`, page.url()).href);
	await expect(table(page)).toBeVisible();
}

/** Records a payment of `dollars` to the loan's Commitment today, on This Month's Bills. */
async function pay(page: Page, thisMonth: string, dollars: string) {
	await page.goto(thisMonth);
	const bill = page.getByRole("listitem", { name: new RegExp(`^${NAME}: `) });
	await bill.getByRole("button", { name: "Record payment" }).click();
	await bill.getByLabel(`Amount paid to ${NAME}`).fill(dollars);
	const paid = savedBy(page, "addCommitmentPayment");
	await bill.getByRole("button", { name: "Record", exact: true }).click();
	await paid;
}

test("a loan's payments read against its schedule, paying it off ends its Commitment from next month, and deleting that payment plans it again", async ({
	browser,
}) => {
	test.slow();
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, {
		baseline: "6,000",
		buckets: [["Groceries", "1,200"]],
		commitments: [{ name: "Fiber internet", amountCents: 7_500, cadence: "monthly", dueDay: 1 }],
	});
	const thisMonth = page.url();
	const month = /\/month\/(\d{4}-\d{2})/.exec(thisMonth)?.[1] ?? "";
	const [year, monthOf] = month.split("-").map(Number) as [number, number];
	const nextMonth = `${monthOf === 12 ? year + 1 : year}-${String((monthOf % 12) + 1).padStart(2, "0")}`;
	await page.setViewportSize({ width: 1280, height: 900 });

	// The loan, with its Commitment: $100 a month. Nothing is said about what's owed yet.
	await page.goto(new URL("/accounts", page.url()).href);
	await expect(page.getByRole("heading", { level: 1 })).toHaveText("Accounts");
	const form = page.getByRole("main");
	await form.getByLabel("Name").fill(NAME);
	await chooseKind(form, "loan", undefined, true);
	await form.getByLabel("Payment", { exact: true }).fill("100");
	await form.getByLabel("Due day").fill("28");
	const added = savedBy(page, "addAccount");
	await form.getByRole("button", { name: "Add Account" }).click();
	await added;

	// What's owed is from a statement that closed three days ago, so a payment today comes off
	// it: $200, two payments left.
	await openLoan(page);
	await page.getByRole("button", { name: "Upload statement" }).click();
	const upload = page.getByRole("dialog", { name: "Upload a statement" });
	await upload.getByLabel("Statement file").setInputFiles({
		name: "sofa.qfx",
		mimeType: "application/x-ofx",
		buffer: Buffer.from(statement(await daysAgo(page, 3), "200.00")),
	});
	await upload.getByRole("button", { name: /^Import \d+ lines?$/ }).click();
	await upload.getByRole("button", { name: "Use $200 as what’s owed" }).click();
	await expect(upload).toBeHidden();
	await expect(stat(page, "Payments left")).toContainText("2");
	await expect(toCome(page).getByRole("listitem")).toHaveCount(2);
	await expect(made(page)).toHaveCount(0);

	// The loan's payment is its Commitment's: $200 here is $200 in the Plan from this month on,
	// and one payment is left.
	await loan(page)
		.getByRole("button", { name: `Edit ${NAME}’s loan` })
		.click();
	const sheet = page.getByRole("dialog", { name: `${NAME}’s loan` });
	await expect(sheet).toContainText(`changes ${NAME}, its Commitment`);
	await sheet.getByLabel("Borrowed").fill("600");
	await sheet.getByLabel("Payment", { exact: true }).fill("200");
	const factsSaved = savedBy(page, "setLoanFacts");
	await sheet.getByRole("button", { name: "Save", exact: true }).click();
	await factsSaved;
	await expect(sheet).toBeHidden();
	await expect(stat(page, "Due on")).toContainText("$200");
	await expect(toCome(page).getByRole("listitem")).toHaveCount(1);
	await expect(toCome(page).getByRole("listitem").first()).toContainText("Last payment");
	await openCommitments(page, month);
	await expect(row(page)).toContainText("$200");
	await openCommitments(page, nextMonth);
	await expect(row(page)).toContainText("$200");

	// The payment, recorded today: it reads paid against the schedule with the day and amount
	// really paid, and the loan is paid off.
	await pay(page, thisMonth, "200");
	await openLoan(page);
	await expect(made(page).getByRole("listitem")).toHaveCount(1);
	await expect(made(page).getByRole("listitem").first()).toContainText("Paid");
	await expect(made(page).getByRole("listitem").first()).toContainText("$200");
	await expect(toCome(page)).toHaveCount(0);
	await expect(loan(page).locator("[data-slot=loan-paid-off]")).toContainText(
		/^Paid off \w+ \d+, 20\d\d\./,
	);
	await expect(loan(page).locator("[data-slot=loan-paid-off]")).toContainText(
		`${NAME}, its Commitment, is in the Plan through`,
	);
	await expect(stat(page, "Paid so far")).toContainText("$600");
	// The Payments section leaves the list to the schedule.
	const payments = page.getByRole("region", { name: /^Payments/ });
	await expect(payments).toContainText("listed against the schedule above");
	await expect(payments.getByRole("list")).toHaveCount(0);

	// This month's Plan still has it, paid, saying it is paid off; next month's doesn't plan it.
	await openCommitments(page, month);
	await expect(row(page)).toContainText("Paid off");
	await expect(row(page)).toContainText("not planned after");
	await expect(row(page).locator("[data-slot=badge]").filter({ hasText: "Paid" })).toBeVisible();
	await openCommitments(page, nextMonth);
	await expect(table(page)).toContainText("Fiber internet");
	await expect(table(page)).not.toContainText(NAME);

	// On a 320px phone nothing runs off the side of the loan's page.
	await page.setViewportSize({ width: 320, height: 700 });
	await openLoan(page);
	await expect(loan(page).locator("[data-slot=loan-paid-off]")).toBeVisible();
	const phone = await measure(page);
	expect(phone.sticking).toEqual([]);
	expect(phone.scrollWidth).toBeLessThanOrEqual(320);
	await page.setViewportSize({ width: 1280, height: 900 });

	// Deleting a payment: something is owed again, and the Commitment is planned again.
	await page.goto(new URL(`/transactions/${month}`, page.url()).href);
	const payment = page
		.getByRole("grid", { name: /^Transactions in / })
		.locator("[data-slot=data-table-body]")
		.getByRole("button", { name: new RegExp(`^Payment, .*${NAME}`) });
	await expect(payment).toHaveCount(1);
	await payment.first().click();
	const pane = page
		.locator("[role=dialog], [data-slot=transaction-detail]")
		.filter({ has: page.getByRole("heading", { name: "Edit Transaction" }) });
	await pane.getByRole("button", { name: "Delete" }).click();
	// The delete is sent once its Undo has gone, and the Undo waits while the pointer is on it.
	const deleted = savedBy(page, "deleteTransaction");
	await page.getByRole("alertdialog").getByRole("button", { name: "Delete Transaction" }).click();
	await page.mouse.move(0, 0);
	await expect(payment).toHaveCount(0);
	await deleted;
	await openLoan(page);
	await expect(loan(page).locator("[data-slot=loan-paid-off]")).toHaveCount(0);
	await expect(toCome(page).getByRole("listitem")).toHaveCount(1);
	await expect(made(page)).toHaveCount(0);
	await openCommitments(page, nextMonth);
	await expect(row(page)).toContainText("$200");
	await openCommitments(page, month);
	await expect(row(page)).not.toContainText("Paid off");
});
