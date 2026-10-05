import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { createTestParent } from "./parents";
import {
	createPlannedHousehold,
	enterJoinedHousehold,
	pickQuickAddBucket,
	signedInPage,
} from "./session";

// Fresh start and Delete Household (#63, ADR-0029): two sheets, a typed name, a 24-hour grace
// period when both Parents are in, progress, then "All cleared" (or /welcome after a delete).

const SHOTS = process.env.SHOTS_DIR;
const phone = { viewport: { width: 393, height: 852 } };

let parents: Awaited<ReturnType<typeof createTestParent>>[] = [];

test.afterEach(async () => {
	await Promise.all(parents.map((p) => p.remove()));
	parents = [];
});

async function expectNoAxeViolations(page: Page, what: string) {
	const { violations } = await new AxeBuilder({ page })
		.withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
		.analyze();
	expect(
		violations.map((v) => `${v.id}: ${v.help}`),
		`${what}: axe violations`,
	).toEqual([]);
}

async function quickAdd(page: Page, amount: string, bucket: string, note: string) {
	await page.getByRole("link", { name: "Quick Add" }).click();
	const sheet = page.getByRole("dialog", { name: "Quick Add" });
	await expect(sheet).toBeVisible();
	await page.keyboard.type(amount);
	await sheet.getByLabel("Note").fill(note);
	await pickQuickAddBucket(sheet, bucket);
	await expect(sheet).toBeHidden();
}

/** Opens the Danger zone's sheets for one action and confirms with the typed name. */
async function confirmInSheets(page: Page, action: "Start fresh" | "Delete Household") {
	await page.goto("/household");
	const zone = page.getByRole("region", { name: "Danger zone" });
	await zone.getByRole("button", { name: action }).click();
	const sheet = page.getByRole("dialog", { name: `${action}?` });
	await expect(sheet).toBeVisible();
	await expect(sheet.getByRole("list", { name: "What will be cleared" })).toBeVisible();
	await expect(sheet.getByRole("link", { name: "Download everything first" })).toBeVisible();
	// A download left in Noodle goes with the rest, and no snapshot holds it (ADR-0035).
	await expect(sheet).toContainText(
		action === "Start fresh"
			? "Save it to your phone or computer: a download left in Noodle is cleared too, and doesn’t come back with a snapshot."
			: "Save it to your phone or computer: a download left in Noodle is deleted too.",
	);
	// Start fresh takes a snapshot first (#78); Delete Household keeps one for 30 days at most.
	await expect(sheet).toContainText(
		action === "Start fresh"
			? "Noodle takes a snapshot first. For up to 90 days you can put your Household back from Snapshots"
			: "This can’t be undone. Noodle keeps one last snapshot for 30 days, then deletes it. You can’t put it back yourself.",
	);
	// The files a kept snapshot refers to are kept too, so they come back with it (ADR-0035).
	if (action === "Start fresh") {
		await expect(sheet).toContainText("Statement and Receipt files come back with it");
	}
	return sheet;
}

test("a single Parent starts fresh: counts, typed name, progress, All cleared, the wizard", async ({
	browser,
}) => {
	test.setTimeout(240_000);
	const alex = await createTestParent();
	parents.push(alex);
	const page = await signedInPage(browser, alex.email, phone);
	await createPlannedHousehold(page, { baseline: "9000", buckets: [["Groceries", "600"]] });
	await quickAdd(page, "42.10", "Groceries", "Farmers market");

	const sheet = await confirmInSheets(page, "Start fresh");
	await expect(sheet.getByRole("listitem").filter({ hasText: /^1 Transaction$/ })).toBeVisible();
	await expectNoAxeViolations(page, "first sheet");
	if (SHOTS) await page.screenshot({ path: `${SHOTS}/sheet-1-393.png` });
	await sheet.getByRole("button", { name: "Continue" }).click();

	const confirm = sheet.getByRole("button", { name: "Start fresh" });
	await expect(confirm).toBeDisabled();
	await sheet.getByLabel("Type “The Rinks”").fill("The Rink");
	await expect(confirm).toBeDisabled();
	await sheet.getByLabel("Type “The Rinks”").fill("The Rinks");
	await expect(confirm).toBeEnabled();
	await expectNoAxeViolations(page, "second sheet");
	if (SHOTS) await page.screenshot({ path: `${SHOTS}/sheet-2-393.png` });
	await confirm.click();

	await expect(
		page
			.getByRole("status")
			.getByText(/of 6|All cleared/)
			.first(),
	).toBeVisible();
	await expect(page.getByRole("heading", { name: "All cleared" })).toBeVisible({
		timeout: 90_000,
	});
	await page.getByRole("button", { name: "Set up your Household" }).click();
	await expect(page).toHaveURL(/\/setup/);

	// The snapshot taken first is in the history, holding what was cleared.
	await page.goto("/household");
	await expect(
		page
			.getByRole("region", { name: "Snapshots" })
			.getByRole("list", { name: "Snapshot history" })
			.getByRole("listitem")
			.filter({ hasText: "Before Fresh start" }),
	).toContainText("1 Transaction,");

	const transactions = await page.request.get("/transactions");
	expect(await transactions.text()).not.toContain("Farmers market");
	await page.goto("/household");
	await page
		.getByRole("region", { name: "Danger zone" })
		.getByRole("button", { name: "Start fresh" })
		.click();
	await expect(
		page
			.getByRole("dialog", { name: "Start fresh?" })
			.getByRole("listitem")
			.filter({ hasText: /^0 Transactions$/ }),
	).toBeVisible();
});

test("with both Parents in, it waits a day; the other Parent sees it and cancels", async ({
	browser,
}) => {
	test.setTimeout(240_000);
	const first = await createTestParent();
	const second = await createTestParent();
	parents.push(first, second);
	const alex = await signedInPage(browser, first.email);
	await createPlannedHousehold(alex, { baseline: "5,000", buckets: [["Groceries", "600"]] });
	await alex.goto("/household");
	await alex.getByLabel("Their email").fill(second.email);
	await alex.getByRole("button", { name: /^Invite/ }).click();
	await expect(alex.getByText(`Invited ${second.email}`)).toBeVisible();
	const sam = await signedInPage(browser, second.email);
	await sam.goto("/welcome");
	await sam.getByLabel("Your name").fill("Sam");
	await sam.getByRole("button", { name: "Join The Rinks" }).click();
	await enterJoinedHousehold(sam);

	const sheet = await confirmInSheets(alex, "Start fresh");
	await sheet.getByRole("button", { name: "Continue" }).click();
	await sheet.getByLabel("Type “The Rinks”").fill("The Rinks");
	await sheet.getByRole("button", { name: "Start fresh" }).click();
	const zone = alex.getByRole("region", { name: "Danger zone" });
	await expect(zone).toContainText(/Fresh start scheduled for tomorrow \d+:\d\d [AP]M/);

	// Sam's open screen hears it from the Household Agent.
	const banner = sam.getByRole("status", { name: "Fresh start scheduled" });
	await expect(banner).toBeVisible({ timeout: 15_000 });
	await banner.getByRole("button", { name: "Cancel" }).click();
	await expect(banner).toBeHidden();
	await expect(zone.getByRole("button", { name: "Start fresh" })).toBeVisible({ timeout: 15_000 });
	await alex.goto("/plan");
	await expect(alex.getByText("Groceries").first()).toBeVisible();
});

test("a single Parent deletes the Household and lands on /welcome", async ({ browser }) => {
	test.setTimeout(240_000);
	const alex = await createTestParent();
	parents.push(alex);
	const page = await signedInPage(browser, alex.email, phone);
	await createPlannedHousehold(page, { baseline: "9000", buckets: [["Groceries", "600"]] });
	const sheet = await confirmInSheets(page, "Delete Household");
	await sheet.getByRole("button", { name: "Continue" }).click();
	await sheet.getByLabel("Type “The Rinks”").fill("The Rinks");
	await expect(sheet).toContainText("One last snapshot is kept for 30 days, then deleted.");
	await sheet.getByLabel("Also delete backups").check();
	await expect(sheet).toContainText("Nothing is kept.");
	await sheet.getByRole("button", { name: "Delete Household" }).click();
	await expect(page).toHaveURL(/\/welcome/, { timeout: 90_000 });
});
