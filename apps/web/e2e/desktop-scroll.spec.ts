import { expect, type Page, test } from "@playwright/test";
import { createTestParent } from "./parents";
import { seedReportHistory } from "./reports-seed";
import { clientRendered, createPlannedHousehold, signedInPage } from "./session";

// Guards the desktop's one scroll per region (#67): the page scrolls, and nothing scrolls inside
// it. A rail with its own scrollbar inside a scrolling page is what this catches. Allowed:
// MasterDetail's panes (`data-scroll-pane`), the sidebar, open sheets, dialogs, menus and popovers,
// text areas, and things that only scroll sideways (tab strips, wide tables).
const desktop = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 } as const;

// The Household's month (docs/seed-data.md: America/Chicago).
const month = new Intl.DateTimeFormat("en-CA", {
	timeZone: "America/Chicago",
	year: "numeric",
	month: "2-digit",
}).format(new Date());

/** On PageLayout or SplitLayout (67a), or with no columns to begin with. */
const migrated = [
	"/month",
	`/plan/${month}`,
	`/plan/${month}/commitments`,
	`/plan/${month}/buckets`,
	`/plan/${month}/goals`,
	`/plan/${month}/income`,
	`/plan/${month}/year`,
	"/reports",
	"/reports?view=spending",
	"/household",
	"/insights",
	"/insights/perks",
	"/glossary",
	"/ask",
	"/check-in",
];

/** Waiting for their master-detail routes (67b to 67d; Review is #68). Move each up as it lands. */
const waiting = [
	"/transactions",
	"/accounts",
	"/goals",
	"/explore",
	"/explore/afford",
	"/explore/scenarios",
	"/review",
	"/review/rules",
];

let parent: Awaited<ReturnType<typeof createTestParent>>;

test.beforeEach(async () => {
	parent = await createTestParent();
});

test.afterEach(async () => {
	await parent?.remove();
});

/** Scrolling elements nested in another scrolling region, and split columns whose tops differ. */
function measure(page: Page) {
	return page.evaluate(() => {
		const scrollsY = (el: Element) => {
			const y = getComputedStyle(el).overflowY;
			return (y === "auto" || y === "scroll") && el.scrollHeight > el.clientHeight + 1;
		};
		const root = document.scrollingElement ?? document.documentElement;
		const pageScrolls = root.scrollHeight > root.clientHeight + 1;
		const allowed =
			"[data-slot=sidebar],[role=dialog],[role=alertdialog],[role=menu],[role=listbox],[data-radix-popper-content-wrapper]";
		const insideScroller = (el: Element) => {
			for (let e = el.parentElement; e && e !== document.body; e = e.parentElement) {
				if (scrollsY(e)) return true;
			}
			return false;
		};
		const name = (el: Element) =>
			`${el.getAttribute("data-slot") ?? el.tagName.toLowerCase()}.${[...el.classList].slice(0, 6).join(".")}`;
		const nested = [...document.querySelectorAll("body *")]
			.filter((el) => {
				if (el.matches("textarea") || el.closest(allowed)) return false;
				if (el.closest("[aria-hidden=true],[inert]")) return false;
				const box = el.getBoundingClientRect();
				if (box.width <= 1 || box.height <= 1 || !scrollsY(el)) return false;
				// A MasterDetail pane may scroll; something scrolling inside one may not.
				if (el.matches("[data-scroll-pane]")) return false;
				return pageScrolls || insideScroller(el);
			})
			.map(name);
		const uneven = [...document.querySelectorAll("[data-slot=split-layout]")].flatMap((split) => {
			const tops = ["split-main", "split-rail"].map((slot) => {
				const column = split.querySelector(`:scope > [data-slot=${slot}]`);
				return column?.firstElementChild ? column.getBoundingClientRect().top : null;
			});
			const [main, rail] = tops;
			return main != null && rail != null && Math.abs(main - rail) > 1
				? [`main top ${main}, rail top ${rail}`]
				: [];
		});
		return { nested, uneven };
	});
}

async function walk(page: Page, paths: string[]) {
	for (const path of paths) {
		await page.goto(path);
		await expect(page.locator("[data-slot=page-header]:visible").first()).toBeVisible(
			clientRendered,
		);
		await expect(page.getByRole("status", { name: "Loading" })).toHaveCount(0, clientRendered);
		await page.evaluate(() => document.fonts.ready);
		const found = await measure(page);
		expect.soft(found.nested, `${path}: a region scrolls inside another`).toEqual([]);
		expect.soft(found.uneven, `${path}: the columns start at different heights`).toEqual([]);
	}
}

/** A Household with a Plan and months of Transactions, so pages are long enough to scroll. */
async function busyHousehold(page: Page) {
	await createPlannedHousehold(page, {
		baseline: "6200",
		buckets: [
			["Groceries", "800"],
			["Eating out", "300"],
			["Kids", "400"],
			["Fun", "250"],
		],
	});
	seedReportHistory(parent.userId, 8);
}

test("no desktop page has a region that scrolls inside another", async ({ browser }) => {
	test.setTimeout(180_000);
	const page = await signedInPage(browser, parent.email, desktop);
	await busyHousehold(page);
	await walk(page, migrated);
	// A Bucket and a Commitment beside their lists (67b): only MasterDetail's panes scroll.
	for (const part of ["buckets", "commitments"]) {
		await page.goto(`/plan/${month}/${part}`);
		const item = page.locator("[data-slot=master-detail-list] [data-md-item]").first();
		if (part === "buckets") await expect(item).toBeVisible();
		if (!(await item.isVisible())) continue;
		await item.click();
		await expect(page.locator("[data-slot=detail-title]")).toBeVisible();
		await walk(page, [new URL(page.url()).pathname]);
	}
	// The check isn't empty: This Month has its two columns here.
	await page.goto("/month");
	await expect(page.locator("[data-slot=split-rail]")).toBeVisible();
	await page.context().close();
});

test.fixme("pages waiting for master-detail have one scroll region too", async ({ browser }) => {
	test.setTimeout(180_000);
	const page = await signedInPage(browser, parent.email, desktop);
	await busyHousehold(page);
	await walk(page, waiting);
	await page.context().close();
});
