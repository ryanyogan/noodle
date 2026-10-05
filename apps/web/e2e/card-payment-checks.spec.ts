import { expect, type Page, test } from "@playwright/test";
import { createTestParent } from "./parents";
import {
	accountKindLabel,
	choose,
	createPlannedHousehold,
	hydrated,
	reloadUntil,
	savedBy,
	signedInPage,
} from "./session";

// What Noodle checks around a payment to a credit card (ADR-0050): Plan health flags a Commitment
// that pays down a card Noodle has since begun to follow, with its two ways out; the Commitment
// form suggests an amount from the last three months of payments to the card; and Review asks
// before a payment to a card it follows is filed in a Bucket. Categorization runs with its fake
// (AI_MODEL=stub), which knows Shell and files it in Gas.

let parent: Awaited<ReturnType<typeof createTestParent>>;

test.beforeEach(async () => {
	parent = await createTestParent();
});

test.afterEach(async () => {
	await parent?.remove();
});

/** A toast saying `text`: the first, since an Import says its file's name in more than one. */
const toast = (page: Page, text: string) =>
	page.getByRole("status").filter({ hasText: text }).first();

/** A day as a statement writes it. */
const written = (date: Date) =>
	date.toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" });

/** Today where the browser (and so the Household) is, as a statement writes it. */
const today = (page: Page) =>
	page.evaluate(() =>
		new Date().toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" }),
	);

/** Adds an Account on the Accounts page: its form when there are none yet, else its sheet. */
async function addAccount(page: Page, name: string, kind: string, balance: string) {
	await page.goto(new URL("/accounts", page.url()).href);
	await expect(page.getByRole("heading", { level: 1 })).toHaveText("Accounts");
	const first = await page.getByText("Accounts are where the money is").count();
	if (!first) {
		const open = page.getByRole("button", { name: "Add Account" });
		await hydrated(open);
		await open.click();
	}
	const form = first
		? page.getByRole("main")
		: page.getByRole("dialog", { name: "Add an Account" });
	await hydrated(form.getByLabel("Name"));
	await form.getByLabel("Name").fill(name);
	await choose(form, "Kind", accountKindLabel(kind));
	await form.getByLabel(kind === "credit-card" ? "Owed now" : "Balance now").fill(balance);
	const saved = savedBy(page, "addAccount");
	await form.getByRole("button", { name: "Add Account" }).click();
	await saved;
	await expect(page.getByRole("link", { name: new RegExp(`^${name}, `) })).toBeVisible();
}

/** Uploads a CSV statement to one of the Household's Accounts, from the Accounts page. */
async function uploadTo(page: Page, account: string, file: string, lines: string[]) {
	await page.goto(new URL("/accounts", page.url()).href);
	const link = page.getByRole("link", { name: new RegExp(`^${account}, `) });
	await hydrated(link);
	// The list may be read once more just after an Account was added, and lose a click made then.
	await expect(async () => {
		await link.click();
		await expect(page.locator("[data-slot=detail-title]:visible")).toContainText(account, {
			timeout: 3_000,
		});
	}).toPass();
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
}

/** A purchase on a card, dated today: what makes it a card Noodle follows. */
const purchase = async (page: Page, card: string, amount: string) =>
	uploadTo(page, card, "card.csv", [
		"Transaction Date,Description,Debit,Credit",
		`${await today(page)},SHELL OIL 5741,${amount},`,
	]);

/** Money out of checking, as Chase writes its statements. */
const CHECKING = "Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #";
const debit = (day: string, what: string, amount: string) =>
	`DEBIT,${day},"${what}",-${amount},ACH_DEBIT,2000.00,`;

/** Adds a Commitment that pays down a card, in the Commitments add form. */
async function addPayingCommitment(
	page: Page,
	commitments: string,
	name: string,
	amount: string,
	card: string,
) {
	await page.goto(commitments);
	const form = page.getByRole("form", { name: "Add a Commitment" });
	const paysDown = form.getByRole("combobox", { name: "Pays down", exact: true });
	await hydrated(paysDown);
	await form.getByLabel("New Commitment").fill(name);
	await form.getByLabel("Amount due").fill(amount);
	await paysDown.click();
	await page
		.getByRole("listbox")
		.getByRole("option", { name: new RegExp(`^${card}`) })
		.click();
	const added = savedBy(page, "addCommitment");
	await form.getByRole("button", { name: "Add Commitment" }).click();
	await added;
}

test("Plan health flags a Commitment that pays down a card Noodle has begun to follow: keeping it for a carried balance or ending it clears the warning", async ({
	browser,
}) => {
	test.slow();
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, {
		baseline: "5,000",
		buckets: [
			["Groceries", "1,200"],
			["Gas", "300"],
		],
	});
	const thisMonth = page.url();
	const month = /\d{4}-\d{2}/.exec(thisMonth)?.[0] ?? "";
	const plan = new URL(`/plan/${month}`, thisMonth).href;
	const commitments = new URL(`/plan/${month}/commitments`, thisMonth).href;

	// Two cards kept by hand, each with a Commitment that pays it down.
	await addAccount(page, "American Express", "credit-card", "2,000");
	await addAccount(page, "Discover", "credit-card", "900");
	await addPayingCommitment(page, commitments, "Amex payment", "300", "American Express");
	await addPayingCommitment(page, commitments, "Discover payment", "150", "Discover");

	// Noodle can't see into either card, so there's nothing to check.
	const rows = page.getByTestId("plan-health-card-followed");
	await page.goto(plan);
	await expect(page.locator("[data-slot=page-header]:visible")).toBeVisible();
	await expect(rows).toHaveCount(0);

	// A purchase comes in on each: Noodle follows them now, so their payments would count twice.
	await purchase(page, "American Express", "38.50");
	await purchase(page, "Discover", "21.00");
	await reloadUntil(page, plan, () => expect(rows).toHaveCount(2, { timeout: 3_000 }));
	// Under where the pay goes the list is one line until it is opened.
	const things = page.getByRole("button", { name: /^Things to check/ });
	await hydrated(things);
	await things.click();
	const amex = rows.filter({ hasText: "American Express" });
	const discover = rows.filter({ hasText: "Discover payment" });
	await expect(amex).toContainText(
		"Noodle sees what’s bought on American Express now, so its payments would count twice.",
	);
	await expect(amex.getByRole("link", { name: "Amex payment" })).toBeVisible();

	// "Keep it": the Commitment stays, as a set payment on a balance being carried.
	const keep = amex.getByRole("button", { name: "Keep it: it’s for a balance I’m carrying" });
	await hydrated(keep);
	const kept = savedBy(page, "keepCarriedBalance");
	await keep.click();
	await kept;
	await expect(toast(page, "Amex payment stays")).toBeVisible();
	await expect(rows).toHaveCount(1);
	await expect(amex).toHaveCount(0);

	// "End this Commitment": asked once, then it leaves the Plan.
	await discover.getByRole("button", { name: "End this Commitment" }).click();
	const ended = savedBy(page, "endCommitment");
	await page.getByRole("alertdialog").getByRole("button", { name: "End Discover payment" }).click();
	await ended;
	await expect(toast(page, "Discover payment ends from")).toBeVisible();
	await expect(rows).toHaveCount(0);

	// Both hold after the page is read again, and the one kept is still in the Plan.
	await page.goto(plan);
	await expect(page.locator("[data-slot=page-header]:visible")).toBeVisible();
	await expect(rows).toHaveCount(0);
	await page.goto(commitments);
	await expect(page.getByText("Pays down American Express").first()).toBeVisible();
	// This Month's Bills say what it pays down too.
	await page.goto(thisMonth);
	await expect(page.getByText("Pays down American Express").first()).toBeVisible();
});

test("the Commitment form suggests an amount from the last three months of payments to the card, and fills it in", async ({
	browser,
}) => {
	test.slow();
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, { baseline: "5,000", buckets: [["Groceries", "1,200"]] });
	const thisMonth = page.url();
	const month = /\d{4}-\d{2}/.exec(thisMonth)?.[0] ?? "";
	const [year, monthOfYear] = month.split("-").map(Number) as [number, number];
	/** The 15th of the month `back` months before this one. */
	const day = (back: number) => written(new Date(year, monthOfYear - 1 - back, 15));

	// Checking, with six payments to American Express over the last three full months, and one
	// this month, which isn't counted: $1,500, $2,000 and $2,400 come to about $1,970 a month.
	await addAccount(page, "Checking", "checking", "2,500");
	await addAccount(page, "American Express", "credit-card", "2,000");
	await addAccount(page, "Discover", "credit-card", "400");
	const pays = "AMERICAN EXPRESS ACH PMT M8054 WEB ID: 2005032111";
	await uploadTo(page, "Checking", "checking.csv", [
		CHECKING,
		debit(day(3), pays, "1000.00"),
		debit(day(3), pays, "500.00"),
		debit(day(2), pays, "2000.00"),
		debit(day(1), pays, "1200.00"),
		debit(day(1), pays, "800.00"),
		debit(day(1), pays, "400.00"),
		debit(await today(page), pays, "9000.00"),
		debit(day(1), "CORNER STORE #1", "30.00"),
	]);
	await expect(toast(page, "checking.csv")).toBeVisible();

	await page.goto(new URL(`/plan/${month}/commitments`, thisMonth).href);
	const form = page.getByRole("form", { name: "Add a Commitment" });
	const paysDown = form.getByRole("combobox", { name: "Pays down", exact: true });
	const suggestion = form.getByTestId("payment-suggestion");
	await hydrated(paysDown);
	// Nothing is suggested until a card or loan is chosen.
	await expect(suggestion).toHaveCount(0);
	await paysDown.click();
	await page
		.getByRole("listbox")
		.getByRole("option", { name: /^American Express/ })
		.click();
	await expect(suggestion).toContainText("About $1,970 a month across 6 payments");
	await suggestion.getByRole("button", { name: "Use $1,970" }).click();
	await expect(form.getByLabel("Amount due")).toHaveValue("1,970");

	// It saves at that amount.
	await form.getByLabel("New Commitment").fill("Amex payment");
	const added = savedBy(page, "addCommitment");
	await form.getByRole("button", { name: "Add Commitment" }).click();
	await added;
	await expect(page.getByText("Pays down American Express").first()).toBeVisible();
	await expect(page.getByText("$1,970").first()).toBeVisible();

	// A card with no payments to go on gets no suggestion.
	await paysDown.click();
	await page
		.getByRole("listbox")
		.getByRole("option", { name: /^Discover/ })
		.click();
	await expect(form.getByText("Noodle can’t see what’s bought on Discover")).toBeVisible();
	await expect(suggestion).toHaveCount(0);
});

test("Review asks before a payment to a card Noodle follows is filed in a Bucket: file it anyway, or mark it a Transfer", async ({
	browser,
}) => {
	test.slow();
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, {
		baseline: "5,000",
		buckets: [
			["Groceries", "1,200"],
			["Gas", "300"],
		],
	});
	const thisMonth = page.url();

	// A card Noodle follows (a purchase on it came in today), and two payments to it out of
	// checking. The card's own side of them never comes in, so nothing pairs.
	await addAccount(page, "Chase Freedom", "credit-card", "900");
	await purchase(page, "Chase Freedom", "38.50");
	await addAccount(page, "Checking", "checking", "2,500");
	const day = await today(page);
	await uploadTo(page, "Checking", "checking.csv", [
		CHECKING,
		debit(day, "CHASE CREDIT CRD AUTOPAY", "400.00"),
		debit(day, "CHASE CREDIT CRD AUTOPAY PPD ID: 4760039224", "250.00"),
	]);
	await expect(toast(page, "checking.csv")).toBeVisible();

	const cards = page.locator("[data-testid=review-card][data-payment=followed]");
	await reloadUntil(page, new URL("/review?view=list", thisMonth).href, async () => {
		await expect(cards).toHaveCount(2, { timeout: 3_000 });
		await expect(cards.first().getByRole("combobox", { name: /^Where .+ goes$/ })).toBeEnabled({
			timeout: 3_000,
		});
	});

	/** Picks Groceries on the first of the payment cards waiting, which asks before it files. */
	const pickGroceries = async (waiting: number) => {
		const card = cards.first();
		await card.getByRole("combobox", { name: /^Where .+ goes$/ }).click();
		await page.getByRole("listbox").getByRole("option", { name: "Groceries", exact: true }).click();
		const caution = card.getByTestId("review-payment-caution");
		await expect(caution).toContainText("File a card payment in Groceries?");
		await expect(caution).toContainText(
			"What was bought on the card is already counted, so this counts it twice.",
		);
		await expect(caution.getByRole("button", { name: "Mark as Transfer" })).toBeVisible();
		await expect(caution.getByRole("button", { name: "File anyway" })).toBeVisible();
		// Nothing is filed until the Parent answers.
		await expect(cards).toHaveCount(waiting);
		return caution;
	};

	// "File anyway" files it in the Bucket.
	let caution = await pickGroceries(2);
	await caution.getByRole("button", { name: "File anyway" }).click();
	await expect(cards).toHaveCount(1);
	await expect(page.getByTestId("review-payment-caution")).toHaveCount(0);

	// "Mark as Transfer" files it nowhere.
	caution = await pickGroceries(1);
	await caution.getByRole("button", { name: "Mark as Transfer" }).click();
	await expect(toast(page, "marked as a Transfer")).toBeVisible();
	await expect(cards).toHaveCount(0);
});
