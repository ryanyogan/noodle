import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";
import { createPlannedHousehold, signedInPage } from "./session";
import { type SharedParent, test } from "./worker-parent";

// Guards the picked item's panel (issue 107, ADR-0047), on Plan › Commitments, the first page to
// use it: on a computer a Commitment opens in a panel on the window's right edge while the list
// keeps its width and stays clickable; it has its own address; Esc and Close return to the list
// and to the row; on a phone it is still a page with Back.
const phone = { viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true } as const;
const at = (width: number) => ({ viewport: { width, height: 900 }, deviceScaleFactor: 1 }) as const;

// The Household's month (docs/seed-data.md: America/Chicago).
const month = new Intl.DateTimeFormat("en-CA", {
	timeZone: "America/Chicago",
	year: "numeric",
	month: "2-digit",
}).format(new Date());

let parent: SharedParent;

test.beforeEach(async ({ sharedParent }) => {
	parent = sharedParent;
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
}

/** Open, and hydrated: Edit in a Commitment's header is off until then. */
async function opened(page: Page, name: string) {
	await expect(title(page)).toHaveText(name);
	await expect(panel(page).getByRole("button", { name: "Edit", exact: true })).toBeEnabled();
}

/** The panel's box once it has slid in: flush with the window's right edge. */
async function settled(page: Page, windowWidth: number) {
	await expect
		.poll(async () => {
			const box = await panel(page).boundingBox();
			return box ? Math.round(box.x + box.width) : -1;
		})
		.toBe(windowWidth);
	const box = await panel(page).boundingBox();
	if (!box) throw new Error("no panel");
	return box;
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
	// On the right edge, at its width for a 1440 window, the height of the window.
	const box = await settled(page, 1440);
	expect(box.width).toBe(640);
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
	// What the panel lies over can't take keyboard focus out of sight, and Ask Noodle stays on top.
	const covered = page.locator("main [data-panel-covered]");
	await expect.poll(() => covered.count()).toBeGreaterThan(0);
	expect(await covered.evaluateAll((all) => all.every((one) => one.tabIndex === -1))).toBe(true);
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
	// Closing works when the Commitment's address was the first one opened.
	await page.keyboard.press("Escape");
	await expect(page).toHaveURL(listAddress);
	await expect(row(page, "Daycare")).toBeVisible();
	await page.context().close();
});

test("the panel steps its width, and a row's name stays in view beside it", async ({ browser }) => {
	test.slow();
	for (const [width, wide] of [
		[1024, 480],
		[1280, 560],
		[1920, 800],
	] as const) {
		const page = await signedInPage(browser, parent.email, at(width));
		if (width === 1024) await household(page);
		else {
			await page.goto(`/plan/${month}/commitments`);
			await expect(row(page, "Rent")).toBeVisible();
		}
		await row(page, "Rent").click();
		await opened(page, "Rent");
		const box = await settled(page, width);
		expect(box.width, `panel at ${width}`).toBe(wide);
		// Every row's name is clear of the panel, so any Commitment is one click away.
		for (const name of ["Rent", "Daycare", "Internet"]) {
			const link = await row(page, name).boundingBox();
			expect((link?.x ?? 0) + (link?.width ?? 0), `${name} at ${width}`).toBeLessThanOrEqual(box.x);
		}
		expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
			width,
		);
		await page.context().close();
	}
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
