import { expect, type Page, test } from "@playwright/test";
import { createTestParent } from "./parents";
import { createPlannedHousehold, signedInPage, switchTo } from "./session";

let parent: Awaited<ReturnType<typeof createTestParent>>;

test.beforeEach(async () => {
	parent = await createTestParent();
});

test.afterEach(async () => {
	await parent?.remove();
});

const waterfall = (page: Page) =>
	page.getByRole("region", { name: "From take-home pay to Free to Spend" });
const bills = (page: Page) => page.getByRole("region", { name: /^Bills/ });
const comingUp = (page: Page) => bills(page).getByRole("tabpanel", { name: /^Coming up/ });
/** Switches This Month's Bills to one of its views. */
const billsView = (page: Page, view: RegExp) =>
	bills(page).getByRole("tab", { name: view }).click();
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
	await form.getByLabel("How often").selectOption({ label: "Yearly" });
	await form.getByLabel("Due on").fill(dueDate);
	await form.getByRole("button", { name: "Add Commitment" }).click();
	await expect(page.getByRole("button", { name: `Edit ${name}` })).toBeVisible();
}

test("Commitments show what's coming up, why a month is lumpy, and each one's page", async ({
	browser,
}) => {
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, { baseline: "9,000", buckets: [["Groceries", "1,200"]] });
	await switchTo(page, "Plan");
	await waterfall(page).getByRole("link", { name: "Commitments", exact: true }).click();
	await expect(page.getByRole("heading", { level: 1 })).toContainText("Commitments");
	const month = /\/plan\/(\d{4}-\d{2})\//.exec(page.url())?.[1];
	if (!month) throw new Error(`No month in ${page.url()}`);

	// Due later this month, so within the next 30 days; the other two months from now.
	const [year = 0, m = 0] = month.split("-").map(Number);
	const lastDay = new Date(Date.UTC(year, m, 0)).getUTCDate();
	const day = new Date().getDate() <= 28 ? 28 : lastDay;
	await addYearly(page, "Car insurance", "1,140", `${month}-${day}`);
	await addYearly(page, "Gym", "300", `${addMonths(month, 2)}-10`);
	await expect(page.getByText("All Commitments: $1,440 a year")).toBeVisible();

	await page.getByRole("link", { name: "Back to Plan" }).click();
	await expect(waterfall(page)).toBeVisible();
	await switchTo(page, "Month");
	const name = monthName(month);
	await expect(page.getByRole("note", { name: "Why Free to Spend is lower" })).toHaveText(
		`Car insurance $1,140 is due in ${name}. That’s why ${name}’s Free to Spend is lower.`,
	);
	// Bills shows this month's first; Coming up is the next 30 days.
	await billsView(page, /^Coming up/);
	await expect(
		comingUp(page).getByRole("listitem", { name: /^Car insurance, due .*, \$1,140$/ }),
	).toBeVisible();
	await expect(comingUp(page).getByText("Gym")).toHaveCount(0);

	// Gym isn't due this month: it waits, collapsed, under "Not this month".
	await billsView(page, /^This month/);
	const gym = page.getByRole("link", { name: "Gym", exact: true });
	await expect(gym).toBeHidden();
	await page.getByText("Not this month").click();
	await expect(gym).toBeVisible();

	await billsView(page, /^Coming up/);
	await comingUp(page).getByRole("link", { name: "Car insurance" }).click();
	await expect(page.getByRole("heading", { level: 1 })).toContainText("Car insurance");
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

	// Try ending it: Explore opens a new Scenario with it ended.
	await page.getByRole("link", { name: "See what ending it frees up" }).click();
	await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Without Car insurance");
});
