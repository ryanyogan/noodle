import { expect, type Page, test } from "@playwright/test";
import { createTestParent } from "./parents";
import { expectSectionHeaderKept, markSectionHeader } from "./section";
import {
	choose,
	createPlannedHousehold,
	moreItem,
	openFromMore,
	openMore,
	pickQuickAddBucket,
	signedInPage,
	switchTo,
} from "./session";

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

const sourceCard = (page: Page, name: string) => page.getByRole("article", { name });

/** Opens a Perk Source's row (one is open at a time) and returns its card. */
async function openSource(page: Page, name: string) {
	const card = sourceCard(page, name);
	const row = card.locator("h3").getByRole("button");
	await expect(row).toBeEnabled();
	if ((await row.getAttribute("aria-expanded")) !== "true") await row.click();
	await expect(row).toHaveAttribute("aria-expanded", "true");
	return card;
}

/** Adds a card or membership by name from the page's one button, with its benefits page if given. */
async function addSource(page: Page, name: string, pageUrl?: string) {
	await page.getByRole("button", { name: "Add a card or membership" }).click();
	const sheet = page.getByRole("dialog", { name: "Add a card or membership" });
	await sheet.getByLabel("Card or membership").fill(name);
	if (pageUrl) {
		await sheet.getByRole("button", { name: "I have a link to its benefits page" }).click();
		await sheet.getByLabel("Benefits page (optional)").fill(pageUrl);
	}
	await sheet.getByRole("button", { name: "Add and read its perks" }).click();
	await expect(sheet).toBeHidden();
	return openSource(page, name);
}

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
	test.slow();
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, { baseline: "9,000", buckets: [["Groceries", "1,200"]] });
	await switchTo(page, "Plan");
	await page
		.getByRole("navigation", { name: "Plan pages" })
		.getByRole("link", { name: "Commitments", exact: true })
		.click();
	await addCommitment(page, "T-Mobile", "140");
	await addCommitment(page, "Netflix", "17.99");

	// The nightly look spots T-Mobile; Insights point to it.
	await page.goto("/insights");
	await page.getByRole("button", { name: "Look for Insights now" }).click();
	await expect(page.getByText("Nothing new.")).toBeVisible();
	const tabs = page.getByRole("navigation", { name: "Insights pages" });
	await expect(tabs.getByRole("link", { name: /^Perks/ })).toContainText("1 to confirm");
	// Going to the tab changes only what's below the tabs: the header is the same node.
	await markSectionHeader(page);
	await tabs.getByRole("link", { name: /^Perks/ }).click();
	await expect(page).toHaveURL(/\/insights\/perks$/);
	await expectSectionHeaderKept(page);
	await expect(tabs.getByRole("link", { name: /^Perks/ })).toHaveAttribute("aria-current", "page");

	const suggestion = page.getByRole("listitem", { name: "T-Mobile" });
	await expect(suggestion).toContainText("Phone plan");
	await expect(suggestion).toContainText("Seen in “T-Mobile”");
	await suggestion.getByRole("button", { name: "Confirm" }).click();
	// It says where it went, and focus lands there rather than on the page's body.
	await expect(page.getByText("T-Mobile added to Perk Sources")).toBeVisible();
	await expect(page.getByRole("heading", { name: /^Perk Sources/ })).toBeFocused();

	// Its Perks depend on the plan: it asks rather than guessing.
	const card = await openSource(page, "T-Mobile");
	await expect(card).toContainText("Which plan is it?");
	await expect(card.getByRole("listitem")).toHaveCount(0);
	await choose(card, "Plan", "Go5G Plus");
	await card.getByRole("button", { name: "Save" }).click();

	// Only what the page says, each linked to it with the day it was read.
	const perks = card.getByRole("list", { name: "T-Mobile Perks" });
	await expect(perks.getByRole("listitem")).toHaveCount(2);
	await expect(perks).toContainText("Netflix Standard with ads");
	await expect(perks).toContainText("Hulu (With Ads)");
	await expect(perks).not.toContainText("Apple TV+");
	// Where each comes from is behind its own button.
	await perks
		.getByRole("button", { name: /^Where .+ comes from$/ })
		.first()
		.click();
	await expect(perks.getByRole("link", { name: "Source" }).first()).toHaveAttribute(
		"href",
		"https://www.t-mobile.com/cell-phone-plans",
	);
	await expect(perks).toContainText("Checked");
	await expect(card).toContainText("Go5G Plus");

	// Netflix, paid for, is included: a Perk Overlap, with its figure from the Commitment.
	await tabs.getByRole("link", { name: "Insights" }).click();
	const overlap = page.getByRole("article", { name: "Netflix may come with T-Mobile (stub)" });
	await expect(overlap).toContainText("Overlap");
	await expect(overlap).toContainText("$216");
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
	await pickQuickAddBucket(sheet, "Groceries");
	await expect(sheet).toBeHidden();

	// The old address still works: Perks moved under Insights.
	await page.goto("/perks");
	await expect(page).toHaveURL(/\/insights\/perks$/);
	await expect(page.getByText("No Perk Sources yet")).toBeVisible();
	// The catalog knows its page; its Perks are the same whichever card.
	const card = await addSource(page, "Chase Sapphire");
	const perks = card.getByRole("list", { name: "Chase Sapphire Perks" });
	await expect(perks.getByRole("listitem")).toHaveCount(2);
	await expect(perks).toContainText("TSA PreCheck or Global Entry fee credit");
	await perks
		.getByRole("button", { name: "Where TSA PreCheck or Global Entry fee credit comes from" })
		.click();
	await expect(perks).toContainText("A cost it pays for");

	// A card Noodle doesn't know, with a page that can't be found.
	const union = await addSource(page, "Credit union card", "https://example.com/missing");
	await expect(union.locator("h3")).toContainText("Couldn’t read");
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
	await openSource(page, "Chase Sapphire");
	await card.getByRole("button", { name: "Remove" }).click();
	await page
		.getByRole("alertdialog")
		.getByRole("button", { name: "Remove Chase Sapphire" })
		.click();
	await expect(card).toHaveCount(0);
	await page.goto("/insights");
	await expect(overlap).toHaveCount(0);
});

test("Phones reach Insights and Credit card perks from More in the tab bar", {
	tag: "@phone",
}, async ({ browser }) => {
	const page = await signedInPage(browser, parent.email, {
		viewport: { width: 393, height: 852 },
		isMobile: true,
		hasTouch: true,
	});
	await createPlannedHousehold(page, { baseline: "9,000", buckets: [["Groceries", "1,200"]] });
	await openFromMore(page, "Insights");
	await expect(page).toHaveURL(/\/insights$/);
	await expect(page.getByRole("heading", { level: 1 })).toHaveText("Insights");

	// More is marked while the page is one of its own, and the sheet marks the page.
	const more = page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "More" });
	await expect(more).toHaveAttribute("aria-current", "true");
	const sheet = await openMore(page);
	await expect(moreItem(sheet, "Insights")).toHaveAttribute("aria-current", "page");
	await moreItem(sheet, "Credit card perks").click();
	await expect(page).toHaveURL(/\/insights\/perks$/);
	await expect(page.getByText("No Perk Sources yet")).toBeVisible();
	await page.context().close();
});

test("the Sidebar has Credit card perks of its own, beside Insights", async ({ browser }) => {
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, { baseline: "9,000", buckets: [["Groceries", "1,200"]] });
	const nav = page.getByRole("navigation", { name: "Main" });
	await expect(nav.getByRole("group", { name: "Understand" }).getByRole("link")).toHaveText([
		"Reports",
		"Insights",
		"Credit card perks",
		"Ask",
	]);
	await nav.getByRole("link", { name: "Credit card perks" }).click();
	await expect(page).toHaveURL(/\/insights\/perks$/);
	await expect(page.getByText("No Perk Sources yet")).toBeVisible();
	await expect(nav.locator("[aria-current=page]")).toHaveText("Credit card perks");
	await page.context().close();
});
