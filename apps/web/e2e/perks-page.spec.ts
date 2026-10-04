import { expect, type Page, test } from "@playwright/test";
import { createTestParent } from "./parents";
import { createPlannedHousehold, signedInPage } from "./session";

// The Credit card perks page with two cards' worth of perks (AI_MODEL=stub, see perks-model.ts):
// a "premium" page with $15 Uber Cash each month, a $200 airline fee credit each year, a $120
// Global Entry credit every four years and a $100 hotel credit each stay; a "travel-card" page
// with a $300 travel credit each year, a $10 DoorDash credit each month and DashPass.

let parent: Awaited<ReturnType<typeof createTestParent>>;

test.beforeEach(async () => {
	parent = await createTestParent();
});

test.afterEach(async () => {
	await parent?.remove();
});

async function addCard(page: Page, name: string, pageUrl: string, fee: string, perks: number) {
	const add = page.getByRole("region", { name: "Add a Perk Source" });
	await add.getByLabel("Name").fill(name);
	await add.getByLabel("Benefits page (optional)").fill(pageUrl);
	await add.getByRole("button", { name: "Add" }).click();
	const card = page.getByRole("article", { name });
	await expect(card.getByRole("list", { name: `${name} Perks` }).getByRole("listitem")).toHaveCount(
		perks,
	);
	await card.getByLabel("Annual fee").fill(fee);
	await card.getByRole("button", { name: "Save fee" }).click();
	await expect(card).toContainText(`annual fee $${fee}`);
	return card;
}

async function twoCards(page: Page) {
	await createPlannedHousehold(page, { baseline: "9,000", buckets: [["Groceries", "1,200"]] });
	await page.goto("/insights/perks");
	const amex = await addCard(page, "Amex Platinum", "https://example.com/premium-card", "695", 4);
	const sapphire = await addCard(
		page,
		"Chase Sapphire Reserve",
		"https://example.com/travel-card",
		"550",
		3,
	);
	return { amex, sapphire };
}

const noSideways = (page: Page) =>
	page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

test("Do now puts the perks about to reset first, and a perk marked used by hand leaves it", async ({
	browser,
}) => {
	test.slow();
	const page = await signedInPage(browser, parent.email);
	const { amex } = await twoCards(page);

	const summary = page.getByRole("region", { name: /^This year/ });
	await expect(summary).toContainText("Annual fees");
	await expect(summary).toContainText("$1,245");
	// $15 × 12 + $200 + $120 ÷ 4 = $410, and $300 + $10 × 12 = $420.
	await expect(summary).toContainText("$0 of $830");

	// The monthly credits reset soonest: the bigger first. No reset date comes last.
	const doNow = page.getByRole("list", { name: "Do now" });
	const items = doNow.getByRole("listitem");
	await expect(items.first()).toHaveAccessibleName("Uber Cash");
	await expect(items.nth(1)).toHaveAccessibleName("DoorDash credit");
	await expect(items.last()).toHaveAccessibleName("DashPass");
	await expect(items.first()).toContainText("Amex Platinum");
	await expect(items.first()).toContainText(/Use it by \w+ \d+, then mark it used\./);

	const uber = amex.getByRole("listitem", { name: "Uber Cash" });
	await expect(uber).toContainText("$15");
	await expect(uber).toContainText("Every month");
	await expect(uber).toContainText(/Not used this month · resets \w+ 1, \d+ days? left/);
	await uber.getByRole("button", { name: "Mark Uber Cash used" }).click();
	await uber.getByLabel("Note (optional)").fill("Rides to the airport");
	await uber.getByRole("button", { name: "Save" }).click();
	await expect(uber).toContainText("“Rides to the airport”");
	await expect(uber).toContainText(/^.*Used \w+ \d+/);
	await expect(items.first()).toHaveAccessibleName("DoorDash credit");
	await expect(doNow.getByRole("listitem", { name: "Uber Cash" })).toHaveCount(0);
	await expect(summary).toContainText("$15 of $830");

	// Taken back, it's to do again.
	await uber.getByRole("button", { name: "Undo Uber Cash used" }).click();
	await expect(items.first()).toHaveAccessibleName("Uber Cash");

	if (process.env.SHOT_DIR) {
		await uber.getByRole("button", { name: "Mark Uber Cash used" }).click();
		await uber.getByRole("button", { name: "Save" }).click();
		await expect(items.first()).toHaveAccessibleName("DoorDash credit");
		for (const width of [1440, 1920]) {
			await page.setViewportSize({ width, height: 1000 });
			await page.screenshot({ path: `${process.env.SHOT_DIR}/perks-${width}.png`, fullPage: true });
		}
	}
});

test("on a phone each perk is its own row with no sideways scroll", { tag: "@phone" }, async ({
	browser,
}) => {
	test.slow();
	const page = await signedInPage(browser, parent.email);
	await twoCards(page);
	for (const width of [320, 393, 430]) {
		await page.setViewportSize({ width, height: 860 });
		expect(await noSideways(page)).toBe(true);
	}
	await page.setViewportSize({ width: 393, height: 860 });
	await expect(
		page.getByRole("list", { name: "Do now" }).getByRole("listitem").first(),
	).toBeVisible();
	if (process.env.SHOT_DIR) {
		await page.screenshot({ path: `${process.env.SHOT_DIR}/perks-393.png`, fullPage: true });
	}
});
