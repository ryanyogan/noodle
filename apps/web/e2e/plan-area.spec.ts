import { expect, type Page, test } from "@playwright/test";
import { createTestParent } from "./parents";
import { createPlannedHousehold, savedBy, signedInPage, switchTo } from "./session";

let parent: Awaited<ReturnType<typeof createTestParent>>;

test.beforeEach(async () => {
	parent = await createTestParent();
});

test.afterEach(async () => {
	await parent?.remove();
});

const plan = {
	baseline: "6,000",
	buckets: [
		["Groceries", "1,200"],
		["Hockey", "400"],
	] as [string, string][],
};

const phone = { viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true };

const heading = (page: Page) => page.getByRole("heading", { level: 1 });
const waterfall = (page: Page) =>
	page.getByRole("region", { name: "From take-home pay to Free to Spend" });
const planRow = (page: Page, bucket: string) =>
	page.getByRole("listitem").filter({ has: page.getByRole("button", { name: `Edit ${bucket}` }) });

/** The month the page shows, from its URL, and its name ("September"). */
function shownMonth(page: Page) {
	const month = /\/(\d{4})-(\d{2})/.exec(page.url());
	if (!month) throw new Error(`No month in ${page.url()}`);
	const name = (offset: number) =>
		new Date(Date.UTC(Number(month[1]), Number(month[2]) - 1 + offset, 1)).toLocaleString("en-US", {
			month: "long",
			timeZone: "UTC",
		});
	return { name: name(0), next: name(1) };
}

test("on a computer, the Plan is in the sidebar", async ({ browser }) => {
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, plan);
	const { name } = shownMonth(page);

	const sidebar = page.getByRole("navigation", { name: "Main" });
	await sidebar.getByRole("link", { name: "Plan", exact: true }).click();
	await expect(page).toHaveURL(/\/plan\/\d{4}-\d{2}$/);
	await expect(heading(page)).toHaveText(`Plan${name}`);
	await expect(waterfall(page)).toContainText("Free to Spend$4,400");
	await page.context().close();
});

test("on a phone, the Plan is a switch away from This Month", async ({ browser }) => {
	const page = await signedInPage(browser, parent.email, phone);
	await createPlannedHousehold(page, plan);
	const { name } = shownMonth(page);

	const views = page.getByRole("navigation", { name: "Month and Plan" });
	await expect(views.getByRole("link", { name: "Month" })).toHaveAttribute("aria-current", "page");
	await views.getByRole("link", { name: "Plan" }).click();
	await expect(heading(page)).toHaveText(`Plan${name}`);
	await expect(views.getByRole("link", { name: "Plan" })).toHaveAttribute("aria-current", "page");
	await expect(waterfall(page)).toContainText("Free to Spend$4,400");

	await views.getByRole("link", { name: "Month" }).click();
	await expect(heading(page)).toContainText("This Month");
	await page.context().close();
});

test("each step from take-home pay to Free to Spend opens its part of the Plan", async ({
	browser,
}) => {
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, plan);
	const { name } = shownMonth(page);
	await switchTo(page, "Plan");

	// A Personal Allowance is its own step.
	await waterfall(page).getByRole("link", { name: "Buckets", exact: true }).click();
	await page.getByLabel("Your Personal Allowance").fill("150");
	await page.getByRole("button", { name: "Set up Personal Allowance" }).click();
	await expect(page.getByRole("button", { name: "Edit Alex’s Personal Allowance" })).toBeVisible();
	await page.getByRole("link", { name: "Back to Plan" }).click();

	for (const [step, title] of [
		["Take-home pay", "Income"],
		["Commitments", "Commitments"],
		["Buckets", "Buckets"],
		["Personal Allowances", "Buckets"],
		["Goal funding", "Goals"],
	]) {
		await waterfall(page).getByRole("link", { name: step, exact: true }).click();
		await expect(heading(page)).toHaveText(`${name} Plan${title}`);
		await page.getByRole("link", { name: "Back to Plan" }).click();
		await expect(heading(page)).toHaveText(`Plan${name}`);
	}
	await expect(waterfall(page)).toContainText("Personal Allowances−$150");
	await expect(waterfall(page)).toContainText("Free to Spend$4,250");
	await page.context().close();
});

test("a change to just this month leaves next month's Plan as it was", async ({ browser }) => {
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, plan);
	const { name, next } = shownMonth(page);
	await switchTo(page, "Plan");
	await waterfall(page).getByRole("link", { name: "Buckets", exact: true }).click();

	await page.getByRole("button", { name: "Edit Groceries" }).click();
	const sheet = page.getByRole("dialog", { name: "Groceries" });
	await sheet.getByRole("textbox", { name: "Allowance", exact: true }).fill("1,500");
	await expect(sheet.getByRole("radio", { name: `From ${name} on` })).toBeChecked();
	await sheet.getByRole("radio", { name: `Just ${name}` }).check();
	await expect(sheet).toContainText(`${next} goes back to $1,200.`);
	const saved = savedBy(page, "setAllowance");
	await sheet.getByRole("button", { name: "Save", exact: true }).click();
	expect((await saved).ok()).toBe(true);

	// This month has the new allowance. The month before had no Groceries, so no change to note.
	await expect(planRow(page, "Groceries")).toContainText("$1,500");
	await expect(planRow(page, "Groceries")).not.toContainText("Changed this month");
	await page.getByRole("link", { name: "Back to Plan" }).click();
	await switchTo(page, "Month");
	await expect(
		page.getByRole("listitem", { name: /^Groceries: \$1,500 left of \$1,500/ }),
	).toBeVisible();

	// Next month goes back to the allowance before, and says it changed from this month's.
	await switchTo(page, "Plan");
	await page.getByRole("link", { name: "Next month" }).click();
	await expect(heading(page)).toContainText(next);
	await waterfall(page).getByRole("link", { name: "Buckets", exact: true }).click();
	await expect(heading(page)).toHaveText(new RegExp(`^${next}( \\d{4})? PlanBuckets$`));
	await expect(planRow(page, "Groceries")).toContainText("$1,200");
	await expect(planRow(page, "Groceries")).toContainText("Changed this month · was $1,500");
	await expect(planRow(page, "Hockey")).not.toContainText("Changed this month");
	await page.reload();
	await expect(planRow(page, "Groceries")).toContainText("$1,200");
	await page.context().close();
});
