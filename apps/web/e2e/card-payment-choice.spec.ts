import { expect, type Page, test } from "@playwright/test";
import { openCommitmentForm } from "./commitment-form";
import { createTestParent } from "./parents";
import { seedSql } from "./seed-sql";
import {
	accountKindLabel,
	choose,
	createPlannedHousehold,
	PURCHASES_QUESTION,
	reloadUntil,
	signedInPage,
	withoutPaymentCommitment,
} from "./session";

// "It's a card payment" (issue 136): one named choice on money out that asks which card. A card
// Noodle keeps by statements makes it a Transfer naming the card; a card that isn't in Noodle asks
// whether the payment counts as spending (yes makes its Commitment in place); a card kept by hand
// files it in the Commitment that pays the card down. Each answer is remembered, covers the lines
// already here that say the same, and has one Undo. The row's own menu and Review ask it too.

let parent: Awaited<ReturnType<typeof createTestParent>>;

test.beforeEach(async () => {
	parent = await createTestParent();
});

test.afterEach(async () => {
	await parent?.remove();
});

const toast = (page: Page, text: string) => page.getByRole("status").filter({ hasText: text });

const today = (page: Page) =>
	page.evaluate(() =>
		new Date().toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" }),
	);

type NewAccount = {
	name: string;
	kind: "checking" | "credit-card";
	balance: string;
	/** A card's answer to "How do its purchases get into Noodle?"; left out, it says statements. */
	purchases?: "I add them by hand" | "They won’t";
};

/** Adds an Account on the Accounts page. */
async function addAccount(page: Page, account: NewAccount) {
	await page.getByRole("link", { name: "Accounts", exact: true }).click();
	await expect(page.getByRole("heading", { level: 1 })).toHaveText("Accounts");
	if (await page.getByRole("region", { name: "Totals" }).isVisible()) {
		await expect(async () => {
			await page.getByRole("button", { name: "Add Account" }).click();
			await expect(page.getByLabel("Name")).toBeVisible({ timeout: 1000 });
		}).toPass();
	}
	await page.getByLabel("Name").fill(account.name);
	await choose(page, "Kind", accountKindLabel(account.kind));
	// A card has to say (issue 141): nothing is chosen for it.
	if (account.kind === "credit-card") {
		await choose(page, PURCHASES_QUESTION, account.purchases ?? "From its statements");
	}
	await withoutPaymentCommitment(page);
	await page
		.getByLabel(account.kind === "credit-card" ? "Owed now" : "Balance now")
		.fill(account.balance);
	await page.getByRole("button", { name: "Add Account" }).click();
	await expect(page.getByRole("link", { name: new RegExp(`^${account.name}, `) })).toBeVisible();
}

/** Adds an Account on the Accounts page, opens it, and uploads a CSV statement to it. */
async function uploadStatement(page: Page, account: NewAccount, file: string, lines: string[]) {
	await addAccount(page, account);
	await page.getByRole("link", { name: new RegExp(`^${account.name}, `) }).click();
	await expect(page.locator("[data-slot=detail-title]:visible")).toContainText(account.name);
	await page.getByRole("button", { name: "Upload statement" }).click();
	const sheet = page.getByRole("dialog", { name: "Upload a statement" });
	await sheet
		.getByLabel("Statement file")
		.setInputFiles({ name: file, mimeType: "text/csv", buffer: Buffer.from(lines.join("\n")) });
	await sheet
		.getByRole("button", {
			name: `Import ${lines.length - 1} line${lines.length === 2 ? "" : "s"}`,
		})
		.click();
	await expect(sheet).toBeHidden();
	await expect(toast(page, file).first()).toBeVisible();
}

const HEADER = "Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #";

/** The list is refetched once an answer or its Undo lands: a busy machine takes a while over it. */
const SETTLED = { timeout: 20_000 };

/** This month's line of `amount` out of Checking that nobody has assigned, as its row. */
const unassigned = (page: Page, amount: string) =>
	page.getByRole("button", {
		name: new RegExp(`, \\$${amount}, Unassigned, .*from Checking$`),
	});

/** The detail that is open, with its type tiles. */
const detail = (page: Page) =>
	page
		.locator("[role=dialog], [data-slot=transaction-detail]")
		.filter({ has: page.getByRole("group", { name: "Transaction type" }) });

/** Opens the detail of this month's unassigned line of `amount`, on its "Card payment" tile. */
async function openLine(page: Page, amount: string) {
	await expect(unassigned(page, amount)).toBeVisible();
	await unassigned(page, amount).click();
	const tile = detail(page).getByRole("button", { name: "Card payment", exact: true });
	await expect(tile).toBeEnabled();
	// The bank's wording is read once, under the tiles, and points at this one.
	await expect(detail(page).locator("[data-slot=type-hint]")).toHaveText(
		"Looks like a card payment. If it is, choose Card payment.",
	);
	await expect(detail(page).getByRole("button", { name: "It’s a card payment" })).toHaveCount(0);
	await tile.click();
	await expect(detail(page).getByRole("combobox", { name: "Payment to" })).toBeEnabled();
	return detail(page);
}

/** "A card that isn’t in Noodle" under "Payment to": the question about the payment itself. */
async function notInNoodle(sheet: ReturnType<typeof detail>) {
	await choose(sheet, "Payment to", "A card that isn’t in Noodle");
	const choice = sheet.getByTestId("card-payment-choice");
	await expect(choice).toContainText("Count this payment as spending?");
	return choice;
}

/** The Transactions page of the month in `thisMonth`'s address, once its rows can be opened. */
async function openTransactions(page: Page, thisMonth: string) {
	await page.goto(thisMonth.replace(/\/month\/(\d{4}-\d{2}).*$/, "/transactions/$1"));
	// A cold dev server builds the page first: rows open once it is hydrated.
	await expect(page.getByLabel("Search notes and merchants")).toBeEnabled({ timeout: 30_000 });
}

test("“It’s a card payment” asks which card, names it on the Transfer, and remembers the wording", async ({
	browser,
}) => {
	test.slow();
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, { baseline: "5,000", buckets: [["Groceries", "1,200"]] });
	const thisMonth = page.url();
	const day = await today(page);

	// Visa is kept by statements; its own side of the payment hasn't come in.
	await uploadStatement(page, { name: "Visa", kind: "credit-card", balance: "300" }, "visa.csv", [
		HEADER,
		`DEBIT,${day},"REI #44 SEATTLE",-60.00,DEBIT_CARD,,`,
	]);
	await uploadStatement(
		page,
		{ name: "Checking", kind: "checking", balance: "2,500" },
		"checking.csv",
		[
			HEADER,
			`DEBIT,${day},"CARDMEMBER SERV WEB PYMT",-250.00,ACH_DEBIT,2250.00,`,
			`DEBIT,${day},"AMEX EPAYMENT ACH PMT",-400.00,ACH_DEBIT,1850.00,`,
			`DEBIT,${day},"CARDMEMBER SERV WEB PYMT",-120.00,ACH_DEBIT,1730.00,`,
			`DEBIT,${day},"DISCOVER E-PAYMENT 5521",-75.00,ACH_DEBIT,1655.00,`,
		],
	);
	await openTransactions(page, thisMonth);

	// A card Noodle keeps by statements: a Transfer that names it, and so is the other line that
	// says the same, in the same answer.
	const answerVisa = async () => {
		const sheet = await openLine(page, "250");
		await choose(sheet, "Payment to", "Visa");
		await expect(sheet).toContainText("this payment isn’t spending: it’s a Transfer to Visa.");
		await sheet.getByRole("button", { name: "It’s a card payment", exact: true }).click();
		await expect(
			toast(page, "marked as a Transfer to Visa, with 1 more worded like it"),
		).toContainText("Payments worded like it will be too.");
		await expect(unassigned(page, "120")).toHaveCount(0, SETTLED);
		await expect(unassigned(page, "250")).toHaveCount(0, SETTLED);
	};
	await answerVisa();
	// One Undo takes both back, and forgets the wording.
	await toast(page, "marked as a Transfer to Visa").getByRole("button", { name: "Undo" }).click();
	await expect(unassigned(page, "250")).toBeVisible(SETTLED);
	await expect(unassigned(page, "120")).toBeVisible(SETTLED);
	await expect(toast(page, "marked as a Transfer to Visa")).toHaveCount(0);
	await answerVisa();
	await expect(
		page.getByText("Checking → Visa", { exact: true }).filter({ visible: true }).first(),
	).toBeVisible();
	// The toast that says so sits over the list "Payment to" opens below, and stays for as long as
	// the pointer rests on it: off it, and gone, before anything under it is clicked.
	await page.mouse.move(0, 0);
	await expect(toast(page, "marked as a Transfer to")).toHaveCount(0, { timeout: 15_000 });

	// The row offers it itself: its menu opens the row on that tile, at "Payment to". A card that isn't in
	// Noodle: is the payment the spending? No: a Transfer with no other side, which counts nowhere.
	await page.keyboard.press("Escape");
	const amex = page.getByRole("row").filter({ has: unassigned(page, "400") });
	await amex.hover();
	await amex.getByRole("button", { name: /^More for / }).click();
	await page.getByRole("menuitem", { name: "It’s a card payment" }).click();
	await expect(
		detail(page).getByRole("button", { name: "Card payment", exact: true }),
	).toHaveAttribute("aria-pressed", "true");
	let choice = await notInNoodle(detail(page));
	await choice.getByRole("button", { name: "No, it’s a Transfer" }).click();
	await expect(toast(page, "marked as a Transfer. Payments worded like it")).toBeVisible();
	await expect(
		page.getByText("out of Checking", { exact: true }).filter({ visible: true }).first(),
	).toBeVisible();

	// Yes: the card's Commitment is made in place, with this payment filed in it.
	const answerYes = async () => {
		const sheet = await openLine(page, "75");
		choice = await notInNoodle(sheet);
		await choice.getByRole("button", { name: "Yes, make a Commitment" }).click();
		await expect(toast(page, "is now a Commitment, and this payment is filed in it")).toContainText(
			"Payments worded like it will be too.",
		);
		await expect(unassigned(page, "75")).toHaveCount(0, SETTLED);
	};
	await answerYes();
	// Undo: the payment is unassigned again and the Commitment is gone from the Plan.
	await toast(page, "is now a Commitment").getByRole("button", { name: "Undo" }).click();
	await expect(unassigned(page, "75")).toBeVisible(SETTLED);
	await expect(toast(page, "is now a Commitment")).toHaveCount(0);
	await answerYes();

	// Both Transfer answers are remembered, and can be removed on the Rules page.
	await page.goto(new URL("/review/rules", thisMonth).href);
	const remembered = page.getByTestId("card-payment-rules");
	// They are fetched once the page is hydrated, which a cold dev server takes a while over.
	await expect(remembered.getByTestId("card-payment-rule")).toHaveCount(2, { timeout: 30_000 });
	await expect(remembered).toContainText("Always a Transfer to Visa");
	await expect(remembered).toContainText("Always a Transfer to a card that isn’t in Noodle");
	// The Commitment's wording is an ordinary Rule, filing in the Commitment named after the line.
	await expect(page.getByRole("main")).toContainText("“discover e”");
	await expect(page.getByRole("main")).toContainText("Discover payment");
	const visa = remembered
		.getByTestId("card-payment-rule")
		.filter({ hasText: "Always a Transfer to Visa" });
	await expect(visa.getByRole("button", { name: /^Stop remembering / })).toBeEnabled();
	await visa.getByRole("button", { name: /^Stop remembering / }).click();
	await expect(toast(page, "No longer remembered")).toBeVisible();
	await expect(remembered.getByTestId("card-payment-rule")).toHaveCount(1);

	// The Commitment made in place is in the Plan, once, at the payment's amount.
	await page.goto(thisMonth.replace(/\/month\/(\d{4}-\d{2}).*$/, "/plan/$1/commitments"));
	await expect(page.getByRole("main").getByText("Discover payment").first()).toBeVisible({
		timeout: 30_000,
	});
	await expect(page.getByRole("main")).toContainText("$75");
});

test("the “Edit” beside a Commitment made in place opens that Commitment", async ({ browser }) => {
	test.slow();
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, { baseline: "5,000", buckets: [["Groceries", "1,200"]] });
	const thisMonth = page.url();
	const day = await today(page);
	// No card Accounts at all: "A card that isn’t in Noodle" is the one choice under "Payment to".
	await uploadStatement(
		page,
		{ name: "Checking", kind: "checking", balance: "2,500" },
		"checking.csv",
		[HEADER, `DEBIT,${day},"DISCOVER E-PAYMENT 5521",-75.00,ACH_DEBIT,1655.00,`],
	);
	await openTransactions(page, thisMonth);
	const sheet = await openLine(page, "75");
	const choice = await notInNoodle(sheet);
	await choice.getByRole("button", { name: "Yes, make a Commitment" }).click();
	// One toast says it, with Edit beside its Undo.
	const said = toast(page, "is now a Commitment, and this payment is filed in it");
	await expect(said).toHaveCount(1);
	await expect(said.getByRole("button", { name: "Undo" })).toBeVisible();
	await expect(toast(page, "It’s planned monthly")).toHaveCount(0);
	await said.getByRole("button", { name: "Edit" }).click();
	await expect(page).toHaveURL(/\/plan\/\d{4}-\d{2}\/commitments\/[0-9A-Z]{26}/);
	// A cold dev server builds the Commitment's page first.
	await expect(page.locator("[data-slot=detail-title]:visible")).toContainText(/discover/i, {
		timeout: 30_000,
	});
});

test("a payment to a card whose purchases aren’t in Noodle is filed in the Commitment that pays it down, with one Undo", async ({
	browser,
}) => {
	test.slow();
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, { baseline: "5,000", buckets: [["Groceries", "1,200"]] });
	const thisMonth = page.url();
	const day = await today(page);
	// Apple Card has no statements and no bank connection, and the Parent says its purchases won't
	// get into Noodle: its payment is the spending. (Kept by hand, it's a Transfer: issue 151.)
	await addAccount(page, {
		name: "Apple Card",
		kind: "credit-card",
		balance: "900",
		purchases: "They won’t",
	});
	await uploadStatement(
		page,
		{ name: "Checking", kind: "checking", balance: "2,500" },
		"checking.csv",
		[
			HEADER,
			`DEBIT,${day},"APPLECARD GSBANK PAYMENT 8841",-300.00,ACH_DEBIT,2200.00,`,
			`DEBIT,${day},"APPLECARD GSBANK PAYMENT 8841",-45.00,ACH_DEBIT,2155.00,`,
			`DEBIT,${day},"CORNER STORE #1",-30.00,DEBIT_CARD,2125.00,`,
		],
	);
	// The Commitment that pays the card down.
	await page.goto(thisMonth.replace(/\/month\/(\d{4}-\d{2}).*$/, "/plan/$1/commitments"));
	await openCommitmentForm(page);
	await expect(page.getByLabel("New Commitment")).toBeEnabled({ timeout: 30_000 });
	await page.getByLabel("New Commitment").fill("Apple Card bill");
	await page.getByLabel("Amount due").fill("300");
	await page.getByRole("combobox", { name: "Pays down", exact: true }).click();
	await page
		.getByRole("listbox")
		.getByRole("option", { name: /^Apple Card/ })
		.click();
	await page.getByRole("button", { name: "Add Commitment" }).click();
	await expect(page.getByRole("main")).toContainText("Pays down Apple Card");

	await openTransactions(page, thisMonth);
	const sheet = await openLine(page, "300");
	await choose(sheet, "Payment to", "Apple Card");
	await expect(sheet).toContainText(
		"Apple Card’s purchases aren’t in Noodle, so this payment is the spending: it’s filed in Apple Card bill.",
	);
	await sheet.getByRole("button", { name: "It’s a card payment", exact: true }).click();
	// Both lines that say the same go in; the corner store stays.
	await expect(toast(page, "filed in Apple Card bill, with 1 more worded like it.")).toContainText(
		"Payments worded like it will be too.",
	);
	await expect(unassigned(page, "300")).toHaveCount(0, SETTLED);
	await expect(unassigned(page, "45")).toHaveCount(0, SETTLED);
	await expect(unassigned(page, "30")).toBeVisible();

	// Undo puts both back.
	await toast(page, "filed in Apple Card bill").getByRole("button", { name: "Undo" }).click();
	await expect(unassigned(page, "300")).toBeVisible(SETTLED);
	await expect(unassigned(page, "45")).toBeVisible(SETTLED);
});

test("Review asks which card when the wording fits two cards Noodle follows", async ({
	browser,
}) => {
	test.slow();
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, { baseline: "5,000", buckets: [["Groceries", "1,200"]] });
	const thisMonth = page.url();
	const day = await today(page);
	for (const name of ["Chase Sapphire", "Chase Freedom"]) {
		await uploadStatement(page, { name, kind: "credit-card", balance: "300" }, `${name}.csv`, [
			HEADER,
			`DEBIT,${day},"REI #44 SEATTLE",-60.00,DEBIT_CARD,,`,
		]);
	}
	await uploadStatement(
		page,
		{ name: "Checking", kind: "checking", balance: "2,500" },
		"checking.csv",
		[HEADER, `DEBIT,${day},"CHASE CREDIT CRD AUTOPAY",-250.00,ACH_DEBIT,2250.00,`],
	);

	// The list: the card's own button asks, and Cancel leaves the card where it was.
	const payment = page
		.getByTestId("review-card")
		.filter({ has: page.getByRole("button", { name: "It’s a card payment" }) });
	await reloadUntil(page, new URL("/review?view=list", thisMonth).href, () =>
		expect(payment).toHaveCount(1, { timeout: 2_000 }),
	);
	const mark = payment.getByRole("button", { name: "It’s a card payment" });
	// A cold dev server takes a while to hydrate Review.
	await expect(mark).toBeEnabled({ timeout: 30_000 });
	await mark.click();
	const asking = page.getByRole("dialog", { name: "It’s a card payment" });
	await expect(asking.getByTestId("card-payment-choice")).toContainText("Which card does it pay?");
	await asking.getByRole("button", { name: "Cancel" }).click();
	await expect(asking).toBeHidden();
	await expect(payment).toHaveCount(1);

	// The stack: the same question, and the answer names the card.
	await page.goto(new URL("/review", thisMonth).href);
	const top = page.getByRole("button", { name: "It’s a card payment" }).first();
	await expect(top).toBeEnabled({ timeout: 30_000 });
	await top.click();
	await asking.getByRole("button", { name: "Chase Freedom", exact: true }).click();
	await expect(toast(page, "marked as a Transfer to Chase Freedom")).toContainText(
		"Payments worded like it will be too.",
	);
	await expect(asking).toBeHidden();
});

test("Review asks which card for a payment to a card Noodle doesn't follow, and offers the one kept by hand", async ({
	browser,
}) => {
	test.slow();
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, { baseline: "5,000", buckets: [["Groceries", "1,200"]] });
	const thisMonth = page.url();
	const day = await today(page);
	// The card's statements haven't come in yet, so Noodle doesn't follow it; and the Parent calls
	// it by a name the bank's wording ("APPLECARD", read as Apple Card) doesn't say.
	await addAccount(page, { name: "Titanium", kind: "credit-card", balance: "900" });
	await uploadStatement(
		page,
		{ name: "Checking", kind: "checking", balance: "2,500" },
		"checking.csv",
		[HEADER, `DEBIT,${day},"APPLECARD GSBANK PAYMENT 8841",-300.00,ACH_DEBIT,2200.00,`],
	);

	const payment = page
		.getByTestId("review-card")
		.filter({ has: page.getByRole("button", { name: "It’s a card payment" }) });
	await reloadUntil(page, new URL("/review?view=list", thisMonth).href, () =>
		expect(payment).toHaveCount(1, { timeout: 2_000 }),
	);
	const mark = payment.getByRole("button", { name: "It’s a card payment" }).first();
	await expect(mark).toBeEnabled({ timeout: 30_000 });
	await mark.click();
	// Nothing is marked on the click: it asks, with the Household's card and one that isn't here.
	const asking = page.getByRole("dialog", { name: "It’s a card payment" });
	const choice = asking.getByTestId("card-payment-choice");
	await expect(choice).toContainText("Which card does it pay?");
	await expect(choice.getByRole("button", { name: "A card that isn’t in Noodle" })).toBeVisible();
	// The Household's cards are read before "Back" below can return to them (it cancels otherwise).
	await expect(choice.getByRole("button", { name: "Titanium", exact: true })).toBeVisible();
	// (The sheet hides the page's buttons from roles, so the cards are counted by test id.)
	await expect(page.getByTestId("review-card")).toHaveCount(1);
	await choice.getByRole("button", { name: "A card that isn’t in Noodle" }).click();
	await expect(choice).toContainText("Count this payment as spending?");
	await choice.getByRole("button", { name: "Back" }).click();
	await choice.getByRole("button", { name: "Titanium", exact: true }).click();
	await expect(toast(page, "marked as a Transfer to Titanium")).toBeVisible();
	await expect(asking).toBeHidden();
	await expect(page.getByTestId("review-card")).toHaveCount(0);
});

test("Review leads with “It’s a card payment” when the bank doesn't say which card and a card Noodle follows may be it", async ({
	browser,
}) => {
	test.slow();
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, { baseline: "5,000", buckets: [["Groceries", "1,200"]] });
	const thisMonth = page.url();
	const day = await today(page);
	// Noodle follows the card (a purchase on it is here), under a name that says no issuer; and
	// the bank's wording for its payment names no card at all.
	await uploadStatement(
		page,
		{ name: "Titanium", kind: "credit-card", balance: "900" },
		"titanium.csv",
		[HEADER, `DEBIT,${day},"REI #44 SEATTLE",-60.00,DEBIT_CARD,,`],
	);
	await uploadStatement(
		page,
		{ name: "Checking", kind: "checking", balance: "2,500" },
		"checking.csv",
		[HEADER, `DEBIT,${day},"CARDMEMBER SERV WEB PYMT",-250.00,ACH_DEBIT,2250.00,`],
	);

	const payment = page.locator("[data-testid=review-card][data-payment=not-followed]");
	await reloadUntil(page, new URL("/review?view=list", thisMonth).href, () =>
		expect(payment).toHaveCount(1, { timeout: 2_000 }),
	);
	await expect(payment).toContainText("Card payment · which card does it pay?");
	await expect(payment.getByTestId("review-payment-why")).toContainText(
		"The bank doesn’t say which card. If it pays Titanium, it isn’t spending; for a card that isn’t in Noodle, the payment is the spending.",
	);
	// Which card is the first question: "Make it a Commitment" comes after it.
	const mark = payment.getByRole("button", { name: "It’s a card payment" });
	const make = payment.getByRole("button", { name: "Make it a Commitment" });
	await expect(mark).toHaveCount(1);
	await expect(make).toHaveCount(1);
	// (Enabled once the page is hydrated.)
	await expect(mark).toBeEnabled({ timeout: 30_000 });
	const [first, second] = await Promise.all([mark.boundingBox(), make.boundingBox()]);
	if (!first || !second) throw new Error("the card's two buttons aren't drawn");
	expect(
		first.y + first.height <= second.y || (first.y <= second.y && first.x < second.x),
		"“It’s a card payment” is before “Make it a Commitment”",
	).toBe(true);

	await mark.click();
	// Nothing is marked on the click: it asks, with the card that may be the one.
	const asking = page.getByRole("dialog", { name: "It’s a card payment" });
	const choice = asking.getByTestId("card-payment-choice");
	await expect(choice).toContainText("Which card does it pay?");
	await expect(choice.getByRole("button", { name: "A card that isn’t in Noodle" })).toBeVisible();
	await expect(page.getByTestId("review-card").filter({ hasText: "CARDMEMBER" })).toHaveCount(1);
	await choice.getByRole("button", { name: "Titanium", exact: true }).click();
	await expect(toast(page, "marked as a Transfer to Titanium")).toBeVisible();
	await expect(asking).toBeHidden();
	await expect(payment).toHaveCount(0, SETTLED);

	// It's a Transfer to the card, not spending: nothing of it waits to be assigned.
	await openTransactions(page, thisMonth);
	await expect(
		page.getByText("Checking → Titanium", { exact: true }).filter({ visible: true }).first(),
	).toBeVisible();
	await expect(unassigned(page, "250")).toHaveCount(0);
});

/** The payment cards waiting in Review, in the view at `view` ("" is one by one). */
async function reviewCards(page: Page, thisMonth: string, view: "" | "?view=list", text: string) {
	const cards = page.getByTestId("review-card").filter({ hasText: text });
	await reloadUntil(page, new URL(`/review${view}`, thisMonth).href, () =>
		expect(cards.first()).toBeVisible({ timeout: 2_000 }),
	);
	return cards;
}

for (const view of ["?view=list", ""] as const) {
	const where = view ? "the list" : "one by one";

	test(`Review, ${where}: “Make it a Commitment” makes it in place, with Undo and Edit in one toast`, async ({
		browser,
	}) => {
		test.slow();
		const page = await signedInPage(browser, parent.email);
		await createPlannedHousehold(page, { baseline: "5,000", buckets: [["Groceries", "1,200"]] });
		const thisMonth = page.url();
		const day = await today(page);
		await uploadStatement(
			page,
			{ name: "Checking", kind: "checking", balance: "2,500" },
			"checking.csv",
			[HEADER, `DEBIT,${day},"DISCOVER E-PAYMENT 5521",-75.00,ACH_DEBIT,1655.00,`],
		);
		const cards = await reviewCards(page, thisMonth, view, "DISCOVER");
		const make = cards.first().getByRole("button", { name: "Make it a Commitment" });
		await expect(make).toBeEnabled({ timeout: 30_000 });
		await make.click();
		// Nothing opens: the Commitment is made here and the card leaves.
		await expect(page).toHaveURL(/\/review/);
		const said = toast(page, "is now a Commitment, and this payment is filed in it");
		await expect(said).toHaveCount(1);
		await expect(said.getByRole("button", { name: "Edit" })).toBeVisible();
		await expect(cards).toHaveCount(0, SETTLED);

		// Undo: the card is back, and the Commitment has left the Plan.
		await said.getByRole("button", { name: "Undo" }).click();
		await expect(cards.first()).toBeVisible(SETTLED);
		await expect(said).toHaveCount(0);
		await page.goto(thisMonth.replace(/\/month\/(\d{4}-\d{2}).*$/, "/plan/$1/commitments"));
		await expect(page.getByRole("button", { name: "Add Commitment", exact: true })).toBeEnabled({
			timeout: 30_000,
		});
		await expect(page.getByRole("main").getByText(/discover/i)).toHaveCount(0);

		// Again, and kept: it's in the Plan once, and Review has nothing left of it.
		const again = await reviewCards(page, thisMonth, view, "DISCOVER");
		await expect(again.first().getByRole("button", { name: "Make it a Commitment" })).toBeEnabled({
			timeout: 30_000,
		});
		await again.first().getByRole("button", { name: "Make it a Commitment" }).click();
		const edit = toast(page, "is now a Commitment").getByRole("button", { name: "Edit" });
		await edit.click();
		await expect(page).toHaveURL(/\/plan\/\d{4}-\d{2}\/commitments\/[0-9A-Z]{26}/);
		await expect(page.locator("[data-slot=detail-title]:visible")).toContainText(/discover/i, {
			timeout: 30_000,
		});
	});

	test(`Review, ${where}: a payment to a card whose purchases aren’t in Noodle is offered its Commitment, and Undo puts the card back`, async ({
		browser,
	}) => {
		test.slow();
		const page = await signedInPage(browser, parent.email);
		await createPlannedHousehold(page, { baseline: "5,000", buckets: [["Groceries", "1,200"]] });
		const thisMonth = page.url();
		const day = await today(page);
		await addAccount(page, {
			name: "Apple Card",
			kind: "credit-card",
			balance: "900",
			purchases: "They won’t",
		});
		await payDown(page, thisMonth);
		await uploadStatement(
			page,
			{ name: "Checking", kind: "checking", balance: "2,500" },
			"checking.csv",
			[HEADER, `DEBIT,${day},"APPLECARD GSBANK PAYMENT 8841",-300.00,ACH_DEBIT,2200.00,`],
		);
		// Review reads it as a payment to Apple Card, which Apple Card bill pays down: the payment
		// is the spending, so Confirm files it there. It isn't asked which card, and nothing offers
		// to make it a Transfer first.
		const cards = await reviewCards(page, thisMonth, view, "Apple Card bill");
		const confirm = cards.first().getByRole("button", { name: "Confirm" });
		await expect(confirm).toBeEnabled({ timeout: 30_000 });
		await expect(cards.first().getByRole("button", { name: "Make it a Commitment" })).toHaveCount(
			0,
		);
		await confirm.click();
		await expect(cards).toHaveCount(0, SETTLED);
		// The list says it in a toast with Undo; one by one there's no toast (it would sit over the
		// next card): it's said beside the stack, whose own Undo is right there.
		const undo = view
			? page.getByRole("status").getByRole("button", { name: "Undo" }).first()
			: page.getByRole("main").getByRole("button", { name: "Undo", exact: true });
		await expect(undo).toBeEnabled();
		await undo.click();
		await expect(cards.first()).toBeVisible(SETTLED);
	});
}

/** A Commitment, "Apple Card bill", that pays the Apple Card down. */
async function payDown(page: Page, thisMonth: string) {
	await page.goto(thisMonth.replace(/\/month\/(\d{4}-\d{2}).*$/, "/plan/$1/commitments"));
	await openCommitmentForm(page);
	await expect(page.getByLabel("New Commitment")).toBeEnabled({ timeout: 30_000 });
	await page.getByLabel("New Commitment").fill("Apple Card bill");
	await page.getByLabel("Amount due").fill("300");
	await page.getByRole("combobox", { name: "Pays down", exact: true }).click();
	await page
		.getByRole("listbox")
		.getByRole("option", { name: /^Apple Card/ })
		.click();
	await page.getByRole("button", { name: "Add Commitment" }).click();
	await expect(page.getByRole("main")).toContainText("Pays down Apple Card");
}

// Issue 151: a card kept by hand has its purchases in Buckets, so paying it is a Transfer. Review
// leads with that, never with a Commitment, and the payment moves nothing on This Month.
test("a payment to a card kept by hand, with Quick Adds on it, is a Transfer first in Review and changes nothing on This Month", async ({
	browser,
}) => {
	test.slow();
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, { baseline: "5,000", buckets: [["Groceries", "1,200"]] });
	const thisMonth = page.url();
	const day = await today(page);
	await addAccount(page, {
		name: "Apple Card",
		kind: "credit-card",
		balance: "0",
		purchases: "I add them by hand",
	});
	// Two Quick Adds on the card, filed in Groceries: written straight in, as Quick Add leaves them.
	const [cards] = await seedSql([
		// This Parent's own card: another test running beside this one has an "Apple Card" too.
		`select id, household_id from accounts where name = 'Apple Card' and household_id = (select household_id from members where clerk_user_id = '${parent.userId}') order by created_at desc limit 1`,
	]);
	const cardId = String(cards?.[0]?.id);
	const householdId = String(cards?.[0]?.household_id);
	const [buckets] = await seedSql([
		`select id from buckets where household_id = '${householdId}' and name = 'Groceries'`,
	]);
	const bucketId = String(buckets?.[0]?.id);
	const run = Date.now().toString(36);
	const isoDay = await page.evaluate(() => {
		const now = new Date();
		const two = (n: number) => String(n).padStart(2, "0");
		return `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`;
	});
	await seedSql(
		[
			["a", 18000],
			["b", 12000],
		].map(
			([id, cents]) =>
				`insert into transactions (id, household_id, source, date, amount_cents, account_id, bucket_id, note)
					values ('buy-${id}-${run}', '${householdId}', 'quick-add', '${isoDay}', ${cents}, '${cardId}', '${bucketId}', 'Groceries on the card')`,
		),
	);

	// This Month before the payment: $300 of Groceries, once.
	const freeToSpend = page.getByRole("region", { name: "Free to Spend" });
	const groceries = page.getByLabel(/^Groceries: /).first();
	const money = async () =>
		((await freeToSpend.innerText()).match(/\$[\d,]+(\.\d\d)?/g) ?? []).join(" ");
	await reloadUntil(page, thisMonth, () =>
		expect(groceries).toHaveAttribute("aria-label", /^Groceries: \$900(\.00)? left of \$1,200/, {
			timeout: 3_000,
		}),
	);
	await expect(freeToSpend).toBeVisible();
	const freeBefore = await money();
	expect(freeBefore).not.toBe("");
	const groceriesBefore = await groceries.getAttribute("aria-label");

	await uploadStatement(
		page,
		{ name: "Checking", kind: "checking", balance: "2,500" },
		"checking.csv",
		[HEADER, `DEBIT,${day},"APPLECARD GSBANK PAYMENT 8841",-300.00,ACH_DEBIT,2200.00,`],
	);

	// Review: not spending, the Transfer is the card's action, and no Commitment is offered.
	const cardsWaiting = await reviewCards(page, thisMonth, "?view=list", "APPLECARD");
	const card = cardsWaiting.first();
	await expect(card).toContainText("Payment to Apple Card · isn’t spending");
	await expect(card.getByTestId("review-payment-why")).toContainText(
		"What you bought on Apple Card is already in your Buckets, so the payment itself isn’t spending.",
	);
	await expect(card.getByRole("button", { name: "Make it a Commitment" })).toHaveCount(0);
	await expect(card.getByRole("button", { name: "Confirm" })).toHaveCount(0);
	const mark = card.getByRole("button", { name: "It’s a card payment" }).first();
	await expect(mark).toBeEnabled({ timeout: 30_000 });
	await mark.click();
	const asking = page.getByRole("dialog", { name: "It’s a card payment" });
	const marked = toast(page, "marked as a Transfer to Apple Card");
	await expect(asking.or(marked).first()).toBeVisible();
	if (await asking.isVisible()) {
		const choice = asking.getByTestId("card-payment-choice");
		// Nothing says its payment is the spending.
		await expect(choice).not.toContainText("so its payment is the spending");
		await choice.getByRole("button", { name: "Apple Card", exact: true }).click();
	}
	await expect(marked).toBeVisible();
	await expect(page.getByTestId("review-card")).toHaveCount(0, SETTLED);
	const [filed] = await seedSql([
		`select t.commitment_id, t.bucket_id, x.other_account_id from transactions t
			left join transfers x on x.out_transaction_id = t.id
			where t.household_id = '${householdId}' and t.amount_cents = 30000`,
	]);
	expect(filed).toEqual([{ commitment_id: null, bucket_id: null, other_account_id: cardId }]);

	// This Month after it: the same spending, the same Free to Spend.
	await page.goto(thisMonth);
	await expect(groceries).toHaveAttribute("aria-label", groceriesBefore ?? "", { timeout: 30_000 });
	await expect(freeToSpend).toBeVisible();
	expect(await money()).toBe(freeBefore);
});

test("a card whose purchases won’t come into Noodle says so where its payment is asked about", async ({
	browser,
}) => {
	test.slow();
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, { baseline: "5,000", buckets: [["Groceries", "1,200"]] });
	const thisMonth = page.url();
	const day = await today(page);
	await addAccount(page, {
		name: "Apple Card",
		kind: "credit-card",
		balance: "900",
		purchases: "They won’t",
	});
	await payDown(page, thisMonth);
	await uploadStatement(
		page,
		{ name: "Checking", kind: "checking", balance: "2,500" },
		"checking.csv",
		[HEADER, `DEBIT,${day},"APPLECARD GSBANK PAYMENT 8841",-300.00,ACH_DEBIT,2200.00,`],
	);
	await openTransactions(page, thisMonth);
	const sheet = await openLine(page, "300");
	await choose(sheet, "Payment to", "Apple Card");
	await expect(sheet).toContainText(
		"Apple Card’s purchases aren’t in Noodle, so this payment is the spending: it’s filed in Apple Card bill.",
	);
	if (process.env.CARD_PAYMENT_SHOTS) {
		await page.screenshot({ path: `${process.env.CARD_PAYMENT_SHOTS}/they-wont-hint.png` });
	}
});

test("an assigned Apple payment links to a manually added card from Transactions", async ({
	browser,
}) => {
	test.slow();
	const page = await signedInPage(browser, parent.email);
	await page.setViewportSize({ width: 1440, height: 1000 });
	await createPlannedHousehold(page, {
		baseline: "5,000",
		buckets: [["Apple Temp Holder", "4,500"]],
	});
	const thisMonth = page.url();
	await addAccount(page, { name: "Apple Card", kind: "credit-card", balance: "4,132.69" });
	await uploadStatement(
		page,
		{ name: "Checking", kind: "checking", balance: "5,000" },
		"apple-payment.csv",
		[HEADER, `DEBIT,${await today(page)},"Apple Card",-4132.69,ACH_DEBIT,,`],
	);
	await openTransactions(page, thisMonth);
	await unassigned(page, "4,132.69").click();
	const editor = page.locator('[data-slot="transaction-detail"]');
	await choose(editor, "Assigned to", "Apple Temp Holder");
	await editor.getByRole("button", { name: "Save", exact: true }).click();
	await expect(editor).toBeHidden();
	const apple = page.getByRole("button", { name: /Apple.*\$4,132.69, Apple Temp Holder/ });
	await expect(apple).toBeVisible(SETTLED);
	await expect(page.getByLabel("Bucket", { exact: true })).toBeHidden();
	await page.getByRole("button", { name: /^Filters/ }).click();
	await expect(page.getByRole("dialog", { name: "Filters", exact: true })).toBeVisible();
	await page
		.getByRole("dialog", { name: "Filters", exact: true })
		.getByRole("button", { name: "Apply", exact: true })
		.click();
	await apple.click();
	await expect(editor.getByLabel("Amount", { exact: true })).toBeVisible();
	await editor.getByRole("link", { name: "Close", exact: true }).click();
	await expect(editor).toBeHidden();
	await apple.click();
	await expect(editor.getByLabel("Amount", { exact: true })).toBeEditable();
	await page.screenshot({
		path: "/tmp/noodle-transactions-spending.png",
		fullPage: true,
		animations: "disabled",
	});
	await editor.getByRole("button", { name: "Card payment", exact: true }).click();
	await choose(editor, "Payment to", "Apple Card");
	await expect(editor).toContainText("this payment isn’t spending: it’s a Transfer to Apple Card.");
	await page.screenshot({
		path: "/tmp/noodle-transactions-payment.png",
		fullPage: true,
		animations: "disabled",
	});
	await page.setViewportSize({ width: 393, height: 852 });
	await expect(editor.getByLabel("Payment to")).toBeVisible();
	expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(393);
	await page.screenshot({
		path: "/tmp/noodle-transactions-payment-phone.png",
		fullPage: true,
		animations: "disabled",
	});
	await page.setViewportSize({ width: 1440, height: 1000 });
	await page.emulateMedia({ reducedMotion: "reduce" });
	await editor.getByRole("button", { name: "It’s a card payment", exact: true }).click();
	await expect(editor).toBeHidden(SETTLED);
	await expect(page.getByTestId("month-total")).toHaveText("$0", SETTLED);
	// The row is a Transfer to the card now, and says so by name: saving it into a Bucket earlier
	// gave it no name of the Parent's, whether or not background naming had named it by then.
	await expect(
		page.getByRole("button", { name: /Card payment, \$4,132\.69, Transfer.*Apple Card/ }),
	).toBeVisible(SETTLED);
	await page.reload();
	await expect(page.getByTestId("month-total")).toHaveText("$0", SETTLED);
	await page.context().close();
});
