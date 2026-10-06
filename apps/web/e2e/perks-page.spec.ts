import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { continueToBank } from "./bank-history";
import { createTestParent } from "./parents";
import {
	accountKindLabel,
	choose,
	createPlannedHousehold,
	savedBy,
	serverFn,
	signedInPage,
} from "./session";

// The Perks & Benefits page with two cards' worth of perks (AI_MODEL=stub, see perks-model.ts):
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

/** A Perk Source's row on the page; its details are open after this (one is open at a time). */
async function openSource(page: Page, name: string) {
	const card = page.getByRole("article", { name });
	const row = card.locator("h3").getByRole("button");
	await expect(row).toBeEnabled();
	if ((await row.getAttribute("aria-expanded")) !== "true") await row.click();
	await expect(row).toHaveAttribute("aria-expanded", "true");
	return card;
}

async function addCard(page: Page, name: string, pageUrl: string, fee: string, perks: number) {
	await page.getByRole("button", { name: "Add a card or membership" }).click();
	const sheet = page.getByRole("dialog", { name: "Add a card or membership" });
	await sheet.getByLabel("Card or membership").fill(name);
	await sheet.getByRole("button", { name: "I have a link to its benefits page" }).click();
	await sheet.getByLabel("Benefits page (optional)").fill(pageUrl);
	await sheet.getByRole("button", { name: "Add and read its perks" }).click();
	await expect(sheet).toBeHidden();
	const card = await openSource(page, name);
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

test("Worth using now puts the perks about to reset first and opens their card; a perk marked used by hand leaves it", async ({
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

	// The page is a short list: a row per card, one open at a time (here the card added last).
	const amexRow = amex.locator("h3").getByRole("button");
	const sapphireRow = sapphire.locator("h3").getByRole("button");
	await expect(amexRow).toHaveAttribute("aria-expanded", "false");
	await expect(amexRow).toContainText(/4 worth using now · 4 perks/);
	await expect(amexRow).toContainText("$410");
	await expect(amex.getByRole("list")).toHaveCount(0);

	// The monthly credits reset soonest: the bigger first. No reset date comes last.
	const doNow = page.getByRole("list", { name: "Worth using now" });
	const items = doNow.getByRole("listitem");
	await expect(items.first()).toHaveAccessibleName("Uber Cash");
	await expect(items.nth(1)).toHaveAccessibleName("DoorDash credit");
	// Only the three most urgent, until asked for all.
	await expect(items).toHaveCount(3);
	const showAll = page.getByRole("button", { name: "Show all 7", exact: true });
	await showAll.click();
	await expect(items).toHaveCount(7);
	await page.getByRole("button", { name: "Show fewer" }).click();
	await expect(items).toHaveCount(3);
	await expect(items.first()).toContainText("Amex Platinum");
	await expect(items.first()).toContainText(/Spend Uber Cash by \w+ \d+, then mark it used\./);

	// A line opens its card, and only that one.
	await items.first().getByRole("button").click();
	await expect(amexRow).toHaveAttribute("aria-expanded", "true");
	await expect(amexRow).toBeFocused();
	await expect(sapphireRow).toHaveAttribute("aria-expanded", "false");

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
	await expect(page.getByRole("button", { name: "Show all 6", exact: true })).toBeVisible();
	await expect(summary).toContainText("$15 of $830");

	// Taken back, it's to do again.
	await uber.getByRole("button", { name: "Undo Uber Cash used" }).click();
	await expect(items.first()).toHaveAccessibleName("Uber Cash");

	// Where a perk comes from is behind its own button, not in the row.
	await expect(uber.getByRole("link", { name: "Source" })).toHaveCount(0);
	await uber.getByRole("button", { name: "Where Uber Cash comes from" }).click();
	await expect(uber.getByRole("link", { name: "Source" })).toHaveAttribute(
		"href",
		"https://example.com/premium-card",
	);
	await expect(uber).toContainText("A cost it pays for");
	await expect(uber).toContainText("Checked");

	// Opening the other card closes this one.
	await openSource(page, "Chase Sapphire Reserve");
	await expect(amexRow).toHaveAttribute("aria-expanded", "false");

	// DashPass's page states no value: a Parent types it.
	const dashPass = sapphire.getByRole("listitem", { name: "DashPass" });
	await dashPass.getByRole("button", { name: "Add the value of DashPass" }).click();
	await dashPass.getByLabel("Value", { exact: true }).fill("10");
	await choose(dashPass, "How often it renews", "Every month");
	await dashPass.getByRole("button", { name: "Save" }).click();
	await expect(dashPass).toContainText("$10");
	await expect(summary).toContainText("$0 of $950");

	if (process.env.SHOT_DIR) {
		await openSource(page, "Amex Platinum");
		await uber.getByRole("button", { name: "Mark Uber Cash used" }).click();
		await uber.getByRole("button", { name: "Save" }).click();
		await expect(items.first()).toHaveAccessibleName("DoorDash credit");
		for (const width of [1440, 1920]) {
			await page.setViewportSize({ width, height: 1000 });
			await page.screenshot({ path: `${process.env.SHOT_DIR}/perks-${width}.png`, fullPage: true });
		}
	}
});

test("on a phone the page is a short list, a card opens in place, and nothing scrolls sideways", {
	tag: "@phone",
}, async ({ browser }) => {
	test.slow();
	const page = await signedInPage(browser, parent.email);
	await twoCards(page);
	for (const width of [320, 393, 430]) {
		await page.setViewportSize({ width, height: 860 });
		expect(await noSideways(page)).toBe(true);
	}
	// A card open, at the narrowest.
	await page.setViewportSize({ width: 320, height: 700 });
	const amex = await openSource(page, "Amex Platinum");
	await expect(amex.getByRole("listitem", { name: "Uber Cash" })).toBeVisible();
	await amex.getByRole("button", { name: "Where Uber Cash comes from" }).click();
	expect(await noSideways(page)).toBe(true);
	await page.setViewportSize({ width: 393, height: 860 });
	await expect(
		page.getByRole("list", { name: "Worth using now" }).getByRole("listitem").first(),
	).toBeVisible();
	const { violations } = await new AxeBuilder({ page })
		.withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
		.analyze();
	expect(
		violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`),
	).toEqual([]);
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
	await expect(page.getByRole("heading", { level: 1 })).toHaveText("Perks & Benefits");

	await page.goto("/check-in");
	const onCheckIn = page.getByRole("link", { name: line });
	await expect(onCheckIn).toBeVisible();
	await onCheckIn.click();
	await expect(page).toHaveURL(/\/insights\/perks$/);

	// Used, it asks no more.
	const amex = await openSource(page, "Amex Platinum");
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
	await expect(page.getByRole("heading", { level: 1 })).toHaveText("Perks & Benefits");
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
	await expect(page.getByRole("heading", { level: 1 })).toHaveText("Perks & Benefits");
	await expect(page.getByRole("article", { name: "Amex Platinum" })).toBeVisible();
	await page.context().close();
});

test("a linked credit card appears by itself, asks which card it is, then shows its perks and what's worth using", async ({
	browser,
}) => {
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, { baseline: "9,000", buckets: [["Groceries", "1,200"]] });
	// The fake bank (AI_MODEL=stub) has one credit card, "Costco Anywhere Visa" ••3333, at a bank
	// that isn't a card issuer Noodle knows by name.
	await page.goto("/accounts");
	await page.getByRole("button", { name: "Connect a bank" }).click();
	await continueToBank(page);
	await page
		.getByRole("dialog", { name: "Which of these do you have already?" })
		.getByRole("button", { name: "Start bringing them in" })
		.click();
	await expect(
		page.getByRole("status").filter({ hasText: "Bringing in 4 Accounts" }),
	).toBeVisible();

	// Nobody added it: the card has a section of its own, and one question.
	await page.goto("/insights/perks");
	const unnamed = page.getByRole("article", { name: "Credit card" });
	await expect(unnamed).toContainText("3333");
	await expect(unnamed.locator("h3")).toContainText("Needs an answer");
	await expect(unnamed.locator("h3")).toContainText("Which card is this?");
	await openSource(page, "Credit card");
	await expect(unnamed).toContainText("The bank calls this card “Costco Anywhere Visa");
	await expect(unnamed).toContainText("doesn’t say which card it is");
	// Nothing to check again until it's known which card it is.
	await expect(unnamed.getByRole("button", { name: "Check again" })).toHaveCount(0);
	// The question is the same sheet and picker as adding a card.
	await unnamed.getByRole("button", { name: "Say which card it is" }).click();
	const which = page.getByRole("dialog", { name: "Which card is this?" });
	await which.getByRole("button", { name: "Look up its perks" }).click();
	await expect(which.getByRole("alert")).toContainText("Pick the card from the list");
	await which.getByLabel("Card", { exact: true }).fill("sapph pref");
	await which
		.getByRole("list", { name: "Matches" })
		.getByRole("button", { name: /Chase Sapphire Preferred/ })
		.click();
	await expect(which.getByLabel("Card", { exact: true })).toHaveValue("Chase Sapphire Preferred");
	await which.getByRole("button", { name: "Look up its perks" }).click();
	await expect(which).toBeHidden();

	// Its perks, read from the (fake) benefits page: what it earns more on, a credit and DashPass.
	// The rate the fake model made up ("5x on travel") isn't on the page, so it isn't a perk.
	const card = await openSource(page, "Chase Sapphire Preferred");
	const perks = card.getByRole("list", { name: "Chase Sapphire Preferred Perks" });
	await expect(perks.getByRole("listitem")).toHaveCount(4);
	await expect(card).toContainText("3333");
	await expect(perks.getByRole("listitem").first()).toContainText("Kroger credit");
	await expect(perks.getByRole("listitem", { name: "3x on dining" })).toContainText(
		"Earns more here",
	);
	await expect(perks).not.toContainText("5x on travel");
	await expect(page.getByRole("button", { name: "Look up its perks" })).toHaveCount(0);
	// A Parent can say another card later.
	await expect(card.getByRole("button", { name: "Change which card" })).toBeVisible();

	// Worth using, once the bank's Transactions are in: Kroger was paid from checking.
	const worth = card.getByRole("list", { name: "Worth using" });
	await expect(async () => {
		await page.reload();
		await expect(worth).toContainText("Kroger on Plaid Checking", { timeout: 3_000 });
	}).toPass({ timeout: 60_000 });
	await expect(worth).toContainText("this card pays back up to $10 a month.");

	// On a small phone nothing runs off the side.
	await page.setViewportSize({ width: 320, height: 700 });
	await expect(card).toBeVisible();
	expect(await noSideways(page)).toBe(true);
});

test("adding a card is one button and one sheet: search the known cards, pick one, and its row appears", {
	tag: "@phone",
}, async ({ browser }) => {
	test.slow();
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, { baseline: "9,000", buckets: [["Groceries", "1,200"]] });
	await page.goto("/insights/perks");
	await page.setViewportSize({ width: 320, height: 700 });
	await expect(page.getByText("No Perk Sources yet")).toBeVisible();
	// The old form on the page is gone: one button opens the sheet.
	await expect(page.getByRole("region", { name: "Add a Perk Source" })).toHaveCount(0);
	await page.getByRole("button", { name: "Add a card or membership" }).click();
	const sheet = page.getByRole("dialog", { name: "Add a card or membership" });
	const name = sheet.getByLabel("Card or membership");

	// Nothing typed: it says what's missing, in the field's own error.
	await sheet.getByRole("button", { name: "Add and read its perks" }).click();
	await expect(sheet.getByRole("alert")).toContainText("Pick one from the list, or type its name.");

	// Typing narrows the known cards and memberships; a name Noodle doesn't know asks what it is.
	const matches = sheet.getByRole("list", { name: "Matches" });
	await name.fill("zzz credit union");
	await expect(matches).toHaveCount(0);
	await expect(sheet.getByLabel("What it is")).toBeVisible();
	await name.fill("sapph res");
	await expect(matches.getByRole("listitem")).toHaveCount(1);
	await matches.getByRole("button", { name: /Chase Sapphire Reserve/ }).click();
	await expect(name).toHaveValue("Chase Sapphire Reserve");
	await expect(sheet).toContainText("Noodle knows this one.");
	await expect(sheet.getByLabel("What it is")).toHaveCount(0);

	expect(await noSideways(page)).toBe(true);
	const { violations } = await new AxeBuilder({ page })
		.withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
		.analyze();
	expect(
		violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`),
	).toEqual([]);

	// Added: the sheet closes and the card has a row of its own, open as it's the only one.
	await sheet.getByRole("button", { name: "Add and read its perks" }).click();
	await expect(sheet).toBeHidden();
	const card = page.getByRole("article", { name: "Chase Sapphire Reserve" });
	await expect(card.locator("h3").getByRole("button")).toHaveAttribute("aria-expanded", "true");
	await expect(card.getByRole("button", { name: "Remove" })).toBeVisible();
	await expect(card.getByRole("button", { name: "Check again" })).toBeVisible();
	expect(await noSideways(page)).toBe(true);
	await page.context().close();
});

test("adding a card that is already there says so, adds nothing, and opens its row", async ({
	browser,
}) => {
	test.slow();
	const page = await signedInPage(browser, parent.email);
	await twoCards(page);
	// By its markup, not its role: the page behind an open sheet is hidden from roles.
	const rows = page.locator("article[aria-labelledby^='perk-source-']");
	await expect(rows).toHaveCount(2);
	// The last one added is open; the one added again is the other.
	const amex = page.getByRole("article", { name: "Amex Platinum" });
	await expect(amex.locator("h3").getByRole("button")).toHaveAttribute("aria-expanded", "false");

	await page.getByRole("button", { name: "Add a card or membership" }).click();
	const sheet = page.getByRole("dialog", { name: "Add a card or membership" });
	await sheet.getByLabel("Card or membership").fill("amex  platinum");
	const asked = savedBy(page, "addPerkSource");
	await sheet.getByRole("button", { name: "Add and read its perks" }).click();
	await asked;
	await expect(sheet.getByRole("status")).toHaveText(
		"Amex Platinum is already in Perks & Benefits, so nothing was added.",
	);
	await expect(rows).toHaveCount(2);
	await expect(rows.filter({ hasText: "Amex Platinum" })).toHaveCount(1);

	await sheet.getByRole("button", { name: "Open it" }).click();
	await expect(sheet).toBeHidden();
	await expect(amex.locator("h3").getByRole("button")).toHaveAttribute("aria-expanded", "true");
	await expect(
		amex.getByRole("list", { name: "Amex Platinum Perks" }).getByRole("listitem"),
	).toHaveCount(4);
	// Still there once, after the page loads again.
	await page.reload();
	await expect(rows).toHaveCount(2);
	await page.context().close();
});
