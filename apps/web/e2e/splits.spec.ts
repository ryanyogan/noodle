import { expect, type Page, test } from "@playwright/test";
import { createTestParent } from "./parents";
import {
	choose,
	clientRendered,
	createPlannedHousehold,
	pickQuickAddBucket,
	serverFn,
	signedInPage,
} from "./session";

let parent: Awaited<ReturnType<typeof createTestParent>>;

test.beforeEach(async () => {
	parent = await createTestParent();
});

test.afterEach(async () => {
	await parent?.remove();
});

const quickAddSheet = (page: Page) => page.getByRole("dialog", { name: "Quick Add" });
const editSheet = (page: Page) =>
	page
		.locator("[role=dialog], [data-slot=transaction-detail]")
		.filter({ has: page.getByRole("heading", { name: "Edit Transaction" }) });
const splitFields = (page: Page, n: number) =>
	editSheet(page).getByRole("group", { name: `Split ${n}`, exact: true });
const remainder = (page: Page) => editSheet(page).getByRole("status");
const save = (page: Page) => editSheet(page).getByRole("button", { name: "Save" });
const nav = (page: Page) => page.getByRole("navigation", { name: "Main" });
const list = (page: Page) => page.getByRole("list", { name: /^Transactions in / });
const costco = (page: Page) => list(page).getByRole("button", { name: /^Costco,/ });
const bucketRow = (page: Page, name: string) =>
	page.getByRole("listitem", { name: new RegExp(`^${name}: `) });

/** A Household with Leo as a Child and a $250 Costco Quick Add in Groceries; ends on This Month. */
async function setUp(page: Page) {
	await createPlannedHousehold(page, {
		baseline: "5,000",
		buckets: [
			["Groceries", "1,200"],
			["Hockey", "400"],
		],
	});
	await page.goto("/household");
	await page.getByLabel("Add a Child").fill("Leo");
	await page.getByRole("button", { name: "Add Child" }).click();
	await expect(page.getByRole("button", { name: "Edit Leo" })).toBeVisible();
	await page.getByRole("link", { name: "Quick Add" }).first().click();
	await expect(quickAddSheet(page)).toBeVisible();
	await page.keyboard.type("250");
	await quickAddSheet(page).getByLabel("Note").fill("Costco");
	await pickQuickAddBucket(quickAddSheet(page), "Groceries");
	await expect(quickAddSheet(page)).toBeHidden();
	await nav(page).getByRole("link", { name: "This Month" }).click();
	await expect(bucketRow(page, "Groceries")).toContainText("$250 spent");
}

async function openCostco(page: Page) {
	await nav(page).getByRole("link", { name: "Transactions" }).click();
	await costco(page).click();
	await expect(editSheet(page)).toBeVisible();
}

/** Splits Costco: $180 of Groceries For everyone, $70 of Hockey For Leo. */
async function splitCostco(page: Page) {
	await editSheet(page).getByRole("button", { name: "Split", exact: true }).click();
	await expect(splitFields(page, 1).getByLabel("Assigned to")).not.toHaveText("Choose…");
	await splitFields(page, 1).getByLabel("Amount").fill("180");
	await choose(splitFields(page, 2), "Assigned to", "Hockey");
	await splitFields(page, 2)
		.getByRole("toolbar", { name: "For" })
		.getByRole("button", { name: "Leo" })
		.click();
	await splitFields(page, 2).getByLabel("Amount").fill("70");
	await expect(remainder(page)).toHaveText("All assigned");
	await save(page).click();
	await expect(editSheet(page)).toBeHidden();
}

test("splitting a Quick Add spends each Split from its own Bucket, For its own Members", async ({
	browser,
}) => {
	const page = await signedInPage(browser, parent.email);
	await setUp(page);
	await openCostco(page);

	// The Splits must add up to the Transaction before it saves.
	await editSheet(page).getByRole("button", { name: "Split", exact: true }).click();
	await expect(remainder(page)).toHaveText("$250 left to assign");
	await splitFields(page, 1).getByLabel("Amount").fill("180");
	await expect(remainder(page)).toHaveText("$70 left to assign");
	await expect(save(page)).toBeDisabled();
	await splitFields(page, 2).getByLabel("Amount").fill("90");
	await expect(remainder(page)).toHaveText("$20 too much");
	await expect(save(page)).toBeDisabled();
	await splitFields(page, 2).getByLabel("Amount").fill("70");
	await expect(remainder(page)).toHaveText("All assigned");
	await choose(splitFields(page, 2), "Assigned to", "Hockey");
	await splitFields(page, 2)
		.getByRole("toolbar", { name: "For" })
		.getByRole("button", { name: "Leo" })
		.click();
	await save(page).click();
	await expect(editSheet(page)).toBeHidden();
	await expect(costco(page)).toHaveAccessibleName(
		"Costco, $250, Split across 2: Groceries, Hockey",
	);

	// Filters match the Splits: Hockey's Split is For Leo; Groceries' is For everyone.
	await choose(page, "Bucket", "Hockey");
	await expect(costco(page)).toBeVisible();
	await choose(page, "For", "Leo");
	await expect(costco(page)).toBeVisible();
	await choose(page, "Bucket", "Groceries");
	await expect(page.getByText("Nothing matches")).toBeVisible();
	await choose(page, "For", "Everyone (shared)");
	await expect(costco(page)).toBeVisible();

	await nav(page).getByRole("link", { name: "This Month" }).click();
	await expect(bucketRow(page, "Groceries")).toContainText("$180 spent");
	await expect(bucketRow(page, "Hockey")).toContainText("$70 spent");
	await page.reload();
	await expect(bucketRow(page, "Groceries")).toContainText("$180 spent");
	await expect(bucketRow(page, "Hockey")).toContainText("$70 spent");

	// Leo cost only his Split.
	await page.goto("/reports?view=people");
	await expect(
		page.getByRole("region", { name: "Leo", exact: true }).getByRole("row", { name: /^Total/ }),
	).toHaveText(/Total\$70\$70/, clientRendered);
	await page.context().close();
});

test("removing Splits returns the Transaction to one assignment", async ({ browser }) => {
	const page = await signedInPage(browser, parent.email);
	await setUp(page);
	await openCostco(page);
	await splitCostco(page);

	await costco(page).click();
	await expect(splitFields(page, 2).getByLabel("Amount")).toHaveValue("70");
	await editSheet(page).getByRole("button", { name: "Remove Splits" }).click();
	await expect(splitFields(page, 1)).toBeHidden();
	await choose(editSheet(page), "Assigned to", "Hockey");
	await save(page).click();
	await expect(costco(page)).toHaveAccessibleName("Costco, $250, Hockey, For Everyone");

	await nav(page).getByRole("link", { name: "This Month" }).click();
	await expect(bucketRow(page, "Hockey")).toContainText("$250 spent");
	await page.reload();
	await expect(bucketRow(page, "Hockey")).toContainText("$250 spent");
	await expect(bucketRow(page, "Groceries")).not.toContainText("$180 spent");
	await page.context().close();
});

test("a failed split is undone and can be retried", async ({ browser }) => {
	const page = await signedInPage(browser, parent.email);
	await setUp(page);
	await openCostco(page);

	const split = serverFn("splitTransaction");
	await page.route(split, (route) => route.fulfill({ status: 500, body: "Server error" }));
	await splitCostco(page);
	const failed = page.getByRole("status").filter({ hasText: "Couldn’t save" });
	await expect(failed).toContainText("$250 (Costco)");
	await expect(costco(page)).toHaveAccessibleName("Costco, $250, Groceries, For Everyone");

	await page.unroute(split);
	await failed.getByRole("button", { name: "Retry" }).click();
	await expect(costco(page)).toHaveAccessibleName(
		"Costco, $250, Split across 2: Groceries, Hockey",
	);
	await nav(page).getByRole("link", { name: "This Month" }).click();
	await expect(bucketRow(page, "Hockey")).toContainText("$70 spent");
	await page.context().close();
});
