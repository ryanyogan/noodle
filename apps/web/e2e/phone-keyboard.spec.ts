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

// Issue 110: on a screen too short for the whole sheet, "For" sat behind the keypad, which stays
// at the bottom while the rest scrolls under it. Being inside the sheet's box it counted as in
// view, so neither focus nor a scroll to it brought it out.
test("Quick Add's For can be reached and changed on a short screen, and with the keyboard up", async ({
	browser,
}) => {
	for (const width of [393, 320]) {
		const page = await signedInPage(browser, parent.email, {
			viewport: { width, height: 500 },
			isMobile: true,
			hasTouch: true,
		});
		if (width === 393) {
			await createPlannedHousehold(page, {
				baseline: "5,000",
				buckets: [
					["Groceries", "1,200"],
					["Gas", "200"],
					["Dining out", "300"],
					["Kids", "150"],
					["Household", "250"],
					["Fun money", "100"],
					["Pet supplies", "80"],
				],
			});
		} else await page.goto("/month");
		await page.getByRole("link", { name: "Quick Add" }).first().click();
		const sheet = page.getByRole("dialog", { name: "Quick Add" });
		const keypad = sheet.getByRole("group", { name: "Keypad" });
		await keypad.getByRole("button", { name: "4", exact: true }).click();
		const forLine = sheet.getByRole("button", { name: /^For: / });
		const choices = sheet.getByRole("radiogroup", { name: "For" });

		// The keypad is showing: For comes to rest between the top of the sheet and the keypad.
		const clearOfKeypad = async () => {
			await expect(async () => {
				const box = await forLine.boundingBox();
				const top = (await keypad.boundingBox())?.y ?? 0;
				expect(box?.y ?? -1).toBeGreaterThanOrEqual(0);
				expect((box?.y ?? 0) + (box?.height ?? Number.POSITIVE_INFINITY)).toBeLessThanOrEqual(top);
			}).toPass({ timeout: 3000 });
		};
		await forLine.focus();
		await clearOfKeypad();
		await forLine.tap();
		const someone = choices.getByRole("radio").nth(1);
		const name = (await someone.textContent()) ?? "";
		expect(name.trim()).not.toBe("");
		await someone.tap();
		await expect(forLine).toHaveText(`For: ${name.trim()}`);
		// Back at the top, a scroll to it (as a screen reader's swipe does) brings it out too.
		await sheet.evaluate((el) => el.scrollTo(0, 0));
		await forLine.evaluate((el) => el.scrollIntoView({ block: "nearest" }));
		await clearOfKeypad();

		// With the keyboard up for the note, the keypad is gone and For is above the keyboard.
		const keyboardGone = await withKeyboard(page, 240);
		await sheet.getByLabel("Note").click();
		await expect(keypad).toBeHidden();
		await forLine.scrollIntoViewIfNeeded();
		await expectAboveKeyboard(page, forLine);
		await keyboardGone();
		await page.context().close();
	}
});

// A Transaction on a phone is a page, not a sheet (ADR-0024, 2026-10-08): the field being typed
// in is above the keyboard, the page doesn't jump, what was typed is kept, and Save stays in view
// above the keyboard, as it did in the sheet.
test("a Transaction's page keeps the field being typed in and Save above the keyboard", async ({
	browser,
}) => {
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
		.locator("[data-slot=data-table-body]")
		.getByRole("button", { name: /^Costco,/ })
		.click();
	const sheet = page.locator("[data-slot=transaction-detail]").filter({
		has: page.getByRole("heading", { name: "Edit Transaction" }),
	});
	await expect(sheet).toBeVisible();
	await expect(page.getByRole("dialog")).toHaveCount(0);
	const keyboardGone = await withKeyboard(page, keyboardHeight);

	const note = sheet.getByLabel("Name");
	await note.click();
	const before = await scrollY(page);
	await page.keyboard.press("End");
	await page.keyboard.type(" for the week");
	await expectAboveKeyboard(page, note);
	await expectAboveKeyboard(page, sheet.getByRole("button", { name: "Save" }));
	expect(await scrollY(page)).toBe(before);
	await expect(note).toHaveValue("Costco for the week");

	const amount = sheet.getByLabel("Amount");
	await amount.click();
	await amount.fill("12.50");
	await expectAboveKeyboard(page, amount);
	await expectAboveKeyboard(page, sheet.getByRole("button", { name: "Save" }));
	await expect(note).toHaveValue("Costco for the week");

	await keyboardGone();
	await sheet.getByRole("button", { name: "Save" }).click();
	await expect(sheet).toBeHidden();
	await expect(
		page
			.getByRole("grid", { name: /^Transactions in / })
			.locator("[data-slot=data-table-body]")
			.getByRole("button", {
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
		`/plan/${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}#buckets`,
	);
	await expect(page.getByRole("button", { name: "Add Buckets", exact: true })).toBeEnabled();
	const keyboardGone = await withKeyboard(page, keyboardHeight);
	// Where the Buckets heading is in the window. Not the page's scroll: while a sheet is open the
	// page behind is held in place, and its scroll reads 0.
	const headingTop = () =>
		page.locator("#buckets").evaluate((el) => Math.round(el.getBoundingClientRect().top));
	const before = await headingTop();

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
	expect(Math.abs((await headingTop()) - before)).toBeLessThanOrEqual(1);

	await keyboardGone();
	await sheet.getByRole("button", { name: "Save", exact: true }).click();
	await expect(sheet).toBeHidden();
	await page.context().close();
});
