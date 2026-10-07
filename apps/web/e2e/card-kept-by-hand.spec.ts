import { expect, type Page, test } from "@playwright/test";
import { createTestParent } from "./parents";
import {
	accountKindLabel,
	choose,
	createPlannedHousehold,
	hydrated,
	PURCHASES_QUESTION,
	pickQuickAddBucket,
	savedBy,
	signedInPage,
} from "./session";

// A card kept by hand (issue 136): adding a card asks how its purchases get into Noodle; one kept
// by hand has a statement day, an ask on Accounts when its statement's balance is due (put away
// for the whole Household by "Not now"), and the
// check itself: "… higher than what's recorded", then "That matches." once the two agree.
// SHOT_DIR (and SHOT_WIDTH) save the add-card question and the Nudge as pictures to look at.

let parent: Awaited<ReturnType<typeof createTestParent>>;

test.beforeEach(async () => {
	parent = await createTestParent();
});

test.afterEach(async () => {
	await parent?.remove();
});

const width = Number(process.env.SHOT_WIDTH ?? 1440);
const shotDir = process.env.SHOT_DIR;

async function shot(page: Page, name: string) {
	if (shotDir) await page.screenshot({ path: `${shotDir}/${name}-${width}.png`, fullPage: true });
}

test("a card kept by hand is asked about when added, and has its statement balance checked", async ({
	browser,
}) => {
	test.slow();
	const page = await signedInPage(browser, parent.email, {
		viewport: { width, height: width < 600 ? 852 : 900 },
	});
	await createPlannedHousehold(page, { baseline: "5,000", buckets: [["Groceries", "1,200"]] });

	await page.goto("/accounts");
	await expect(page.getByRole("heading", { level: 1 })).toHaveText("Accounts");
	// A Household with no Accounts has the form on the page; otherwise it's in a sheet.
	await expect(async () => {
		if (!(await page.getByLabel("Name").isVisible())) {
			await page.getByRole("button", { name: "Add Account" }).click();
		}
		await expect(page.getByLabel("Name")).toBeVisible({ timeout: 1000 });
		await page.getByLabel("Name").fill("Visa");
		await choose(page, "Kind", accountKindLabel("credit-card"));
		await expect(page.getByLabel(PURCHASES_QUESTION)).toBeVisible({ timeout: 1000 });
	}).toPass();
	// Nothing is chosen for a card (issue 141): a Parent says it, and the form says so if they don't.
	const question = page.getByRole("combobox", { name: PURCHASES_QUESTION, exact: true });
	await expect(question).toContainText("Choose one");
	await page.getByRole("button", { name: "Add Account" }).last().click();
	await expect(page.getByText("Choose how this card’s purchases get into Noodle.")).toBeVisible();
	await expect(page.getByRole("link", { name: /^Visa, / })).toHaveCount(0);
	await shot(page, "add-card-nothing-chosen");
	// A name that reads as an Apple Card suggests by hand, already chosen; it can be changed.
	await page.getByLabel("Name").fill("Apple Card");
	await expect(question).toContainText("I add them by hand");
	await expect(page.getByText("For a card no bank reaches, like Apple Card.")).toBeVisible();
	await choose(page, PURCHASES_QUESTION, "From its statements");
	await expect(page.getByText("You upload its statements.")).toBeVisible();
	await choose(page, PURCHASES_QUESTION, "I add them by hand");
	await shot(page, "add-card-question");
	// No balance yet: the statement's balance is what the check will ask for.
	await page.getByRole("button", { name: "Add Account" }).last().click();

	await page.getByRole("link", { name: /^Apple Card, / }).click();
	const detail = page.locator("[data-slot=detail-title]:visible");
	await expect(detail).toContainText("Apple Card");
	await expect(page.getByText("I add them by hand")).toBeVisible();
	// The 1st is never later than today, so its statement has closed and no balance is recorded.
	await page.getByLabel("Statement closes on day").fill("1");
	await page.getByRole("button", { name: "Save day" }).click();
	await expect(
		page.getByText(/Apple Card’s statement closed on \w+ 1\. What’s its balance\?/),
	).toBeVisible();

	// The Nudge on Accounts, once.
	await page.goto("/accounts");
	const nudge = page.getByRole("status").filter({ hasText: "Apple Card’s statement closed on" });
	// It shows once the page is live: what's been put away is this device's to know.
	await expect(nudge).toHaveCount(1, { timeout: 30_000 });
	await expect(nudge).toContainText("Type its balance to check nothing’s missing.");
	await shot(page, "balance-check-nudge");
	await expect(nudge.getByRole("link", { name: "Check its balance" })).toBeVisible();
	// "Not now" puts it away for the Household until the next statement; the card's page still asks.
	await hydrated(nudge.getByRole("button", { name: /^Not now/ }));
	const putAway = savedBy(page, "putAwayBalanceCheck");
	await nudge.getByRole("button", { name: /^Not now/ }).click();
	await expect(nudge).toHaveCount(0);
	await putAway;
	// The Household's, not this device's: still away once the device has forgotten everything.
	await page.evaluate(() => window.localStorage.clear());
	await page.reload();
	await expect(page.getByRole("link", { name: /^Apple Card, / })).toBeVisible();
	await hydrated(page.getByRole("button", { name: "Add Account" }).first());
	await expect(nudge).toHaveCount(0);
	await expect(async () => {
		await page.getByRole("link", { name: /^Apple Card, / }).click();
		await expect(page.getByLabel("Statement balance")).toBeVisible({ timeout: 2000 });
	}).toPass();

	// Nothing is recorded on the card yet, so the statement is all of it higher.
	await expect(async () => {
		await page.getByLabel("Statement balance").fill("84.20");
		await expect(page.getByRole("button", { name: "Check balance" })).toBeEnabled({
			timeout: 1000,
		});
	}).toPass();
	await page.getByRole("button", { name: "Check balance" }).click();
	await expect(
		page.getByText(
			"$84.20 higher than what’s recorded: add what’s missing, or import the statement.",
		),
	).toBeVisible();
	await shot(page, "balance-check-higher");
	// The statement's balance is the card's from then on, and the check is no longer due.
	await expect(page.getByText("Check a statement’s balance")).toBeVisible();
	await expect(page.getByRole("link", { name: "import the statement" })).toHaveAttribute(
		"href",
		/#account-statements$/,
	);

	// "add what's missing" opens Quick Add paid with this card: the record, on top of what's owed.
	await page.getByRole("link", { name: "add what’s missing" }).click();
	const sheet = page.getByRole("dialog", { name: "Quick Add" });
	await expect(sheet.getByRole("button", { name: /Paid with:\s*Apple Card/ })).toBeVisible();
	await shot(page, "quick-add-paid-with");
	await page.keyboard.type("12.50");
	await pickQuickAddBucket(sheet, "Groceries");
	await expect(sheet).toBeHidden();
	// Dated today: after the statement's day unless today is the 1st, when it's taken as in it.
	const owed = new Date().getDate() === 1 ? "84.20" : "96.70";
	await expect(page.locator("[data-slot=detail-title]:visible")).toContainText("Apple Card");
	await page.getByLabel("Statement balance").fill(owed);
	await page.getByRole("button", { name: "Check balance" }).click();
	await expect(page.getByText("That matches.")).toBeVisible();
	await shot(page, "card-page");

	// A choice made in the sheet is this device's default next time.
	await page.goto("/transactions");
	await expect(page.getByText("$12.50").first()).toBeVisible();
	await expect(page.getByText("Waiting for bank")).toHaveCount(0);
	await hydrated(page.getByRole("link", { name: "Quick Add" }).first());
	await page.getByRole("link", { name: "Quick Add" }).first().click();
	// Opened from the card's link it was a one-off: the device's own choice is what's kept.
	await expect(sheet.getByRole("button", { name: /Paid with:\s*Something else/ })).toBeVisible();
	await sheet.getByRole("button", { name: /Paid with:/ }).click();
	await sheet.getByRole("radio", { name: "Apple Card" }).click();
	await expect(sheet.getByRole("button", { name: /Paid with:\s*Apple Card/ })).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(sheet).toBeHidden();
	await page.getByRole("link", { name: "Quick Add" }).first().click();
	await expect(sheet.getByRole("button", { name: /Paid with:\s*Apple Card/ })).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(sheet).toBeHidden();

	await page.goto("/accounts");
	await expect(page.getByRole("link", { name: /^Apple Card, / })).toContainText(`$${owed}`);
	await expect(
		page.getByRole("status").filter({ hasText: "Apple Card’s statement closed on" }),
	).toHaveCount(0);
});
