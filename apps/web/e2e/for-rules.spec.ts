import { expect, type Page, test } from "@playwright/test";
import { ulid } from "ulid";
import { createTestParent } from "./parents";
import { seedSql } from "./seed-sql";
import {
	choose,
	clientRendered,
	createPlannedHousehold,
	reloadUntil,
	signedInPage,
	uploadStatement,
} from "./session";

// For is quicker to set (issue 155): a Rule stated with a Bucket and a For files the merchant's
// next line For that person, where Reports › People counts it; and a Review card whose merchant
// was twice filed For the same person starts as For them, said on the card, until a Parent files
// it or says otherwise.

let parent: Awaited<ReturnType<typeof createTestParent>>;

test.beforeEach(async () => {
	parent = await createTestParent();
});

test.afterEach(async () => {
	await parent?.remove();
});

const q = (value: string) => `'${value.replaceAll("'", "''")}'`;

const addChild = (name: string) =>
	seedSql([
		`insert into members (id, household_id, kind, name) values (${q(ulid())}, (select household_id from members where clerk_user_id = ${q(parent.userId)}), 'child', ${q(name)})`,
	]);

const noSidewaysScroll = async (page: Page) =>
	expect(
		await page.evaluate(
			() => document.documentElement.scrollWidth - document.documentElement.clientWidth,
		),
	).toBeLessThanOrEqual(0);

test("a Rule with a Bucket and a For files the merchant's next line For that Child", async ({
	browser,
}) => {
	test.slow();
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, {
		baseline: "5,000",
		buckets: [
			["Groceries", "1,200"],
			["Sports", "300"],
		],
	});
	const thisMonth = page.url();
	await addChild("Maya");

	// The Rule: the swim club's lines go in Sports, For Maya.
	await page.goto(new URL("/review/rules", thisMonth).href);
	await expect(page.getByRole("button", { name: "Add Rule" })).toBeEnabled(clientRendered);
	await page.getByRole("button", { name: "Add Rule" }).click();
	const add = page.getByRole("dialog", { name: "Add a Rule" });
	await add.getByLabel("Merchant").fill("Riverside Swim");
	await choose(add, "Files to", "Sports");
	await add.getByRole("button", { name: "Maya", exact: true }).click();
	await add.getByRole("button", { name: "Add Rule and file what matches" }).click();
	await expect(add).toBeHidden();
	await expect(
		page.getByRole("link", { name: /^riverside swim, Sports, For Maya, / }),
	).toBeVisible();

	// Its next statement line arrives filed in Sports, For Maya.
	await uploadStatement(page, [["RIVERSIDE SWIM CLUB", "85.00"]], true);
	const line = page.getByRole("button", {
		name: /^Riverside Swim Club[^,]*, \$85, Sports \(filed automatically\), For Maya, from Visa$/i,
	});
	await reloadUntil(
		page,
		thisMonth.replace(/\/month\/(\d{4}-\d{2}).*$/, "/transactions/$1"),
		async () => {
			await expect(line).toBeVisible({ timeout: 2_000 });
		},
	);

	// Reports › People counts it under her, in Sports.
	await page.goto("/reports?view=people");
	await expect(
		page.getByRole("heading", { name: "Where the money went for each person, by Bucket" }),
	).toBeVisible(clientRendered);
	await expect(
		page.getByRole("region", { name: "Maya", exact: true }).getByRole("row", { name: /^Sports/ }),
	).toHaveText(/Sports\$85\$85/);

	// On the narrowest phone the Rule's form, For and all, fits the screen.
	await page.setViewportSize({ width: 320, height: 640 });
	await page.goto(new URL("/review/rules", thisMonth).href);
	await page.getByRole("link", { name: /^riverside swim, Sports, For Maya, / }).click();
	const form = page.locator("form").filter({ has: page.getByLabel("Merchant") });
	await expect(form.getByRole("button", { name: "Maya", exact: true })).toHaveAttribute(
		"aria-pressed",
		"true",
	);
	await noSidewaysScroll(page);
	await page.context().close();
});

test("a Review card whose merchant was twice filed For a Child starts as For them, and the Rule offered says so", async ({
	browser,
}) => {
	test.slow();
	const page = await signedInPage(browser, parent.email, {
		viewport: { width: 1440, height: 900 },
	});
	await createPlannedHousehold(page, {
		baseline: "5,000",
		buckets: [
			["Groceries", "1,200"],
			["Gas", "300"],
		],
	});
	const thisMonth = page.url();
	await addChild("Maya");
	// The fake categorizer guesses Gas for each: three cards of one merchant, each with Confirm.
	await uploadStatement(
		page,
		[
			["CORNER GAS MART", "22.50"],
			["CORNER GAS MART", "31.00"],
			["CORNER GAS MART", "18.25"],
		],
		true,
	);
	const review = new URL("/review?view=list", thisMonth).href;
	const cards = page.getByTestId("review-card");
	const confirm = cards.getByRole("button", { name: "Confirm", exact: true });
	const likely = page.getByTestId("review-for-likely");
	await reloadUntil(page, review, async () => {
		await expect(confirm).toHaveCount(3, { timeout: 2_000 });
	});
	await expect(confirm.first()).toBeEnabled(clientRendered);
	// Nothing has been filed For anyone yet: no card offers anybody.
	await expect(likely).toHaveCount(0);

	// Two are filed For Maya by hand; neither Rule offered is taken.
	for (const left of [2, 1]) {
		await cards.first().getByRole("button", { name: "Maya", exact: true }).click();
		await confirm.first().click();
		await expect(cards).toHaveCount(left);
	}

	// The third starts as For Maya, and says why.
	await reloadUntil(page, review, async () => {
		await expect(cards).toHaveCount(1, { timeout: 2_000 });
		await expect(likely).toHaveCount(1, { timeout: 2_000 });
	});
	await expect(confirm).toBeEnabled(clientRendered);
	const card = cards.first();
	const chip = (name: string) => card.getByRole("button", { name, exact: true });
	await expect(likely).toContainText("For Maya, like last time");
	await expect(chip("Maya")).toHaveAttribute("aria-pressed", "true");
	// One tap says otherwise, and her chip brings it back.
	await likely.getByRole("button", { name: /^Not this time/ }).click();
	await expect(chip("Everyone")).toHaveAttribute("aria-pressed", "true");
	await expect(likely).toHaveCount(0);
	await chip("Maya").click();
	await expect(likely).toContainText("For Maya, like last time");

	// Confirm keeps it, and the Rule offered names her.
	await confirm.click();
	const offer = page.locator("[data-sonner-toast]").filter({ hasText: "Always file “" });
	await expect(offer).toContainText(/Always file “Corner Gas Mart.*” in Gas, For Maya\?/i);
	await expect(cards).toHaveCount(0);
	await page.goto(thisMonth.replace(/\/month\/(\d{4}-\d{2}).*$/, "/transactions/$1"));
	await expect(
		page.getByRole("button", { name: /^Corner Gas Mart[^,]*, .*Gas, For Maya, from Visa$/i }),
	).toHaveCount(3);
	await page.context().close();
});
