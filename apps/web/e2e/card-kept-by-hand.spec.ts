import { expect, type Page, test } from "@playwright/test";
import { createTestParent } from "./parents";
import { accountKindLabel, choose, createPlannedHousehold, signedInPage } from "./session";

// A card kept by hand (issue 136): adding a card asks how its purchases get into Noodle; one kept
// by hand has a statement day, a Nudge on Accounts when its statement's balance is due, and the
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
		await page.getByLabel("Name").fill("Apple Card");
		await choose(page, "Kind", accountKindLabel("credit-card"));
		await expect(page.getByLabel("How do its purchases get into Noodle?")).toBeVisible({
			timeout: 1000,
		});
	}).toPass();
	// Statements unless said otherwise; by hand is the Apple Card's answer.
	await expect(page.getByText("You upload its statements.")).toBeVisible();
	await choose(page, "How do its purchases get into Noodle?", "I add them by hand");
	await expect(page.getByText("For a card no bank reaches, like Apple Card.")).toBeVisible();
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
	await expect(nudge).toHaveCount(1);
	await expect(nudge).toContainText("Type its balance to check nothing’s missing.");
	await shot(page, "balance-check-nudge");
	await expect(async () => {
		await nudge.getByRole("link", { name: "Check its balance" }).click();
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
	await page.getByLabel("Statement balance").fill("84.20");
	await page.getByRole("button", { name: "Check balance" }).click();
	await expect(page.getByText("That matches.")).toBeVisible();

	await page.goto("/accounts");
	await expect(page.getByRole("link", { name: /^Apple Card, / })).toContainText("$84.20");
	await expect(
		page.getByRole("status").filter({ hasText: "Apple Card’s statement closed on" }),
	).toHaveCount(0);
});
