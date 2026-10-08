import { expect, type Page, test } from "@playwright/test";
import { createTestParent } from "./parents";
import {
	createPlannedHousehold,
	openFreeWorking,
	openPlanBuckets,
	serverFn,
	signedInPage,
	switchTo,
} from "./session";

let parent: Awaited<ReturnType<typeof createTestParent>>;

test.beforeEach(async () => {
	parent = await createTestParent();
});

test.afterEach(async () => {
	await parent?.remove();
});

const plan = {
	baseline: "5,000",
	buckets: [
		["Groceries", "1,200"],
		["Hockey", "400"],
	] as [string, string][],
};

const sheet = (page: Page) => page.getByRole("dialog", { name: "Quick Add" });
const hero = (page: Page) => page.getByRole("region", { name: "Free to Spend" });
const bucketRow = (page: Page, name: string) =>
	page.getByRole("listitem", { name: new RegExp(`^${name}: `) });

/** Opens Quick Add from the sidebar, types an amount, and picks a Bucket. */
async function quickAdd(page: Page, amount: string, bucket: string, note?: string) {
	await page.getByRole("link", { name: "Quick Add" }).click();
	await expect(sheet(page)).toBeVisible();
	await page.keyboard.type(amount);
	if (note) await sheet(page).getByLabel("Note").fill(note);
	await sheet(page)
		.getByRole("option", { name: new RegExp(`^${bucket}`) })
		.click();
	await expect(sheet(page)).toBeHidden();
}

test("a Quick Add drains its Bucket at once and is saved", async ({ browser }) => {
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, plan);
	await openFreeWorking(page);
	await expect(hero(page)).toContainText("Left in Buckets$1,600");

	await quickAdd(page, "85.50", "Groceries", "Costco");
	await expect(bucketRow(page, "Groceries")).toHaveAccessibleName(
		/^Groceries: \$1,114\.50 left of \$1,200/,
	);
	await expect(bucketRow(page, "Groceries")).toContainText("$85.50 spent");
	await expect(hero(page)).toContainText("Left in Buckets$1,514.50");
	// Spending inside a Bucket doesn't touch Free to Spend: that money was already planned.
	await expect(hero(page).getByText("$3,400", { exact: true }).first()).toBeVisible();
	await expect(page.getByRole("status").filter({ hasText: "added to" })).toHaveText(
		"$85.50 added to Groceries",
	);

	await page.reload();
	await expect(bucketRow(page, "Groceries")).toHaveAccessibleName(
		/^Groceries: \$1,114\.50 left of \$1,200/,
	);
	await page.context().close();
});

test("Buckets are offered most likely first", async ({ browser }) => {
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, plan);
	const picks = sheet(page).getByRole("option");

	await page.keyboard.press("q");
	await expect(picks.first()).toContainText("Groceries");
	await page.keyboard.press("Escape");
	await expect(sheet(page)).toBeHidden();

	await quickAdd(page, "40", "Hockey");
	await quickAdd(page, "25", "Hockey");
	await expect(bucketRow(page, "Hockey")).toContainText("$65 spent");
	await page.keyboard.press("q");
	await expect(picks.first()).toContainText("Hockey");
	await expect(picks.first()).toContainText("$335 left");
	await page.context().close();
});

test("Quick Add opens over any screen, and Back closes it without reloading the screen", async ({
	browser,
}) => {
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, plan);

	// A half-typed Personal Allowance in the Plan survives opening and closing Quick Add (a Bucket
	// changes in a sheet, which Quick Add can't open over).
	await switchTo(page, "Plan");
	await openPlanBuckets(page);
	const typed = page.getByLabel("Your Personal Allowance");
	await typed.fill("75");
	await page.getByRole("link", { name: "Quick Add" }).click();
	await expect(sheet(page)).toBeVisible();
	await expect(page).toHaveURL(/sheet=quick-add/);
	await page.goBack();
	await expect(sheet(page)).toBeHidden();
	await expect(page).not.toHaveURL(/sheet=/);
	await expect(typed).toHaveValue("75");

	// From the Household screen, adding closes the sheet and stays there.
	await page
		.getByRole("navigation", { name: "Main" })
		.getByRole("link", { name: "Household" })
		.click();
	await expect(page.getByRole("heading", { name: "Parents" })).toBeVisible();
	await quickAdd(page, "12", "Hockey");
	await expect(page.getByRole("heading", { name: "Parents" })).toBeVisible();
	await expect(page).not.toHaveURL(/sheet=/);
	await page
		.getByRole("navigation", { name: "Main" })
		.getByRole("link", { name: "This Month" })
		.click();
	await expect(bucketRow(page, "Hockey")).toContainText("$12 spent");

	// Opened straight from a link (e.g. a home screen shortcut), closing it stays on the page.
	await page.goto("/month?sheet=quick-add");
	await expect(sheet(page)).toBeVisible();
	await sheet(page).getByRole("button", { name: "Close" }).click();
	await expect(sheet(page)).toBeHidden();
	await expect(page).toHaveURL(/\/month\/\d{4}-\d{2}$/);
	await page.context().close();
});

test("on a phone, Quick Add takes three taps from the tab bar", { tag: "@phone" }, async ({
	browser,
}) => {
	const page = await signedInPage(browser, parent.email, {
		viewport: { width: 393, height: 852 },
		isMobile: true,
		hasTouch: true,
	});
	await createPlannedHousehold(page, plan);
	await page
		.getByRole("navigation", { name: "Main" })
		.getByRole("link", { name: "Quick Add" })
		.tap();
	const keypad = sheet(page).getByRole("group", { name: "Keypad" });
	for (const key of ["4", "2", "Decimal point", "5"]) {
		await keypad.getByRole("button", { name: key, exact: true }).tap();
	}
	await expect(sheet(page).getByRole("status", { name: "Amount" })).toHaveText("$42.5");
	await sheet(page)
		.getByRole("button", { name: /^Groceries/ })
		.tap();
	await expect(sheet(page)).toBeHidden();
	await expect(bucketRow(page, "Groceries")).toContainText("$42.50 spent");
	await page.context().close();
});

test("a failed Quick Add is undone and can be retried", async ({ browser }) => {
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, plan);

	const addQuickAdd = serverFn("addQuickAdd");
	await page.route(addQuickAdd, (route) => route.fulfill({ status: 500, body: "Server error" }));
	await quickAdd(page, "20", "Hockey");
	const toast = page.getByRole("status").filter({ hasText: "Couldn’t save" });
	await expect(toast).toContainText("Couldn’t save $20 to Hockey");
	await expect(bucketRow(page, "Hockey")).toContainText("$0 spent");

	await page.unroute(addQuickAdd);
	await toast.getByRole("button", { name: "Retry" }).click();
	await expect(bucketRow(page, "Hockey")).toContainText("$20 spent");
	await page.reload();
	await expect(bucketRow(page, "Hockey")).toContainText("$20 spent");
	await page.context().close();
});

test("a Quick Add delivered twice is recorded once", async ({ browser }) => {
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, plan);
	// Deliver the request to the server twice, as a retry after a lost response would.
	await page.route(serverFn("addQuickAdd"), async (route) => {
		await route.fetch();
		await route.continue();
	});
	await quickAdd(page, "30", "Groceries");
	await expect(page.getByRole("status").filter({ hasText: "added to" })).toBeVisible();
	await page.reload();
	await expect(bucketRow(page, "Groceries")).toContainText("$30 spent");
	await page.context().close();
});

const many = {
	baseline: "6,000",
	buckets: [
		["Groceries", "1,200"],
		["Dining out", "300"],
		["Gas", "200"],
		["Kids", "250"],
		["Household", "150"],
		["Fun money", "150"],
		["Gifts", "100"],
		["Pet supplies", "80"],
	] as [string, string][],
};

test("on a small phone, the amount, six Buckets and the keypad fit without scrolling, and More Buckets finds the rest", {
	tag: "@phone",
}, async ({ browser }) => {
	const page = await signedInPage(browser, parent.email, {
		viewport: { width: 375, height: 667 },
		isMobile: true,
		hasTouch: true,
	});
	await createPlannedHousehold(page, many);
	await page
		.getByRole("navigation", { name: "Main" })
		.getByRole("link", { name: "Quick Add" })
		.tap();
	const keypad = sheet(page).getByRole("group", { name: "Keypad" });
	const picks = sheet(page).getByRole("list", { name: "Add to" }).getByRole("listitem");
	const more = sheet(page).getByRole("button", { name: /^More Buckets/ });
	await expect(picks).toHaveCount(6);
	await expect(picks.last()).toContainText("More Buckets");
	for (const shown of [
		sheet(page).getByRole("status", { name: "Amount" }),
		picks.first(),
		more,
		keypad.getByRole("button", { name: "Delete" }),
	]) {
		// All of it, but for a sliver: WebKit lays the two columns out in 64ths of a pixel and
		// reports a tile as 99.99% in view when its edge falls on one.
		await expect(shown).toBeInViewport({ ratio: 0.999 });
	}
	expect(await sheet(page).evaluate((el) => el.scrollHeight - el.clientHeight)).toBeLessThanOrEqual(
		0,
	);

	// With no amount, a Bucket picked from More goes first in the grid, and nothing is saved.
	await more.tap();
	const find = sheet(page).getByRole("searchbox", { name: "Find a Bucket" });
	await expect(find).toBeFocused();
	await find.fill("pet");
	await sheet(page)
		.getByRole("region", { name: "Household" })
		.getByRole("button", { name: /^Pet supplies/ })
		.tap();
	await expect(picks.first()).toContainText("Pet supplies");
	await expect(picks.first()).toContainText("Picked");

	// With an amount, picking from More is the save.
	await keypad.getByRole("button", { name: "9", exact: true }).tap();
	await more.tap();
	await find.fill("gif");
	await sheet(page)
		.getByRole("button", { name: /^Gifts/ })
		.tap();
	await expect(sheet(page)).toBeHidden();
	await expect(bucketRow(page, "Gifts")).toContainText("$9 spent");
	await expect(bucketRow(page, "Pet supplies")).toContainText("$0 spent");
	await page.context().close();
});

test("on a computer, the keyboard alone files an amount: q, digits, letters, arrows and Enter", async ({
	browser,
}) => {
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, plan);
	const find = sheet(page).getByRole("combobox", { name: "Find a Bucket" });
	const options = sheet(page).getByRole("option");

	// q 2 4 Enter files $24 to the most likely Bucket.
	await page.keyboard.press("q");
	await expect(options.first()).toHaveAttribute("aria-selected", "true");
	await expect(options.first()).toContainText("Groceries");
	await page.keyboard.type("24");
	await expect(sheet(page).getByRole("button", { name: "Add $24 to Groceries" })).toBeVisible();
	await page.keyboard.press("Enter");
	await expect(sheet(page)).toBeHidden();
	await expect(bucketRow(page, "Groceries")).toContainText("$24 spent");

	// Letters go to Find a Bucket; ↓/↑ move the highlight; Esc clears the search, then closes.
	await page.keyboard.press("q");
	await page.keyboard.type("12hock");
	await expect(find).toBeFocused();
	await expect(find).toHaveValue("hock");
	await expect(options.first()).toContainText("Hockey");
	await page.keyboard.press("ArrowDown");
	await page.keyboard.press("ArrowUp");
	await expect(find).toHaveAttribute(
		"aria-activedescendant",
		(await options.first().getAttribute("id")) ?? "",
	);
	await page.keyboard.press("Escape");
	await expect(find).toHaveValue("");
	await expect(sheet(page)).toBeVisible();
	await page.keyboard.type("hock");
	await expect(sheet(page).getByRole("button", { name: "Add $12 to Hockey" })).toBeVisible();
	await page.keyboard.press("Enter");
	await expect(sheet(page)).toBeHidden();
	await expect(bucketRow(page, "Hockey")).toContainText("$12 spent");

	await page.keyboard.press("q");
	await expect(options.first()).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(sheet(page)).toBeHidden();
	await page.context().close();
});
