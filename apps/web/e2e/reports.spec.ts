import { expect, type Page, test } from "@playwright/test";
import { createTestParent } from "./parents";
import { seedReportHistory } from "./reports-seed";
import { createPlannedHousehold, signedInPage } from "./session";

let parent: Awaited<ReturnType<typeof createTestParent>>;

test.beforeEach(async () => {
	parent = await createTestParent();
});

test.afterEach(async () => {
	await parent?.remove();
});

const plan = {
	baseline: "8,000",
	buckets: [
		["Groceries", "1,100"],
		["Eating out", "300"],
		["Kids", "450"],
		["Fun", "400"],
	] as [string, string][],
};

const heading = (page: Page) => page.getByRole("heading", { level: 1 });

// Reports render only in the browser (`ssr: "data-only"`, ADR-0013), so after a full page load
// (goto, reload) the page is a skeleton until the dev server has served its whole module graph,
// Recharts included: about 3s on a laptop, 4-6s or more on a 2-vCPU CI runner, which is past
// expect's 5s. So the tests arrive the way a Parent does, by the Reports link from a running app,
// and give the one full load they mean to test (a reload keeps the options) this budget.
const fullLoad = { timeout: 20_000 };

test("Reports: change the period, then drill from a Bucket to its Transactions", async ({
	browser,
}) => {
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, plan);
	seedReportHistory(parent.userId);

	await page.getByRole("link", { name: "Reports" }).click();
	await expect(heading(page)).toContainText("Overview");
	await expect(page.getByText("Income and spending")).toBeVisible();

	await page.getByLabel("Period").selectOption({ label: "Last 3 months" });
	await expect(page).toHaveURL(/period=3m/);
	// Every option lives in the URL, so a reload keeps it.
	await page.reload();
	await expect(page.getByLabel("Period")).toHaveValue("3m", fullLoad);

	await page.getByRole("link", { name: "Buckets", exact: true }).click();
	await expect(heading(page)).toContainText("Buckets");
	await page.getByRole("button", { name: /^Groceries: \$/ }).click();
	await expect(page).toHaveURL(/area=bucket/);
	await expect(page.getByText("Pick a month to see its Transactions")).toBeVisible();

	await page.getByRole("link", { name: "Open in Transactions" }).click();
	await expect(page).toHaveURL(/\/transactions\/\d{4}-\d{2}/);
	await expect(page.getByText("Costco").first()).toBeVisible();
});

test("Big expenses are the one-offs over a threshold the Parent picks", async ({ browser }) => {
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, plan);
	seedReportHistory(parent.userId);

	await page.getByRole("link", { name: "Reports" }).click();
	await expect(heading(page)).toContainText("Overview");
	await page.getByRole("link", { name: "Big expenses" }).click();
	await expect(page).toHaveURL(/view=big/);
	await expect(heading(page)).toContainText("Big expenses");
	const largest = page.getByRole("group", { name: "Largest Transactions" });
	await expect(largest.getByText("Flights to Denver")).toBeVisible();
	// Commitments are expected, not big expenses: they have their own card.
	await expect(largest.getByText("Mortgage")).toHaveCount(0);
	await expect(page.getByText("Commitments, by the year")).toBeVisible();

	const slider = page.getByLabel("What did we spend over…");
	await slider.focus();
	await slider.press("ArrowRight");
	await slider.press("ArrowRight");
	await expect(page).toHaveURL(/over=1000/);
	await expect(page.getByText("One-offs over $1,000", { exact: true })).toBeVisible();
	await expect(largest.getByText("Car repair")).toBeVisible();
	await expect(largest.getByText("Dentist")).toHaveCount(0);
});

test("Phones reach Reports from This Month", async ({ browser }) => {
	const page = await signedInPage(browser, parent.email, {
		viewport: { width: 393, height: 852 },
		isMobile: true,
		hasTouch: true,
	});
	await createPlannedHousehold(page, plan);
	await page.getByRole("link", { name: "Reports" }).click();
	await expect(heading(page)).toContainText("Overview");
});
