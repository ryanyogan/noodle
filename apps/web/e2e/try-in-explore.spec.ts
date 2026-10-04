import { expect, type Page, test } from "@playwright/test";
import { createTestParent } from "./parents";
import { expectSectionHeaderKept, markSectionHeader, sectionTabs } from "./section";
import {
	clientRendered,
	createPlannedHousehold,
	serverFn,
	signedInPage,
	switchTo,
} from "./session";

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

const waterfall = (page: Page) =>
	page.getByRole("region", { name: "From take-home pay to Free to Spend" });
const changes = (page: Page) => page.getByRole("region", { name: "Your changes" });
const scenarioName = (page: Page) => page.getByLabel("Name", { exact: true });
const saved = (page: Page, name: string) =>
	page
		.locator("[data-slot=list-row]")
		.filter({ has: page.getByRole("link", { name, exact: true }) });

/**
 * Makes the next Scenario save land after Explore has read the Scenarios without it, but before
 * Explore shows: the list is read first, the save's answer arrives, then the list's.
 */
async function saveLandsBeforeExploreShows(page: Page) {
	let listRead = () => {};
	const listReadBefore = new Promise<void>((resolve) => {
		listRead = resolve;
	});
	const saveAnswered = page.waitForResponse((r) => serverFn("saveScenario")(new URL(r.url())));
	await page.route(serverFn("saveScenario"), async (route) => {
		await listReadBefore;
		await route.continue();
	});
	await page.route(serverFn("getScenarios"), async (route) => {
		const response = await route.fetch();
		listRead();
		await saveAnswered;
		// Long enough for the save to settle in the page before the list arrives.
		await page.waitForTimeout(300);
		await route.fulfill({ response });
	});
	return async () => {
		await page.unroute(serverFn("saveScenario"));
		await page.unroute(serverFn("getScenarios"));
	};
}

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
	// Two Commitments paid, Insights looked for, and Ask asked: close to 30 s even run alone.
	test.slow();
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, { baseline: "9,000", buckets: [["Groceries", "1,200"]] });
	await switchTo(page, "Plan");
	await page
		.getByRole("navigation", { name: "Plan pages" })
		.getByRole("link", { name: "Commitments", exact: true })
		.click();
	await addCommitment(page, "Disney+", "13.99");
	await addCommitment(page, "Hulu", "17.99");
	await page
		.getByRole("navigation", { name: "Plan pages" })
		.getByRole("link", { name: "Overview" })
		.click();
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
	// It opens even when its save lands between Explore reading the Scenarios and showing.
	const unroute = await saveLandsBeforeExploreShows(page);
	await card.getByRole("button", { name: "Try “Without Hulu”" }).click();
	await expect(page).toHaveURL(/\/explore\?scenario=/);
	await expect(scenarioName(page)).toHaveValue("Without Hulu");
	await unroute();
	await expect(changes(page)).toContainText("Hulu");

	// Back without applying: the Insight is as it was, and the Scenario is kept.
	await page.goBack();
	await expect(card).toBeVisible();
	await expect(card.getByRole("button", { name: "Got it" })).toBeVisible();
	await page.goto("/explore/scenarios");
	await expect(saved(page, "Without Hulu")).toBeVisible(clientRendered);
	// From the saved Scenarios back to Explore by its tab: the header is the same node.
	await markSectionHeader(page);
	await sectionTabs(page, "Explore pages")
		.getByRole("link", { name: "Explore", exact: true })
		.click();
	await expect(page).toHaveURL(/\/explore$/);
	await expectSectionHeaderKept(page);

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
	await page
		.getByRole("navigation", { name: "Plan pages" })
		.getByRole("link", { name: "Commitments", exact: true })
		.click();
	await expect(page.getByRole("button", { name: "Edit Disney+" })).toBeVisible();
	await expect(page.getByRole("button", { name: "Edit Hulu" })).toBeVisible();
	await page.context().close();
});

test("a link to a Scenario that doesn't exist opens a new one, reading the Scenarios again once", async ({
	browser,
}) => {
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, { baseline: "9,000", buckets: [["Groceries", "1,200"]] });
	let reads = 0;
	page.on("request", (request) => {
		if (serverFn("getScenarios")(new URL(request.url()))) reads++;
	});
	await page.goto("/explore?scenario=01J0000000000000000000GONE");
	await expect(scenarioName(page)).toHaveValue("Scenario 1", clientRendered);
	// Settled: the page read the list for it once more at most, and doesn't keep asking.
	await page.waitForTimeout(1500);
	const settled = reads;
	expect(settled).toBeLessThanOrEqual(2);
	await page.waitForTimeout(1500);
	expect(reads).toBe(settled);
	await expect(scenarioName(page)).toHaveValue("Scenario 1");
	await page.context().close();
});
