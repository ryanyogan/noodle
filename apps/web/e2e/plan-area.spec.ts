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
const header = (page: Page) => page.locator("[data-slot=page-header]:visible");
const planTabs = (page: Page) => page.getByRole("navigation", { name: "Plan pages" });
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
	await expect(heading(page)).toHaveText(name);
	await expect(waterfall(page)).toContainText("Free to Spend$4,400");
	await page.context().close();
});

test("on a phone, the Plan is a switch away from This Month", { tag: "@phone" }, async ({
	browser,
}) => {
	const page = await signedInPage(browser, parent.email, phone);
	await createPlannedHousehold(page, plan);
	const { name } = shownMonth(page);

	const views = page.getByRole("navigation", { name: "Month and Plan" });
	await expect(views.getByRole("link", { name: "Month" })).toHaveAttribute("aria-current", "page");
	await views.getByRole("link", { name: "Plan" }).click();
	await expect(heading(page)).toHaveText(name);
	await expect(views.getByRole("link", { name: "Plan" })).toHaveAttribute("aria-current", "page");
	await expect(waterfall(page)).toContainText("Free to Spend$4,400");

	await views.getByRole("link", { name: "Month" }).click();
	await expect(header(page)).toContainText("This Month");
	await page.context().close();
});

test("the steps from take-home pay to Free to Spend are figures, and the tabs open each part", async ({
	browser,
}) => {
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, plan);
	const { name } = shownMonth(page);
	await switchTo(page, "Plan");

	// A Personal Allowance is its own step.
	await planTabs(page).getByRole("link", { name: "Buckets", exact: true }).click();
	await page.getByLabel("Your Personal Allowance").fill("150");
	await page.getByRole("button", { name: "Set up Personal Allowance" }).click();
	await expect(page.getByRole("button", { name: "Edit Alex’s Personal Allowance" })).toBeVisible();
	await page
		.getByRole("navigation", { name: "Plan pages" })
		.getByRole("link", { name: "Overview" })
		.click();

	// No row links to a tab right above it (#73).
	await expect(waterfall(page).getByRole("link")).toHaveCount(0);
	for (const [step, tab] of [
		["Take-home pay", "Income"],
		["Commitments", "Commitments"],
		["Buckets", "Buckets"],
		["Personal Allowances", "Buckets"],
		["Goal funding", "Goal funding"],
	]) {
		await expect(waterfall(page)).toContainText(step as string);
		await planTabs(page).getByRole("link", { name: tab, exact: true }).click();
		await expect(planTabs(page).getByRole("link", { name: tab as string })).toHaveAttribute(
			"aria-current",
			"page",
		);
		// The header is the Plan's on every tab.
		await expect(heading(page)).toHaveText(name);
		await page
			.getByRole("navigation", { name: "Plan pages" })
			.getByRole("link", { name: "Overview" })
			.click();
		await expect(heading(page)).toHaveText(name);
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
	await planTabs(page).getByRole("link", { name: "Buckets", exact: true }).click();

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
	await page
		.getByRole("navigation", { name: "Plan pages" })
		.getByRole("link", { name: "Overview" })
		.click();
	await switchTo(page, "Month");
	await expect(
		page.getByRole("listitem", { name: /^Groceries: \$1,500 left of \$1,500/ }),
	).toBeVisible();

	// Next month goes back to the allowance before, and says it changed from this month's.
	await switchTo(page, "Plan");
	await page.getByRole("link", { name: "Next month" }).click();
	await expect(header(page)).toContainText(next);
	await planTabs(page).getByRole("link", { name: "Buckets", exact: true }).click();
	await expect(planTabs(page).getByRole("link", { name: "Buckets" })).toHaveAttribute(
		"aria-current",
		"page",
	);
	await expect(heading(page)).toHaveText(next);
	await expect(planRow(page, "Groceries")).toContainText("$1,200");
	await expect(planRow(page, "Groceries")).toContainText("Changed this month · was $1,500");
	await expect(planRow(page, "Hockey")).not.toContainText("Changed this month");
	await page.reload();
	await expect(planRow(page, "Groceries")).toContainText("$1,200");
	await page.context().close();
});

test("going between the Plan's tabs changes only what's below them", async ({ browser }) => {
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, plan);
	await switchTo(page, "Plan");
	await expect(waterfall(page)).toBeVisible();
	const { name, next } = shownMonth(page);
	const month = /\/plan\/(\d{4}-\d{2})/.exec(page.url())?.[1] as string;

	// Mark the header's nodes. A header that re-mounted would be new nodes, without the marks.
	const marked = [
		"[data-slot=section-layout-header]",
		"[data-slot=page-header] h1",
		"nav[aria-label='Plan pages']",
	];
	for (const selector of marked) {
		await page.locator(selector).evaluate((node) => {
			(node as Element & { kept?: boolean }).kept = true;
		});
	}
	const kept = (selector: string) =>
		page.locator(selector).evaluate((node) => (node as Element & { kept?: boolean }).kept === true);
	const box = await planTabs(page).boundingBox();

	for (const [tab, path] of [
		["Income", "/income"],
		["Commitments", "/commitments"],
		["Buckets", "/buckets"],
		["Goal funding", "/goals"],
		["Year", "/year"],
		["Overview", ""],
	] as const) {
		await planTabs(page).getByRole("link", { name: tab }).click();
		await expect(page).toHaveURL(new RegExp(`/plan/${month}${path}$`));
		await expect(planTabs(page).getByRole("link", { name: tab })).toHaveAttribute(
			"aria-current",
			"page",
		);
		// One tab is the current one, the header still names the month, and nothing moved.
		await expect(planTabs(page).locator("[aria-current=page]")).toHaveCount(1);
		await expect(heading(page)).toHaveText(name);
		for (const selector of marked) expect(await kept(selector), `${selector} on ${tab}`).toBe(true);
		expect(await planTabs(page).boundingBox()).toEqual(box);
	}

	// The next month opens on the same tab.
	await planTabs(page).getByRole("link", { name: "Buckets" }).click();
	await page.getByRole("link", { name: "Next month" }).click();
	await expect(page).toHaveURL(/\/plan\/\d{4}-\d{2}\/buckets$/);
	await expect(heading(page)).toHaveText(next);
	await expect(planTabs(page).getByRole("link", { name: "Buckets" })).toHaveAttribute(
		"aria-current",
		"page",
	);
	await page.goBack();
	await expect(page).toHaveURL(new RegExp(`/plan/${month}/buckets$`));
	await page.context().close();
});

test("the old address of the year opens the Plan's Year tab", async ({ browser }) => {
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, plan);
	await switchTo(page, "Plan");
	const month = /\/plan\/(\d{4}-\d{2})/.exec(page.url())?.[1] as string;
	const year = Number(month.slice(0, 4));

	// This year opens on this month; another year on its January.
	await page.goto(`/plan/year/${year}`);
	await expect(page).toHaveURL(new RegExp(`/plan/${month}/year$`));
	await expect(planTabs(page).getByRole("link", { name: "Year" })).toHaveAttribute(
		"aria-current",
		"page",
	);
	await expect(
		page.getByRole("heading", { level: 2, name: String(year), exact: true }),
	).toBeVisible();
	await page.goto(`/plan/year/${year + 1}`);
	await expect(page).toHaveURL(new RegExp(`/plan/${year + 1}-01/year$`));
	await expect(
		page.getByRole("heading", { level: 2, name: String(year + 1), exact: true }),
	).toBeVisible();
	await page.context().close();
});
