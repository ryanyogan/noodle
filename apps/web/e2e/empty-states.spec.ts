import { expect, test } from "@playwright/test";
import { createTestParent } from "./parents";
import { currentTab } from "./section";
import { clientRendered, createHousehold, signedInPage } from "./session";

// A Household made a minute ago, with nothing planned: every page says what it's for and where
// to start, instead of a table of zeros or verdicts worked out from nothing (docs/seed-data.md,
// "Pages without a proper empty state in fresh").

let parent: Awaited<ReturnType<typeof createTestParent>>;

test.beforeEach(async () => {
	parent = await createTestParent();
});

test.afterEach(async () => {
	await parent?.remove();
});

test("a new Household's pages say where to start", async ({ browser }) => {
	const page = await signedInPage(browser, parent.email);
	await createHousehold(page, "The Rinks", "Alex");
	const month = /\/month\/(\d{4}-\d{2})/.exec(page.url())?.[1];
	if (!month) throw new Error(`No month in ${page.url()}`);

	// This Month: nothing before the Household to go back to.
	await expect(page.getByRole("button", { name: "Previous month" })).toBeDisabled();

	// Plan › Goals: none yet, and an Account comes first.
	await page.goto(`/plan/${month}/goals`);
	await expect(page.getByText("No Goals yet")).toBeVisible();
	await expect(page.getByRole("link", { name: "Add an Account first" })).toHaveAttribute(
		"href",
		"/accounts",
	);

	// The Plan: setting up comes first, not a waterfall of zeros; its Goals step leads somewhere.
	await page.goto(`/plan/${month}`);
	const waterfall = page.getByRole("region", { name: "Where take-home pay goes" });
	await expect(page.getByRole("region", { name: "Set up the Plan" })).toBeVisible();
	await expect(waterfall).toHaveCount(0);
	await expect(page.getByRole("region", { name: "What changed" })).toHaveCount(0);
	await expect(page.getByRole("link", { name: "Add an Account first" })).toHaveAttribute(
		"href",
		"/accounts",
	);

	// The year: an empty state, not a table of "Not set".
	await page.goto(`/plan/year/${month.slice(0, 4)}`);
	await expect(
		page.getByText(`Your ${month.slice(0, 4)} appears once the Plan is set up`),
	).toBeVisible();
	await expect(page.getByRole("table")).toHaveCount(0);
	await expect(page.getByRole("link", { name: "Set up the Plan" })).toBeVisible();

	// Reports: they fill in once there's spending, with where to start; nothing to export.
	await page.goto("/reports");
	await expect(page.getByText("Reports fill in once you have Transactions")).toBeVisible(
		clientRendered,
	);
	await expect(page.getByRole("link", { name: "Quick Add" }).last()).toBeVisible();
	await expect(page.getByRole("button", { name: "Export CSV" })).toBeDisabled();
	await expect(page.getByLabel("Period")).toHaveCount(0);

	// Explore: what it's for, and that a Plan comes first.
	await page.goto("/explore");
	await expect(page.getByText("Explore tries changes on your Plan")).toBeVisible(clientRendered);
	await expect(page.getByRole("link", { name: "Set up the Plan" })).toBeVisible();

	// Can we afford it?: the costs, but no verdict worked out from zeros.
	await page.getByRole("link", { name: "Can we afford it?" }).click();
	await expect(currentTab(page, "Explore pages")).toHaveText("Can we afford it?");
	const verdict = page.getByTestId("affordability-verdict");
	await expect(verdict.getByRole("heading", { level: 2 })).toHaveText("Can’t check yet");
	await expect(verdict).not.toContainText("Not yet");
	await expect(verdict.getByRole("row", { name: /^Housing/ })).toBeVisible();
	await expect(page.getByRole("note")).toContainText("Set up the Plan first");

	// Check-in: what it is, even with nothing to do.
	await page.goto("/check-in");
	await expect(page.getByText(/Once a week, the Check-in takes a few minutes/)).toBeVisible();

	// Setting take-home pay inline says where to change it later, and the Plan fills in.
	await page.goto(`/plan/${month}`);
	await page.getByRole("textbox", { name: "Take-home pay" }).fill("5,000");
	await page.getByRole("button", { name: "Set take-home pay" }).click();
	await expect(page.getByText(/Change it any time on Income/)).toBeVisible();
	await expect(waterfall).toBeVisible();
	await expect(page.getByRole("navigation", { name: "Plan pages" })).toBeVisible();
	await page.context().close();
});
