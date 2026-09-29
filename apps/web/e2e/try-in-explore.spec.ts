import { expect, type Page, test } from "@playwright/test";
import { createTestParent } from "./parents";
import { createPlannedHousehold, signedInPage, switchTo } from "./session";

// "Try in Explore" from Insights and Ask, with their deterministic fake models (AI_MODEL=stub):
// each saves a Scenario with the change it suggests and opens it, and the Plan stays as it was
// until a Parent applies one.

let parent: Awaited<ReturnType<typeof createTestParent>>;

test.beforeEach(async () => {
	parent = await createTestParent();
});

test.afterEach(async () => {
	await parent?.remove();
});

const waterfall = (page: Page) => page.getByRole("region", { name: "Baseline to Free to Spend" });
const changes = (page: Page) => page.getByRole("region", { name: "Your changes" });
const scenarioName = (page: Page) => page.getByLabel("Name", { exact: true });
const saved = (page: Page, name: string) =>
	page.getByRole("listitem").filter({ has: page.getByRole("link", { name, exact: true }) });

async function addCommitment(page: Page, name: string, due: string) {
	const form = page.getByRole("form", { name: "Add a Commitment" });
	await form.getByLabel("New Commitment").fill(name);
	await form.getByLabel("Amount due").fill(due);
	await form.getByRole("button", { name: "Add Commitment" }).click();
	await expect(page.getByRole("button", { name: `Edit ${name}` })).toBeVisible();
}

async function recordPayment(page: Page, name: string) {
	const row = page.getByRole("listitem", {
		name: new RegExp(`^${name.replace(/[+.]/g, "\\$&")}: `),
	});
	await row.getByRole("button", { name: "Record payment" }).click();
	await row.getByRole("button", { name: "Record", exact: true }).click();
	await expect(row).toContainText("Paid");
}

test("an Insight and an Ask answer open as Scenarios in Explore, leaving the Plan as it was", async ({
	browser,
}) => {
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, { baseline: "9,000", buckets: [["Groceries", "1,200"]] });
	await switchTo(page, "Plan");
	await waterfall(page).getByRole("link", { name: "Commitments", exact: true }).click();
	await addCommitment(page, "Disney+", "13.99");
	await addCommitment(page, "Hulu", "17.99");
	await page.getByRole("link", { name: "Back to Plan" }).click();
	await switchTo(page, "Month");
	await recordPayment(page, "Disney+");
	await recordPayment(page, "Hulu");
	await switchTo(page, "Plan");
	const planBefore = (await waterfall(page).textContent()) ?? "";

	// An Overlap offers ending either Commitment as a Scenario, before it's even accepted.
	await page.goto("/insights");
	await page.getByRole("button", { name: "Look for Insights now" }).click();
	const card = page.getByRole("article", { name: "Disney+ and Hulu may overlap (stub)" });
	await expect(card.getByRole("button", { name: "Try “Without Disney+”" })).toBeVisible();
	await card.getByRole("button", { name: "Try “Without Hulu”" }).click();
	await expect(page).toHaveURL(/\/explore\?scenario=/);
	await expect(scenarioName(page)).toHaveValue("Without Hulu");
	await expect(changes(page)).toContainText("Hulu");

	// Back without applying: the Insight is as it was, and the Scenario is kept.
	await page.goBack();
	await expect(card).toBeVisible();
	await expect(card.getByRole("button", { name: "Accept" })).toBeVisible();
	await page.goto("/explore/scenarios");
	await expect(saved(page, "Without Hulu")).toBeVisible();

	// Ask offers the change it projected, built from its tool, not from the model's words.
	await page.getByRole("link", { name: "Ask", exact: true }).click();
	await page.getByLabel("Question").fill("What if we cancel Disney+?");
	await page.getByLabel("Question").press("Enter");
	await expect(
		page.getByText(/^Ending Disney\+ frees \$[\d,.]+ over the next 12 months\./),
	).toBeVisible();
	await page.getByRole("button", { name: "Try in Explore" }).click();
	await expect(page).toHaveURL(/\/explore\?scenario=/);
	await expect(scenarioName(page)).toHaveValue("Without Disney+");
	await expect(changes(page)).toContainText("Disney+");
	await page.goBack();
	await expect(page.getByRole("heading", { level: 1 })).toHaveText("Ask");

	// Neither Scenario was applied: the Plan and its Commitments are as they were.
	await page.goto("/plan");
	await expect(waterfall(page)).toHaveText(planBefore);
	await waterfall(page).getByRole("link", { name: "Commitments", exact: true }).click();
	await expect(page.getByRole("button", { name: "Edit Disney+" })).toBeVisible();
	await expect(page.getByRole("button", { name: "Edit Hulu" })).toBeVisible();
	await page.context().close();
});
