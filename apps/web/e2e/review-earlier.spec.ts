import { expect, type Page, test } from "@playwright/test";
import { createTestParent } from "./parents";
import { seedReportHistory } from "./reports-seed";
import { createPlannedHousehold, signedInPage, uploadStatement, waitForReview } from "./session";

// Review for Transactions from earlier months (#82, ADR-0037): one from a month with no Plan, or
// from a month that is over, can be filed without a Bucket, one at a time or all at once; and the
// count of what waits goes down after every decision, in Sort, in the list, on the Review tab and
// beside Transactions in the Sidebar.

let parent: Awaited<ReturnType<typeof createTestParent>>;

test.beforeEach(async () => {
	parent = await createTestParent();
});

test.afterEach(async () => {
	await parent?.remove();
});

const desktop = { viewport: { width: 1440, height: 900 } };
const stack = (page: Page) => page.getByTestId("review-stack");
const top = (page: Page) => stack(page).getByTestId("review-card");
const card = (page: Page) => page.getByTestId("review-card");
const said = (page: Page) => page.getByTestId("review-said");
const status = (page: Page, text: string | RegExp) =>
	page.getByRole("status").filter({ hasText: text });
/** The count beside Transactions in the Sidebar. */
const badge = (page: Page, count: number) =>
	page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: `${count} to review` });
/** The count on the Review tab. */
const tab = (page: Page, count: number) => page.getByLabel(`${count} to review`);

/** The 15th, `monthsAgo` months back, as a statement dates it. */
const earlier = (page: Page, monthsAgo: number) =>
	page.evaluate((back) => {
		const now = new Date();
		return new Date(now.getFullYear(), now.getMonth() - back, 15).toLocaleDateString("en-US");
	}, monthsAgo);

test("a bank Transaction from a month with no Plan is filed without a Bucket, and the count drops after every decision", async ({
	browser,
}) => {
	test.slow();
	const page = await signedInPage(browser, parent.email, desktop);
	await createPlannedHousehold(page, {
		baseline: "5,000",
		buckets: [
			["Groceries", "1,200"],
			["Gas", "300"],
		],
	});
	const thisMonth = page.url();
	const lastMonth = await earlier(page, 1);
	const before = await earlier(page, 2);
	await uploadStatement(
		page,
		[
			["CORNER GAS MART", "40.00"],
			["VALLEY GAS STOP", "30.00"],
			["ACME WIDGETS LLC", "19.99", lastMonth],
			["ZENITH TOOLS INC", "12.00", lastMonth],
			["OMEGA PARTS CO", "8.00", before],
		],
		true,
	);
	// Sort, newest first: this month's two (each with a suggestion), then the earlier months'.
	await waitForReview(page, new URL("/review", thisMonth).href, "1 of 5", async () => {
		await expect(top(page).getByRole("button", { name: "Confirm" })).toBeVisible({
			timeout: 2_000,
		});
	});
	await expect(badge(page, 5)).toBeVisible();
	await expect(tab(page, 5)).toBeVisible();

	// Each decision in Sort: the place goes up, and every count goes down by one.
	await top(page).getByRole("button", { name: "Confirm" }).click();
	await expect(said(page)).toContainText("4 left.");
	await expect(stack(page)).toContainText("2 of 5");
	await expect(badge(page, 4)).toBeVisible();
	await expect(tab(page, 4)).toBeVisible();
	await top(page).getByRole("button", { name: "Confirm" }).click();
	await expect(said(page)).toContainText("3 left.");
	await expect(stack(page)).toContainText("3 of 5");
	await expect(badge(page, 3)).toBeVisible();

	// An earlier month with no Plan: no Bucket to pick, but it can be filed as it is.
	await expect(top(page)).toContainText(/has no Plan yet/);
	await expect(top(page).getByRole("combobox")).toHaveCount(0);
	await top(page).getByRole("button", { name: "File without a Bucket" }).click();
	await expect(said(page)).toHaveText(/^Filed .+ without a Bucket\. 2 left\.$/);
	await expect(stack(page)).toContainText("4 of 5");
	await expect(badge(page, 2)).toBeVisible();
	await expect(tab(page, 2)).toBeVisible();

	// Undo puts it back, and the counts with it.
	await stack(page).getByRole("button", { name: "Undo" }).click();
	await expect(stack(page)).toContainText("3 of 5");
	await expect(badge(page, 3)).toBeVisible();

	// The list: its own count, one card at a time, then all the earlier ones at once.
	await page.getByRole("radio", { name: "List" }).click();
	await expect(card(page)).toHaveCount(3);
	await expect(page.getByTestId("review-waiting")).toHaveText("3 to review");
	await card(page)
		.filter({ hasText: /omega/i })
		.getByRole("button", { name: "File without a Bucket" })
		.click();
	await expect(status(page, /filed without a Bucket/)).toBeVisible();
	await expect(card(page)).toHaveCount(2);
	await expect(page.getByTestId("review-waiting")).toHaveText("2 to review");
	await expect(badge(page, 2)).toBeVisible();
	await expect(tab(page, 2)).toBeVisible();

	await page.getByRole("button", { name: /^File all 2 from before \w+ without a Bucket$/ }).click();
	await expect(page.getByText("All sorted")).toBeVisible();
	await expect(
		page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: /to review$/ }),
	).toHaveCount(0);

	// Saved: still nothing waits after a reload.
	await page.reload();
	await expect(page.getByText("Nothing to review")).toBeVisible();
	await expect(
		page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: /to review$/ }),
	).toHaveCount(0);
	await page.context().close();
});

test("a bank Transaction from a month that is over and closed is filed in one of its Buckets, or without one", async ({
	browser,
}) => {
	test.slow();
	const page = await signedInPage(browser, parent.email, desktop);
	await createPlannedHousehold(page, {
		baseline: "6200",
		buckets: [
			["Groceries", "800"],
			["Eating out", "300"],
		],
	});
	const thisMonth = page.url();
	// Planned and spent from two months ago: that month ended, and its closing week has passed.
	seedReportHistory(parent.userId, 3);
	const before = await earlier(page, 2);
	await uploadStatement(
		page,
		[
			["ACME WIDGETS LLC", "19.99", before],
			["ZENITH TOOLS INC", "12.00", before],
		],
		true,
	);
	await waitForReview(page, new URL("/review", thisMonth).href, "1 of 2");
	await expect(badge(page, 2)).toBeVisible();

	// Its month has a Plan, so its Buckets are offered, as for any card.
	await top(page).getByRole("combobox").click();
	await page.getByRole("listbox").getByRole("option", { name: "Groceries", exact: true }).click();
	await expect(said(page)).toHaveText(/^Filed .+ in Groceries\. 1 left\.$/);
	await expect(stack(page)).toContainText("2 of 2");
	await expect(badge(page, 1)).toBeVisible();

	// Or without a Bucket, which changes nothing in the month that's over.
	await top(page)
		.getByRole("button", { name: /is over: file without a Bucket$/ })
		.click();
	await expect(said(page)).toHaveText(/^Filed .+ without a Bucket\. All sorted\.$/);
	await expect(page.getByText("All sorted", { exact: true })).toBeVisible();
	await expect(
		page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: /to review$/ }),
	).toHaveCount(0);
	await page.reload();
	await expect(page.getByText("Nothing to review")).toBeVisible();
	await page.context().close();
});
