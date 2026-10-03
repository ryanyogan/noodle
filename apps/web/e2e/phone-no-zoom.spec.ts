import { expect, type Page, test } from "@playwright/test";
import { createTestParent } from "./parents";
import { createPlannedHousehold, pickQuickAddBucket, signedInPage, switchTo } from "./session";

// Mobile Safari zooms the page when a field under 16 px gets focus. On a phone, portrait and
// landscape (both below lg), every field on the main pages and sheets is at least 16 px. Buttons
// that open a list (a Select's trigger) can't take typing, so they don't zoom and aren't checked.

let parent: Awaited<ReturnType<typeof createTestParent>>;

test.beforeEach(async () => {
	parent = await createTestParent();
});

test.afterEach(async () => {
	await parent?.remove();
});

/** Fields that would zoom on focus: visible, typeable, and under 16 px. */
const smallFields = (page: Page) =>
	page.evaluate(() =>
		[
			...document.querySelectorAll<HTMLElement>(
				"input, select, textarea, [role=combobox], [contenteditable=true]",
			),
		]
			.filter((el) => {
				if (el instanceof HTMLButtonElement) return false;
				if (
					el instanceof HTMLInputElement &&
					[
						"checkbox",
						"radio",
						"file",
						"range",
						"hidden",
						"submit",
						"button",
						"color",
						"image",
						"reset",
					].includes(el.type)
				)
					return false;
				const box = el.getBoundingClientRect();
				if (box.width <= 1 || box.height <= 1) return false;
				return Number.parseFloat(getComputedStyle(el).fontSize) < 16;
			})
			.map(
				(el) =>
					`${el.getAttribute("aria-label") ?? el.getAttribute("placeholder") ?? el.outerHTML.slice(0, 80)}: ${getComputedStyle(el).fontSize}`,
			),
	);

/** Checks the page now, then turned to landscape (as wide as the screen is tall), and back. */
async function expectNoZoom(page: Page, where: string) {
	const portrait = page.viewportSize() ?? { width: 393, height: 659 };
	expect(await smallFields(page), `${where}, portrait`).toEqual([]);
	// Turned sideways, Safari is as wide as the screen is tall: 852 on an iPhone 15, still below lg.
	const [width, height] = await page.evaluate(() => [
		Math.max(screen.width, screen.height),
		Math.min(screen.width, screen.height),
	]);
	await page.setViewportSize({ width, height });
	expect(await smallFields(page), `${where}, landscape`).toEqual([]);
	await page.setViewportSize(portrait);
}

test("no field on the main phone pages is small enough to zoom", async ({ browser }) => {
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, {
		baseline: "5,000",
		buckets: [
			["Groceries", "1,200"],
			["Gifts", "100"],
		],
	});
	await switchTo(page, "Month");
	await expectNoZoom(page, "This Month");

	const quickAdd = page.getByRole("dialog", { name: "Quick Add" });
	await page.getByRole("link", { name: "Quick Add" }).first().click();
	await expect(quickAdd.getByLabel("Note")).toBeVisible();
	await expectNoZoom(page, "Quick Add");
	await quickAdd.getByRole("group", { name: "Keypad" }).getByRole("button", { name: "7" }).click();
	await quickAdd.getByLabel("Note").fill("Costco");
	await pickQuickAddBucket(quickAdd, "Groceries");
	await expect(quickAdd).toBeHidden();

	await page
		.getByRole("navigation", { name: "Main" })
		.getByRole("link", { name: "Transactions" })
		.click();
	const list = page.getByRole("list", { name: /^Transactions in / });
	await expect(list.getByRole("button", { name: /^Costco,/ })).toBeVisible();
	await expectNoZoom(page, "Transactions");

	await list.getByRole("button", { name: /^Costco,/ }).click();
	const edit = page.getByRole("dialog").filter({
		has: page.getByRole("heading", { name: "Edit Transaction" }),
	});
	await expect(edit.getByLabel("Note")).toBeVisible();
	await expectNoZoom(page, "Edit Transaction");
	await page.keyboard.press("Escape");
	await expect(edit).toBeHidden();

	await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Month" }).click();
	await switchTo(page, "Plan");
	await page
		.getByRole("navigation", { name: "Plan pages" })
		.getByRole("link", { name: "Buckets", exact: true })
		.click();
	await expect(page.getByRole("button", { name: "Edit Gifts" })).toBeVisible();
	await expectNoZoom(page, "Plan Buckets");
	await page.getByRole("button", { name: "Edit Gifts" }).click();
	await expect(page.getByRole("dialog", { name: "Gifts" })).toBeVisible();
	await expectNoZoom(page, "Edit Bucket");
	await page.keyboard.press("Escape");

	await page.goto("/household");
	await expect(page.getByLabel("Add a Child")).toBeVisible();
	await expectNoZoom(page, "Household settings");
	await page.context().close();
});
