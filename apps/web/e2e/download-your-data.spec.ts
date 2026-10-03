import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";
import { createTestParent } from "./parents";
import { createPlannedHousehold, signedInPage } from "./session";

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
	await sheet.getByRole("button", { name: new RegExp(`^${bucket}`) }).click();
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
	await expect(section).toContainText("The other Parent’s Personal Allowance isn’t included");
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
			"rules.csv",
			"household.json",
		]),
	);
	const transactions = strFromU8(files["transactions.csv"] as Uint8Array)
		.trim()
		.split("\r\n");
	expect(transactions[0]).toBe(
		"Date,Account,Merchant,Note,Amount,Bucket,Commitment,Goal,Splits,For",
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
