import { expect, type Page, test } from "@playwright/test";
import { createTestParent } from "./parents";
import { seedSql } from "./seed-sql";
import {
	choose,
	chooseKind,
	createPlannedHousehold,
	hydrated,
	savedBy,
	signedInPage,
} from "./session";

// A card kept by hand and Wallet (issue 136): a capture naming a card Noodle knows lands on that
// Account; one naming a card it can't place is asked about once on Accounts, and "None of these"
// ends the asking; a card nobody has answered for is asked about on Accounts; and a payment
// marked as a Transfer naming the card is listed under Payments on its page.
// SHOT_DIR (and SHOT_WIDTH) save the Wallet question, the unasked-card prompt and the Balance
// check's Nudge preference as pictures to look at.

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

test("Wallet captures land on the card they name, an unknown card is asked about once, and a Transfer shows under Payments", async ({
	browser,
}) => {
	test.slow();
	const page = await signedInPage(browser, parent.email, {
		viewport: { width, height: width < 600 ? 852 : 900 },
	});
	await createPlannedHousehold(page, { baseline: "5,000", buckets: [["Eating out", "300"]] });
	// Its own name per run, so the rows below are found whatever else is in the database.
	const run = Date.now().toString(36);
	const apple = `Apple Card ${run}`;
	const oldVisa = `Old Visa ${run}`;

	await page.goto("/accounts");
	await expect(async () => {
		if (!(await page.getByLabel("Name").isVisible())) {
			await page.getByRole("button", { name: "Add Account" }).click();
		}
		await expect(page.getByLabel("Name")).toBeVisible({ timeout: 1000 });
		await page.getByLabel("Name").fill(apple);
		await chooseKind(page, "credit-card");
		await expect(page.getByLabel("How do its purchases get into Noodle?")).toBeVisible({
			timeout: 1000,
		});
	}).toPass();
	await choose(page, "How do its purchases get into Noodle?", "I add them by hand");
	await page.getByRole("button", { name: "Add Account" }).last().click();
	await expect(page.getByRole("link", { name: new RegExp(`^${apple}, `) })).toBeVisible();

	// A card from before the question, a checking Account, and a payment from it marked as a
	// Transfer naming the Apple Card: written straight in, as Setup and Review would leave them.
	const [found] = await seedSql([
		`select id, household_id from accounts where name = '${apple}' order by created_at desc limit 1`,
	]);
	const appleId = String(found?.[0]?.id);
	const householdId = String(found?.[0]?.household_id);
	const today = new Date().toISOString().slice(0, 10);
	await seedSql([
		`insert into accounts (id, household_id, name, kind) values ('visa-${run}', '${householdId}', '${oldVisa}', 'credit-card')`,
		`insert into accounts (id, household_id, name, kind) values ('checking-${run}', '${householdId}', 'Checking ${run}', 'checking')`,
		`insert into transactions (id, household_id, source, date, amount_cents, account_id, note)
			values ('payment-${run}', '${householdId}', 'import', '${today}', 20000, 'checking-${run}', 'APPLECARD GSBANK PAYMENT')`,
		`insert into transfers (id, household_id, out_transaction_id, other_account_id)
			values ('transfer-${run}', '${householdId}', 'payment-${run}', '${appleId}')`,
	]);

	// The unasked card is asked about on Accounts; the Apple Card, answered, isn't.
	await page.reload();
	const unasked = page.getByText(`How do purchases on ${oldVisa} get into Noodle?`);
	await expect(unasked).toBeVisible({ timeout: 30_000 });
	await expect(page.getByText(`How do purchases on ${apple} get into Noodle?`)).toHaveCount(0);
	await expect(
		page.getByRole("link", { name: `Say how purchases on ${oldVisa} get in` }),
	).toBeVisible();
	await shot(page, "unasked-card-prompt");

	// The Shortcut's token.
	await page.goto("/household");
	const capture = page.getByRole("region", { name: "Tap to capture" });
	await hydrated(capture.getByRole("button", { name: "Set up" }));
	await capture.getByRole("button", { name: "Set up" }).click();
	const guide = page.getByRole("dialog", { name: "Set up tap to capture" });
	await expect(guide.getByRole("button", { name: "Copy URL" })).toBeVisible();
	const token =
		(await guide
			.locator("code")
			.filter({ hasText: /^noodle_/ })
			.textContent()) ?? "";
	const url =
		(await guide
			.locator("code")
			.filter({ hasText: /\/api\/capture$/ })
			.textContent()) ?? "";
	await page.keyboard.press("Escape");
	const send = async (merchant: string, amount: string, card: string) => {
		const response = await page.request.post(url, {
			headers: { Authorization: `Bearer ${token}` },
			data: { merchant, amount, at: new Date().toISOString(), card },
		});
		expect(response.status()).toBe(202);
	};
	const onAccount = async (cents: number) => {
		const [rows] = await seedSql([
			`select account_id from transactions where household_id = '${householdId}' and source = 'quick-add' and amount_cents = ${cents}`,
		]);
		return rows?.map((row) => row.account_id) ?? [];
	};

	// Wallet's "Apple Card" is the Account whose name holds it: the capture lands there.
	await send("Blue Bottle Coffee", "$5.75", "Apple Card");
	await expect.poll(() => onAccount(575), { timeout: 30_000 }).toEqual([appleId]);
	// "Titanium" is no Account Noodle can place: it lands on none, and is asked about.
	await send("Corner Market", "$21.00", "Titanium");
	await expect.poll(() => onAccount(2100), { timeout: 30_000 }).toEqual([null]);

	await page.goto("/accounts");
	const question = page.getByText("Which Account is “Titanium” in Wallet?");
	await expect(question).toBeVisible({ timeout: 30_000 });
	await expect(page.getByText("A Wallet capture was paid with it.")).toBeVisible();
	await shot(page, "wallet-question");
	// "None of these": it stays on no Account, and that card isn't asked about again.
	const none = page.getByRole("button", { name: "None of these" });
	await hydrated(none);
	const dismissed = savedBy(page, "dismissWalletCard");
	await none.click();
	await dismissed;
	await expect(question).toHaveCount(0);
	await send("Corner Market", "$22.00", "Titanium");
	await expect.poll(() => onAccount(2200), { timeout: 30_000 }).toEqual([null]);
	await page.reload();
	await expect(unasked).toBeVisible({ timeout: 30_000 });
	await expect(question).toHaveCount(0);
	expect(await onAccount(2100)).toEqual([null]);

	// The payment marked as a Transfer naming the card, on the card's page.
	await page.getByRole("link", { name: new RegExp(`^${apple}, `) }).click();
	await expect(page.locator("[data-slot=detail-title]:visible")).toContainText(apple);
	const payments = page.getByRole("region", { name: /^Payments/ });
	await expect(payments).toContainText("$200");
	await expect(payments).toContainText("Payment · Transfer");
	await shot(page, "card-payments");

	// The Balance check is one of the Nudges a Parent chooses, on until they say otherwise.
	await page.goto("/household");
	const more = page.getByRole("button", { name: "Choose which Nudges you get" });
	// On a phone the switches wait behind a button.
	if (width < 600) {
		await hydrated(more);
		await more.click();
	}
	const balanceCheck = page.getByRole("switch", { name: /A statement’s Balance check is due/ });
	await expect(balanceCheck).toBeChecked();
	await balanceCheck.scrollIntoViewIfNeeded();
	if (shotDir) await page.screenshot({ path: `${shotDir}/nudge-preference-${width}.png` });
});
