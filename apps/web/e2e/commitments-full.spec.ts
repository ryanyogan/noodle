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
const bills = (page: Page) => page.getByRole("region", { name: /^Bills/ });
const addForm = (page: Page) => page.getByRole("form", { name: "Add a Commitment" });

const monthName = (month: string) =>
	new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-US", {
		month: "long",
		timeZone: "UTC",
	});

function addMonths(month: string, count: number) {
	const [year = 0, m = 0] = month.split("-").map(Number);
	const date = new Date(Date.UTC(year, m - 1 + count, 1));
	return date.toISOString().slice(0, 7);
}

async function addYearly(page: Page, name: string, due: string, dueDate: string) {
	const form = addForm(page);
	await form.getByLabel("New Commitment").fill(name);
	await form.getByLabel("Amount due").fill(due);
	await choose(form, "How often", "Yearly");
	await pickDate(form, "Due on", dueDate);
	await form.getByRole("button", { name: "Add Commitment" }).click();
	await expect(page.getByRole("button", { name: `Edit ${name}` })).toBeVisible();
}

test("Bills switches between this month's bills and Coming up", async ({ browser }) => {
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, { baseline: "9,000", buckets: [["Groceries", "1,200"]] });
	await switchTo(page, "Plan");
	await page
		.getByRole("navigation", { name: "Plan pages" })
		.getByRole("link", { name: "Commitments", exact: true })
		.click();
	const month = /\/plan\/(\d{4}-\d{2})\//.exec(page.url())?.[1];
	if (!month) throw new Error(`No month in ${page.url()}`);
	const [year = 0, m = 0] = month.split("-").map(Number);
	const lastDay = new Date(Date.UTC(year, m, 0)).getUTCDate();
	const day = new Date().getDate() <= 28 ? 28 : lastDay;
	await addYearly(page, "Car insurance", "1,140", `${month}-${day}`);
	await addYearly(page, "Gym", "300", `${addMonths(month, 2)}-10`);
	await page
		.getByRole("navigation", { name: "Plan pages" })
		.getByRole("link", { name: "Overview" })
		.click();
	await expect(waterfall(page)).toBeVisible();
	await switchTo(page, "Month");

	// Bills holds both lists behind a two-tab switch, on a phone as on a desktop (#73).
	await page.setViewportSize({ width: 393, height: 852 });
	const tabs = bills(page).getByRole("tablist", { name: "Bills" });
	await expect(tabs).toBeVisible();
	const thisMonth = tabs.getByRole("tab", { name: "This month" });
	const upcoming = tabs.getByRole("tab", { name: "Coming up (1)" });
	await expect(thisMonth).toHaveAttribute("aria-selected", "true");
	const panel = bills(page).getByRole("tabpanel");
	await expect(panel.getByRole("link", { name: "Car insurance" })).toBeVisible();

	await upcoming.click();
	await expect(upcoming).toHaveAttribute("aria-selected", "true");
	await expect(
		panel.getByRole("listitem", { name: /^Car insurance, due .*, \$1,140$/ }),
	).toBeVisible();
	await expect(panel.getByText("Gym")).toHaveCount(0);

	// Arrow keys move between the tabs too.
	await page.keyboard.press("ArrowLeft");
	await expect(thisMonth).toHaveAttribute("aria-selected", "true");
	await expect(thisMonth).toBeFocused();
	const sw = await page.evaluate(() => document.documentElement.scrollWidth);
	expect(sw).toBeLessThanOrEqual(393);
});

test("Commitments show what's coming up, why a month is lumpy, and each one's page", async ({
	browser,
}) => {
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, { baseline: "9,000", buckets: [["Groceries", "1,200"]] });
	await switchTo(page, "Plan");
	await page
		.getByRole("navigation", { name: "Plan pages" })
		.getByRole("link", { name: "Commitments", exact: true })
		.click();
	await expect(page.locator("nav[aria-label='Plan pages'] [aria-current=page]")).toHaveText(
		"Commitments",
	);
	const month = /\/plan\/(\d{4}-\d{2})\//.exec(page.url())?.[1];
	if (!month) throw new Error(`No month in ${page.url()}`);

	// Due later this month, so within the next 30 days; the other two months from now.
	const [year = 0, m = 0] = month.split("-").map(Number);
	const lastDay = new Date(Date.UTC(year, m, 0)).getUTCDate();
	const day = new Date().getDate() <= 28 ? 28 : lastDay;
	await addYearly(page, "Car insurance", "1,140", `${month}-${day}`);
	await addYearly(page, "Gym", "300", `${addMonths(month, 2)}-10`);
	await expect(
		page.getByText(/Across a year these average \$120 a month \(\$1,440 a year\)/),
	).toBeVisible();

	await page
		.getByRole("navigation", { name: "Plan pages" })
		.getByRole("link", { name: "Overview" })
		.click();
	await expect(waterfall(page)).toBeVisible();
	await switchTo(page, "Month");
	const name = monthName(month);
	await expect(page.getByRole("note", { name: "Why Free to Spend is lower" })).toHaveText(
		`Car insurance $1,140 is due in ${name}. That’s why ${name}’s Free to Spend is lower.`,
	);
	// Bills' switch at every size (#73): This month's bills, and Coming up, the next 30 days.
	const upcoming = bills(page).getByRole("tab", { name: "Coming up (1)" });
	const panel = bills(page).getByRole("tabpanel");
	await upcoming.click();
	await expect(
		panel.getByRole("listitem", { name: /^Car insurance, due .*, \$1,140$/ }),
	).toBeVisible();
	await expect(panel.getByText("Gym")).toHaveCount(0);
	await bills(page).getByRole("tab", { name: "This month" }).click();

	// Gym isn't due this month: it waits, collapsed, under "Not this month".
	const gym = page.getByRole("link", { name: "Gym", exact: true });
	await expect(gym).toBeHidden();
	await page.getByText("Not this month").click();
	await expect(gym).toBeVisible();

	await upcoming.click();
	await panel.getByRole("link", { name: "Car insurance" }).click();
	await expect(page.locator("[data-slot=detail-header]")).toContainText("Car insurance");
	const cost = page.getByRole("region", { name: "Cost a year" });
	await expect(cost).toContainText("$1,140");
	await expect(cost).toContainText("about $95 a month");
	await expect(cost).toContainText("No end date");
	const nextDue = page.getByRole("region", { name: "Next due" });
	await expect(nextDue.getByRole("listitem").first()).toHaveAccessibleName(/^Due .*, \$1,140$/);
	await expect(page.getByRole("region", { name: "Charges" })).toContainText(
		"Nothing has been paid toward it",
	);
	await expect(page.getByRole("region", { name: "Terms history" })).toContainText("$1,140");

	// It's changed from its own page, in the same sheet as on the Plan.
	await page.getByRole("button", { name: "Edit", exact: true }).click();
	const sheet = page.getByRole("dialog", { name: "Car insurance" });
	await expect(sheet.getByLabel("Next due")).toHaveAttribute("data-value", `${month}-${day}`);
	await sheet.getByLabel("Amount", { exact: true }).fill("");
	await sheet.getByRole("button", { name: "Save", exact: true }).click();
	await expect(sheet.getByRole("alert")).toContainText("Enter the amount");
	await sheet.getByLabel("Amount", { exact: true }).fill("1,200");
	await sheet.getByRole("button", { name: "Save", exact: true }).click();
	await expect(sheet).toBeHidden();
	await expect(cost).toContainText("$1,200");

	// Try ending it: Explore opens a new Scenario with it ended.
	await page.getByRole("link", { name: "See what ending it frees up" }).click();
	await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Without Car insurance");
});
