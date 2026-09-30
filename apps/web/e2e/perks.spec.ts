import { expect, type Page, test } from "@playwright/test";
import { createTestParent } from "./parents";
import { createPlannedHousehold, signedInPage, switchTo } from "./session";

// Perk research runs inline with its fakes here (AI_MODEL=stub in playwright.config.ts): any
// t-mobile.com page is a phone plan's whose Perks depend on the plan (Netflix with Go5G and Go5G
// Plus, Hulu with Go5G Plus), a link with "missing" in it can't be found, and any other page is a
// card's (a TSA PreCheck credit, DashPass). The fake model also "remembers" Apple TV+, which the
// page doesn't say: it must never show.

let parent: Awaited<ReturnType<typeof createTestParent>>;

test.beforeEach(async () => {
	parent = await createTestParent();
});

test.afterEach(async () => {
	await parent?.remove();
});

const waterfall = (page: Page) => page.getByRole("region", { name: "Baseline to Free to Spend" });
const sourceCard = (page: Page, name: string) => page.getByRole("article", { name });

async function addCommitment(page: Page, name: string, due: string) {
	const form = page.getByRole("form", { name: "Add a Commitment" });
	await form.getByLabel("New Commitment").fill(name);
	await form.getByLabel("Amount due").fill(due);
	await form.getByRole("button", { name: "Add Commitment" }).click();
	await expect(page.getByRole("button", { name: `Edit ${name}` })).toBeVisible();
}

test("a phone plan among the Commitments is confirmed, asks for its plan, and finds a Perk Overlap", async ({
	browser,
}) => {
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, { baseline: "9,000", buckets: [["Groceries", "1,200"]] });
	await switchTo(page, "Plan");
	await waterfall(page).getByRole("link", { name: "Commitments", exact: true }).click();
	await addCommitment(page, "T-Mobile", "140");
	await addCommitment(page, "Netflix", "17.99");

	// The nightly look spots T-Mobile; Insights point to it.
	await page.goto("/insights");
	await page.getByRole("button", { name: "Look for Insights now" }).click();
	await expect(page.getByText("Nothing new.")).toBeVisible();
	await page.getByRole("link", { name: /1 Perk Source to confirm/ }).click();
	await expect(page).toHaveURL(/\/perks$/);

	const suggestion = page.getByRole("listitem", { name: "T-Mobile" });
	await expect(suggestion).toContainText("Phone plan");
	await expect(suggestion).toContainText("Seen in “T-Mobile”");
	await suggestion.getByRole("button", { name: "Confirm" }).click();

	// Its Perks depend on the plan: it asks rather than guessing.
	const card = sourceCard(page, "T-Mobile");
	await expect(card).toContainText("Which plan is it?");
	await expect(card.getByRole("listitem")).toHaveCount(0);
	await card.getByLabel("Plan").selectOption("Go5G Plus");
	await card.getByRole("button", { name: "Save" }).click();

	// Only what the page says, each linked to it with the day it was read.
	const perks = card.getByRole("list", { name: "T-Mobile Perks" });
	await expect(perks.getByRole("listitem")).toHaveCount(2);
	await expect(perks).toContainText("Netflix Standard with ads");
	await expect(perks).toContainText("Hulu (With Ads)");
	await expect(perks).not.toContainText("Apple TV+");
	await expect(perks.getByRole("link", { name: "Source" }).first()).toHaveAttribute(
		"href",
		"https://www.t-mobile.com/cell-phone-plans",
	);
	await expect(perks).toContainText("Checked");
	await expect(card).toContainText("Go5G Plus");

	// Netflix, paid for, is included: a Perk Overlap, with its figure from the Commitment.
	await page.getByRole("link", { name: "Insights" }).click();
	const overlap = page.getByRole("article", { name: "Netflix may come with T-Mobile (stub)" });
	await expect(overlap).toContainText("Overlap");
	await expect(overlap).toContainText("$215.88");
	await expect(overlap).toContainText("a year");
	await overlap.getByText("What it’s based on").click();
	await expect(overlap.getByRole("link", { name: "Netflix Standard with ads" })).toHaveAttribute(
		"href",
		"https://www.t-mobile.com/cell-phone-plans",
	);
	await expect(overlap).toContainText("Perk of T-Mobile");
});

test("a card added by hand covers a cost already paid; a page that can't be read asks for a link", async ({
	browser,
}) => {
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, { baseline: "9,000", buckets: [["Groceries", "1,200"]] });
	await page.getByRole("link", { name: "Quick Add" }).click();
	const sheet = page.getByRole("dialog", { name: "Quick Add" });
	await page.keyboard.type("78");
	await sheet.getByLabel("Note").fill("TSA PreCheck");
	await sheet.getByRole("button", { name: /^Groceries/ }).click();
	await expect(sheet).toBeHidden();

	await page.goto("/perks");
	await expect(page.getByText("No Perk Sources yet")).toBeVisible();
	const add = page.getByRole("region", { name: "Add a Perk Source" });
	await add.getByLabel("Name").fill("Chase Sapphire");
	await add.getByLabel("Kind").selectOption("Credit card");
	await add.getByRole("button", { name: "Add" }).click();

	// The catalog knows its page; its Perks are the same whichever card.
	const card = sourceCard(page, "Chase Sapphire");
	const perks = card.getByRole("list", { name: "Chase Sapphire Perks" });
	await expect(perks.getByRole("listitem")).toHaveCount(2);
	await expect(perks).toContainText("TSA PreCheck or Global Entry fee credit");
	await expect(perks).toContainText("Covered cost");

	// A card Noodle doesn't know, with a page that can't be found.
	await add.getByLabel("Name").fill("Credit union card");
	await add.getByLabel("Benefits page (optional)").fill("https://example.com/missing");
	await add.getByRole("button", { name: "Add" }).click();
	const union = sourceCard(page, "Credit union card");
	await expect(union).toContainText("Couldn’t read its benefits page.");
	await union.getByLabel("Benefits page").fill("https://example.com/benefits");
	await union.getByRole("button", { name: "Read it" }).click();
	await expect(union.getByRole("list", { name: "Credit union card Perks" })).toContainText(
		"DashPass",
	);

	// The TSA PreCheck fee, paid already: an Overlap, once.
	await page.goto("/insights");
	const overlap = page.getByRole("article", {
		name: "Chase Sapphire may cover TSA PreCheck (stub)",
	});
	await expect(overlap).toContainText("$78");
	await expect(overlap).toContainText("once");
	await expect(overlap.getByRole("button", { name: /Try/ })).toHaveCount(0);

	// Removing the card takes its Perks and the Overlap resting on them.
	await page.goto("/perks");
	await card.getByRole("button", { name: "Remove" }).click();
	await page
		.getByRole("alertdialog")
		.getByRole("button", { name: "Remove Chase Sapphire" })
		.click();
	await expect(card).toHaveCount(0);
	await page.goto("/insights");
	await expect(overlap).toHaveCount(0);
});
