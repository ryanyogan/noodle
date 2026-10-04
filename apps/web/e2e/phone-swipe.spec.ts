import { expect, type Page } from "@playwright/test";
import { createPlannedHousehold, openFromMore, signedInPage, switchTo } from "./session";
import { realTouch, swipe } from "./touch";
import { type SharedParent, test } from "./worker-parent";

// Swiping a sheet closed on a phone (packages/ui's Sheet): a drag down from the grabber or the
// header closes it; a short drag doesn't, and leaves the place in a list inside it; a swipe that
// starts in the list scrolls the list rather than closing the sheet.

let parent: SharedParent;

test.beforeEach(async ({ sharedParent }) => {
	parent = sharedParent;
});

const quickAdd = (page: Page) => page.getByRole("dialog", { name: "Quick Add" });
const glossary = (page: Page) => page.getByRole("dialog", { name: "Glossary" });
const listOf = (page: Page) => glossary(page).locator(".overflow-y-auto").first();

test("a sheet swipes closed from its grabber and its header", async ({ browser }) => {
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, { baseline: "5,000", buckets: [["Groceries", "1,200"]] });
	await switchTo(page, "Month");

	const tabBar = page.getByRole("navigation", { name: "Main" });
	await tabBar.getByRole("link", { name: "Quick Add" }).click();
	await expect(quickAdd(page)).toBeVisible();
	await swipe(page, quickAdd(page).locator("[data-slot=sheet-grabber]"), 200);
	await expect(quickAdd(page)).toBeHidden();

	await tabBar.getByRole("link", { name: "Quick Add" }).click();
	await expect(quickAdd(page)).toBeVisible();
	await swipe(page, quickAdd(page).getByRole("heading", { name: "Quick Add" }), 200);
	await expect(quickAdd(page)).toBeHidden();
});

test("a short drag keeps the sheet and its list's place, and a swipe in the list scrolls it", async ({
	browser,
}) => {
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, { baseline: "5,000", buckets: [["Groceries", "1,200"]] });
	await openFromMore(page, "Glossary");
	await expect(glossary(page)).toBeVisible();
	const list = listOf(page);
	const scrollTop = () => list.evaluate((el) => Math.round(el.scrollTop));

	// A swipe up that starts in the list scrolls it (a real touch only), and never closes the sheet.
	await swipe(page, list, -250);
	await expect(glossary(page)).toBeVisible();
	if (realTouch(page)) await expect.poll(scrollTop).toBeGreaterThan(50);

	// Once the fling has stopped, from a known place.
	await expect
		.poll(async () => {
			const a = await scrollTop();
			await page.waitForTimeout(150);
			return a === (await scrollTop());
		})
		.toBe(true);
	await list.evaluate((el) => {
		el.scrollTop = 300;
	});
	const before = await scrollTop();
	expect(before).toBeGreaterThan(0);

	// Less than the threshold: the sheet settles back, the list where it was.
	await swipe(page, glossary(page).getByRole("heading", { name: "Glossary" }), 40);
	await expect(glossary(page)).toBeVisible();
	await expect.poll(() => glossary(page).evaluate((el) => el.style.transform)).toBe("");
	expect(await scrollTop()).toBe(before);

	await swipe(page, glossary(page).getByRole("heading", { name: "Glossary" }), 220);
	await expect(glossary(page)).toBeHidden();
});
