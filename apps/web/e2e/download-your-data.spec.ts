import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";
import { createTestParent } from "./parents";
import {
	choose,
	chooseKind,
	createPlannedHousehold,
	enterJoinedHousehold,
	openPlanBuckets,
	pickQuickAddBucket,
	signedInPage,
	switchTo,
} from "./session";

// Download your data (#62, ADR-0028): prepared in the background, downloaded as a ZIP of CSVs
// that hold the Household's spending, and refused to anyone but the Parent it was made for.

const SHOTS = process.env.SHOTS_DIR;

let parents: Awaited<ReturnType<typeof createTestParent>>[] = [];

test.afterEach(async () => {
	await Promise.all(parents.map((p) => p.remove()));
	parents = [];
});

async function quickAdd(page: Page, amount: string, bucket: string, note: string) {
	await page.getByRole("link", { name: "Quick Add" }).click();
	const sheet = page.getByRole("dialog", { name: "Quick Add" });
	await expect(sheet).toBeVisible();
	await page.keyboard.type(amount);
	await sheet.getByLabel("Note").fill(note);
	await pickQuickAddBucket(sheet, bucket);
	await expect(sheet).toBeHidden();
}

test("prepare, download and open the ZIP; another Household's link is refused", async ({
	browser,
}) => {
	test.setTimeout(180_000);
	const alex = await createTestParent();
	parents.push(alex);
	const page = await signedInPage(browser, alex.email, { viewport: { width: 393, height: 852 } });
	await createPlannedHousehold(page, { baseline: "9000", buckets: [["Groceries", "600"]] });
	await quickAdd(page, "42.10", "Groceries", 'Farmers, "market"');

	await page.goto("/household");
	const section = page.getByRole("region", { name: "Download your data" });
	// On a phone the second paragraph waits behind a button. A click before the page has come alive
	// in the browser does nothing, so click (only while it is still closed) until it opens.
	const more = section.getByRole("button", { name: "More about this file" });
	await expect(async () => {
		if ((await more.getAttribute("aria-expanded")) !== "true") await more.click();
		await expect(more).toHaveAttribute("aria-expanded", "true", { timeout: 2_000 });
	}).toPass({ timeout: 20_000 });
	await expect(
		section.getByText("The other Parent’s Personal Allowance isn’t included"),
	).toBeVisible();
	await section.getByRole("button", { name: "Prepare download" }).click();
	const ready = section.getByRole("link", { name: /^Download \(ready until .* tomorrow\)$/ });
	await expect(ready).toBeVisible({ timeout: 60_000 });
	if (SHOTS) {
		await section.scrollIntoViewIfNeeded();
		await page.screenshot({ path: `${SHOTS}/download-your-data-393.png`, fullPage: false });
	}

	const [download] = await Promise.all([page.waitForEvent("download"), ready.click()]);
	const files = unzipSync(new Uint8Array(readFileSync(await download.path())));
	expect(Object.keys(files)).toEqual(
		expect.arrayContaining([
			"transactions.csv",
			"accounts.csv",
			"plan.csv",
			"plan-changes.csv",
			"log-removed.csv",
			"rules.csv",
			"money-in.csv",
			"money-in-rules.csv",
			"card-payment-rules.csv",
			"owed-back.csv",
			"paid-back.csv",
			"refund-links.csv",
			"household.json",
		]),
	);
	const transactions = strFromU8(files["transactions.csv"] as Uint8Array)
		.trim()
		.split("\r\n");
	expect(transactions[0]).toBe(
		"Date,Account,Merchant,Note,Amount,Bucket,Commitment,Goal,Splits,For,Bank took it back on,Bank lowered it to,Bank’s date",
	);
	expect(transactions).toHaveLength(2);
	expect(transactions[1]).toContain('"Farmers, ""market""",42.1,Groceries');
	expect(strFromU8(files["plan.csv"] as Uint8Array)).toContain("Bucket,Groceries,600");

	const href = (await ready.getAttribute("href")) as string;
	expect((await page.request.get(href.replace(/\w{6}\.zip$/, "AAAAAA.zip"))).status()).toBe(404);

	// A Parent in another Household gets nothing from the same link.
	const sam = await createTestParent();
	parents.push(sam);
	const other = await signedInPage(browser, sam.email);
	await createPlannedHousehold(other, { baseline: "5000", buckets: [["Groceries", "300"]] });
	expect((await other.request.get(href)).status()).toBe(404);
	expect((await other.context().request.get(href)).status()).toBe(404);
});

/** Prepares this Parent's download from Household and opens the ZIP. */
async function downloadZip(page: Page) {
	await page.goto("/household");
	const section = page.getByRole("region", { name: "Download your data" });
	await section.getByRole("button", { name: "Prepare download" }).click();
	const ready = section.getByRole("link", { name: /^Download \(ready until / });
	await expect(ready).toBeVisible({ timeout: 60_000 });
	const [download] = await Promise.all([page.waitForEvent("download"), ready.click()]);
	return unzipSync(new Uint8Array(readFileSync(await download.path())));
}

test("the other Parent's download has Alex's Personal Allowance only as its monthly total", async ({
	browser,
}) => {
	test.setTimeout(180_000);
	const first = await createTestParent();
	const second = await createTestParent();
	parents.push(first, second);
	const alex = await signedInPage(browser, first.email);
	await createPlannedHousehold(alex, { baseline: "5,000", buckets: [["Groceries", "600"]] });
	await alex
		.getByRole("navigation", { name: "Main" })
		.getByRole("link", { name: "Household" })
		.click();
	await alex.getByLabel("Their email").fill(second.email);
	await alex.getByRole("button", { name: /^Invite/ }).click();
	await expect(alex.getByText(`Invited ${second.email}`)).toBeVisible();

	const sam = await signedInPage(browser, second.email);
	await sam.goto("/welcome");
	await sam.getByLabel("Your name").fill("Sam");
	await sam.getByRole("button", { name: "Join The Rinks" }).click();
	await enterJoinedHousehold(sam);

	// Alex sets up a Personal Allowance and spends from it, and spends from Groceries too.
	await alex
		.getByRole("navigation", { name: "Main" })
		.getByRole("link", { name: "This Month" })
		.click();
	await switchTo(alex, "Plan");
	await openPlanBuckets(alex);
	await alex.getByLabel("Your Personal Allowance").fill("150");
	await alex.getByRole("button", { name: "Set up Personal Allowance" }).click();
	await expect(alex.getByRole("button", { name: "Edit Alex’s Personal Allowance" })).toBeVisible();
	await alex
		.getByRole("navigation", { name: "Main" })
		.getByRole("link", { name: "This Month" })
		.click();
	await switchTo(alex, "Month");
	await quickAdd(alex, "42", "Alex’s Personal Allowance", "Birthday gift for Sam");
	await quickAdd(alex, "10", "Groceries", "Milk");

	const samLines = strFromU8((await downloadZip(sam))["transactions.csv"] as Uint8Array);
	expect(samLines).toContain("Milk");
	expect(samLines).not.toContain("Birthday gift");
	expect(samLines).toContain("Total for the month");
	expect(samLines).toMatch(/,42,Alex’s Personal Allowance,/);

	// Alex's own download has the line itself.
	const alexLines = strFromU8((await downloadZip(alex))["transactions.csv"] as Uint8Array);
	expect(alexLines).toContain("Birthday gift for Sam");
	expect(alexLines).not.toContain("Total for the month");
});

/** A CSV file of the download as rows of cells (none of these cells holds a comma or a quote). */
const cells = (file: Uint8Array | undefined) =>
	strFromU8(file as Uint8Array)
		.trim()
		.split("\r\n")
		.map((line) => line.split(","));

// The three files issue 141 added: money in with its kind, the Rules for money in (a remembered
// pair of Accounts among them) and the card payments Noodle remembers. Each is read from the ZIP
// a Parent downloads, after they have named a deposit, remembered a pair and answered "It's a
// card payment" in the app.
test("the download's money-in.csv, money-in-rules.csv and card-payment-rules.csv say what the Parent named and asked Noodle to remember", async ({
	browser,
}) => {
	test.setTimeout(300_000);
	const alex = await createTestParent();
	parents.push(alex);
	const page = await signedInPage(browser, alex.email, { viewport: { width: 1440, height: 900 } });
	await createPlannedHousehold(page, { baseline: "5,000", buckets: [["Groceries", "600"]] });
	const month = /\/month\/(\d{4}-\d{2})/.exec(page.url())?.[1];
	if (!month) throw new Error(`No month in ${page.url()}`);
	const toast = (text: string) => page.getByRole("status").filter({ hasText: text });

	const addAccount = async (name: string, kind: "checking" | "savings" | "credit-card") => {
		await page.goto("/accounts");
		await expect(page.getByRole("heading", { level: 1 })).toHaveText("Accounts");
		await expect(async () => {
			if (!(await page.getByLabel("Name").isVisible()))
				await page.getByRole("button", { name: "Add Account" }).click({ timeout: 2_000 });
			await expect(page.getByLabel("Name")).toBeVisible({ timeout: 1_000 });
		}).toPass();
		await page.getByLabel("Name").fill(name);
		await chooseKind(page, kind);
		await page.getByLabel(kind === "credit-card" ? "Owed now" : "Balance now").fill("900");
		await page.getByRole("button", { name: "Add Account" }).last().click();
		await expect(page.getByRole("link", { name: new RegExp(`^${name}, `) })).toBeVisible();
	};
	await addAccount("Visa", "credit-card");
	await addAccount("Ally savings", "savings");
	await addAccount("Checking", "checking");

	// Checking's statement: a paycheck, money a person sent, and a payment to the card.
	const { us, iso } = await page.evaluate(() => {
		const now = new Date();
		const mm = String(now.getMonth() + 1).padStart(2, "0");
		const dd = String(now.getDate()).padStart(2, "0");
		return { us: `${mm}/${dd}/${now.getFullYear()}`, iso: `${now.getFullYear()}-${mm}-${dd}` };
	});
	const PAY = "ACME CORP PAYROLL 0042";
	const JORDAN = "Zelle payment from JORDAN PIKE 99887766";
	const CARD = "CARDMEMBER SERV WEB PYMT";
	await page.getByRole("link", { name: /^Checking, / }).click();
	await expect(page.locator("[data-slot=detail-title]:visible")).toContainText("Checking");
	await page.getByRole("button", { name: "Upload statement" }).click();
	const sheet = page.getByRole("dialog", { name: "Upload a statement" });
	await sheet.getByLabel("Statement file").setInputFiles({
		name: "checking.csv",
		mimeType: "text/csv",
		buffer: Buffer.from(
			[
				"Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #",
				`CREDIT,${us},"${PAY}",1840.00,ACH_CREDIT,2740.00,`,
				`CREDIT,${us},"${JORDAN}",75.00,ACH_CREDIT,2815.00,`,
				`DEBIT,${us},"${CARD}",-250.00,ACH_DEBIT,2565.00,`,
			].join("\n"),
		),
	});
	await sheet.getByRole("button", { name: "Import 3 lines" }).click();
	await expect(sheet).toBeHidden();
	await expect(toast("checking.csv").first()).toBeVisible();

	// The payment out of Checking is a card payment to Visa, and its wording is remembered.
	await page.goto(`/transactions/${month}`);
	await expect(page.getByLabel("Search notes and merchants")).toBeEnabled({ timeout: 30_000 });
	const payment = page.getByRole("button", { name: /, \$250, Unassigned, .*from Checking$/ });
	await expect(payment).toBeVisible();
	await payment.click();
	const detail = page
		.locator("[role=dialog], [data-slot=transaction-detail]")
		.filter({ has: page.getByRole("group", { name: "Transaction type" }) });
	const tile = detail.getByRole("button", { name: "Credit card payment", exact: true });
	await expect(tile).toBeEnabled();
	await tile.click();
	await choose(detail, "Payment to", "Visa");
	await detail.getByRole("button", { name: "Link payment", exact: true }).click();
	await expect(toast("marked as a Transfer to Visa")).toBeVisible();
	await expect(payment).toHaveCount(0, { timeout: 20_000 });

	// What the person sent is a Transfer from savings, and the pair is remembered. (After the card
	// payment, so Review holds nothing else while the row asks which Account.)
	await page.goto("/review");
	const row = page
		.getByTestId("money-in-review")
		.getByTestId("money-in-row")
		.filter({ hasText: "JORDAN PIKE" });
	await expect(row).toBeVisible({ timeout: 30_000 });
	const pair = row.getByTestId("account-pair-offer");
	await expect(async () => {
		if (!(await pair.isVisible()))
			await row.getByRole("button", { name: "Transfer", exact: true }).click({ timeout: 2_000 });
		await expect(pair).toBeVisible({ timeout: 3_000 });
	}).toPass({ timeout: 30_000 });
	await pair.getByRole("button", { name: "Ally savings" }).click();
	await pair.getByRole("button", { name: "Yes, always" }).click();
	await expect(
		toast("Money from Ally savings into Checking is always a Transfer now"),
	).toBeVisible();

	// Rules are dated by the day they were made, in UTC: the day before or after this one's start.
	const madeOn = [new Date(Date.now() - 600_000), new Date()].map((d) =>
		d.toISOString().slice(0, 10),
	);
	const files = await downloadZip(page);

	// money-in.csv: every deposit with its kind; the Transfer names the Account it came from.
	const moneyIn = cells(files["money-in.csv"]);
	expect(moneyIn[0]).toEqual([
		"Date",
		"Account",
		"Note",
		"Amount",
		"Kind",
		"From Account",
		"Whose pay",
		"Pay day",
		"Bank took it back on",
		"Bank changed it to",
	]);
	expect(moneyIn).toHaveLength(3);
	const paycheck = moneyIn.find((line) => line[3] === "1840");
	expect(paycheck).toEqual([iso, "Checking", PAY, "1840", "Income", "", "", "", "", ""]);
	const transfer = moneyIn.find((line) => line[3] === "75");
	expect(transfer).toEqual([
		iso,
		"Checking",
		JORDAN,
		"75",
		"Transfer",
		"Ally savings",
		"",
		"",
		"",
		"",
	]);
	// The payment to the card is money out: it is not in this file.
	expect(strFromU8(files["money-in.csv"] as Uint8Array)).not.toContain("CARDMEMBER");

	// money-in-rules.csv: the remembered pair, with both its Accounts and who made it.
	const moneyInRules = cells(files["money-in-rules.csv"]);
	expect(moneyInRules[0]).toEqual([
		"Statement words",
		"Always",
		"Into Account",
		"From Account",
		"Whose pay",
		"Set by",
		"Made on",
	]);
	expect(moneyInRules).toHaveLength(2);
	expect(moneyInRules[1]).toEqual([
		// The wording as Noodle keeps it: the sender, without the words and numbers that change.
		"zelle from jordan pike",
		"Transfer",
		"Checking",
		"Ally savings",
		"",
		"Alex",
		expect.stringMatching(new RegExp(`^(${madeOn.join("|")})$`)),
	]);

	// card-payment-rules.csv: the wording, the card it pays, who said so and when.
	const cardPaymentRules = cells(files["card-payment-rules.csv"]);
	expect(cardPaymentRules[0]).toEqual(["Statement words", "Card", "Set by", "Made on"]);
	expect(cardPaymentRules).toHaveLength(2);
	expect(cardPaymentRules[1]).toEqual([
		"cardmember serv",
		"Visa",
		"Alex",
		expect.stringMatching(new RegExp(`^(${madeOn.join("|")})$`)),
	]);
});
