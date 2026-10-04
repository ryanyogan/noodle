import { expect, type Page, test } from "@playwright/test";
import { createTestParent } from "./parents";
import { currentTab, sectionTabs } from "./section";
import { clientRendered, createPlannedHousehold, signedInPage } from "./session";

// A section's tabs on the page of one of its items (#73, #74): the tab the item sits beneath is
// the current one, and it is the only one. A Bucket's page is checked in master-detail.spec.ts;
// here a Commitment's, a kept Scenario's and a Rule's. At desktop width: on a phone an open item
// has its own header and the section's tabs aren't shown.

let parent: Awaited<ReturnType<typeof createTestParent>>;

test.beforeEach(async () => {
	parent = await createTestParent();
});

test.afterEach(async () => {
	await parent?.remove();
});

/** Exactly one tab of the section's `<nav>` is marked current, and it is `label`. */
async function expectOneCurrentTab(page: Page, nav: string, label: RegExp) {
	await expect(sectionTabs(page, nav)).toBeVisible(clientRendered);
	await expect(currentTab(page, nav)).toHaveCount(1);
	await expect(currentTab(page, nav)).toHaveText(label);
	// No tab is marked current in some other way ("true", "location") beside it.
	await expect(sectionTabs(page, nav).locator("[aria-current]")).toHaveCount(1);
}

test("one tab is current on a Commitment's, a Rule's and a kept Scenario's page", async ({
	browser,
}) => {
	test.slow();
	const page = await signedInPage(browser, parent.email, {
		viewport: { width: 1440, height: 900 },
	});
	const created = await createPlannedHousehold(page, {
		baseline: "5,000",
		buckets: [
			["Groceries", "1,200"],
			["Hockey", "400"],
		],
		commitments: [{ name: "Daycare", amountCents: 90_000, cadence: "monthly", dueDay: 5 }],
		rules: [{ pattern: "Costco", bucket: "Groceries" }],
	});
	if (!created) throw new Error("The Household wasn't made through /api/dev/household");

	// A Commitment's page: Commitments, not Overview (the page the others sit beneath).
	const commitmentId = created.commitmentIds.Daycare;
	expect(commitmentId, "Daycare's id").toBeTruthy();
	await page.goto(`/plan/${created.month}/commitments/${commitmentId}`);
	await expect(page).toHaveURL(new RegExp(`/plan/${created.month}/commitments/${commitmentId}$`));
	await expectOneCurrentTab(page, "Plan pages", /^Commitments/);

	// A Rule's page: Rules, not Review.
	await page.goto("/review/rules");
	await page.getByRole("link", { name: /^Costco, Groceries/i }).click();
	await expect(page).toHaveURL(/\/review\/rules\/[^/?#]+/);
	await expectOneCurrentTab(page, "Review pages", /^Rules/);

	// A kept Scenario's page: Scenarios, not Explore.
	await page.goto("/explore?lever=baseline:450000");
	await expect(page.getByRole("region", { name: "Your changes" })).toContainText(
		"Income",
		clientRendered,
	);
	await page.getByLabel("Name", { exact: true }).fill("Pay cut");
	await page.getByRole("button", { name: "Save Scenario" }).click();
	await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Pay cut");
	await page.goto("/explore/scenarios");
	const kept = page.getByRole("link", { name: "Pay cut", exact: true }).first();
	await expect(kept).toBeVisible(clientRendered);
	await kept.click();
	await expect(page).toHaveURL(/\/explore\/scenarios\/[^/?#]+/);
	await expectOneCurrentTab(page, "Explore pages", /^Scenarios/);
	await page.context().close();
});
