import { expect, type Page, test } from "@playwright/test";
import { misaligned } from "./alignment";
import { createTestParent } from "./parents";
import { seedReportHistory } from "./reports-seed";
import {
	accountKindLabel,
	choose,
	clientRendered,
	createPlannedHousehold,
	signedInPage,
} from "./session";

// Guards the desktop's one scroll per region (#67): the page scrolls, and nothing scrolls inside
// it. A rail with its own scrollbar inside a scrolling page is what this catches. Allowed:
// the sidebar, open sheets, dialogs, menus and popovers,
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
	"/explore/scenarios",
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
	"/goals",
	"/accounts",
	"/transactions",
	"/explore",
	"/explore/afford",
	"/review/rules",
	"/review",
	"/review?view=list",
];

/** Pages whose column blocks are checked for alignment (#73). */
const aligned = [
	"/month",
	`/plan/${month}`,
	"/explore",
	"/transactions",
	"/review",
	"/reports",
	"/reports?view=spending",
	"/insights",
	// The list-and-detail pages (73e).
	`/plan/${month}/buckets`,
	`/plan/${month}/commitments`,
	"/goals",
	"/accounts",
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
		// The first block of each column shares a top, and cards keep their column's left edge (#73).
		if (aligned.includes(path))
			expect.soft(await misaligned(page), `${path}: blocks out of line`).toEqual([]);
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
	await seedReportHistory(parent.userId, 8);
	// An Account and a Goal in it, so Goals and Accounts have a list and an item to show.
	await page.goto("/accounts");
	await page.getByLabel("Name").fill("Joint Savings");
	await choose(page, "Kind", accountKindLabel("savings"));
	await page.getByLabel("Balance now").fill("8,000");
	await page.getByRole("button", { name: "Add Account" }).click();
	await expect(page.getByRole("link", { name: /^Joint Savings, / })).toBeVisible();
	await page.goto("/goals");
	await page.getByRole("button", { name: "Add Goal" }).click();
	const addGoal = page.getByRole("dialog", { name: "Add a Goal" });
	await addGoal.getByLabel("Name").fill("Trip");
	await addGoal.getByLabel("Target", { exact: true }).fill("3,000");
	await addGoal.getByRole("button", { name: "Add Goal" }).click();
	await expect(addGoal).toBeHidden();
	await expect(page.getByRole("link", { name: /^Trip, / })).toBeVisible();
}

test("no desktop page has a region that scrolls inside another", async ({ browser }) => {
	test.setTimeout(180_000);
	const page = await signedInPage(browser, parent.email, desktop);
	await busyHousehold(page);
	await walk(page, migrated);
	// An item beside its list (67b, 67c): the page scrolls, not a pane (#73). The busy Household
	// has no Commitment, so that one is walked only when there is one.
	const lists = [`/plan/${month}/buckets`, `/plan/${month}/commitments`, "/goals", "/accounts"];
	for (const path of lists) {
		await page.goto(path);
		const item = page.locator("[data-slot=master-detail-list] [data-md-item]").first();
		if (!path.endsWith("/commitments")) await expect(item).toBeVisible();
		if (!(await item.isVisible())) continue;
		await item.click();
		await expect(page.locator("[data-slot=detail-title]")).toBeVisible();
		await walk(page, [new URL(page.url()).pathname]);
	}
	// A Transaction beside its month's list (67d): the page scrolls, and only the Transaction's pane
	// may scroll in it.
	await page.goto("/transactions");
	await expect(page.locator("[data-slot=page-header]:visible").first()).toBeVisible(clientRendered);
	const row = page.locator("[data-slot=list-row] > button").first();
	// Hydrated: before then a press on a row does nothing.
	await expect(page.getByLabel("Search notes and merchants")).toBeEnabled(clientRendered);
	await expect(row).toBeVisible();
	await row.click();
	await expect(
		page.locator("[data-slot=transaction-detail] [data-slot=detail-title]"),
	).toBeVisible();
	await walk(page, [new URL(page.url()).pathname]);
	// The check isn't empty: This Month has its two columns here.
	await page.goto("/month");
	await expect(page.locator("[data-slot=split-rail]")).toBeVisible();
	await page.context().close();
});
