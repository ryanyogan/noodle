import { expect, type Page, test } from "@playwright/test";
import { createTestParent } from "./parents";
import {
	choose,
	clientRendered,
	createPlannedHousehold,
	pickQuickAddBucket,
	savedBy,
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
const list = (page: Page) =>
	page.getByRole("grid", { name: /^Transactions in / }).locator("[data-slot=data-table-body]");
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
	const saved = savedBy(page, "addQuickAdd");
	await pickQuickAddBucket(quickAddSheet(page), "Groceries");
	await expect(quickAddSheet(page)).toBeHidden();
	// The sheet closes before the server has the Quick Add: wait for its answer, then for This
	// Month to load, which on a busy CI runner has taken longer than the usual five seconds (#128).
	await saved;
	await nav(page).getByRole("link", { name: "This Month" }).click();
	await expect(bucketRow(page, "Groceries")).toContainText("$250 spent", { timeout: 20_000 });
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
	// As on a slow runner: the split's answer takes a while, so the change made after it is still
	// waiting its turn (changes to Transactions are sent one at a time) when the row shows it (#128).
	await page.route(serverFn("splitTransaction"), async (route) => {
		const response = await route.fetch();
		await new Promise((resolve) => setTimeout(resolve, 1_500));
		await route.fulfill({ response });
	});
	await splitCostco(page);

	await costco(page).click();
	await expect(splitFields(page, 2).getByLabel("Amount")).toHaveValue("70");
	await editSheet(page).getByRole("button", { name: "Remove Splits" }).click();
	await expect(splitFields(page, 1)).toBeHidden();
	await choose(editSheet(page), "Assigned to", "Hockey");
	// The row and This Month show the change before the server has it, and it is sent only once
	// the split before it has been answered: the reload below reads what the server has, so wait
	// for the server's answer first (#128).
	const saved = savedBy(page, "updateTransaction");
	await save(page).click();
	await expect(costco(page)).toHaveAccessibleName("Costco, $250, Hockey, For Everyone");
	await saved;

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

/** The ways a Parent leaves a page; each answers with the page they are on next. */
const leavings: Record<string, (page: Page) => Promise<Page>> = {
	reloaded: async (page) => {
		await page.reload();
		return page;
	},
	"left for another whole page": async (page) => {
		await page.goto("/household");
		return page;
	},
	"closed and the app opened again": async (page) => {
		const context = page.context();
		await page.close();
		const next = await context.newPage();
		await next.goto("/");
		return next;
	},
};

for (const [how, leave] of Object.entries(leavings)) {
	// Changes to Transactions go to the server one at a time. One still waiting its turn had not
	// been sent when the page went, and a page that is gone sends nothing: it was lost without a
	// word (#128). It is sent when the app is next open (ADR-0056).
	test(`a change still waiting its turn behind another is saved though the page is ${how}`, async ({
		browser,
	}) => {
		// Several whole page loads, one after another.
		test.slow();
		const page = await signedInPage(browser, parent.email);
		const context = page.context();
		await setUp(page);
		await openCostco(page);

		// The server takes the split, but its answer never reaches the page: the change made next
		// waits its turn behind it and has not been sent when the page is left.
		let held = true;
		let landed = 0;
		let release = () => {};
		const released = new Promise<void>((resolve) => {
			release = resolve;
		});
		await context.route(serverFn("splitTransaction"), async (route) => {
			if (!held) return route.continue();
			await route.fetch().catch(() => null);
			landed += 1;
			await released;
			await route.abort().catch(() => {});
		});
		const sent: string[] = [];
		context.on("request", (request) => {
			if (serverFn("updateTransaction")(new URL(request.url()))) sent.push(request.method());
		});
		await splitCostco(page);
		await expect.poll(() => landed).toBe(1);

		await costco(page).click();
		await expect(splitFields(page, 2).getByLabel("Amount")).toHaveValue("70");
		await editSheet(page).getByRole("button", { name: "Remove Splits" }).click();
		await expect(splitFields(page, 1)).toBeHidden();
		await choose(editSheet(page), "Assigned to", "Hockey");
		await save(page).click();
		await expect(costco(page)).toHaveAccessibleName("Costco, $250, Hockey, For Everyone");
		// Still waiting: nothing has gone to the server for it.
		expect(sent).toEqual([]);

		held = false;
		const next = await leave(page);
		await nav(next).getByRole("link", { name: "This Month" }).click();
		// Soft, so a failure says both what the server has and whether the change was ever sent.
		await expect.soft(bucketRow(next, "Hockey")).toContainText("$250 spent", { timeout: 20_000 });
		expect.soft(sent).toEqual(["POST"]);
		await expect(bucketRow(next, "Groceries")).not.toContainText("$180 spent");
		// What the server has, not only what this page shows.
		await next.reload();
		await expect(bucketRow(next, "Hockey")).toContainText("$250 spent", { timeout: 20_000 });

		release();
		await context.close();
	});
}
