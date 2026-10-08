import { expect, type Page, test } from "@playwright/test";
import { ulid } from "ulid";
import { createTestParent } from "./parents";
import { seedSql } from "./seed-sql";
import { chooseKind, createPlannedHousehold, hydrated, signedInPage } from "./session";

// Cards have one home (issue 150): on Accounts each credit card says what's owed, what was paid
// to it this month, how paying it counts and what waits in Review, with the month's total beside
// them; on the card's own page Payments and "How paying it counts" come straight after what's
// owed. A card kept by its statements, one kept by hand and one nobody was asked about each read
// differently.

let parent: Awaited<ReturnType<typeof createTestParent>>;

test.beforeEach(async () => {
	parent = await createTestParent();
});

test.afterEach(async () => {
	await parent?.remove();
});

const q = (value: string) => `'${value.replaceAll("'", "''")}'`;

/** A picture for a person to look at, only when SHOTS_DIR says where to put it. */
const shot = async (page: Page, name: string) => {
	if (process.env.SHOTS_DIR)
		await page.screenshot({ path: `${process.env.SHOTS_DIR}/${name}.png`, fullPage: true });
};

const row = (page: Page, name: string) =>
	page.getByRole("link", { name: new RegExp(`^${name}, `) });

async function addAccount(
	page: Page,
	name: string,
	kind: "checking" | "credit-card",
	amount: string,
	purchases?: "From its statements" | "I add them by hand",
) {
	await page.goto("/accounts");
	await expect(page.getByRole("heading", { level: 1 })).toHaveText("Accounts");
	await expect(async () => {
		if (!(await page.getByLabel("Name").isVisible()))
			await page.getByRole("button", { name: "Add Account" }).click({ timeout: 2_000 });
		await expect(page.getByLabel("Name")).toBeVisible({ timeout: 1_000 });
	}).toPass();
	await page.getByLabel("Name").fill(name);
	await chooseKind(page, kind, purchases);
	await page.getByLabel(kind === "credit-card" ? "Owed now" : "Balance now").fill(amount);
	await page.getByRole("button", { name: "Add Account" }).last().click();
	await expect(row(page, name)).toBeVisible();
}

/** Opens an Account's page from Accounts. */
async function open(page: Page, name: string) {
	await page.goto("/accounts");
	await hydrated(row(page, name));
	const title = page.locator("[data-slot=detail-title]:visible");
	await expect(async () => {
		await row(page, name).click();
		await expect(title).toContainText(name, { timeout: 3_000 });
	}).toPass();
	return page.locator("[data-slot=master-detail-detail]:visible");
}

test("each card reads as a card on Accounts, and its page has Payments and how paying it counts near the top", async ({
	browser,
}) => {
	test.setTimeout(300_000);
	const page = await signedInPage(browser, parent.email);
	await page.setViewportSize({ width: 1440, height: 900 });
	await createPlannedHousehold(page, { baseline: "5,000", buckets: [["Groceries", "1,200"]] });
	await addAccount(page, "Checking", "checking", "2,000");
	await addAccount(page, "Chase Freedom", "credit-card", "900", "From its statements");
	await addAccount(page, "Apple Card", "credit-card", "900", "I add them by hand");
	await addAccount(page, "Store card", "credit-card", "120", "From its statements");

	// Payments out of Checking marked as a Transfer naming a card, as Review leaves them: two to
	// Chase Freedom (one this month, one last month) and one to the Apple Card. The Store card is
	// left as a card nobody was asked about.
	const { today, earlier, month } = await page.evaluate(() => {
		const pad = (n: number) => String(n).padStart(2, "0");
		const now = new Date();
		const before = new Date(now.getFullYear(), now.getMonth() - 1, 15);
		return {
			today: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
			earlier: `${before.getFullYear()}-${pad(before.getMonth() + 1)}-15`,
			month: now.toLocaleDateString("en-US", { month: "long" }),
		};
	});
	const household = `(select household_id from members where clerk_user_id = ${q(parent.userId)})`;
	const account = (name: string) =>
		`(select id from accounts where household_id = ${household} and name = ${q(name)})`;
	const payment = (card: string, day: string, cents: number, note: string) => {
		const id = ulid();
		return [
			`insert into transactions (id, household_id, source, date, amount_cents, account_id, note)
				values (${q(id)}, ${household}, 'import', ${q(day)}, ${cents}, ${account("Checking")}, ${q(note)});`,
			`insert into transfers (id, household_id, out_transaction_id, other_account_id)
				values (${q(ulid())}, ${household}, ${q(id)}, ${account(card)});`,
		];
	};
	await seedSql([
		...payment("Chase Freedom", today, 40_000, "CHASE CREDIT CRD AUTOPAY"),
		...payment("Chase Freedom", earlier, 25_000, "CHASE CREDIT CRD AUTOPAY"),
		...payment("Apple Card", today, 30_000, "APPLECARD GSBANK PAYMENT"),
		`update accounts set purchases = null where household_id = ${household} and name = 'Store card';`,
	]);

	// One more payment to Chase Freedom comes in from Checking's statement and waits in Review.
	const checking = await open(page, "Checking");
	await checking.getByRole("button", { name: "Upload statement" }).click();
	const sheet = page.getByRole("dialog", { name: "Upload a statement" });
	const written = await page.evaluate(() => new Date().toLocaleDateString("en-US"));
	await sheet.getByLabel("Statement file").setInputFiles({
		name: "checking.csv",
		mimeType: "text/csv",
		buffer: Buffer.from(
			["Transaction Date,Description,Debit,Credit", `${written},CHASE FREEDOM PAYMENT,50.00,`].join(
				"\n",
			),
		),
	});
	await sheet.getByRole("button", { name: "Import 1 line" }).click();
	await expect(sheet).toBeHidden();

	// Accounts: each card says what's owed, what was paid this month and how paying it counts.
	const chase = row(page, "Chase Freedom");
	await expect(async () => {
		await page.goto("/accounts");
		// Review's list is read after the page is up, so the count comes in a moment later.
		await expect(chase).toContainText("1 payment waiting in Review", { timeout: 10_000 });
	}).toPass({ timeout: 90_000 });
	await expect(chase).toContainText("$900");
	await expect(chase).toContainText("Purchases come from its statements");
	await expect(chase).toContainText(`Paid in ${month}: $400`);
	const apple = row(page, "Apple Card");
	await expect(apple).toContainText("$900");
	await expect(apple).toContainText("You add its purchases");
	await expect(apple).toContainText(`Paid in ${month}: $300`);
	await expect(apple).not.toContainText("waiting in Review");
	// Kept by hand and never asked no longer read the same.
	const store = row(page, "Store card");
	await expect(store).toContainText("$120");
	await expect(store).toContainText("Not said yet how its purchases get in");
	await expect(store).toContainText(`Nothing paid in ${month}`);
	await expect(apple).not.toContainText("Entered by hand");
	await expect(store).not.toContainText("Entered by hand");
	await expect(row(page, "Checking")).not.toContainText("Paid in");
	// The month's total across the cards, and what waits, in Totals.
	const totals = page.locator("section[aria-labelledby=account-totals]");
	await expect(totals).toContainText(`Paid to cards in ${month}`);
	await expect(totals).toContainText("$700");
	await expect(
		totals.getByRole("link", { name: "1 payment to a card waiting in Review" }),
	).toHaveAttribute("href", "/review");
	await shot(page, "accounts-after-1440");

	// A card's page: Payments, then how paying it counts, straight after what's owed.
	const order = async (detail: ReturnType<Page["locator"]>) => {
		const headings = await detail.locator("h2, h3").allTextContents();
		return ["Owed", "Payments", "How paying it counts", "Paying it off"].map((title) =>
			headings.findIndex((heading) => heading.trim().startsWith(title)),
		);
	};
	let detail = await open(page, "Chase Freedom");
	const sorted = await order(detail);
	expect(sorted.every((at) => at >= 0)).toBe(true);
	expect(sorted).toEqual([...sorted].sort((a, b) => a - b));
	await expect(detail.locator("[data-slot=card-paid-month]")).toHaveText(
		new RegExp(`Paid in ${month}: \\$400\\.`),
	);
	const thisMonth = detail.getByRole("list", { name: `Payments to Chase Freedom in ${month}` });
	await expect(thisMonth.getByRole("link")).toHaveCount(1);
	await expect(thisMonth.getByRole("link")).toContainText("$400");
	await expect(thisMonth.getByRole("link")).toHaveAttribute("href", /\/transactions\/\d{4}-\d{2}$/);
	const before = detail.getByRole("list", { name: "Earlier payments to Chase Freedom" });
	await expect(before.getByRole("link")).toHaveCount(1);
	await expect(before.getByRole("link")).toContainText("$250");
	await expect(
		detail.getByRole("link", { name: "1 payment to it waiting in Review" }),
	).toHaveAttribute("href", "/review");
	await expect(detail.locator("[data-slot=card-paying]")).toHaveText(
		"Its purchases come from its statements, so paying it is a Transfer, not spending.",
	);
	await expect(detail.getByRole("button", { name: "Change", exact: true })).toBeVisible();
	await shot(page, "card-statements-after-1440");

	detail = await open(page, "Apple Card");
	await expect(detail.locator("[data-slot=card-paying]")).toHaveText(
		"You add its purchases yourself, so paying it is a Transfer, not spending. A payment brings what’s owed down.",
	);
	await expect(detail.locator("[data-slot=card-paid-month]")).toHaveText(
		new RegExp(`Paid in ${month}: \\$300\\.`),
	);
	await expect(
		detail.getByRole("list", { name: `Payments to Apple Card in ${month}` }).getByRole("link"),
	).toHaveCount(1);

	// The card nobody was asked about: nothing paid, and the question under the same heading.
	detail = await open(page, "Store card");
	await expect(detail.locator("[data-slot=card-paid-month]")).toHaveText(
		new RegExp(`Nothing paid in ${month} yet\\.`),
	);
	await expect(detail.getByRole("heading", { name: "How paying it counts" })).toBeVisible();
	await expect(detail.getByText("How do purchases on Store card get into Noodle?")).toBeVisible();

	// On a phone: the same, nothing sideways.
	await page.setViewportSize({ width: 393, height: 852 });
	await page.goto("/accounts");
	await expect(chase).toContainText(`Paid in ${month}: $400`);
	expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(393);
	await shot(page, "accounts-after-393");
	await page.emulateMedia({ colorScheme: "dark" });
	await shot(page, "accounts-after-393-dark");
	await page.emulateMedia({ colorScheme: "light" });
	detail = await open(page, "Apple Card");
	await expect(detail.locator("[data-slot=card-paying]")).toBeVisible();
	expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(393);
	await shot(page, "card-by-hand-after-393");
	detail = await open(page, "Chase Freedom");
	await expect(detail.locator("[data-slot=card-paid-month]")).toBeVisible();
	await shot(page, "card-statements-after-393");
	await page.setViewportSize({ width: 320, height: 700 });
	await page.goto("/accounts");
	await expect(chase).toContainText(`Paid in ${month}: $400`);
	expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
	await shot(page, "accounts-after-320");
	await page.context().close();
});
