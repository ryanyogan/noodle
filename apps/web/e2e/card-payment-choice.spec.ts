import { expect, type Page, test } from "@playwright/test";
import { createTestParent } from "./parents";
import {
	accountKindLabel,
	choose,
	createPlannedHousehold,
	reloadUntil,
	signedInPage,
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
	/** A card's answer to "How do its purchases get into Noodle?"; left out, it stays on statements. */
	purchases?: "I add them by hand";
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
	if (account.purchases) {
		await choose(page, "How do its purchases get into Noodle?", account.purchases);
	}
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

/** The Transfer section of the detail that is open. */
const detail = (page: Page) =>
	page
		.locator("[role=dialog], [data-slot=transaction-detail]")
		.filter({ has: page.getByRole("heading", { name: "Transfer" }) });

/** Opens the detail of this month's unassigned line of `amount`, at its Transfer section. */
async function openLine(page: Page, amount: string) {
	await expect(unassigned(page, amount)).toBeVisible();
	await unassigned(page, amount).click();
	await expect(detail(page).getByRole("button", { name: "It’s a card payment" })).toBeEnabled();
	return detail(page);
}

/** The Transactions page of the month in `thisMonth`'s address, once its rows can be opened. */
async function openTransactions(page: Page, thisMonth: string) {
	await page.goto(thisMonth.replace(/\/month\/(\d{4}-\d{2}).*$/, "/transactions/$1"));
	// A cold dev server builds the page first: rows open once it is hydrated.
	await expect(page.getByLabel("Bucket")).toBeEnabled({ timeout: 30_000 });
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
		await sheet.getByRole("button", { name: "It’s a card payment" }).click();
		const choice = sheet.getByTestId("card-payment-choice");
		await expect(choice).toContainText("Which card does it pay?");
		await choice.getByRole("button", { name: "Visa", exact: true }).click();
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
		page.getByText("Transfer · Checking → Visa").filter({ visible: true }).first(),
	).toBeVisible();

	// The row offers it itself: its menu opens the row at the question. A card that isn't in
	// Noodle: is the payment the spending? No: a Transfer with no other side, which counts nowhere.
	await page.keyboard.press("Escape");
	const amex = page.getByRole("row").filter({ has: unassigned(page, "400") });
	await amex.hover();
	await amex.getByRole("button", { name: /^More for / }).click();
	await page.getByRole("menuitem", { name: "It’s a card payment" }).click();
	let choice = detail(page).getByTestId("card-payment-choice");
	await expect(choice).toContainText("Which card does it pay?");
	await choice.getByRole("button", { name: "A card that isn’t in Noodle" }).click();
	await expect(choice).toContainText("Count this payment as spending?");
	await choice.getByRole("button", { name: "No, it’s a Transfer" }).click();
	await expect(toast(page, "marked as a Transfer. Payments worded like it")).toBeVisible();
	await expect(
		page.getByText("Transfer out of Checking").filter({ visible: true }).first(),
	).toBeVisible();

	// Yes: the card's Commitment is made in place, with this payment filed in it.
	const answerYes = async () => {
		const sheet = await openLine(page, "75");
		await sheet.getByRole("button", { name: "It’s a card payment" }).click();
		choice = sheet.getByTestId("card-payment-choice");
		await choice.getByRole("button", { name: "A card that isn’t in Noodle" }).click();
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
	// No card Accounts at all: the question goes straight to "Count this payment as spending?".
	await uploadStatement(
		page,
		{ name: "Checking", kind: "checking", balance: "2,500" },
		"checking.csv",
		[HEADER, `DEBIT,${day},"DISCOVER E-PAYMENT 5521",-75.00,ACH_DEBIT,1655.00,`],
	);
	await openTransactions(page, thisMonth);
	const sheet = await openLine(page, "75");
	await sheet.getByRole("button", { name: "It’s a card payment" }).click();
	const choice = sheet.getByTestId("card-payment-choice");
	await expect(choice).toContainText("Count this payment as spending?");
	await choice.getByRole("button", { name: "Yes, make a Commitment" }).click();
	await toast(page, "It’s planned monthly").getByRole("button", { name: "Edit" }).click();
	await expect(page).toHaveURL(/\/plan\/\d{4}-\d{2}\/commitments\/[0-9A-Z]{26}/);
	await expect(page.locator("[data-slot=detail-title]:visible")).toContainText(/discover/i);
});

test("a payment to a card kept by hand is filed in the Commitment that pays it down, with one Undo", async ({
	browser,
}) => {
	test.slow();
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, { baseline: "5,000", buckets: [["Groceries", "1,200"]] });
	const thisMonth = page.url();
	const day = await today(page);
	// Apple Card has no statements and no bank connection: the Parent says it's kept by hand.
	await addAccount(page, {
		name: "Apple Card",
		kind: "credit-card",
		balance: "900",
		purchases: "I add them by hand",
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
	await sheet.getByRole("button", { name: "It’s a card payment" }).click();
	const choice = sheet.getByTestId("card-payment-choice");
	await expect(choice).toContainText(
		"Apple Card is kept by hand, so its payment is the spending: it’s filed in Apple Card bill.",
	);
	await choice.getByRole("button", { name: "Apple Card", exact: true }).click();
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
	// Apple Card is kept by hand, and the bank's wording doesn't say its name.
	await addAccount(page, { name: "Apple Card", kind: "credit-card", balance: "900" });
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
	// (The sheet hides the page's buttons from roles, so the cards are counted by test id.)
	await expect(page.getByTestId("review-card")).toHaveCount(1);
	await choice.getByRole("button", { name: "A card that isn’t in Noodle" }).click();
	await expect(choice).toContainText("Count this payment as spending?");
	await choice.getByRole("button", { name: "Back" }).click();
	await choice.getByRole("button", { name: "Apple Card", exact: true }).click();
	await expect(toast(page, "marked as a Transfer to Apple Card")).toBeVisible();
	await expect(asking).toBeHidden();
	await expect(page.getByTestId("review-card")).toHaveCount(0);
});
