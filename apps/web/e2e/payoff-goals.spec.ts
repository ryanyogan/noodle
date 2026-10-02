import { expect, type Page, test } from "@playwright/test";
import { createTestParent } from "./parents";
import { accountKindLabel, choose, createPlannedHousehold, savedBy, signedInPage } from "./session";

// Paying off a credit card or loan with a payoff Goal (ADR-0019): its target is what's owed when
// it's added, it's funded from Free to Spend like any Goal, and it's paid down as what's owed
// comes down (from a statement, or a balance a Parent enters) until it's paid off at $0.

let parent: Awaited<ReturnType<typeof createTestParent>>;

test.beforeEach(async () => {
	parent = await createTestParent();
});

test.afterEach(async () => {
	await parent?.remove();
});

const plan = { baseline: "5,000", buckets: [["Groceries", "1,200"]] as [string, string][] };

const owedCard = (page: Page) => page.getByRole("region", { name: "Still owed" });
const freeToSpend = (page: Page) => page.getByRole("region", { name: "Free to Spend" });

/** Adds an Account on the Accounts page: its form when there are none yet, else its sheet. */
async function addAccount(page: Page, name: string, kind: string, amount: string) {
	await page.goto(new URL("/accounts", page.url()).href);
	await expect(page.getByRole("heading", { level: 1 })).toHaveText("Accounts");
	const first = await page.getByText("Accounts are where the money is").count();
	if (!first) await page.getByRole("button", { name: "Add Account" }).click();
	const form = first
		? page.getByRole("main")
		: page.getByRole("dialog", { name: "Add an Account" });
	await form.getByLabel("Name").fill(name);
	await choose(form, "Kind", accountKindLabel(kind));
	await form.getByLabel(kind === "checking" ? "Balance now" : "Owed now").fill(amount);
	const saved = savedBy(page, "addAccount");
	await form.getByRole("button", { name: "Add Account" }).click();
	await saved;
	await expect(page.getByRole("link", { name: new RegExp(`^${name}, `) })).toBeVisible();
}

/** Today in the browser's time zone, which is the Household's. */
const todayIn = (page: Page) =>
	page.evaluate(() => new Date().toLocaleDateString("en-CA")) as Promise<string>;

/** A card statement (QFX) with a payment onto the card, ending owing `owed` on `day`. */
function cardStatement(day: string, payment: string, owed: string) {
	const d = day.replaceAll("-", "");
	return `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<?OFX OFXHEADER="200" VERSION="220" SECURITY="NONE" OLDFILEUID="NONE" NEWFILEUID="NONE"?>
<OFX><CREDITCARDMSGSRSV1><CCSTMTTRNRS><TRNUID>0</TRNUID>
<STATUS><CODE>0</CODE><SEVERITY>INFO</SEVERITY></STATUS>
<CCSTMTRS><CURDEF>USD</CURDEF><CCACCTFROM><ACCTID>4111111111111111</ACCTID></CCACCTFROM>
<BANKTRANLIST><DTSTART>${d}</DTSTART><DTEND>${d}</DTEND>
<STMTTRN><TRNTYPE>CREDIT</TRNTYPE><DTPOSTED>${d}000000</DTPOSTED><TRNAMT>${payment}</TRNAMT>
<FITID>payoff-${d}</FITID><NAME>PAYMENT THANK YOU</NAME></STMTTRN>
</BANKTRANLIST>
<LEDGERBAL><BALAMT>-${owed}</BALAMT><DTASOF>${d}</DTASOF></LEDGERBAL>
</CCSTMTRS></CCSTMTTRNRS></CREDITCARDMSGSRSV1></OFX>`;
}

test("a card is paid off with a payoff Goal: added from what's owed, funded, paid down, completed", async ({
	browser,
}) => {
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, plan);
	const thisMonth = page.url();
	await addAccount(page, "Everyday Checking", "checking", "4,000");
	await addAccount(page, "Visa", "credit-card", "1,200");

	// The card's page plans paying it off, from what's owed now.
	await page.getByRole("link", { name: /^Visa, / }).click();
	await expect(page.locator("[data-slot=detail-title]")).toContainText("Visa");
	const payingOff = page.getByRole("region", { name: /^Paying it off/ });
	await payingOff.getByRole("button", { name: "Plan to pay this off" }).click();
	const add = page.getByRole("dialog", { name: "Pay off a card or loan" });
	await expect(add.getByLabel("Card or loan", { exact: true })).toContainText("Visa");
	await expect(add).toContainText("$1,200 owed today. That’s the target");
	await expect(add.getByLabel("Name")).toHaveValue("Pay off Visa");
	const added = savedBy(page, "addGoal");
	await add.getByRole("button", { name: "Add Goal" }).click();
	await expect(add).toBeHidden();
	await added;

	// The Account links to it, and it starts with nothing paid down.
	await payingOff.getByRole("link", { name: "Pay off Visa, paid down $0 of $1,200" }).click();
	await expect(page.locator("[data-slot=detail-title]")).toContainText("Pay off Visa");
	await expect(owedCard(page)).toContainText("$1,200");
	await expect(owedCard(page)).toContainText("Paid down $0 of $1,200");
	await expect(owedCard(page).getByRole("button", { name: "Spend" })).toHaveCount(0);

	// Funding plans extra payments from Free to Spend; nothing is set aside.
	await owedCard(page).getByRole("button", { name: "Fund" }).click();
	const fund = page.getByRole("dialog", { name: "Fund Pay off Visa" });
	await expect(fund).toContainText("Plans extra payments toward paying down Visa");
	await fund.getByLabel("Amount").fill("600");
	await fund.getByRole("button", { name: "Fund" }).click();
	await expect(fund).toBeHidden();
	await expect(page.getByRole("status").filter({ hasText: "to Pay off Visa" })).toContainText(
		"$600 from Free to Spend to Pay off Visa",
	);
	await expect(
		page.getByRole("listitem").filter({ hasText: "Planned from Free to Spend" }),
	).toContainText("$600");
	// Funding isn't progress: only what's owed is.
	await expect(owedCard(page)).toContainText("Paid down $0 of $1,200");

	// It counts in Goal funding like any Goal, and This Month says what's still owed.
	await page.goto(thisMonth);
	await expect(freeToSpend(page).getByText("$3,200", { exact: true }).first()).toBeVisible();
	const goals = page.getByRole("region", { name: /^Goals/ });
	await expect(goals.getByRole("listitem", { name: "Pay off Visa" })).toContainText(
		"$1,200 still owed",
	);

	// The card's statement brings in the payment, and what it ends owing pays the Goal down.
	await page.goto(new URL("/accounts", page.url()).href);
	await page.getByRole("link", { name: /^Visa, / }).click();
	await page.getByRole("button", { name: "Upload statement" }).click();
	const upload = page.getByRole("dialog", { name: "Upload a statement" });
	const today = await todayIn(page);
	await upload.getByLabel("Statement file").setInputFiles({
		name: "visa.qfx",
		mimeType: "application/x-ofx",
		buffer: Buffer.from(cardStatement(today, "600.00", "600.00")),
	});
	await upload.getByRole("button", { name: /^Import \d+ lines?$/ }).click();
	await expect(page.getByRole("status").filter({ hasText: "visa.qfx:" })).toBeVisible();
	// Right after the import, the sheet offers what the statement ends owing.
	await expect(upload).toContainText("This statement ends owing $600");
	await upload.getByRole("button", { name: "Use $600 as what’s owed" }).click();
	await expect(upload).toBeHidden();
	await payingOff.getByRole("link", { name: /^Pay off Visa, / }).click();
	await expect(owedCard(page)).toContainText("Your latest statement ends owing $600");
	await expect(owedCard(page)).toContainText("Paid down $600 of $1,200");
	await expect(owedCard(page).getByRole("button", { name: /^Use / })).toHaveCount(0);
	await expect(page.getByRole("listitem").filter({ hasText: "What’s owed" }).first()).toContainText(
		"$600",
	);

	// Paying the rest: the balance entered by hand reaches $0, and it's paid off.
	await owedCard(page).getByRole("button", { name: "Update what’s owed" }).click();
	const owed = page.getByRole("dialog", { name: "Update what’s owed" });
	await owed.getByLabel("Owed now").fill("0");
	await owed.getByRole("button", { name: "Save" }).click();
	await expect(owed).toBeHidden();
	await expect(owedCard(page)).toContainText("Paid off");
	await expect(owedCard(page)).toContainText("Paid down $1,200 of $1,200");
	await expect(owedCard(page).getByRole("button", { name: "Fund" })).toHaveCount(0);

	// A Parent completes it; it moves to Completed, still linked from the card.
	const completed = savedBy(page, "completeGoal");
	await owedCard(page).getByRole("button", { name: "Complete" }).click();
	await completed;
	await expect(page.getByText("Completed. Nicely done.")).toBeVisible();
	await page.getByRole("link", { name: "Back to Goals" }).click();
	const done = page.getByRole("region", { name: /^Completed/ });
	await expect(done.getByRole("link", { name: /^Pay off Visa, / })).toContainText("Paid off");
	await page.context().close();
});

test("on a phone, a payoff Goal is added from Goals, loses progress to new charges, and starts again", async ({
	browser,
}) => {
	const page = await signedInPage(browser, parent.email, {
		viewport: { width: 393, height: 852 },
		isMobile: true,
		hasTouch: true,
	});
	await createPlannedHousehold(page, plan);
	await addAccount(page, "Honda loan", "loan", "8,000");

	// Add Goal offers paying off a card or loan, with the card or loan to pick.
	await page.goto(new URL("/goals", page.url()).href);
	await expect(page.getByRole("heading", { level: 1 })).toHaveText("Goals");
	await page.getByRole("button", { name: "Add Goal" }).click();
	const add = page.getByRole("dialog", { name: "Add a Goal" });
	await add.getByRole("radio", { name: "Pay off a card or loan" }).check();
	const payoff = page.getByRole("dialog", { name: "Pay off a card or loan" });
	await expect(payoff.getByLabel("Card or loan", { exact: true })).toContainText("Honda loan");
	await expect(payoff).toContainText("$8,000 owed today");
	const added = savedBy(page, "addGoal");
	await payoff.getByRole("button", { name: "Add Goal" }).click();
	await added;

	const row = page
		.getByRole("region", { name: /^Paying off/ })
		.getByRole("link", { name: /^Pay off Honda loan, / });
	await expect(row).toContainText("$8,000");
	await expect(row).toContainText("still owed");
	expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(393);

	// New charges take what's owed above where it started: nothing counts as paid down.
	await row.click();
	await owedCard(page).getByRole("button", { name: "Update what’s owed" }).click();
	const owed = page.getByRole("dialog", { name: "Update what’s owed" });
	await owed.getByLabel("Owed now").fill("8,400");
	await owed.getByRole("button", { name: "Save" }).click();
	await expect(owed).toBeHidden();
	await expect(owedCard(page)).toContainText("Paid down $0 of $8,000");
	await expect(owedCard(page)).toContainText("New charges took what’s owed $400 above");
	expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(393);

	// Starting again makes today's balance the target.
	const restarted = savedBy(page, "restartPayoffGoal");
	await owedCard(page).getByRole("button", { name: "Start again from today’s balance" }).click();
	await restarted;
	await expect(owedCard(page)).toContainText("Paid down $0 of $8,400");
	await expect(owedCard(page)).not.toContainText("New charges");
	await page.context().close();
});
