import { expect, type Page, test } from "@playwright/test";
import { createTestParent } from "./parents";
import { createPlannedHousehold, pickQuickAddBucket, signedInPage } from "./session";

// Household snapshots (#78, ADR-0035): take one in Household → Your data, change something,
// restore it behind the typed Household name, and what was there is back.

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

test("a Parent takes a snapshot, adds a Transaction, restores the snapshot, and it's as it was", async ({
	browser,
}) => {
	test.setTimeout(240_000);
	const alex = await createTestParent();
	parents.push(alex);
	const page = await signedInPage(browser, alex.email);
	await createPlannedHousehold(page, { baseline: "9000", buckets: [["Groceries", "600"]] });
	await quickAdd(page, "42.10", "Groceries", "Farmers market");

	await page.goto("/household");
	const snapshots = page.getByRole("region", { name: "Snapshots" });
	await snapshots.getByLabel("Note").fill("Before the big shop");
	await snapshots.getByRole("button", { name: "Take a snapshot" }).click();
	const history = snapshots.getByRole("list", { name: "Snapshot history" });
	const taken = history.getByRole("listitem").filter({ hasText: "Before the big shop" });
	await expect(taken).toContainText("Taken by");
	await expect(taken).toContainText("1 Transaction,");

	// Something changes after the snapshot.
	await page.goto("/month");
	await quickAdd(page, "310.00", "Groceries", "Warehouse run");
	await expect(page.getByText("Warehouse run").first()).toBeVisible();

	await page.goto("/household");
	await taken.getByRole("button", { name: /^Restore the snapshot from/ }).click();
	const sheet = page.getByRole("dialog", { name: "Restore this snapshot?" });
	await expect(sheet.getByRole("list", { name: "What a restore does" })).toContainText(
		"1 Transaction",
	);
	const confirm = sheet.getByRole("button", { name: "Restore" });
	await expect(confirm).toBeDisabled();
	await sheet.getByLabel("Type “The Rinks”").fill("The Rink");
	await expect(confirm).toBeDisabled();
	await sheet.getByLabel("Type “The Rinks”").fill("The Rinks");
	await confirm.click();
	await expect(sheet).toBeHidden();

	// A snapshot of how things were just before is taken first, holding both Transactions.
	const before = history.getByRole("listitem").filter({ hasText: "Before a restore" });
	await expect(before).toContainText("2 Transactions,", { timeout: 30_000 });
	await expect(page.getByText("Restored. Your Household is back to how it was.")).toBeVisible({
		timeout: 120_000,
	});

	await page.goto("/month");
	await expect(page.getByText("Farmers market").first()).toBeVisible();
	await expect(page.getByText("Warehouse run")).toHaveCount(0);
});
