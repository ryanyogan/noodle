import { expect, type Page, test } from "@playwright/test";
import { createTestParent } from "./parents";
import { createPlannedHousehold, openFromMore, signedInPage } from "./session";

// A term the Parents keep is explained where it first appears: a "?" beside it opens a sentence
// and a link to the Glossary, by mouse, by keyboard and by touch (ADR-0018). The Glossary lists
// every term, with the word a renamed one used to be.

let parent: Awaited<ReturnType<typeof createTestParent>>;

test.beforeEach(async () => {
	parent = await createTestParent();
});

test.afterEach(async () => {
	await parent?.remove();
});

const plan = { baseline: "5,000", buckets: [["Groceries", "1,200"]] as [string, string][] };
const phone = { viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true };
const heading = (page: Page) => page.getByRole("heading", { level: 1 });
const glossaryDialog = (page: Page) => page.getByRole("dialog", { name: "Glossary" });
const freeToSpendHelp = (page: Page) =>
	page.getByRole("button", { name: "What’s “Free to Spend”?" });

test("a term's help explains it in place and leads to the Glossary", async ({ browser }) => {
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, plan);

	// By keyboard: it opens on Enter, closes on Esc, and focus comes back to the "?".
	await freeToSpendHelp(page).focus();
	await page.keyboard.press("Enter");
	const popover = page.getByRole("dialog");
	await expect(popover).toContainText("isn’t planned for a Commitment, a Bucket or a Goal yet");
	await page.keyboard.press("Escape");
	await expect(popover).toBeHidden();
	await expect(freeToSpendHelp(page)).toBeFocused();

	// The heading's name is still just the term.
	await expect(page.getByRole("region", { name: "Free to Spend", exact: true })).toBeVisible();

	// By mouse, through to the Glossary: it opens over the page at the term, and Esc gives focus
	// back to the "?".
	await freeToSpendHelp(page).click();
	await popover.getByRole("link", { name: "More in the Glossary" }).click();
	const glossary = glossaryDialog(page);
	await expect(glossary).toBeVisible();
	await expect(page).toHaveURL(/\/month/);
	const freeToSpend = glossary.locator("#free-to-spend");
	await expect(freeToSpend).toHaveAttribute("data-highlighted", "true");
	await expect(freeToSpend).toBeInViewport();
	await page.keyboard.press("Escape");
	await expect(glossary).toBeHidden();
	await expect(freeToSpendHelp(page)).toBeFocused();

	// On a computer the Glossary is linked from Ask (#100), which is the small button on every
	// page; it opens over Ask, searches, and closes by clicking outside.
	await page.getByRole("link", { name: "Ask Noodle" }).click();
	await expect(heading(page)).toHaveText("Ask");
	const icon = page.getByRole("link", { name: "the Glossary" });
	await icon.click();
	await expect(glossary).toBeVisible();
	expect(await glossary.getByRole("term").count()).toBeGreaterThan(10);
	await glossary.getByRole("searchbox", { name: "Search the Glossary" }).fill("baseline");
	await expect(glossary.getByRole("term")).toHaveText(["Take-home pay"]);
	await expect(glossary.getByText("Used to be called “Baseline”.")).toBeVisible();
	await page.mouse.click(5, 5);
	await expect(glossary).toBeHidden();
	await expect(icon).toBeFocused();
	// The sidebar has no Glossary of its own any more: no page, and no button.
	const sidebar = page.getByRole("navigation", { name: "Main" });
	await expect(sidebar.getByRole("link", { name: "Glossary" })).toHaveCount(0);
	await expect(sidebar.getByRole("button", { name: "Glossary" })).toHaveCount(0);

	// The page is still there to link to, from each term's help.
	await page.goto("/glossary");
	await expect(heading(page)).toHaveText("Glossary");
	await expect(page.getByRole("term").filter({ hasText: "Take-home pay" })).toBeVisible();
	await page.goto("/glossary#sweep");
	await expect(page.locator("#sweep")).toBeInViewport();
	await page.context().close();
});

test("on a phone, a term's help opens with a tap and fits the screen", { tag: "@phone" }, async ({
	browser,
}) => {
	const page = await signedInPage(browser, parent.email, phone);
	await createPlannedHousehold(page, plan);

	await freeToSpendHelp(page).tap();
	const popover = page.getByRole("dialog");
	await expect(popover).toBeVisible();
	const box = await popover.boundingBox();
	expect(box).not.toBeNull();
	if (box) {
		expect(box.x).toBeGreaterThanOrEqual(0);
		expect(box.x + box.width).toBeLessThanOrEqual(393);
	}

	// Its link opens the Glossary as a sheet over the page, at the term.
	await popover.getByRole("link", { name: "More in the Glossary" }).tap();
	const glossary = glossaryDialog(page);
	await expect(glossary).toBeVisible();
	await expect(glossary.locator("#free-to-spend")).toBeInViewport();
	await glossary.getByRole("button", { name: "Close" }).tap();
	await expect(glossary).toBeHidden();

	// The Glossary is in the More sheet, opened from the tab bar's last item.
	await expect(
		page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: "Glossary" }),
	).toHaveCount(0);
	await openFromMore(page, "Glossary");
	await expect(glossary).toBeVisible();
	const sheet = await glossary.boundingBox();
	expect(sheet).not.toBeNull();
	if (sheet) {
		expect(sheet.x).toBeGreaterThanOrEqual(0);
		expect(sheet.x + sheet.width).toBeLessThanOrEqual(393);
	}
	await glossary.getByRole("searchbox", { name: "Search the Glossary" }).fill("sweep");
	await expect(glossary.getByRole("term").filter({ hasText: /^Sweep$/ })).toBeVisible();
	await glossary.getByRole("button", { name: "Close" }).tap();
	await expect(glossary).toBeHidden();
	await page.context().close();
});
