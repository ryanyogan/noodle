import { expect, type Page, test } from "@playwright/test";
import { createTestParent } from "./parents";
import { createPlannedHousehold, signedInPage } from "./session";

let parent: Awaited<ReturnType<typeof createTestParent>>;

test.beforeEach(async () => {
	parent = await createTestParent();
});

test.afterEach(async () => {
	await parent?.remove();
});

const plan = {
	baseline: "5,000",
	buckets: [
		["Groceries", "1,200"],
		["Hockey", "400"],
	] as [string, string][],
};

const hero = (page: Page) => page.getByRole("region", { name: "Free to Spend" });
/** Any Cover button on This Month: each overspent Bucket's row has one. */
const coverButtons = (page: Page) => page.getByRole("button", { name: /^Cover / });
const coverSheet = (page: Page, bucket: string) =>
	page.getByRole("dialog", { name: `Cover ${bucket}` });
const bucketRow = (page: Page, name: string) =>
	page.getByRole("listitem", { name: new RegExp(`^${name}: `) });

async function quickAdd(page: Page, amount: string, bucket: string) {
	await page.getByRole("link", { name: "Quick Add" }).click();
	const sheet = page.getByRole("dialog", { name: "Quick Add" });
	await expect(sheet).toBeVisible();
	await page.keyboard.type(amount);
	await sheet.getByRole("button", { name: new RegExp(`^${bucket}`) }).click();
	await expect(sheet).toBeHidden();
}

/** Opens the Cover sheet for an overspent Bucket and covers it from `source`. */
async function cover(page: Page, bucket: string, source: string) {
	await bucketRow(page, bucket)
		.getByRole("button", { name: `Cover ${bucket}` })
		.click();
	const sheet = coverSheet(page, bucket);
	await sheet.getByRole("button", { name: new RegExp(`^${source}`) }).click();
	await expect(sheet).toBeHidden();
}

test("an overspent Bucket is covered back to zero from another Bucket, and undone from the Bucket", async ({
	browser,
}) => {
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, plan);
	await expect(coverButtons(page)).toHaveCount(0);

	await quickAdd(page, "450", "Hockey");
	await expect(bucketRow(page, "Hockey")).toHaveAccessibleName(/over by \$50$/);
	// Overspent Buckets come first, with their Cover on the row.
	await expect(
		page
			.getByRole("region", { name: /^Buckets/ })
			.getByRole("listitem")
			.first(),
	).toHaveAccessibleName(/^Hockey: /);

	await bucketRow(page, "Hockey").getByRole("button", { name: "Cover Hockey" }).click();
	const sheet = coverSheet(page, "Hockey");
	await expect(sheet).toContainText("Hockey is $50 over.");
	// Exactly what it's over, from anywhere with enough left.
	await expect(sheet.getByLabel("Amount")).toHaveValue("50");
	await expect(sheet.getByRole("button", { name: /^Free to Spend/ })).toContainText("$3,400 left");
	await sheet.getByRole("button", { name: /^Groceries/ }).click();
	await expect(sheet).toBeHidden();

	await expect(bucketRow(page, "Hockey")).toHaveAccessibleName(
		/^Hockey: \$0 left of \$450(, ahead of pace)?$/,
	);
	await expect(bucketRow(page, "Groceries")).toHaveAccessibleName(
		/^Groceries: \$1,150 left of \$1,150$/,
	);
	await expect(coverButtons(page)).toHaveCount(0);
	await expect(page.getByRole("status").filter({ hasText: "covers" })).toContainText(
		"$50 from Groceries covers Hockey",
	);
	// Moving money between Buckets doesn't touch Free to Spend.
	await expect(hero(page).getByText("$3,400", { exact: true }).first()).toBeVisible();

	await page.reload();
	await expect(bucketRow(page, "Hockey")).toHaveAccessibleName(
		/^Hockey: \$0 left of \$450(, ahead of pace)?$/,
	);
	await expect(bucketRow(page, "Hockey")).toContainText("Covered $50 from Groceries");

	await bucketRow(page, "Hockey")
		.getByRole("button", { name: "Undo Cover from Groceries" })
		.click();
	await expect(bucketRow(page, "Hockey")).toHaveAccessibleName(
		/^Hockey: \$0 left of \$400, over by \$50$/,
	);
	await expect(bucketRow(page, "Groceries")).toHaveAccessibleName(
		/^Groceries: \$1,200 left of \$1,200$/,
	);
	await expect(
		bucketRow(page, "Hockey").getByRole("button", { name: "Cover Hockey" }),
	).toBeVisible();
	await page.reload();
	await expect(bucketRow(page, "Hockey")).toHaveAccessibleName(/over by \$50$/);
	await page.context().close();
});

test("a Cover from Free to Spend is undone from its toast", async ({ browser }) => {
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, plan);
	await quickAdd(page, "430", "Hockey");

	await cover(page, "Hockey", "Free to Spend");
	await expect(bucketRow(page, "Hockey")).toHaveAccessibleName(
		/^Hockey: \$0 left of \$430(, ahead of pace)?$/,
	);
	await expect(hero(page).getByText("$3,370", { exact: true }).first()).toBeVisible();

	const toast = page.getByRole("status").filter({ hasText: "covers" });
	await expect(toast).toContainText("$30 from Free to Spend covers Hockey");
	await toast.getByRole("button", { name: "Undo" }).click();
	await expect(hero(page).getByText("$3,400", { exact: true }).first()).toBeVisible();
	await expect(bucketRow(page, "Hockey")).toHaveAccessibleName(/over by \$30$/);
	await page.reload();
	await expect(hero(page).getByText("$3,400", { exact: true }).first()).toBeVisible();
	await expect(bucketRow(page, "Hockey")).toHaveAccessibleName(/over by \$30$/);
	await page.context().close();
});

test("a Cover is refused when its source no longer has that much left", async ({ browser }) => {
	const page = await signedInPage(browser, parent.email);
	// This screen doesn't hear about the other screen's spending, so it still believes
	// Groceries has plenty left when it asks for the Cover.
	await page.routeWebSocket(/\/api\/household-agent$/, (socket) => {
		socket.onMessage((message) => {
			if (message === "ping") socket.send("pong");
		});
	});
	await createPlannedHousehold(page, plan);
	await quickAdd(page, "450", "Hockey");
	await expect(bucketRow(page, "Hockey")).toHaveAccessibleName(/over by \$50$/);

	const other = await page.context().newPage();
	await other.goto("/month");
	await quickAdd(other, "1180", "Groceries");
	await expect(bucketRow(other, "Groceries")).toHaveAccessibleName(/^Groceries: \$20 left/);

	await bucketRow(page, "Hockey").getByRole("button", { name: "Cover Hockey" }).click();
	await expect(
		coverSheet(page, "Hockey").getByRole("button", { name: /^Groceries/ }),
	).toContainText("$1,200 left");
	await coverSheet(page, "Hockey")
		.getByRole("button", { name: /^Groceries/ })
		.click();
	await expect(page.getByRole("status").filter({ hasText: "wasn’t covered" })).toContainText(
		"Groceries has only $20 left now, so Hockey wasn’t covered.",
	);
	await expect(bucketRow(page, "Hockey")).toHaveAccessibleName(/over by \$50$/);

	await page.reload();
	await expect(bucketRow(page, "Hockey")).toHaveAccessibleName(/over by \$50$/);
	await expect(bucketRow(page, "Groceries")).toHaveAccessibleName(/^Groceries: \$20 left/);
	await page.context().close();
});
