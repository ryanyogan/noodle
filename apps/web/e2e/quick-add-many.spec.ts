import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { createTestParent } from "./parents";
import { createPlannedHousehold, signedInPage } from "./session";

// ADR-0031's guard: a real Household's 30 Buckets, plus both Parents' Personal Allowances, never
// make Quick Add scroll. The common save (an amount, then the likely Bucket) fits a 375×667 phone
// and a 1280×720 computer; the rest is a search away; a Rule's merchant steers the order; and the
// other Parent's Personal Allowance never shows.

let parent: Awaited<ReturnType<typeof createTestParent>>;

test.beforeEach(async () => {
	parent = await createTestParent();
});

test.afterEach(async () => {
	await parent?.remove();
});

const names = [
	"Groceries",
	"Dining out",
	"Gas",
	"Kids",
	"Household",
	"Fun money",
	"Gifts",
	"Pet supplies",
	"Clothes",
	"Haircuts",
	"Hockey",
	"Swim lessons",
	"School lunches",
	"Coffee",
	"Takeout",
	"Pharmacy",
	"Doctor copays",
	"Home repairs",
	"Garden",
	"Car wash",
	"Parking",
	"Books",
	"Movies",
	"Birthday parties",
	"Date night",
	"Camping",
	"Hobbies",
	"Charity",
	"Office supplies",
	"Toys",
];

const MINE = "Alex’s Personal Allowance";
const THEIRS = "Sam’s Personal Allowance";

/** 30 Buckets, both Personal Allowances, and a Rule filing Chewy into Pet supplies (not in the five). */
async function manyBuckets(page: Page) {
	await createPlannedHousehold(page, {
		baseline: "12,000",
		buckets: names.map((name, at) => [name, String(100 + at * 10)] as [string, string]),
		personalAllowanceCents: 20_000,
		otherParent: { name: "Sam", personalAllowanceCents: 15_000 },
		rules: [{ pattern: "chewy", bucket: "Pet supplies" }],
	});
}

const sheet = (page: Page) => page.getByRole("dialog", { name: "Quick Add" });
const saved = (page: Page, bucket: string) =>
	page.getByRole("status").filter({ hasText: "added to" }).filter({ hasText: bucket });

const axe = (page: Page) =>
	new AxeBuilder({ page })
		.include("[role=dialog]")
		.withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
		.analyze();

async function noScroll(page: Page) {
	expect(await sheet(page).evaluate((el) => el.scrollHeight - el.clientHeight)).toBeLessThanOrEqual(
		0,
	);
}

test("on a 375×667 phone with 30 Buckets, the common save needs no scrolling, and More finds the rest", {
	tag: "@phone",
}, async ({ browser }) => {
	const page = await signedInPage(browser, parent.email, {
		viewport: { width: 375, height: 667 },
		isMobile: true,
		hasTouch: true,
	});
	await manyBuckets(page);
	const open = () =>
		page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Quick Add" }).tap();
	await open();
	const keypad = sheet(page).getByRole("group", { name: "Keypad" });
	const tiles = sheet(page).getByRole("list", { name: "Add to" }).getByRole("listitem");
	const more = sheet(page).getByRole("button", { name: /^More Buckets/ });
	await expect(tiles).toHaveCount(6);
	for (const key of ["2", "4"]) await keypad.getByRole("button", { name: key, exact: true }).tap();
	await expect(sheet(page).getByRole("status", { name: "Amount" })).toHaveText("$24");
	for (const shown of [
		sheet(page).getByRole("status", { name: "Amount" }),
		tiles.first(),
		more,
		keypad.getByRole("button", { name: "Delete" }),
	]) {
		await expect(shown).toBeInViewport({ ratio: 1 });
	}
	await noScroll(page);
	await expect(sheet(page).getByText(THEIRS)).toHaveCount(0);

	// The note's merchant has a Rule: its Bucket goes first, saying why.
	await sheet(page).getByLabel("Note").fill("Chewy");
	await expect(tiles.first()).toContainText("Pet supplies");
	await expect(tiles.first()).toContainText("From your Rule");
	await sheet(page).getByLabel("Note").fill("");

	// More Buckets: every Bucket in sections, mine but never the other Parent's Personal Allowance.
	await more.tap();
	const find = sheet(page).getByRole("searchbox", { name: "Find a Bucket" });
	await expect(find).toBeFocused();
	const mine = sheet(page).getByRole("region", { name: "My Personal Allowance" });
	await expect(mine.getByRole("button", { name: new RegExp(`^${MINE}`) })).toBeVisible();
	await expect(sheet(page).getByText(THEIRS)).toHaveCount(0);
	const { violations } = await axe(page);
	expect(violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
	await find.fill("allowance");
	await expect(mine.getByRole("button", { name: new RegExp(`^${MINE}`) })).toBeVisible();
	await expect(sheet(page).getByText(THEIRS)).toHaveCount(0);

	// Search finds a Bucket outside the five, and with an amount typed, picking it is the save.
	await find.fill("toy");
	await sheet(page)
		.getByRole("region", { name: "Household" })
		.getByRole("button", { name: /^Toys/ })
		.tap();
	await expect(sheet(page)).toBeHidden();
	await expect(saved(page, "Toys")).toBeVisible();

	// The common save: an amount, then the first tile.
	await open();
	await keypad.getByRole("button", { name: "7", exact: true }).tap();
	const tile = tiles.first().getByRole("button");
	// The tile's first line is the Bucket's name; its monogram is hidden from the name.
	const first = (
		await tile.locator(':scope > span:not([aria-hidden="true"])').first().innerText()
	).trim();
	await tile.tap();
	await expect(sheet(page)).toBeHidden();
	// An earlier save's toast can still be showing; the newest is last.
	await expect(saved(page, first).last()).toBeVisible();
	await page.context().close();
});

test("on a 1280×720 computer with 30 Buckets, Quick Add never scrolls and the keyboard alone files to any Bucket", async ({
	browser,
}) => {
	const page = await signedInPage(browser, parent.email, {
		viewport: { width: 1280, height: 720 },
	});
	await manyBuckets(page);
	const find = sheet(page).getByRole("combobox", { name: "Find a Bucket" });
	const options = sheet(page).getByRole("listbox", { name: "Add to" }).getByRole("option");

	// q 2 4: the amount, the highlighted Bucket and the Add button all fit, and nothing scrolls.
	await page.keyboard.press("q");
	await expect(options.first()).toHaveAttribute("aria-selected", "true");
	await page.keyboard.type("24");
	const add = sheet(page).getByRole("button", { name: /^Add \$24 to / });
	for (const shown of [sheet(page).getByRole("status", { name: "Amount" }), options.first(), add]) {
		await expect(shown).toBeInViewport({ ratio: 1 });
	}
	await noScroll(page);
	await expect(sheet(page).getByText(THEIRS)).toHaveCount(0);
	const { violations } = await axe(page);
	expect(violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);

	// Letters search past the five; ↓ moves to the second match, and Enter adds to it.
	await page.keyboard.type("par");
	await expect(find).toBeFocused();
	await expect(options).toHaveCount(2);
	await page.keyboard.press("ArrowDown");
	await expect(find).toHaveAttribute(
		"aria-activedescendant",
		(await options.nth(1).getAttribute("id")) ?? "",
	);
	const target = ((await add.textContent()) ?? "").replace(/^Add \$24 to /, "");
	expect(["Parking", "Birthday parties"]).toContain(target);
	await page.keyboard.press("Enter");
	await expect(sheet(page)).toBeHidden();
	await expect(saved(page, target)).toBeVisible();

	// Esc clears the search, then closes.
	await page.keyboard.press("q");
	await page.keyboard.type("5toy");
	await expect(options.first()).toContainText("Toys");
	await page.keyboard.press("Escape");
	await expect(find).toHaveValue("");
	await expect(sheet(page)).toBeVisible();

	// My Personal Allowance is found; the other Parent's never is.
	await page.keyboard.type("allowance");
	await expect(options.filter({ hasText: MINE })).toHaveCount(1);
	await expect(sheet(page).getByText(THEIRS)).toHaveCount(0);
	await page.keyboard.press("Escape");

	// The note's merchant has a Rule: its Bucket goes first, saying why, and Enter in the note adds there.
	await sheet(page).getByLabel("Note").fill("Chewy");
	await expect(options.first()).toContainText("Pet supplies");
	await expect(options.first()).toContainText("From your Rule");
	await expect(sheet(page).getByRole("button", { name: "Add $5 to Pet supplies" })).toBeVisible();
	await sheet(page).getByLabel("Note").press("Enter");
	await expect(sheet(page)).toBeHidden();
	await expect(saved(page, "Pet supplies")).toBeVisible();
	await page.context().close();
});

test(
	"Quick Add with 30 Buckets looks the same on a 393 phone",
	{ tag: "@phone" },
	async ({ browser }, testInfo) => {
		test.skip(testInfo.project.name !== "chromium-mobile", "one engine's pictures are enough");
		const page = await signedInPage(browser, parent.email, {
			viewport: { width: 393, height: 852 },
			isMobile: true,
			hasTouch: true,
		});
		await manyBuckets(page);
		await page
			.getByRole("navigation", { name: "Main" })
			.getByRole("link", { name: "Quick Add" })
			.tap();
		await expect(sheet(page).getByRole("button", { name: /^More Buckets/ })).toBeVisible();
		await expect(sheet(page)).toHaveScreenshot("quick-add-393.png");
		await page.context().close();
	},
);

test("Quick Add with 30 Buckets looks the same on a 1440 computer", async ({ browser }) => {
	const page = await signedInPage(browser, parent.email, {
		viewport: { width: 1440, height: 900 },
	});
	await manyBuckets(page);
	await page.keyboard.press("q");
	await expect(sheet(page).getByRole("option").first()).toHaveAttribute("aria-selected", "true");
	await page.keyboard.type("24");
	await expect(sheet(page)).toHaveScreenshot("quick-add-1440.png");
	await page.context().close();
});
