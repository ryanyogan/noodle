import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { measure } from "./overflow";
import { createTestParent } from "./parents";
import {
	accountKindLabel,
	choose,
	createPlannedHousehold,
	reloadUntil,
	savedBy,
	signedInPage,
} from "./session";

// A Commitment can pay down a credit card or loan (issue 93, ADR-0050): chosen under "Pays down"
// in its form, each payment filed in it after the balance's day brings what's owed on an Account
// kept by hand down, and un-filing the payment puts it back. A card Noodle follows needs the
// "balance I'm carrying" tick.

let parent: Awaited<ReturnType<typeof createTestParent>>;

test.beforeEach(async () => {
	parent = await createTestParent();
});

test.afterEach(async () => {
	await parent?.remove();
});

const plan = { baseline: "6,000", buckets: [["Groceries", "1,200"]] as [string, string][] };

const addForm = (page: Page) => page.getByRole("form", { name: "Add a Commitment" });
const owedCard = (page: Page) => page.getByRole("region", { name: "Owed", exact: true });
const payments = (page: Page) => page.getByRole("region", { name: /^Payments/ });
const row = (page: Page, name: string) => page.getByRole("listitem").filter({ hasText: name });

/** A day `back` days before today, in the browser's time zone, which is the Household's. */
const daysAgo = (page: Page, back: number) =>
	page.evaluate(
		(days) => new Date(Date.now() - days * 86_400_000).toLocaleDateString("en-CA"),
		back,
	) as Promise<string>;

/** Adds an Account on the Accounts page: its form when there are none yet, else its sheet. */
async function addAccount(page: Page, name: string, kind: string, amount?: string) {
	await page.goto(new URL("/accounts", page.url()).href);
	await expect(page.getByRole("heading", { level: 1 })).toHaveText("Accounts");
	const first = await page.getByText("Accounts are where the money is").count();
	if (!first) await page.getByRole("button", { name: "Add Account" }).click();
	const form = first
		? page.getByRole("main")
		: page.getByRole("dialog", { name: "Add an Account" });
	await form.getByLabel("Name").fill(name);
	await choose(form, "Kind", accountKindLabel(kind));
	if (amount) await form.getByLabel(kind === "checking" ? "Balance now" : "Owed now").fill(amount);
	const saved = savedBy(page, "addAccount");
	await form.getByRole("button", { name: "Add Account" }).click();
	await saved;
	await expect(page.getByRole("link", { name: new RegExp(`^${name}, `) })).toBeVisible();
}

/** A card statement (QFX) with one payment onto the card, ending owing `owed` on `day`. */
function cardStatement(day: string, owed: string) {
	const d = day.replaceAll("-", "");
	return `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<?OFX OFXHEADER="200" VERSION="220" SECURITY="NONE" OLDFILEUID="NONE" NEWFILEUID="NONE"?>
<OFX><CREDITCARDMSGSRSV1><CCSTMTTRNRS><TRNUID>0</TRNUID>
<STATUS><CODE>0</CODE><SEVERITY>INFO</SEVERITY></STATUS>
<CCSTMTRS><CURDEF>USD</CURDEF><CCACCTFROM><ACCTID>371111111111114</ACCTID></CCACCTFROM>
<BANKTRANLIST><DTSTART>${d}</DTSTART><DTEND>${d}</DTEND>
<STMTTRN><TRNTYPE>CREDIT</TRNTYPE><DTPOSTED>${d}000000</DTPOSTED><TRNAMT>25.00</TRNAMT>
<FITID>pays-down-${d}</FITID><NAME>PAYMENT THANK YOU</NAME></STMTTRN>
</BANKTRANLIST>
<LEDGERBAL><BALAMT>-${owed}</BALAMT><DTASOF>${d}</DTASOF></LEDGERBAL>
</CCSTMTRS></CCSTMTTRNRS></CREDITCARDMSGSRSV1></OFX>`;
}

const openAccount = async (page: Page, name: string) => {
	await page.goto(new URL("/accounts", page.url()).href);
	await page.getByRole("link", { name: new RegExp(`^${name}, `) }).click();
	await expect(page.locator("[data-slot=detail-title]")).toContainText(name);
};

const openCommitments = async (page: Page, month: string) => {
	await page.goto(new URL(`/plan/${month}/commitments`, page.url()).href);
	await expect(addForm(page)).toBeVisible();
};

/** Picks a card or loan under "Pays down": its option also carries what's owed. */
async function paysDown(scope: Locator, page: Page, option: string | RegExp) {
	await scope.getByRole("combobox", { name: "Pays down", exact: true }).click();
	await page.getByRole("listbox").getByRole("option", { name: option }).click();
	await expect(page.getByRole("listbox")).toBeHidden();
}

test("a Commitment pays down a card kept by hand: a payment brings what's owed down, un-filing puts it back", async ({
	browser,
}) => {
	test.slow();
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, plan);
	const thisMonth = page.url();
	const month = /\d{4}-\d{2}/.exec(thisMonth)?.[0] ?? (await daysAgo(page, 0)).slice(0, 7);
	await addAccount(page, "Everyday Checking", "checking", "4,000");
	await addAccount(page, "American Express", "credit-card");

	// What's owed comes from a statement that closed three days ago, so a payment today is after it.
	await openAccount(page, "American Express");
	await page.getByRole("button", { name: "Upload statement" }).click();
	const upload = page.getByRole("dialog", { name: "Upload a statement" });
	await upload.getByLabel("Statement file").setInputFiles({
		name: "amex.qfx",
		mimeType: "application/x-ofx",
		buffer: Buffer.from(cardStatement(await daysAgo(page, 3), "2000.00")),
	});
	await upload.getByRole("button", { name: /^Import \d+ lines?$/ }).click();
	await expect(upload).toContainText("This statement ends owing $2,000");
	await upload.getByRole("button", { name: "Use $2,000 as what’s owed" }).click();
	await expect(upload).toBeHidden();
	await expect(owedCard(page)).toContainText("$2,000");

	// The Commitment: "Pays down" offers the card with what's owed, and says what linking means.
	await openCommitments(page, month);
	await addForm(page).getByLabel("New Commitment").fill("Amex payment");
	await addForm(page).getByLabel("Amount due").fill("500");
	await paysDown(addForm(page), page, /^American Express/);
	await expect(addForm(page)).toContainText(
		"Noodle can’t see what’s bought on American Express, so these payments are the spending.",
	);
	const added = savedBy(page, "addCommitment");
	await addForm(page).getByRole("button", { name: "Add Commitment" }).click();
	await added;
	await expect(row(page, "Amex payment").first()).toContainText("Pays down American Express");

	// Paying it today, on This Month's Bills.
	await page.goto(thisMonth);
	const bill = page.getByRole("listitem", { name: /^Amex payment: / });
	await bill.getByRole("button", { name: "Record payment" }).click();
	const paid = savedBy(page, "addCommitmentPayment");
	await bill.getByRole("button", { name: "Record", exact: true }).click();
	await paid;

	// The card owes less, and says how it got there.
	await openAccount(page, "American Express");
	await expect(owedCard(page)).toContainText("$1,500");
	await expect(owedCard(page)).toContainText("$2,000 on");
	await expect(owedCard(page)).toContainText("less $500 paid since.");
	await expect(payments(page)).toContainText("Payment · Amex payment");
	await expect(payments(page)).toContainText("came off what’s owed");
	await expect(payments(page).getByRole("link", { name: "Amex payment" })).toBeVisible();

	// The Commitment's page: Payments, not Charges, and what's still owed, linking to the card.
	await payments(page).getByRole("link", { name: "Amex payment" }).click();
	await expect(page.locator("[data-slot=detail-header]")).toContainText("Amex payment");
	await expect(
		page.getByRole("link", { name: "Still owed $1,500 on American Express" }),
	).toBeVisible();
	await expect(payments(page)).toContainText("1 payment this month, $500 in all.");
	await expect(page.getByRole("region", { name: /^Charges/ })).toHaveCount(0);

	// Un-filing the payment (deleting the Quick Add) puts what's owed back.
	// Reached from the Sidebar, so the page is hydrated and the row opens when pressed.
	await page
		.getByRole("navigation", { name: "Main" })
		.getByRole("link", { name: "Transactions" })
		.click();
	const payment = page
		.getByRole("list", { name: /^Transactions in / })
		.getByRole("button", { name: /Amex payment/ });
	await payment.click();
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
	await openAccount(page, "American Express");
	await expect(owedCard(page)).toContainText("$2,000");
	await expect(owedCard(page)).not.toContainText("paid since");

	// On a 320px phone: the Commitment sheet adds a loan inline, passes axe, and nothing scrolls sideways.
	await page.setViewportSize({ width: 320, height: 700 });
	await openCommitments(page, month);
	const sheet = page.getByRole("dialog", { name: "Amex payment" });
	// Pressed again until it opens: a press before the page has hydrated is lost.
	await expect(async () => {
		if (!(await sheet.isVisible()))
			await page.getByRole("button", { name: "Edit Amex payment" }).click({ timeout: 2_000 });
		await expect(sheet).toBeVisible({ timeout: 2_000 });
	}).toPass();
	await expect(sheet.getByRole("combobox", { name: "Pays down", exact: true })).toContainText(
		"American Express",
	);
	await paysDown(sheet, page, "Add a card or loan…");
	const inline = sheet.getByRole("group", { name: "Add a card or loan" });
	await inline.getByLabel("Card or loan name").fill("Car loan");
	await choose(inline, "Kind", "Loan");
	await inline.getByLabel("What’s owed today (optional)").fill("9,000");
	const loanAdded = savedBy(page, "addAccount");
	await inline.getByRole("button", { name: "Add loan" }).click();
	await loanAdded;
	await expect(inline).toBeHidden();
	await expect(sheet.getByRole("combobox", { name: "Pays down", exact: true })).toContainText(
		"Car loan",
	);
	await expect(sheet).toContainText("Each payment brings what’s owed on Car loan down.");
	const { violations } = await new AxeBuilder({ page })
		.include("[role=dialog]")
		.withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
		.analyze();
	expect(violations.map((v) => v.id)).toEqual([]);
	const size = await measure(page);
	expect(size.scrollWidth).toBeLessThanOrEqual(size.width);
	expect(size.sticking).toEqual([]);
	const saved = savedBy(page, "updateCommitment");
	await sheet.getByRole("button", { name: "Save" }).click();
	await saved;
	await expect(row(page, "Amex payment").first()).toContainText("Pays down Car loan");
});

test("a card Noodle follows needs the balance-I'm-carrying tick", async ({ browser }) => {
	test.slow();
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, plan);
	const month = /\d{4}-\d{2}/.exec(page.url())?.[0] ?? (await daysAgo(page, 0)).slice(0, 7);
	await addAccount(page, "Everyday Checking", "checking", "4,000");
	await addAccount(page, "Chase Freedom", "credit-card", "900");

	// A statement brings in a purchase from two days ago: Noodle follows the card from then on.
	await openAccount(page, "Chase Freedom");
	const [year, monthOf, day] = (await daysAgo(page, 2)).split("-");
	const csv = [
		"Transaction Date,Description,Debit,Credit",
		`${monthOf}/${day}/${year},SHELL OIL 5741,38.50,`,
	].join("\n");
	await page.getByRole("button", { name: "Upload statement" }).click();
	const upload = page.getByRole("dialog", { name: "Upload a statement" });
	await upload
		.getByLabel("Statement file")
		.setInputFiles({ name: "chase.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
	await upload.getByRole("button", { name: "Import 1 line" }).click();
	await expect(
		page.getByRole("status").filter({ hasText: "chase.csv: 1 Transaction" }),
	).toBeVisible();

	await openCommitments(page, month);
	await addForm(page).getByLabel("New Commitment").fill("Card minimum");
	await addForm(page).getByLabel("Amount due").fill("90");
	await paysDown(addForm(page), page, /^Chase Freedom/);
	await expect(addForm(page)).toContainText(
		"Noodle already counts what you buy on Chase Freedom in your Buckets. Paying it off is a Transfer, so it isn’t counted twice.",
	);
	await expect(
		addForm(page).getByRole("link", { name: "Plan to pay this off instead" }),
	).toBeVisible();

	// Without the tick it isn't added, and the form says what to do.
	await addForm(page).getByRole("button", { name: "Add Commitment" }).click();
	await expect(addForm(page)).toContainText(
		"Tick “This is a set payment on a balance I’m carrying”, or choose Nothing under Pays down.",
	);
	await expect(row(page, "Card minimum")).toHaveCount(0);

	await addForm(page)
		.getByRole("checkbox", { name: "This is a set payment on a balance I’m carrying" })
		.click();
	const added = savedBy(page, "addCommitment");
	await addForm(page).getByRole("button", { name: "Add Commitment" }).click();
	await added;
	await expect(row(page, "Card minimum").first()).toContainText("Pays down Chase Freedom");
});

test("a payment out of checking to a card a Commitment pays down is offered in Review as that payment, and Confirm files it there", async ({
	browser,
}) => {
	test.slow();
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, plan);
	const thisMonth = page.url();
	const month = /\d{4}-\d{2}/.exec(thisMonth)?.[0] ?? (await daysAgo(page, 0)).slice(0, 7);
	await addAccount(page, "Everyday Checking", "checking", "4,000");
	await addAccount(page, "American Express", "credit-card");

	// What's owed is from a statement that closed three days ago, so a payment today comes off it.
	await openAccount(page, "American Express");
	await page.getByRole("button", { name: "Upload statement" }).click();
	const upload = page.getByRole("dialog", { name: "Upload a statement" });
	await upload.getByLabel("Statement file").setInputFiles({
		name: "amex.qfx",
		mimeType: "application/x-ofx",
		buffer: Buffer.from(cardStatement(await daysAgo(page, 3), "2000.00")),
	});
	await upload.getByRole("button", { name: /^Import \d+ lines?$/ }).click();
	await upload.getByRole("button", { name: "Use $2,000 as what’s owed" }).click();
	await expect(upload).toBeHidden();

	await openCommitments(page, month);
	await addForm(page).getByLabel("New Commitment").fill("Amex payment");
	await addForm(page).getByLabel("Amount due").fill("2,300");
	await paysDown(addForm(page), page, /^American Express/);
	const added = savedBy(page, "addCommitment");
	await addForm(page).getByRole("button", { name: "Add Commitment" }).click();
	await added;
	await expect(row(page, "Amex payment").first()).toContainText("Pays down American Express");

	// The bank's own line for one of the month's payments: less than the Commitment's amount.
	await openAccount(page, "Everyday Checking");
	const [year, monthOf, day] = (await daysAgo(page, 0)).split("-");
	const csv = [
		"Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #",
		`DEBIT,${monthOf}/${day}/${year},"AMERICAN EXPRESS ACH PMT M8054 WEB ID: 2005032111",-612.50,ACH_DEBIT,3387.50,`,
	].join("\n");
	await page.getByRole("button", { name: "Upload statement" }).click();
	await upload
		.getByLabel("Statement file")
		.setInputFiles({ name: "checking.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
	await upload.getByRole("button", { name: "Import 1 line" }).click();
	await expect(
		page.getByRole("status").filter({ hasText: "checking.csv: 1 Transaction" }),
	).toBeVisible();

	// Review suggests the payment, by the card it pays down; Confirm files it in the Commitment.
	const card = page.getByTestId("review-card").filter({ hasText: "Payment to American Express" });
	await reloadUntil(page, new URL("/review?view=list", thisMonth).href, () =>
		expect(card).toHaveCount(1, { timeout: 2_000 }),
	);
	await expect(card).toContainText("Files in Amex payment · pays down what’s owed");
	await expect(card.getByRole("button", { name: "It’s a card payment" })).toHaveCount(0);
	const confirm = card.getByRole("button", { name: "Confirm" });
	await expect(confirm).toBeEnabled();
	const filed = savedBy(page, "updateTransaction");
	await confirm.click();
	await filed;
	await expect(page.getByTestId("review-card")).toHaveCount(0);
	// Then the usual offer to always file it there.
	await expect(page.getByRole("status").filter({ hasText: "in Amex payment?" })).toBeVisible();

	// The Commitment shows how far along it is, and the card owes that much less.
	await openCommitments(page, month);
	await expect(row(page, "Amex payment").first()).toContainText("$612.50 of $2,300 paid");
	await openAccount(page, "American Express");
	await expect(owedCard(page)).toContainText("$1,387.50");
	await expect(owedCard(page)).toContainText("less $612.50 paid since.");
	await expect(payments(page)).toContainText("Payment · Amex payment");
});
