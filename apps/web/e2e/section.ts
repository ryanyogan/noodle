import { expect, type Page } from "@playwright/test";

type Marked = Element & { kept?: boolean };
type Shifts = { cls: number; header: number };
type Watched = Window & { __shifts?: Shifts };
type LayoutShift = PerformanceEntry & {
	value: number;
	hadRecentInput: boolean;
	sources?: { node?: Node | null }[];
};

const HEADER = "[data-slot=section-layout-header]";
// The header, and the section's tabs ("Explore pages", "Review pages") wherever they sit.
const HEADER_OR_TABS = `${HEADER}, nav[aria-label$=" pages"]`;

/**
 * Marks a section's header node. A header that re-mounted would be a new node, without the mark.
 * From here on it also records layout shifts, for `expectSectionHeaderKept`.
 */
export async function markSectionHeader(page: Page) {
	await page.locator(HEADER).evaluate((node, headerOrTabs) => {
		(node as Marked).kept = true;
		const shifts: Shifts = { cls: 0, header: 0 };
		(window as Watched).__shifts = shifts;
		new PerformanceObserver((list) => {
			for (const entry of list.getEntries() as LayoutShift[]) {
				// Cumulative Layout Shift leaves out shifts within 0.5 s of a click or key press.
				if (!entry.hadRecentInput) shifts.cls += entry.value;
				// The header and tabs mustn't move at all, right after the click that switched tabs too.
				const moved = (entry.sources ?? []).some(
					(source) => source.node instanceof Element && source.node.closest(headerOrTabs),
				);
				if (moved) shifts.header += entry.value;
			}
		}).observe({ type: "layout-shift" });
	}, HEADER_OR_TABS);
}

/**
 * The header marked before going to another tab is still the same node, neither it nor the
 * tabs moved, and the switch shifted nothing else on the page (CLS 0).
 */
export async function expectSectionHeaderKept(page: Page) {
	expect(await page.locator(HEADER).evaluate((node) => (node as Marked).kept === true)).toBe(true);
	// Layout-shift entries arrive after the frame they happen in: wait two frames for them.
	const shifts = await page.evaluate(
		() =>
			new Promise<Shifts | undefined>((resolve) =>
				requestAnimationFrame(() =>
					requestAnimationFrame(() => resolve((window as Watched).__shifts)),
				),
			),
	);
	expect(shifts).toEqual({ cls: expect.closeTo(0, 3), header: 0 });
}

/** A section's tabs, by the name of their `<nav>` ("Explore pages", "Review pages"). */
export const sectionTabs = (page: Page, name: string) => page.getByRole("navigation", { name });

/** The tab of the page being shown. */
export const currentTab = (page: Page, name: string) =>
	sectionTabs(page, name).locator("[aria-current=page]");
