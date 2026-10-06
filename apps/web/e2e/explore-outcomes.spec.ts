import { expect, type Page, test } from "@playwright/test";
import { createTestParent } from "./parents";
import { clientRendered, createPlannedHousehold, signedInPage } from "./session";

let parent: Awaited<ReturnType<typeof createTestParent>>;

test.beforeEach(async () => {
	parent = await createTestParent();
});

test.afterEach(async () => {
	await parent?.remove();
});

async function type(page: Page, label: string, value: string) {
	await page.getByRole("textbox", { name: label }).fill(value);
	await page.getByRole("textbox", { name: label }).press("Enter");
}

test("a change that empties the Projected balance is flagged, and the warning leads to it", async ({
	browser,
}) => {
	const page = await signedInPage(browser, parent.email);
	// $5,000 − $1,200 − $400: $3,400 Free to Spend a month.
	await createPlannedHousehold(page, {
		baseline: "5,000",
		buckets: [
			["Groceries", "1,200"],
			["Hockey", "400"],
		],
	});
	await page.getByRole("link", { name: "Explore", exact: true }).click();
	await expect(page.getByRole("heading", { level: 1 })).toHaveText("Explore");
	const warnings = page.getByRole("list", { name: "Caused by this Scenario" });
	await page.getByRole("tab", { name: "Balance" }).click();
	await expect(page.getByRole("heading", { name: "Projected balance" })).toBeVisible();
	await expect(warnings).toHaveCount(0);
	await expect(
		page.getByText(/^Assumptions\. Spending is assumed to equal allowances\./),
	).toBeVisible();

	// A $10,000 roof this month: $3,400 less $10,000 leaves the Projected balance at −$6,600.
	await page.getByRole("button", { name: "Add one-off" }).click();
	const oneOff = page.getByRole("form", { name: "New one-off" });
	await oneOff.getByRole("textbox", { name: "Name" }).fill("New roof");
	await oneOff.getByRole("textbox", { name: "Amount" }).fill("10,000");
	await oneOff.getByRole("textbox", { name: "Amount" }).press("Tab");
	await oneOff.getByRole("button", { name: "Add", exact: true }).click();

	const warning = warnings.getByRole("link", {
		name: /^The projected balance dips below zero from/,
	});
	await expect(warning).toContainText("Mostly from your change to New roof");
	await expect(warnings.getByRole("listitem")).toHaveCount(1);

	// The warning lands on the change responsible.
	await warning.click();
	const roof = page
		.getByRole("region", { name: "Your changes" })
		.getByRole("listitem", { name: /^One-off expense: New roof \$10,000/ });
	await expect(roof).toBeFocused();
	await expect(roof).toBeInViewport();

	// The Projected balance's chart, as a table.
	await page.getByRole("button", { name: "Show Projected balance as a table" }).click();
	const projectedBalance = page.getByRole("table", { name: "Projected balance" });
	await expect(projectedBalance.getByRole("row").nth(1)).toContainText(/\$3,400\s*−\$6,600$/);
	await expect(projectedBalance.getByRole("row").nth(2)).toContainText(/\$6,800\s*−\$3,200$/);

	// Left out, the roof no longer counts, and nothing is flagged.
	await roof.getByRole("button", { name: "Leave out" }).click();
	await expect(warnings).toHaveCount(0);
	await expect(projectedBalance.getByRole("row").nth(1)).toContainText(/\$3,400\s*\$3,400$/);
});

test("on a phone, tapping a month shows it in full under the chart", { tag: "@phone" }, async ({
	browser,
}) => {
	const page = await signedInPage(browser, parent.email, {
		viewport: { width: 393, height: 852 },
		isMobile: true,
		hasTouch: true,
	});
	await createPlannedHousehold(page, {
		baseline: "5,000",
		buckets: [["Groceries", "1,200"]],
	});
	await page.goto("/explore");
	await expect(page.getByRole("heading", { level: 1 })).toHaveText("Explore", clientRendered);
	// On a phone a line opens in a sheet.
	await page.getByRole("button", { name: "Edit Take-home pay" }).click();
	await type(page, "Take-home pay", "4,000");
	await page.keyboard.press("Escape");
	await expect(page.getByRole("dialog")).toBeHidden();

	// The first tap lands on the month under the finger, and the next tap moves it.
	await page.getByRole("tab", { name: "Balance" }).click();
	const projectedBalance = page.getByRole("group", { name: "Projected balance", exact: true });
	const chart = projectedBalance.locator("svg.recharts-surface").first();
	await chart.scrollIntoViewIfNeeded();
	const box = await chart.boundingBox();
	if (!box) throw new Error("no Projected balance chart");
	const tap = (share: number) =>
		page.touchscreen.tap(box.x + 52 + (box.width - 60) * share, box.y + box.height / 2);
	await tap(0.02);
	await expect(projectedBalance.getByRole("button", { name: /^Close \w+ \d{4}$/ })).toBeVisible();
	await expect(projectedBalance).toContainText(/Why\s*Income \$5,000 → \$4,000 a month/);
	const first = await projectedBalance.getByRole("button", { name: /^Close / }).textContent();
	await tap(0.6);
	await expect(projectedBalance.getByRole("button", { name: /^Close / })).not.toHaveText(
		first ?? "",
	);
	await projectedBalance.getByRole("button", { name: /^Close / }).click();
	await expect(projectedBalance.getByRole("button", { name: /^Close / })).toBeHidden();
});

test("on a phone, the result comes first and long groups fold to what the Scenario changes", {
	tag: "@phone",
}, async ({ browser }) => {
	const page = await signedInPage(browser, parent.email, {
		viewport: { width: 393, height: 852 },
		isMobile: true,
		hasTouch: true,
	});
	await createPlannedHousehold(page, {
		baseline: "5,000",
		buckets: [
			["Groceries", "1,200"],
			["Hockey", "400"],
			["Fun", "200"],
		],
	});
	await page.goto("/explore");
	await expect(page.getByRole("heading", { level: 1 })).toHaveText("Explore", clientRendered);

	// How it plays out is above the outline, in the page and so in reading order.
	const top = async (name: string) =>
		(await page.getByRole("heading", { name, exact: true }).boundingBox())?.y ?? Number.NaN;
	expect(await top("How it plays out")).toBeLessThan(await top("Income"));

	// Buckets says what the Plan has; its lines are behind Show all, and Add is still there.
	const all = page.getByRole("button", { name: /^Show all \d+ Buckets$/ });
	await expect(all).toHaveAttribute("aria-expanded", "false");
	await expect(page.getByText(/^\d+ in the Plan · \$[\d,]+ a month$/)).toBeVisible();
	await expect(page.getByRole("button", { name: "Add Bucket" })).toBeVisible();
	await expect(page.getByRole("button", { name: "Edit Hockey" })).toBeHidden();
	const box = await all.boundingBox();
	expect(box?.height).toBeGreaterThanOrEqual(44);

	await all.click();
	await page.getByRole("button", { name: "Edit Hockey" }).click();
	await type(page, "Hockey allowance", "300");
	await page.keyboard.press("Escape");
	await expect(page.getByRole("dialog")).toBeHidden();

	// Folded again, the changed line stays and the others go.
	const fewer = page.getByRole("button", { name: "Show fewer Buckets" });
	await expect(fewer).toHaveAttribute("aria-expanded", "true");
	await fewer.click();
	await expect(page.getByRole("button", { name: "Edit Hockey" })).toBeVisible();
	await expect(page.getByRole("button", { name: "Edit Groceries" })).toBeHidden();
});
