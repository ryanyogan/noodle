import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { createTestParent } from "./parents";
import { createPlannedHousehold, hydrated, signedInPage } from "./session";

// Guards the picked item's panel (issue 107, ADR-0047), on Plan › Commitments, the first page to
// use it: on a computer a Commitment opens in a panel on the window's right edge, over the rail,
// while the list keeps its width and every one of its columns and stays clickable; where the
// window is too narrow for that (1024 to 1279) it is a drawer over a dimmed page instead; it has
// its own address; Esc and Close return to the list and to the row; on a phone it is still a page
// with Back.
const phone = { viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true } as const;
const at = (width: number) => ({ viewport: { width, height: 900 }, deviceScaleFactor: 1 }) as const;

// The Household's month (docs/seed-data.md: America/Chicago).
const month = new Intl.DateTimeFormat("en-CA", {
	timeZone: "America/Chicago",
	year: "numeric",
	month: "2-digit",
}).format(new Date());

let parent: Awaited<ReturnType<typeof createTestParent>>;

test.beforeEach(async () => {
	parent = await createTestParent();
});

test.afterEach(async () => {
	await parent?.remove();
});

const list = (page: Page) => page.locator("[data-slot=master-detail-list]");
const rail = (page: Page) => page.locator("[data-slot=master-detail-aside]");
const panel = (page: Page) => page.locator("[data-slot=master-detail-detail]");
const title = (page: Page) => page.locator("[data-slot=detail-title]");
const row = (page: Page, name: string) => list(page).getByRole("link", { name, exact: true });
const address = new RegExp(`/plan/${month}/commitments/[0-9A-Z]{26}$`);
const listAddress = new RegExp(`/plan/${month}/commitments$`);

async function household(page: Page) {
	await createPlannedHousehold(page, {
		baseline: "9,000",
		buckets: [["Groceries", "800"]],
		commitments: [
			{ name: "Rent", amountCents: 180_000, cadence: "monthly", dueDay: 1 },
			{ name: "Daycare", amountCents: 95_000, cadence: "monthly", dueDay: 5 },
			{ name: "Internet", amountCents: 7_000, cadence: "monthly", dueDay: 12 },
		],
	});
	await page.goto(`/plan/${month}/commitments`);
	await expect(row(page, "Rent")).toBeVisible();
	// Hydrated: a row clicked before then is a plain link, which loads the Commitment as a whole new
	// page (it still opens, but nothing of the page before is kept, the list included).
	await hydrated(row(page, "Rent"));
}

/** Open, and hydrated: Edit in a Commitment's header is off until then. */
async function opened(page: Page, name: string) {
	await expect(title(page)).toHaveText(name);
	await expect(panel(page).getByRole("button", { name: "Edit", exact: true })).toBeEnabled();
}

/** The panel's box once it has slid in: flush with the window's right edge. */
async function settled(page: Page, windowWidth: number) {
	// Not rounded: in the last frames of the slide the panel is a fraction of a pixel short of the
	// edge, and its box a fraction wider than it will be at rest.
	await expect
		.poll(async () => {
			const box = await panel(page).boundingBox();
			return box ? box.x + box.width : -1;
		})
		.toBe(windowWidth);
	const box = await panel(page).boundingBox();
	if (!box) throw new Error("no panel");
	return box;
}

/**
 * Nothing of the list is under the panel: the list column ends where the panel starts, and every
 * figure and control in its rows (what it costs a year, the amount, the pencil) is on top at its
 * own middle.
 */
async function listClearOf(page: Page, panelLeft: number, what: string) {
	const pane = await list(page).boundingBox();
	expect((pane?.x ?? 0) + (pane?.width ?? 0), `${what}: the list's right edge`).toBeLessThanOrEqual(
		panelLeft,
	);
	const hidden = await list(page).evaluate((pane, left) => {
		const out: string[] = [];
		for (const part of pane.querySelectorAll<HTMLElement>(
			"a[href], button, [data-slot=list-row] *",
		)) {
			const box = part.getBoundingClientRect();
			if (box.width === 0 || box.height === 0) continue;
			if (box.bottom < 0 || box.top > window.innerHeight) continue;
			if (box.right > left + 0.5)
				out.push(`${part.tagName} "${part.textContent?.trim().slice(0, 30)}" ends at ${box.right}`);
		}
		return out;
	}, panelLeft);
	expect(hidden, `${what}: parts of the list under the panel`).toEqual([]);
}

async function axe(page: Page, what: string) {
	const { violations } = await new AxeBuilder({ page }).analyze();
	expect(
		violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`),
		`${what}: axe violations`,
	).toEqual([]);
}

test("a Commitment opens in a panel from the right and the list keeps its width", async ({
	browser,
}) => {
	test.slow();
	const page = await signedInPage(browser, parent.email, at(1440));
	await household(page);
	await expect(panel(page)).toHaveCount(0);
	await expect(rail(page)).toHaveAttribute("aria-label", "Commitments: totals, add and about");
	const listBefore = await list(page).boundingBox();
	const railBefore = await rail(page).boundingBox();
	// In the wide list a row has its columns: what it costs a year is one of them.
	const yearly = list(page)
		.getByText(/a year$/)
		.first();
	await expect(yearly).toBeVisible();
	await list(page).evaluate((pane) => {
		pane.dataset.kept = "yes";
	});

	await row(page, "Rent").click();
	await expect(page).toHaveURL(address);
	await opened(page, "Rent");
	const rent = page.url();
	// A labelled region, not a dialog: the page behind is still there to use.
	await expect(page.getByRole("region", { name: "Commitment details" })).toBeVisible();
	await expect(page.getByRole("dialog")).toHaveCount(0);
	// On the right edge, the height of the window, and as wide as what is to the right of the list
	// column at 1440, less the 16 px left clear beside the list: the rail (380), the gap (32) and
	// the gutter (40).
	const box = await settled(page, 1440);
	expect(box.width).toBe(436);
	await listClearOf(page, box.x, "1440");
	// Opened by a click: focus is on the title, without a ring.
	await expect(title(page)).not.toHaveAttribute("data-keyboard-open");
	expect(await title(page).evaluate((node) => getComputedStyle(node).outlineStyle)).toBe("none");
	expect(box.y).toBe(0);
	expect(box.height).toBe(900);
	// The list and the rail are exactly where and as wide as they were, and the row keeps its columns.
	expect(await list(page).boundingBox()).toEqual(listBefore);
	expect(await rail(page).boundingBox()).toEqual(railBefore);
	await expect(yearly).toBeVisible();
	await expect(list(page)).toHaveAttribute("data-kept", "yes");
	await expect(list(page).locator("[data-md-item][aria-current]")).toHaveText("Rent");
	// Focus is on what just opened.
	await expect(title(page)).toBeFocused();
	// Close is there to see, named for what it closes; Back is the phone's.
	await expect(panel(page).getByRole("link", { name: "Close Commitment" })).toBeVisible();
	await expect(page.getByRole("link", { name: "Back to Commitments" })).toBeHidden();
	await expect(panel(page).locator("[data-slot=detail-pager]")).toBeVisible();
	await axe(page, "A Commitment in its panel");
	// What the panel lies over (the rail) can't take keyboard focus out of sight, nothing of the list
	// is among it, and Ask Noodle stays on top.
	const covered = page.locator("main [data-panel-covered]");
	await expect.poll(() => covered.count()).toBeGreaterThan(0);
	expect(await covered.evaluateAll((all) => all.every((one) => one.tabIndex === -1))).toBe(true);
	await expect(list(page).locator("[data-panel-covered]")).toHaveCount(0);
	expect(
		await page.locator("[data-ask-button]").evaluate((button) => {
			const box = button.getBoundingClientRect();
			const top = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
			return top !== null && button.contains(top);
		}),
	).toBe(true);

	// Another row is one click away: the same panel shows it, at its own address.
	await panel(page).evaluate((node) => {
		node.dataset.kept = "yes";
	});
	await row(page, "Daycare").click();
	await opened(page, "Daycare");
	await expect(page).toHaveURL(address);
	expect(page.url()).not.toBe(rent);
	await expect(panel(page)).toHaveAttribute("data-kept", "yes");
	await expect(title(page)).toBeFocused();
	expect(await list(page).boundingBox()).toEqual(listBefore);

	// Next, in the panel's header, keeps focus on itself.
	await panel(page).getByRole("link", { name: "Next Commitment" }).click();
	await opened(page, "Internet");
	await expect(panel(page).getByRole("link", { name: "Next Commitment" })).toBeFocused();

	// Esc closes it: the list's address, and focus on the row it was.
	await page.keyboard.press("Escape");
	await expect(page).toHaveURL(listAddress);
	await expect(panel(page)).toHaveCount(0);
	await expect(row(page, "Internet")).toBeFocused();
	expect(await list(page).boundingBox()).toEqual(listBefore);
	await expect(covered).toHaveCount(0);
	await expect(list(page)).toHaveAttribute("data-kept", "yes");

	// Back and Forward walk the same addresses.
	await page.goBack();
	await opened(page, "Internet");
	await page.goBack();
	await opened(page, "Daycare");

	// Esc belongs to a sheet opened from the panel first: the sheet closes, the panel stays.
	await panel(page).getByRole("button", { name: "Edit", exact: true }).click();
	await expect(page.getByRole("dialog")).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(page.getByRole("dialog")).toHaveCount(0);
	await expect(page).toHaveURL(address);
	await opened(page, "Daycare");

	// The page behind still scrolls, and the panel stays put.
	await page.mouse.move(400, 500);
	await page.mouse.wheel(0, 300);
	expect((await settled(page, 1440)).y).toBe(0);

	// Close does what Esc does.
	await panel(page).getByRole("link", { name: "Close Commitment" }).click();
	await expect(page).toHaveURL(listAddress);
	await expect(panel(page)).toHaveCount(0);
	await expect(row(page, "Daycare")).toBeFocused();
	await page.context().close();
});

test("a Commitment's address opens its panel, and a reload keeps it open", async ({ browser }) => {
	const page = await signedInPage(browser, parent.email, at(1440));
	await household(page);
	const listBefore = await list(page).boundingBox();
	await row(page, "Daycare").click();
	await opened(page, "Daycare");
	const address = page.url();

	await page.reload();
	await expect(page).toHaveURL(address);
	await opened(page, "Daycare");
	await settled(page, 1440);
	expect(await list(page).boundingBox()).toEqual(listBefore);
	await expect(list(page).locator("[data-md-item][aria-current]")).toHaveText("Daycare");
	// Focus is on the title for a screen reader, but a page that has just loaded draws no ring.
	await expect(title(page)).toBeFocused();
	await expect(title(page)).not.toHaveAttribute("data-keyboard-open");
	expect(await title(page).evaluate((node) => getComputedStyle(node).outlineStyle)).toBe("none");
	// Closing works when the Commitment's address was the first one opened.
	await page.keyboard.press("Escape");
	await expect(page).toHaveURL(listAddress);
	await expect(row(page, "Daycare")).toBeFocused();
	// Opened from the keyboard, the title shows the app's ring.
	await page.keyboard.press("Enter");
	await opened(page, "Daycare");
	await expect(title(page)).toBeFocused();
	await expect(title(page)).toHaveAttribute("data-keyboard-open", "");
	expect(await title(page).evaluate((node) => getComputedStyle(node).outlineStyle)).toBe("solid");
	await page.context().close();
});

test("beside the list the panel covers the rail and none of the list's columns", async ({
	browser,
}) => {
	test.slow();
	// The rail, the gap and the gutter, less 16 px: 360 + 32 + 40 - 16 at 1280, 440 + 32 + 40 - 16 at 1920.
	for (const [width, wide] of [
		[1280, 416],
		[1920, 496],
	] as const) {
		const page = await signedInPage(browser, parent.email, at(width));
		if (width === 1280) await household(page);
		else {
			await page.goto(`/plan/${month}/commitments`);
			await expect(row(page, "Rent")).toBeVisible();
		}
		await row(page, "Rent").click();
		await opened(page, "Rent");
		const box = await settled(page, width);
		expect(box.width, `panel at ${width}`).toBe(wide);
		await listClearOf(page, box.x, `${width}`);
		await expect(panel(page)).toHaveAttribute("data-panel-mode", "beside");
		await expect(page.getByRole("dialog")).toHaveCount(0);
		await expect(page.locator("[data-panel-scrim]")).toBeHidden();
		expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
			width,
		);
		await page.context().close();
	}
});

// A Commitment that takes a while to arrive (its history is fetched as it opens) shows a skeleton
// first, with no title to put focus on. Focus must still end on the title, not stay on the panel:
// this failed about one run in three on a busy machine before the panel waited for the title.
for (const width of [1440, 1024]) {
	test(`at ${width} a Commitment that is slow to load still gets focus on its title`, async ({
		browser,
	}) => {
		test.slow();
		const page = await signedInPage(browser, parent.email, at(width));
		await household(page);
		// Nothing was loaded ahead by the pointer passing over the row: every fetch from here is slow.
		await page.route(
			(url) => url.pathname.includes("/_serverFn/"),
			async (route) => {
				await new Promise((done) => setTimeout(done, 3000));
				await route.continue().catch(() => {});
			},
		);
		await row(page, "Rent").focus();
		await page.keyboard.press("Enter");
		const pending = panel(page).locator("[data-slot=detail-pending]");
		await expect(pending).toBeVisible();
		await expect(panel(page)).toBeFocused();
		await opened(page, "Rent");
		await expect(pending).toHaveCount(0);
		await expect(title(page)).toBeFocused();
		// Opened from the keyboard, so the title shows where focus is.
		await expect(title(page)).toHaveAttribute("data-keyboard-open");
		await page.unroute((url) => url.pathname.includes("/_serverFn/")).catch(() => {});
	});
}

test("at 1024 a Commitment is a drawer over a dimmed page, closed by Esc or a click outside", async ({
	browser,
}) => {
	test.slow();
	const page = await signedInPage(browser, parent.email, at(1024));
	await household(page);
	const listBefore = await list(page).boundingBox();
	await row(page, "Rent").click();
	await expect(page).toHaveURL(address);
	await opened(page, "Rent");
	const box = await settled(page, 1024);
	expect(box.width).toBe(480);
	// A dialog with a scrim: covering the list is by design here, and nothing under it can be used.
	const drawer = page.getByRole("dialog", { name: "Commitment details" });
	await expect(drawer).toBeVisible();
	await expect(drawer).toHaveAttribute("aria-modal", "true");
	const scrim = page.locator("[data-panel-scrim]");
	await expect(scrim).toBeVisible();
	expect((await scrim.boundingBox())?.width).toBe(1024);
	await expect(list(page)).toHaveAttribute("inert", "");
	await expect(rail(page)).toHaveAttribute("inert", "");
	expect(
		await page.locator("[data-ask-button]").evaluate((node) => node.closest("[inert]") !== null),
		"Ask Noodle is out of reach under the scrim",
	).toBe(true);
	await expect(page.locator("main [data-panel-covered]")).toHaveCount(0);
	// The list behind it keeps its shape.
	expect(await list(page).boundingBox()).toEqual(listBefore);
	await expect(title(page)).toBeFocused();
	await axe(page, "A Commitment in its drawer");
	// Tab stays in the drawer (or leaves the page for the browser's own controls).
	for (let press = 0; press < 12; press += 1) {
		await page.keyboard.press("Tab");
		expect(
			await panel(page).evaluate(
				(node) => node.contains(document.activeElement) || document.activeElement === document.body,
			),
			`Tab ${press + 1}`,
		).toBe(true);
	}

	// Esc closes it, the page is usable again, and focus is back on the row.
	await page.keyboard.press("Escape");
	await expect(page).toHaveURL(listAddress);
	await expect(panel(page)).toHaveCount(0);
	await expect(scrim).toHaveCount(0);
	await expect(list(page)).not.toHaveAttribute("inert", "");
	await expect(row(page, "Rent")).toBeFocused();

	// A click on the dimmed page closes it too.
	await row(page, "Daycare").click();
	await opened(page, "Daycare");
	await settled(page, 1024);
	await page.mouse.click(400, 450);
	await expect(page).toHaveURL(listAddress);
	await expect(panel(page)).toHaveCount(0);
	await expect(row(page, "Daycare")).toBeFocused();
	expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1024);
	await page.context().close();
});

test("on a phone a Commitment is still a page with Back", { tag: "@phone" }, async ({
	browser,
}) => {
	const page = await signedInPage(browser, parent.email, phone);
	await household(page);
	await row(page, "Rent").click();
	await expect(page).toHaveURL(address);
	await opened(page, "Rent");
	// A page: the list steps aside, nothing is fixed over it, and Back leads to the list.
	await expect(list(page)).toBeHidden();
	await expect(rail(page)).toBeHidden();
	expect(await panel(page).evaluate((node) => getComputedStyle(node).position)).toBe("static");
	await expect(page.getByRole("link", { name: "Close Commitment" })).toBeHidden();
	const back = page.getByRole("link", { name: "Back to Commitments" });
	await expect(back).toBeVisible();
	expect(await page.evaluate(() => window.scrollY)).toBe(0);
	expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(393);
	await axe(page, "A Commitment on a phone");

	await back.click();
	await expect(page).toHaveURL(listAddress);
	await expect(row(page, "Rent")).toBeVisible();
	await expect(panel(page)).toHaveCount(0);
	await page.context().close();
});

// Plan › Buckets, the first table in the panel's list (issue 107): the row itself opens the Bucket.
const bucketAddress = new RegExp(`/plan/${month}/buckets/[0-9A-Z]{26}$`);
// Closing a Bucket leaves the Plan's first page, with no hash (the page stays where it is).
const bucketsAddress = new RegExp(`/plan/${month}$`);
const bucketRow = (page: Page, name: string) =>
	page.locator("[data-bucket-row]").filter({ has: page.getByRole("link", { name, exact: true }) });

async function buckets(page: Page) {
	await createPlannedHousehold(page, {
		baseline: "9,000",
		buckets: [
			["Groceries", "800"],
			["Gas", "200"],
			["Fun", "100"],
		],
	});
	await page.goto(`/plan/${month}#buckets`);
	await expect(page.getByRole("button", { name: "Edit Gas", exact: true })).toBeEnabled();
}

test("a Bucket's row opens it in the panel and the table keeps its width and every column", async ({
	browser,
}) => {
	test.slow();
	const page = await signedInPage(browser, parent.email, at(1440));
	await buckets(page);
	const table = page.getByRole("grid", { name: "Buckets", exact: true });
	// At 1440 the totals are beside the table, which has room for its figures and a name that
	// reads; Pace and End of month need more.
	for (const name of ["Bucket", "Allowance", "Spent", "Left"]) {
		await expect(table.getByRole("columnheader", { name, exact: true })).toBeVisible();
	}
	await expect(table.getByRole("columnheader", { name: "Pace", exact: true })).toBeHidden();
	await expect(table.getByRole("columnheader", { name: "End of month" })).toBeHidden();
	const name = await bucketRow(page, "Gas").locator("[data-column=bucket]").boundingBox();
	expect(name?.width ?? 0, "the name's column").toBeGreaterThanOrEqual(192);
	// The totals are the table's last row.
	const foot = table.locator("[data-slot=data-table-foot]");
	await expect(foot).toContainText("Total");
	await expect(foot).toContainText("$1,100");
	await axe(page, "The Buckets table");
	const listBefore = await list(page).boundingBox();
	const tableBefore = await table.boundingBox();

	// A click on the row itself (here its Spent figure) opens the Bucket, at its own address.
	await bucketRow(page, "Gas").locator("[data-column=spent]").click();
	await expect(page).toHaveURL(bucketAddress);
	await expect(title(page)).toHaveText("Gas");
	await expect(page.getByRole("region", { name: "Bucket details" })).toBeVisible();
	await expect(page.getByRole("dialog")).toHaveCount(0);
	const box = await settled(page, 1440);
	expect(box.width).toBe(436);
	// The list and the table are exactly where and as wide as they were, with the same columns, and
	// nothing of the table is under the panel.
	expect(await list(page).boundingBox()).toEqual(listBefore);
	expect(await table.boundingBox()).toEqual(tableBefore);
	await expect(table.getByRole("columnheader", { name: "Left", exact: true })).toBeVisible();
	await expect(bucketRow(page, "Gas")).toHaveAttribute("aria-current", "true");
	const under = await table.evaluate((node, left) => {
		const out: string[] = [];
		for (const part of node.querySelectorAll<HTMLElement>(
			"[role=gridcell], [role=columnheader], a[href], button",
		)) {
			const at = part.getBoundingClientRect();
			if (at.width === 0 || at.height === 0) continue;
			if (at.right > left + 0.5) out.push(`${part.textContent?.trim().slice(0, 30)}: ${at.right}`);
		}
		return out;
	}, box.x);
	expect(under, "parts of the table under the panel").toEqual([]);
	await axe(page, "A Bucket in its panel");

	// Esc closes it.
	await page.keyboard.press("Escape");
	await expect(page).toHaveURL(bucketsAddress);
	await expect(panel(page)).toHaveCount(0);

	// Enter on a row in focus opens it too.
	await bucketRow(page, "Fun").focus();
	await page.keyboard.press("Enter");
	await expect(page).toHaveURL(bucketAddress);
	await expect(title(page)).toHaveText("Fun");
	await page.keyboard.press("Escape");
	await expect(panel(page)).toHaveCount(0);

	// The pencil opens the sheet, not the panel, and focus comes back to it.
	const pencil = page.getByRole("button", { name: "Edit Gas", exact: true });
	await pencil.click();
	const sheet = page.getByRole("dialog", { name: "Gas", exact: true });
	await expect(sheet.getByRole("textbox", { name: "Allowance", exact: true })).toBeFocused();
	await expect(page).toHaveURL(bucketsAddress);
	await page.keyboard.press("Escape");
	await expect(sheet).toBeHidden();
	await expect(pencil).toBeFocused();

	// So does the allowance in its column. A click inside the sheet is not a click on the row.
	const amount = bucketRow(page, "Gas").locator("[data-bucket-amount]");
	await amount.click();
	await expect(sheet.getByRole("textbox", { name: "Allowance", exact: true })).toBeFocused();
	await sheet.locator("[data-slot=bucket-more]").getByText("More", { exact: true }).click();
	await expect(page).toHaveURL(bucketsAddress);
	await page.keyboard.press("Escape");
	await expect(sheet).toBeHidden();
	await expect(amount).toBeFocused();
	await expect(panel(page)).toHaveCount(0);
	await page.context().close();
});

test("Buckets is a table from 1024 with the totals under it; a Bucket is a drawer there and a page with Back on a phone", async ({
	browser,
}) => {
	test.slow();
	const page = await signedInPage(browser, parent.email, at(1024));
	await buckets(page);
	const table = page.getByRole("grid", { name: "Buckets", exact: true });
	const totals = page.locator("[data-slot=master-detail-aside]");
	// Up to 1440 the table has the page's width and the totals are under it: a real table on a
	// small laptop (its figures in columns), and every column on a common one.
	for (const [width, columns, missing] of [
		[1024, ["Bucket", "Allowance", "Spent", "Left"], ["Pace", "End of month"]],
		[1280, ["Bucket", "Allowance", "Spent", "Left", "Pace", "End of month"], []],
	] as const) {
		await page.setViewportSize({ width, height: 800 });
		for (const name of columns) {
			await expect(table.getByRole("columnheader", { name, exact: true })).toBeVisible();
		}
		for (const name of missing) {
			await expect(table.getByRole("columnheader", { name, exact: true })).toBeHidden();
		}
		const tableBox = await table.boundingBox();
		const totalsBox = await totals.boundingBox();
		if (!tableBox || !totalsBox) throw new Error("no table or no totals");
		expect(totalsBox.y, `the totals are under the table at ${width}`).toBeGreaterThan(
			tableBox.y + tableBox.height - 1,
		);
		expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
			width,
		);
		// With no rail beside the table, a Bucket is a drawer over the dimmed page.
		await bucketRow(page, "Gas").locator("[data-column=spent]").click();
		await expect(page).toHaveURL(bucketAddress);
		await expect(title(page)).toHaveText("Gas");
		expect((await settled(page, width)).width).toBe(480);
		await expect(panel(page)).toHaveAttribute("role", "dialog");
		await expect(page.locator("[data-panel-scrim]")).toBeVisible();
		await page.keyboard.press("Escape");
		await expect(page).toHaveURL(bucketsAddress);
		await expect(panel(page)).toHaveCount(0);
	}

	// The narrowest phone: the same table, stacked; a row opens the Bucket's page, with Back.
	await page.setViewportSize({ width: 320, height: 700 });
	await page.goto(`/plan/${month}#buckets`);
	await expect(page.getByRole("button", { name: "Edit Gas", exact: true })).toBeEnabled();
	expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
	await axe(page, "The Buckets table at 320");
	// With no room beside the name, what's left leads the line under it.
	const under = bucketRow(page, "Gas").locator("[data-column=summary]");
	await expect(under).toContainText("$200 left of $200");
	await expect(
		bucketRow(page, "Gas").getByRole("link", { name: "Gas", exact: true }),
	).toBeVisible();
	await under.click();
	await expect(page).toHaveURL(bucketAddress);
	await expect(page.getByRole("link", { name: "Back to Buckets" })).toBeVisible();
	expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
	await page.getByRole("link", { name: "Back to Buckets" }).click();
	// Back lands on the Buckets, part-way down the Plan's first page.
	await expect(page).toHaveURL(new RegExp(`/plan/${month}#buckets$`));
	await page.context().close();
});
