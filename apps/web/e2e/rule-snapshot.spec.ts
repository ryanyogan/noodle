import { expect, type Page, test } from "@playwright/test";
import { createTestParent } from "./parents";
import {
	choose,
	createPlannedHousehold,
	signedInPage,
	uploadStatement,
	waitForReview,
} from "./session";

// A snapshot before a Rule files several Transactions at once (#78, ADR-0035): the Parent is told
// one was taken and where to put things back, and it's in the snapshot history. A Rule that files
// one Transaction takes none and says nothing about it.
//
// Categorization runs with its deterministic fake (AI_MODEL=stub): it knows nothing about ACME, so
// every ACME line of a statement waits in Review, unassigned, until a Rule files it.

const SNAPSHOT_FIRST =
	"Noodle took a snapshot first, so you can put things back from Snapshots in Household settings.";

let parent: Awaited<ReturnType<typeof createTestParent>>;

test.beforeEach(async () => {
	parent = await createTestParent();
});

test.afterEach(async () => {
	await parent?.remove();
});

/** Adds a Rule for ACME's lines from Review's Rules, filing what's unassigned into Groceries. */
async function addAcmeRule(page: Page) {
	await page.getByRole("link", { name: "Rules" }).click();
	await page.getByRole("button", { name: "Add Rule" }).click();
	const add = page.getByRole("dialog", { name: "Add a Rule" });
	await add.getByLabel("Merchant").fill("Acme Widgets");
	await choose(add, "Files to", "Groceries");
	await add.getByRole("button", { name: "Add Rule and file what matches" }).click();
	await expect(add).toBeHidden();
}

/** What Noodle said once the Rule was saved: each toast is a status. */
const ruleSaved = (page: Page) => page.getByRole("status").filter({ hasText: "Rule saved" });

const snapshotHistory = (page: Page) =>
	page.getByRole("region", { name: "Snapshots" }).getByRole("list", { name: "Snapshot history" });

test("a Rule that files several Transactions says a snapshot was taken first, and it's in Snapshots", async ({
	browser,
}) => {
	test.slow();
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, { baseline: "5,000", buckets: [["Groceries", "1,200"]] });
	const thisMonth = page.url();

	await uploadStatement(
		page,
		[
			["ACME WIDGETS LLC #101", "19.99"],
			["ACME WIDGETS LLC #102", "24.50"],
			["ACME WIDGETS LLC #103", "31.75"],
		],
		true,
	);
	await waitForReview(page, new URL("/review", thisMonth).href, "1 of 3");

	await addAcmeRule(page);
	await expect(ruleSaved(page)).toHaveText(
		`Rule saved. Filed 3 more in Groceries. ${SNAPSHOT_FIRST}`,
	);
	await expect(
		page.getByRole("link", { name: /^acme widgets, Groceries, For Everyone, Filed 3 so far$/ }),
	).toBeVisible();

	// The snapshot holds the three as they were, and can be restored like any other.
	await page.goto("/household");
	const taken = snapshotHistory(page)
		.getByRole("listitem")
		.filter({ hasText: "Before applying a Rule" });
	await expect(taken).toHaveCount(1);
	await expect(taken).toContainText("3 Transactions,");
	await expect(taken.getByRole("button", { name: /^Restore the snapshot from/ })).toBeVisible();
});

test("a Rule that files one Transaction takes no snapshot and doesn't say it did", async ({
	browser,
}) => {
	test.slow();
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, { baseline: "5,000", buckets: [["Groceries", "1,200"]] });
	const thisMonth = page.url();

	await uploadStatement(page, [["ACME WIDGETS LLC #101", "19.99"]], true);
	await waitForReview(page, new URL("/review", thisMonth).href, "1 of 1");

	await addAcmeRule(page);
	// The whole of what's said: nothing about a snapshot.
	await expect(ruleSaved(page)).toHaveText("Rule saved. Filed 1 more in Groceries.");
	await expect(page.getByText("Noodle took a snapshot first")).toHaveCount(0);

	// And none is in the history: one taken by hand shows the list is loaded, with only itself.
	await page.goto("/household");
	const snapshots = page.getByRole("region", { name: "Snapshots" });
	await snapshots.getByLabel("Note").fill("By hand");
	await snapshots.getByRole("button", { name: "Take a snapshot" }).click();
	const rows = snapshotHistory(page).getByRole("listitem");
	await expect(rows.filter({ hasText: "By hand" })).toHaveCount(1);
	await expect(rows.filter({ hasText: "Before applying a Rule" })).toHaveCount(0);
});

test("a Rule that's already there says the same when it files several Transactions at once", async ({
	browser,
}) => {
	test.slow();
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, { baseline: "5,000", buckets: [["Groceries", "1,200"]] });
	const thisMonth = page.url();

	await uploadStatement(
		page,
		[
			["ACME WIDGETS LLC #101", "19.99"],
			["ACME WIDGETS LLC #102", "24.50"],
			["ACME WIDGETS LLC #103", "31.75"],
		],
		true,
	);
	await waitForReview(page, new URL("/review", thisMonth).href, "1 of 3");

	// A Rule that matches none of them: saved, nothing filed, no snapshot.
	await page.getByRole("link", { name: "Rules" }).click();
	await page.getByRole("button", { name: "Add Rule" }).click();
	const add = page.getByRole("dialog", { name: "Add a Rule" });
	await add.getByLabel("Merchant").fill("Acme Gadgets");
	await choose(add, "Files to", "Groceries");
	await add.getByRole("button", { name: "Add Rule and file what matches" }).click();
	await expect(add).toBeHidden();
	await expect(page.getByText("Noodle took a snapshot first")).toHaveCount(0);

	// The Rule is opened, pointed at the merchant the three lines have, and told to file what's
	// still unassigned: the apply of a Rule that exists, not the one saving a new Rule does.
	await page.getByRole("link", { name: /^acme gadgets, Groceries, / }).click();
	const merchant = page.getByLabel("Merchant");
	await expect(merchant).toHaveValue(/acme gadgets/i);
	await merchant.fill("Acme Widgets");
	await page.getByRole("button", { name: "Save and file what’s still unassigned" }).click();
	await expect(page.getByRole("status").filter({ hasText: SNAPSHOT_FIRST })).toHaveText(
		`Filed 3 in Groceries. ${SNAPSHOT_FIRST}`,
	);
	await expect(
		page.getByRole("link", { name: /^acme widgets, Groceries, For Everyone, Filed 3 so far$/ }),
	).toBeVisible();

	await page.goto("/household");
	const taken = snapshotHistory(page)
		.getByRole("listitem")
		.filter({ hasText: "Before applying a Rule" });
	await expect(taken).toHaveCount(1);
	await expect(taken).toContainText("3 Transactions,");
});
