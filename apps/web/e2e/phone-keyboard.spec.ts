import { expect, type Locator, type Page, test } from "@playwright/test";
import { visibleBottom, withKeyboard } from "./keyboard";
import { createTestParent } from "./parents";
import { createPlannedHousehold, signedInPage } from "./session";

// Typing in a sheet with the iPhone keyboard up (#52 rows 143 and 147): the sheet sits above the
// keyboard, its primary button can be seen, the page underneath doesn't jump, and what was typed
// is kept. The keyboard is emulated by shrinking the visual viewport (see keyboard.ts). Runs on
// the phone projects, so the browser and screen come from the project (iPhone 15, iPhone SE).

let parent: Awaited<ReturnType<typeof createTestParent>>;

test.beforeEach(async () => {
	parent = await createTestParent();
});

test.afterEach(async () => {
	await parent?.remove();
});

/** An iPhone keyboard with the suggestions bar is about 336 px tall in portrait. */
const keyboardHeight = 336;

const scrollY = (page: Page) => page.evaluate(() => window.scrollY);

/** The element is wholly inside what the keyboard leaves visible. */
async function expectAboveKeyboard(page: Page, locator: Locator) {
	// A sheet slides up as it opens: measured again until it has come to rest.
	await expect(async () => {
		const bottom = await visibleBottom(page);
		const box = await locator.boundingBox();
		expect(box, "it is on screen").not.toBeNull();
		expect(box?.y ?? -1).toBeGreaterThanOrEqual(0);
		expect((box?.y ?? 0) + (box?.height ?? Number.POSITIVE_INFINITY)).toBeLessThanOrEqual(
			bottom + 1,
		);
	}).toPass({ timeout: 3000 });
}

test("Quick Add stays above the keyboard while a note is typed", async ({ browser }) => {
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, { baseline: "5,000", buckets: [["Groceries", "1,200"]] });
	const keyboardGone = await withKeyboard(page, keyboardHeight);

	const before = await scrollY(page);
	await page.getByRole("link", { name: "Quick Add" }).first().click();
	const sheet = page.getByRole("dialog", { name: "Quick Add" });
	const keypad = sheet.getByRole("group", { name: "Keypad" });
	await keypad.getByRole("button", { name: "4", exact: true }).click();
	await keypad.getByRole("button", { name: "2", exact: true }).click();

	const note = sheet.getByLabel("Note");
	await note.click();
	await expect(note).toBeFocused();
	await expect
		.poll(() =>
			page.evaluate(() => document.documentElement.style.getPropertyValue("--keyboard-inset")),
		)
		.toBe(`${keyboardHeight}px`);
	await page.keyboard.type("Costco run");

	await expectAboveKeyboard(page, sheet);
	await expectAboveKeyboard(page, note);
	await expectAboveKeyboard(page, sheet.getByRole("button", { name: /^Groceries/ }));
	expect(await scrollY(page)).toBe(before);
	await expect(note).toHaveValue("Costco run");
	await expect(sheet.locator("output")).toHaveText("$42");
	// The keypad steps aside for the keyboard, which has numbers of its own.
	await expect(keypad).toBeHidden();

	// The keyboard goes away: the sheet drops back to the bottom with the note kept.
	await keyboardGone();
	await expect
		.poll(() =>
			page.evaluate(() => document.documentElement.style.getPropertyValue("--keyboard-inset")),
		)
		.toBe("0px");
	await expect(keypad).toBeVisible();
	await expect(note).toHaveValue("Costco run");
	await sheet.getByRole("button", { name: /^Groceries/ }).click();
	await expect(sheet).toBeHidden();
	await page.context().close();
});

test("Edit Transaction stays above the keyboard with Save in view", async ({ browser }) => {
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, { baseline: "5,000", buckets: [["Groceries", "1,200"]] });
	const quickAdd = page.getByRole("dialog", { name: "Quick Add" });
	await page.getByRole("link", { name: "Quick Add" }).first().click();
	await quickAdd.getByRole("group", { name: "Keypad" }).getByRole("button", { name: "9" }).click();
	await quickAdd.getByLabel("Note").fill("Costco");
	await quickAdd.getByRole("button", { name: /^Groceries/ }).click();
	await expect(quickAdd).toBeHidden();

	await page
		.getByRole("navigation", { name: "Main" })
		.getByRole("link", { name: "Transactions" })
		.click();
	await page
		.getByRole("grid", { name: /^Transactions in / })
		.getByRole("button", { name: /^Costco,/ })
		.click();
	const sheet = page.getByRole("dialog").filter({
		has: page.getByRole("heading", { name: "Edit Transaction" }),
	});
	await expect(sheet).toBeVisible();
	const keyboardGone = await withKeyboard(page, keyboardHeight);
	const before = await scrollY(page);

	const note = sheet.getByLabel("Name");
	await note.click();
	await page.keyboard.press("End");
	await page.keyboard.type(" for the week");
	await expectAboveKeyboard(page, sheet);
	await expectAboveKeyboard(page, note);
	await expectAboveKeyboard(page, sheet.getByRole("button", { name: "Save" }));
	expect(await scrollY(page)).toBe(before);
	await expect(note).toHaveValue("Costco for the week");

	const amount = sheet.getByLabel("Amount");
	await amount.click();
	await amount.fill("12.50");
	await expectAboveKeyboard(page, sheet.getByRole("button", { name: "Save" }));
	await expect(note).toHaveValue("Costco for the week");

	await keyboardGone();
	await sheet.getByRole("button", { name: "Save" }).click();
	await expect(sheet).toBeHidden();
	await expect(
		page.getByRole("grid", { name: /^Transactions in / }).getByRole("button", {
			name: /^Costco for the week, \$12\.50/,
		}),
	).toBeVisible();
	await page.context().close();
});

test("the Bucket sheet opens on its amount and stays above the keyboard with Save in view", async ({
	browser,
}) => {
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, {
		baseline: "5,000",
		buckets: [
			["Groceries", "1,200"],
			["Gas", "200"],
		],
	});
	const now = new Date();
	await page.goto(
		`/plan/${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}/buckets`,
	);
	await expect(page.getByRole("button", { name: "Add Buckets", exact: true })).toBeEnabled();
	const keyboardGone = await withKeyboard(page, keyboardHeight);
	const before = await scrollY(page);

	// The row's pencil opens the one Bucket sheet with the amount ready to type (the row itself
	// opens the Bucket's page, issue 107).
	await page
		.locator("[data-bucket-row]")
		.filter({ has: page.getByRole("link", { name: "Groceries", exact: true }) })
		.getByRole("button", { name: "Edit Groceries", exact: true })
		.click();
	const sheet = page.getByRole("dialog", { name: "Groceries", exact: true });
	const amount = sheet.getByRole("textbox", { name: "Allowance", exact: true });
	await expect(amount).toBeFocused();
	await expect
		.poll(() =>
			page.evaluate(() => document.documentElement.style.getPropertyValue("--keyboard-inset")),
		)
		.toBe(`${keyboardHeight}px`);
	await amount.fill("1,300");
	await expect(sheet.getByRole("radio", { name: /^From .* on$/ })).toBeChecked();

	await expectAboveKeyboard(page, sheet);
	await expectAboveKeyboard(page, amount);
	await expectAboveKeyboard(page, sheet.getByRole("button", { name: "Save", exact: true }));
	expect(await scrollY(page)).toBe(before);

	await keyboardGone();
	await sheet.getByRole("button", { name: "Save", exact: true }).click();
	await expect(sheet).toBeHidden();
	await page.context().close();
});
