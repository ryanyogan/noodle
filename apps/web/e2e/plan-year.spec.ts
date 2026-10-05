import { expect, type Page, test } from "@playwright/test";
import { createTestParent } from "./parents";
import { choose, createPlannedHousehold, pickDate, signedInPage, switchTo } from "./session";

let parent: Awaited<ReturnType<typeof createTestParent>>;

test.beforeEach(async () => {
	parent = await createTestParent();
});

test.afterEach(async () => {
	await parent?.remove();
});

const waterfall = (page: Page) => page.getByRole("region", { name: "Where take-home pay goes" });
const health = (page: Page) => page.getByRole("region", { name: "Things to check" });
const addForm = (page: Page) => page.getByRole("form", { name: "Add a Commitment" });

const monthName = (month: string) =>
	new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-US", {
		month: "long",
		timeZone: "UTC",
	});

function addMonths(month: string, count: number) {
	const [year = 0, m = 0] = month.split("-").map(Number);
	return new Date(Date.UTC(year, m - 1 + count, 1)).toISOString().slice(0, 7);
}

test("the year at a glance, and Plan health pointing at the fix", async ({ browser }) => {
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, { baseline: "9,000", buckets: [["Groceries", "1,200"]] });
	await switchTo(page, "Plan");
	await expect(waterfall(page)).toBeVisible();
	const month = /\/plan\/(\d{4}-\d{2})/.exec(page.url())?.[1];
	if (!month) throw new Error(`No month in ${page.url()}`);
	// A healthy Plan has nothing to warn about.
	await expect(health(page)).toHaveCount(0);

	// A yearly Commitment bigger than what this month and the next leave on top of its own pay
	// (Free to Spend is carried over, issue 113), due two months from now.
	const lumpy = addMonths(month, 2);
	await page
		.getByRole("navigation", { name: "Plan pages" })
		.getByRole("link", { name: "Commitments", exact: true })
		.click();
	const form = addForm(page);
	await form.getByLabel("New Commitment").fill("Roof");
	await form.getByLabel("Amount due").fill("24,000");
	await choose(form, "How often", "Yearly");
	await pickDate(form, "Due on", `${lumpy}-10`);
	await form.getByRole("button", { name: "Add Commitment" }).click();
	await expect(page.getByRole("button", { name: "Edit Roof" })).toBeVisible();
	await page
		.getByRole("navigation", { name: "Plan pages" })
		.getByRole("link", { name: "Overview" })
		.click();

	// Plan health: Free to Spend goes below zero then, and the warning opens that month's Plan.
	// Under where the pay goes it is one line, naming the most urgent: opened, it lists them.
	await page.getByRole("button", { name: /^Things to check/ }).click();
	const warning = health(page).getByRole("link", {
		name: `Free to Spend goes below zero in ${monthName(lumpy)}`,
	});
	await expect(warning).toBeVisible();
	// What the figure is made of (the months before leave $7,800 each), and where to change it.
	await expect(health(page)).toContainText(
		`${monthName(lumpy)} starts with $15,600 carried over, and its Plan uses $16,200 more than its take-home pay, which leaves −$600.`,
	);
	await expect(health(page).getByRole("link", { name: "Roof" })).toHaveAttribute(
		"href",
		new RegExp(`/plan/${lumpy}/commitments/`),
	);
	await warning.click();
	await expect(page).toHaveURL(new RegExp(`/plan/${lumpy}$`));
	await expect(page.locator("[data-slot=page-header]:visible")).toContainText(monthName(lumpy));

	// The year at a glance, from the Plan's Year tab (#73: the overview no longer links it twice).
	await page
		.getByRole("navigation", { name: "Plan pages" })
		.getByRole("link", { name: "Year" })
		.click();
	await expect(page).toHaveURL(new RegExp(`/plan/${lumpy}/year$`));
	await expect(
		page.getByRole("heading", { level: 2, name: lumpy.slice(0, 4), exact: true }),
	).toBeVisible();
	const table = page.getByRole("table", { name: "The Plan month by month" });
	const row = table.getByRole("row", { name: new RegExp(`^${monthName(lumpy)}`) });
	await expect(row).toContainText("Lumpy");
	await expect(row).toContainText("$9,000");
	await expect(row).toContainText("$24,000");
	// Carried over: the two months before leave $15,600, so the month is $600 short, not $16,200.
	await expect(row).toContainText("−$600");
	await expect(page.getByRole("region", { name: "Lumpy months" })).toContainText(
		`Roof $24,000 is due in ${monthName(lumpy)}.`,
	);
	if (lumpy.slice(0, 4) === month.slice(0, 4)) {
		// This month shows what's actually happened so far beneath its Plan.
		const now = table.getByRole("row", { name: new RegExp(`^${monthName(month)}`) });
		await expect(now).toContainText("This month");
		await expect(now).toContainText("Actual so far");
	}

	// On a phone: a readable list, not a squashed grid, and no sideways scrolling.
	await page.setViewportSize({ width: 390, height: 844 });
	await expect(table).toBeHidden();
	const list = page.getByRole("list", { name: "The Plan month by month" });
	await expect(list).toBeVisible();
	await expect(list.getByRole("listitem").filter({ hasText: monthName(lumpy) })).toContainText(
		"−$600",
	);
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
		true,
	);

	// Each month opens its Plan.
	await list.getByRole("link", { name: monthName(lumpy), exact: true }).click();
	await expect(page).toHaveURL(new RegExp(`/plan/${lumpy}$`));
});
