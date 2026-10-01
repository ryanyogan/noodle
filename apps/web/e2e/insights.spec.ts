import { expect, type Page, test } from "@playwright/test";
import { createTestParent } from "./parents";
import { createPlannedHousehold, signedInPage, switchTo } from "./session";

// Insights run with their deterministic fake model here (AI_MODEL=stub in playwright.config.ts):
// it groups Disney+ and Hulu as one service family and adds "(stub)" to each title it words.

let parent: Awaited<ReturnType<typeof createTestParent>>;

test.beforeEach(async () => {
	parent = await createTestParent();
});

test.afterEach(async () => {
	await parent?.remove();
});

const waterfall = (page: Page) =>
	page.getByRole("region", { name: "From take-home pay to Free to Spend" });
const commitmentRow = (page: Page, name: string) =>
	page.getByRole("listitem", {
		name: new RegExp(`^${name.replace(/[+.]/g, "\\$&")}: `),
	});

async function addCommitment(page: Page, name: string, due: string) {
	const form = page.getByRole("form", { name: "Add a Commitment" });
	await form.getByLabel("New Commitment").fill(name);
	await form.getByLabel("Amount due").fill(due);
	await form.getByRole("button", { name: "Add Commitment" }).click();
	await expect(page.getByRole("button", { name: `Edit ${name}` })).toBeVisible();
}

async function recordPayment(page: Page, name: string) {
	const row = commitmentRow(page, name);
	await row.getByRole("button", { name: "Record payment" }).click();
	await row.getByRole("button", { name: "Record", exact: true }).click();
	await expect(row).toContainText("Paid");
}

test("an Overlap between two streaming Commitments is found, accepted, and dismissed for good", async ({
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

	await page.goto("/insights");
	await expect(page.getByText("No Insights right now")).toBeVisible();
	await page.getByRole("button", { name: "Look for Insights now" }).click();
	await expect(page.getByText("Found 1 new Insight.")).toBeVisible();

	// Worded by the model; the figure is the cheaper service's year, from domain code.
	const card = page.getByRole("article", { name: "Disney+ and Hulu may overlap (stub)" });
	await expect(card).toContainText("Overlap");
	await expect(card).toContainText("$167.88");
	await expect(card).toContainText("a year");

	// What it rests on: both Commitments and both charges, linked.
	await card.getByText("What it’s based on").click();
	await expect(card.getByRole("link", { name: "Disney+" })).toHaveAttribute(
		"href",
		/\/plan\/commitments\//,
	);
	await expect(card.getByRole("link", { name: "Hulu" })).toBeVisible();
	await expect(card.getByRole("listitem")).toHaveCount(4);
	await expect(card).toContainText("$13.99");
	await expect(card).toContainText("$17.99");

	// This Month points to it while it's new.
	await page.goto("/month");
	await page.getByRole("link", { name: "1 new Insight" }).click();
	await expect(card).toBeVisible();

	// Accepting records it and offers to end one, never ending anything by itself.
	await card.getByRole("button", { name: "Accept" }).click();
	await expect(card).toContainText("Accepted");
	await expect(card.getByRole("button", { name: "Try “Without Hulu”" })).toBeVisible();
	await card.getByRole("button", { name: "End Hulu…" }).click();
	await page
		.getByRole("alertdialog")
		.getByRole("button", { name: "End Hulu", exact: true })
		.click();
	await expect(page.getByText(/^Hulu leaves the Plan from/)).toBeVisible();
	await expect(card.getByRole("button", { name: "End Hulu…" })).toHaveCount(0);
	await expect(card.getByRole("button", { name: "End Disney+…" })).toBeVisible();

	// Dismissed, it's gone, and looking again doesn't bring it back.
	await card.getByRole("button", { name: "Dismiss" }).click();
	await expect(card).toHaveCount(0);
	await expect(page.getByText("No Insights right now")).toBeVisible();
	await page.getByRole("button", { name: "Look for Insights now" }).click();
	await expect(page.getByText("Nothing new.")).toBeVisible();
	await page.reload();
	await expect(page.getByText("No Insights right now")).toBeVisible();
	await page.context().close();
});
