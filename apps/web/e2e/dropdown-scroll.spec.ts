import { expect, type Page, test } from "@playwright/test";
import { createTestParent } from "./parents";
import { createPlannedHousehold, pickQuickAddBucket, savedBy, signedInPage } from "./session";

// A list that opens from a field inside a sheet scrolls with the wheel. The sheet holds the page
// still, and that took the wheel from the list too, since the list is drawn outside the sheet's
// own element: a long list of Buckets could only be reached with the arrow keys.

let parent: Awaited<ReturnType<typeof createTestParent>>;

test.beforeEach(async () => {
	parent = await createTestParent();
});

test.afterEach(async () => {
	await parent?.remove();
});

test("a long list of Buckets in a sheet scrolls with the wheel", async ({ browser }) => {
	test.slow();
	const page = await signedInPage(browser, parent.email);
	const names =
		"Groceries,Eating out,Fuel,Hockey,Fun,Life,Clothes,Pets,Gifts,Travel,Health,Home,School,Garden";
	await createPlannedHousehold(page, {
		baseline: "9,000",
		buckets: names.split(",").map((name) => [name, "100"] as [string, string]),
	});
	await page.goto("/review/rules");
	const sheet = page.getByRole("dialog", { name: "Add a Rule" });
	// Pressed again until it opens: before the page is live a press does nothing.
	await expect(async () => {
		if (!(await sheet.isVisible()))
			await page.getByRole("button", { name: "Add Rule" }).first().click({ timeout: 2_000 });
		await expect(sheet).toBeVisible({ timeout: 3_000 });
	}).toPass({ timeout: 40_000 });
	await sheet.getByRole("combobox", { name: "Files to" }).click();
	const list = page.locator("[data-slot=command-list]");
	await expect(list).toBeVisible();
	// Longer than its window, or there is nothing to scroll.
	expect(await list.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
	const box = await list.boundingBox();
	await page.mouse.move((box?.x ?? 0) + 40, (box?.y ?? 0) + 60);
	await page.mouse.wheel(0, 200);
	await expect.poll(() => list.evaluate((el) => el.scrollTop)).toBeGreaterThan(100);
	await expect(page.getByRole("option", { name: "Garden" })).toBeVisible();
});

// Issue 154: every list a Bucket is picked from looks and searches the same. Names no other spec
// uses, in this test's own Household.
const picked =
	"Pantry stock,Meals out,Petrol,Rink fees,Treats,Odds and ends,Wardrobe,Critters,Presents,Getaways,Wellbeing,Homestead,Classroom,Allotment";

async function openAddRule(page: Page) {
	await page.goto("/review/rules");
	const sheet = page.getByRole("dialog", { name: "Add a Rule" });
	// Pressed again until it opens: before the page is live a press does nothing.
	await expect(async () => {
		if (!(await sheet.isVisible()))
			await page.getByRole("button", { name: "Add Rule" }).first().click({ timeout: 2_000 });
		await expect(sheet).toBeVisible({ timeout: 3_000 });
	}).toPass({ timeout: 40_000 });
	return sheet;
}

test("a Rule's list shows each Bucket's colour and Bills under their own heading, finds a name by a later word or with a slip, and Enter takes the first match", async ({
	browser,
}) => {
	test.slow();
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, {
		baseline: "9,000",
		buckets: picked.split(",").map((name) => [name, "100"] as [string, string]),
		commitments: [{ name: "Broadband plan", amountCents: 6_000, cadence: "monthly", dueDay: 5 }],
	});
	const sheet = await openAddRule(page);
	const field = sheet.getByRole("combobox", { name: "Files to" });
	await field.click();
	const list = page.getByRole("listbox");
	const options = list.getByRole("option");
	await expect(options).toHaveCount(15);
	// Every choice leads with its mark; a Bucket's is in its own colour, a bill's is neutral.
	await expect(list.locator("[data-slot=choice-mark]")).toHaveCount(15);
	const tile = (name: string) =>
		list
			.getByRole("option", { name, exact: true })
			.locator("[data-slot=choice-mark]")
			.evaluate((el) => (el as HTMLElement).style.getPropertyValue("--tile"));
	expect(await tile("Pantry stock")).toMatch(/^var\(--bucket-\d\)$/);
	expect(await tile("Broadband plan")).toBe("");
	await expect(list.getByText("Bills", { exact: true })).toBeAttached();
	// A row is a comfortable target.
	const row = await options.first().boundingBox();
	expect(row?.height).toBeGreaterThanOrEqual(36);

	// A heading stays in view while its group scrolls.
	const scroller = page.locator("[data-slot=command-list]");
	await scroller.evaluate((el) => el.scrollTo(0, 200));
	const heading = list.getByText("Buckets", { exact: true });
	const at = await heading.boundingBox();
	const frame = await scroller.boundingBox();
	expect(Math.abs((at?.y ?? 0) - (frame?.y ?? -100))).toBeLessThan(2);

	const search = page.getByPlaceholder("Find a Bucket or Commitment");
	// A later word's beginning.
	await search.fill("out");
	await expect(options).toHaveText(["Meals out"]);
	// Any case, with a letter missing.
	await search.fill("WARDRBE");
	await expect(options).toHaveText(["Wardrobe"]);
	// The name that begins with what's typed comes before one that has it as a later word.
	await search.fill("st");
	await expect(options.first()).toHaveText("Pantry stock");
	await search.fill("pre");
	await expect(options).toHaveText(["Presents"]);
	// Enter takes the first match; the sheet under the list stays open.
	await search.fill("rink");
	await expect(options).toHaveText(["Rink fees"]);
	await page.keyboard.press("Enter");
	await expect(list).toBeHidden();
	await expect(field).toHaveText("Rink fees");
	await expect(field.locator("[data-slot=choice-mark]")).toBeVisible();
	await expect(sheet).toBeVisible();

	// It opens on the chosen row, which is marked; the arrow keys move from it, and Esc closes
	// the list alone.
	await field.click();
	await expect(list.getByRole("option", { name: "Rink fees" })).toHaveAttribute(
		"data-checked",
		"true",
	);
	await expect(list.getByRole("option", { name: "Rink fees" })).toHaveAttribute(
		"aria-selected",
		"true",
	);
	await page.keyboard.press("ArrowDown");
	await expect(list.getByRole("option", { name: "Treats" })).toHaveAttribute(
		"aria-selected",
		"true",
	);
	await page.keyboard.press("Escape");
	await expect(list).toBeHidden();
	await expect(sheet).toBeVisible();
	await page.context().close();
});

test("on a 320px phone a Rule's list fits the screen, scrolls under a finger's wheel, and Esc leaves the sheet open @phone", async ({
	browser,
}) => {
	test.slow();
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, {
		baseline: "9,000",
		buckets: picked.split(",").map((name) => [name, "100"] as [string, string]),
	});
	await page.setViewportSize({ width: 320, height: 640 });
	const sheet = await openAddRule(page);
	await sheet.getByRole("combobox", { name: "Files to" }).click();
	const scroller = page.locator("[data-slot=command-list]");
	await expect(scroller).toBeVisible();
	const panel = await page.locator("[data-slot=combobox-content]").boundingBox();
	expect(panel?.x).toBeGreaterThanOrEqual(0);
	expect((panel?.x ?? 0) + (panel?.width ?? 999)).toBeLessThanOrEqual(320);
	expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
	expect(await scroller.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
	// A finger's target.
	const row = await page.getByRole("option").first().boundingBox();
	expect(row?.height).toBeGreaterThanOrEqual(44);
	const box = await scroller.boundingBox();
	await page.mouse.move((box?.x ?? 0) + 40, (box?.y ?? 0) + 60);
	await page.mouse.wheel(0, 200);
	await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(100);
	await page.keyboard.press("Escape");
	await expect(scroller).toBeHidden();
	await expect(sheet).toBeVisible();
	await page.context().close();
});

test("the Assigned to cell's list is the same list: colours, Suggested first, a forgiving search, and Enter files", async ({
	browser,
}) => {
	test.slow();
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, {
		baseline: "9,000",
		buckets: picked.split(",").map((name) => [name, "100"] as [string, string]),
		commitments: [{ name: "Broadband plan", amountCents: 6_000, cadence: "monthly", dueDay: 5 }],
	});
	const quickAdd = page.getByRole("dialog", { name: "Quick Add" });
	await page.getByRole("link", { name: "Quick Add" }).first().click();
	await expect(quickAdd).toBeVisible();
	await page.keyboard.type("12.40");
	await quickAdd.getByLabel("Note").fill("Corner bakery");
	const added = savedBy(page, "addQuickAdd");
	await pickQuickAddBucket(quickAdd, "Treats");
	await expect(quickAdd).toBeHidden();
	await added;

	// Through the app's own link: the page is live already, so the cell answers its first press.
	await page
		.getByRole("navigation", { name: "Main" })
		.getByRole("link", { name: "Transactions" })
		.click();
	await page.getByRole("button", { name: "Refile Corner bakery, now Treats", exact: true }).click();
	const list = page.getByRole("listbox");
	const options = list.getByRole("option");
	await expect(options).toHaveCount(15);
	await expect(list.locator("[data-slot=choice-mark]")).toHaveCount(15);
	// Where spending was filed lately comes first, under its own heading, and is listed once.
	await expect(list.getByText("Suggested", { exact: true })).toBeVisible();
	await expect(options.first()).toHaveText("Treats");
	await expect(options.first()).toHaveAttribute("data-checked", "true");
	await expect(list.getByText("Bills", { exact: true })).toBeAttached();

	const search = page.getByPlaceholder("Search or create");
	// Two letters swapped, and the row to create what was typed stays last.
	await search.fill("getawyas");
	await expect(options).toHaveText(["Getaways", "Create Bucket “getawyas”"]);
	// A bill is found by a later word too.
	await search.fill("plan");
	await expect(options.first()).toHaveText("Broadband plan");
	await search.fill("ends");
	await expect(options.first()).toHaveText("Odds and ends");
	const saved = savedBy(page, "updateTransaction");
	await page.keyboard.press("Enter");
	await saved;
	await expect(
		page.getByRole("button", { name: "Refile Corner bakery, now Odds and ends", exact: true }),
	).toBeVisible();
	await page.context().close();
});
