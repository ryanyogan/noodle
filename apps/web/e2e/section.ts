import { expect, type Page } from "@playwright/test";

type Marked = Element & { kept?: boolean };

const HEADER = "[data-slot=section-layout-header]";

/** Marks a section's header node. A header that re-mounted would be a new node, without the mark. */
export async function markSectionHeader(page: Page) {
	await page.locator(HEADER).evaluate((node) => {
		(node as Marked).kept = true;
	});
}

/** The header marked before going to another tab is still the same node. */
export async function expectSectionHeaderKept(page: Page) {
	expect(await page.locator(HEADER).evaluate((node) => (node as Marked).kept === true)).toBe(true);
}

/** A section's tabs, by the name of their `<nav>` ("Explore pages", "Review pages"). */
export const sectionTabs = (page: Page, name: string) => page.getByRole("navigation", { name });

/** The tab of the page being shown. */
export const currentTab = (page: Page, name: string) =>
	sectionTabs(page, name).locator("[aria-current=page]");
