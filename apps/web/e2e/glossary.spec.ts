import { expect, type Page, test } from "@playwright/test";
import { createTestParent } from "./parents";
import { createPlannedHousehold, signedInPage } from "./session";

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

	// By mouse, through to the Glossary.
	await freeToSpendHelp(page).click();
	await popover.getByRole("link", { name: "More in the Glossary" }).click();
	await expect(heading(page)).toHaveText("HouseholdGlossary");
	await expect(page).toHaveURL(/\/glossary#free-to-spend$/);
	const terms = page.getByRole("term");
	await expect(terms.filter({ hasText: "Take-home pay" })).toBeVisible();
	await expect(page.getByText("Used to be called “Baseline”.")).toBeVisible();

	// The sidebar links to it, as the page you're on.
	await page.goBack();
	const glossaryLink = page
		.getByRole("navigation", { name: "Main" })
		.getByRole("link", { name: "Glossary" });
	await glossaryLink.click();
	await expect(heading(page)).toHaveText("HouseholdGlossary");
	await expect(glossaryLink).toHaveAttribute("aria-current", "page");

	// The Household page links to it too.
	await page
		.getByRole("navigation", { name: "Main" })
		.getByRole("link", { name: "Household" })
		.click();
	await page.getByRole("link", { name: "the Glossary" }).click();
	await expect(heading(page)).toHaveText("HouseholdGlossary");
	await page.context().close();
});

test("on a phone, a term's help opens with a tap and fits the screen", async ({ browser }) => {
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
	await page.context().close();
});
