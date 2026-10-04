import { expect, type Page } from "@playwright/test";
import {
	accountKindLabel,
	choose,
	createPlannedHousehold,
	serverFn,
	signedInPage,
} from "./session";
import { type SharedParent, test } from "./worker-parent";

// The Credit card perks page with two cards' worth of perks (AI_MODEL=stub, see perks-model.ts):
// a "premium" page with $15 Uber Cash each month, a $200 airline fee credit each year, a $120
// Global Entry credit every four years and a $100 hotel credit each stay; a "travel-card" page
// with a $300 travel credit each year, a $10 DoorDash credit each month and DashPass.

let parent: SharedParent;

test.beforeEach(async ({ sharedParent }) => {
	parent = sharedParent;
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
	const { amex, sapphire } = await twoCards(page);

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
	// Only the three most urgent: every perk is in its card below, once.
	await expect(items).toHaveCount(3);
	await expect(page.getByRole("link", { name: "4 more to use" })).toBeVisible();
	await expect(items.first()).toContainText("Amex Platinum");
	await expect(items.first()).toContainText(/Spend Uber Cash by \w+ \d+, then mark it used\./);

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
	await expect(page.getByRole("link", { name: "3 more to use" })).toBeVisible();
	await expect(summary).toContainText("$15 of $830");

	// Taken back, it's to do again.
	await uber.getByRole("button", { name: "Undo Uber Cash used" }).click();
	await expect(items.first()).toHaveAccessibleName("Uber Cash");

	// DashPass's page states no value: a Parent types it.
	const dashPass = sapphire.getByRole("listitem", { name: "DashPass" });
	await dashPass.getByRole("button", { name: "Add the value of DashPass" }).click();
	await dashPass.getByLabel("Value", { exact: true }).fill("10");
	await choose(dashPass, "How often it renews", "Every month");
	await dashPass.getByRole("button", { name: "Save" }).click();
	await expect(dashPass).toContainText("$10");
	await expect(summary).toContainText("$0 of $950");

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

/**
 * Moves the day the perks are read on ("asOf") to four days before the month ends (or keeps today
 * when that is later), so the monthly credits reset within a week whatever today is. Only the perks
 * server function's answer changes.
 */
async function fourDaysBeforeMonthEnds(page: Page) {
	await page.route(serverFn("getPerkSources"), async (route) => {
		const response = await route.fetch();
		const body = (await response.text()).replace(
			// Every day in the answer (asOf, and any use) moves the same way, so they stay in order.
			/"(\d{4})-(\d{2})-(\d{2})(\\?)"/g,
			(_, y: string, m: string, d: string, slash: string) => {
				const last = new Date(Date.UTC(Number(y), Number(m), 0)).getUTCDate();
				const day = Math.max(Number(d), last - 4);
				return `"${y}-${m}-${String(day).padStart(2, "0")}${slash}"`;
			},
		);
		await route.fulfill({ response, body });
	});
}

test("a perk resetting within a week is a To do on This Month and a line on the Check-in", async ({
	browser,
}) => {
	test.slow();
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, { baseline: "9,000", buckets: [["Groceries", "1,200"]] });
	await page.goto("/insights/perks");
	await addCard(page, "Amex Platinum", "https://example.com/premium-card", "695", 4);
	await fourDaysBeforeMonthEnds(page);

	// Uber Cash ($15 each month) is the soonest to reset, unused.
	const line = /^Uber Cash resets in \d+ days? — use it$/;
	await page.goto("/");
	const toDo = page.getByRole("region", { name: "To do" });
	const onMonth = (page.viewportSize()?.width ?? 0) >= 1024 ? toDo : page;
	await expect(onMonth.getByRole("link", { name: line })).toBeVisible();
	await onMonth.getByRole("link", { name: line }).click();
	await expect(page).toHaveURL(/\/insights\/perks$/);
	await expect(page.getByRole("heading", { level: 1 })).toHaveText("Credit card perks");

	await page.goto("/check-in");
	const onCheckIn = page.getByRole("link", { name: line });
	await expect(onCheckIn).toBeVisible();
	await onCheckIn.click();
	await expect(page).toHaveURL(/\/insights\/perks$/);

	// Used, it asks no more.
	const amex = page.getByRole("article", { name: "Amex Platinum" });
	const uber = amex.getByRole("listitem", { name: "Uber Cash" });
	await uber.getByRole("button", { name: "Mark Uber Cash used" }).click();
	await uber.getByRole("button", { name: "Save" }).click();
	await expect(uber).toContainText(/Used \w+ \d+/);
	await page.goto("/check-in");
	await expect(page.getByRole("link", { name: /^Uber Cash resets/ })).toHaveCount(0);
	await page.context().close();
});

test("a credit card's Account page links to its perks, under the page's own header", async ({
	browser,
}) => {
	test.slow();
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, { baseline: "9,000", buckets: [["Groceries", "1,200"]] });
	await page.goto("/insights/perks");
	await expect(page.getByRole("heading", { level: 1 })).toHaveText("Credit card perks");
	await addCard(page, "Amex Platinum", "https://example.com/premium-card", "695", 4);

	await page.goto("/accounts");
	await page.getByLabel("Name").fill("Amex Platinum");
	await choose(page, "Kind", accountKindLabel("credit-card"));
	await page.getByLabel("Owed now").fill("0");
	await page.getByRole("button", { name: "Add Account" }).click();
	await page.getByRole("link", { name: /^Amex Platinum, Credit card, / }).click();
	const link = page.getByRole("link", { name: /^Perks for this card, 4 Perks/ });
	await expect(link).toBeVisible();
	await link.click();
	await expect(page).toHaveURL(/\/insights\/perks$/);
	await expect(page.getByRole("heading", { level: 1 })).toHaveText("Credit card perks");
	await expect(page.getByRole("article", { name: "Amex Platinum" })).toBeVisible();
	await page.context().close();
});
