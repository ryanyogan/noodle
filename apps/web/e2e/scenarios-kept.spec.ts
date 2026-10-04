import { expect, type Page } from "@playwright/test";
import { currentTab, expectSectionHeaderKept, markSectionHeader, sectionTabs } from "./section";
import {
	accountKindLabel,
	choose,
	clientRendered,
	createPlannedHousehold,
	signedInPage,
} from "./session";
import { type SharedParent, test } from "./worker-parent";

let parent: SharedParent;

test.beforeEach(async ({ sharedParent }) => {
	parent = sharedParent;
});

const changes = (page: Page) => page.getByRole("region", { name: "Your changes" });
const confirm = (page: Page) => page.getByRole("alertdialog", { name: "Apply to the Plan" });
const saved = (page: Page, name: string) =>
	page
		.locator("[data-slot=list-row]")
		.filter({ has: page.getByRole("link", { name, exact: true }) });

test("a Scenario opened from a link is kept, applied with a preview, and compared", async ({
	browser,
}) => {
	// Scenarios opened, saved, applied and compared: close to 30 s even run alone.
	test.slow();
	const page = await signedInPage(browser, parent.email);
	// $5,000 − $1,200 − $400: $3,400 Free to Spend a month.
	await createPlannedHousehold(page, {
		baseline: "5,000",
		buckets: [
			["Groceries", "1,200"],
			["Hockey", "400"],
		],
	});
	// A savings Account, for a one-off to be saved for as a Goal.
	await page.getByRole("link", { name: "Accounts", exact: true }).click();
	await page.getByLabel("Name").fill("Ally savings");
	await choose(page, "Kind", accountKindLabel("savings"));
	await page.getByLabel("Balance now").fill("1,000");
	await page.getByRole("button", { name: "Add Account" }).click();
	await expect(page.getByRole("link", { name: /^Ally savings, Savings/ })).toBeVisible();

	// A link opens Explore with the change already made: a raise to $6,000.
	await page.goto("/explore?lever=baseline:600000");
	await expect(page.getByRole("heading", { level: 1 })).toHaveText("Explore", clientRendered);
	// The header is the layout's and is there at once; the page below it is rendered in the browser.
	await expect(changes(page)).toContainText("Income $5,000 → $6,000 a month", clientRendered);

	// A one-off can't be part of the Plan.
	await page.getByRole("button", { name: "Add one-off" }).click();
	const oneOff = page.getByRole("form", { name: "New one-off" });
	await oneOff.getByRole("textbox", { name: "Name" }).fill("New roof");
	await oneOff.getByRole("textbox", { name: "Amount" }).fill("3,000");
	await oneOff.getByRole("textbox", { name: "Amount" }).press("Tab");
	await oneOff.getByRole("button", { name: "Add", exact: true }).click();

	await page.getByLabel("Name", { exact: true }).fill("Raise");
	await page.getByRole("button", { name: "Save Scenario" }).click();
	// Saved, it is the Scenario chosen.
	await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Raise");

	// Apply lists exactly what changes in the Plan, and what it leaves out.
	await page.getByRole("button", { name: "Apply to Plan" }).click();
	await expect(
		confirm(page).getByRole("list", { name: "What changes in the Plan" }).getByRole("listitem"),
	).toHaveText([/^Income \$5,000 → \$6,000 a month from /]);
	const leftOut = confirm(page).getByRole("list", { name: "Not applied" });
	await expect(leftOut).toContainText("New roof");
	// The roof becomes a Goal to save for instead, and the preview says so.
	await leftOut.getByRole("button", { name: "Make it a Goal" }).click();
	await expect(leftOut).toHaveCount(0);
	await expect(
		confirm(page).getByRole("list", { name: "What changes in the Plan" }).getByRole("listitem"),
	).toHaveText([/^Income \$5,000 → \$6,000/, /^New Goal New roof: \$3,000 .*Ally savings/]);
	await confirm(page).getByRole("button", { name: "Apply to Plan" }).click();
	await expect(page.getByRole("status").filter({ hasText: "Raise" })).toContainText(
		"is now the Plan",
	);
	await expect(page.getByText(/· Applied \w+ \d+ by Alex/)).toBeVisible();

	// Another Scenario from a link: a pay cut to $4,500.
	await page.goto("/explore?lever=baseline:450000");
	await expect(changes(page)).toContainText("Income $6,000 → $4,500 a month", clientRendered);
	await page.getByLabel("Name", { exact: true }).fill("Pay cut");
	await page.getByRole("button", { name: "Save Scenario" }).click();
	// Saved, it is the Scenario chosen.
	await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Pay cut");

	// The overview: who made each, and which was applied.
	// Only the page below the tabs changes: the header is the same node.
	await markSectionHeader(page);
	await sectionTabs(page, "Explore pages").getByRole("link", { name: "Scenarios" }).click();
	await expect(currentTab(page, "Explore pages")).toHaveText("Scenarios");
	await expectSectionHeaderKept(page);
	await expect(saved(page, "Raise")).toContainText("Applied");
	await expect(saved(page, "Raise")).toContainText("Made by Alex");
	await expect(saved(page, "Pay cut")).not.toContainText("Applied");
	// $1,500 a month less over 2 years.
	await expect(saved(page, "Pay cut")).toContainText("−$36,000");

	// Compared side by side with the Plan: $4,400 a month ($6,000 − $1,600), less the $3,000 roof.
	await page.getByRole("checkbox", { name: "Compare “Raise”" }).check();
	await page.getByRole("checkbox", { name: "Compare “Pay cut”" }).check();
	const numbers = page.getByRole("table", { name: /^Key numbers/ });
	await expect(numbers.getByRole("columnheader")).toHaveText([
		"Number",
		"Plan",
		"Raise",
		"Pay cut",
	]);
	await expect(numbers.getByRole("row", { name: /^Free to Spend, 2 years/ })).toHaveText(
		/\$102,600\$102,600\$66,600$/,
	);
	await expect(numbers.getByRole("row", { name: /^New roof reached/ })).toBeVisible();
	await expect(page.getByRole("group", { name: "Projected balance" })).toBeVisible();

	// It opens a kept Scenario beside the list, and from there in Explore to carry on with it.
	await saved(page, "Pay cut").getByRole("link", { name: "Pay cut" }).click();
	await expect(page.locator("[data-slot=detail-title]")).toHaveText("Pay cut");
	await expect(page).toHaveURL(/\/explore\/scenarios\/[0-9A-Z]{26}\?compare=/);
	await page.getByRole("link", { name: "Open in Explore" }).click();
	await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Pay cut");

	// On a phone the overview fits the screen.
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto("/explore/scenarios?compare=");
	await expect(currentTab(page, "Explore pages")).toHaveText("Scenarios", clientRendered);
	expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test("a kept Scenario still names a Bucket archived since, marked archived", async ({
	browser,
}) => {
	test.slow();
	const page = await signedInPage(browser, parent.email);
	await page.setViewportSize({ width: 1440, height: 900 });
	await createPlannedHousehold(page, {
		baseline: "5,000",
		buckets: [
			["Groceries", "1,200"],
			["Hockey", "400"],
		],
	});

	// Hockey's page, for its id.
	await page.goto("/plan");
	await page
		.getByRole("navigation", { name: "Plan pages" })
		.getByRole("link", { name: "Buckets", exact: true })
		.click();
	await page.getByRole("link", { name: "Hockey", exact: true }).click();
	await expect(page.locator("[data-slot=detail-header]")).toContainText("Hockey");
	const bucketPage = page.url();
	const bucketId = new URL(bucketPage).pathname.split("/").pop();

	// A Scenario that cuts Hockey to $250 a month, kept.
	await page.goto(`/explore?lever=allowance:${bucketId}:25000`);
	await expect(changes(page)).toContainText("Hockey", clientRendered);
	await page.getByLabel("Name", { exact: true }).fill("Less hockey");
	await page.getByRole("button", { name: "Save Scenario" }).click();
	await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Less hockey");

	// Hockey is archived.
	await page.goto(bucketPage);
	await page.getByRole("button", { name: "Edit", exact: true }).click();
	await page
		.getByRole("dialog", { name: "Hockey" })
		.getByRole("button", { name: "Archive", exact: true })
		.click();
	await page.getByRole("alertdialog").getByRole("button", { name: "Archive Hockey" }).click();
	await expect(page.locator("[data-slot=detail-header]")).toContainText("Archived Bucket");

	// The kept Scenario still says which Bucket it changed.
	await page.goto("/explore/scenarios");
	await saved(page, "Less hockey").getByRole("link", { name: "Less hockey" }).click();
	await expect(page.locator("[data-slot=detail-title]")).toHaveText("Less hockey");
	await expect(page.getByText(/Hockey \(archived\)/).first()).toBeVisible();
	if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT, fullPage: true });

	// Opened in Explore, the Change reads the same.
	await page.getByRole("link", { name: "Open in Explore" }).click();
	await expect(changes(page)).toContainText("Hockey (archived)", clientRendered);
});
