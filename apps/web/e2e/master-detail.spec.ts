import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { createTestParent } from "./parents";
import { createPlannedHousehold, signedInPage } from "./session";

// Guards the list beside its item (#67): the list stays mounted and keeps its scroll while the
// detail changes, old addresses still arrive, a phone shows one level at a time, and the keys
// work. Buckets stand for every master-detail page: they share MasterDetail and its helpers.
const desktop = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 } as const;
const phone = { viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true } as const;

// The Household's month (docs/seed-data.md: America/Chicago).
const month = new Intl.DateTimeFormat("en-CA", {
	timeZone: "America/Chicago",
	year: "numeric",
	month: "2-digit",
}).format(new Date());

const names = Array.from({ length: 12 }, (_, i) => `Fund ${String(i + 1).padStart(2, "0")}`);

let parent: Awaited<ReturnType<typeof createTestParent>>;

test.beforeEach(async () => {
	parent = await createTestParent();
});

test.afterEach(async () => {
	await parent?.remove();
});

const list = (page: Page) => page.locator("[data-slot=master-detail-list]");
const detail = (page: Page) => page.locator("[data-slot=master-detail-detail]");
const title = (page: Page) => page.locator("[data-slot=detail-title]");
const row = (page: Page, name: string) => list(page).getByRole("link", { name, exact: true });
const picked = (page: Page) => list(page).locator("[data-md-item][aria-current]");

async function household(page: Page) {
	await createPlannedHousehold(page, {
		baseline: "9,000",
		buckets: names.map((name) => [name, "50"] as [string, string]),
	});
	await page.goto(`/plan/${month}/buckets`);
	await expect(row(page, "Fund 01")).toBeVisible();
	// Hydrated: a node marked before then could be replaced by the client's render.
	await expect(page.getByRole("button", { name: "Edit Fund 01" })).toBeEnabled();
}

async function axe(page: Page, what: string) {
	const { violations } = await new AxeBuilder({ page }).analyze();
	expect(
		violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`),
		`${what}: axe violations`,
	).toEqual([]);
}

test("the list stays put, keeps its scroll and marks its item while the detail changes", async ({
	browser,
}) => {
	test.slow();
	const page = await signedInPage(browser, parent.email, desktop);
	await household(page);

	// Nothing picked: the right pane holds what the rail held.
	await expect(detail(page)).toContainText("Pick a Bucket to see it here.");
	await expect(list(page)).toHaveAttribute("aria-label", "Buckets");
	await axe(page, "Buckets, nothing picked");

	// The same node, scrolled to its end, through three items.
	const top = await list(page).evaluate((pane) => {
		pane.dataset.kept = "yes";
		pane.scrollTop = pane.scrollHeight;
		return pane.scrollTop;
	});
	expect(top).toBeGreaterThan(0);
	await row(page, "Fund 12").click();
	await expect(page).toHaveURL(new RegExp(`/plan/${month}/buckets/[0-9A-Z]{26}$`));
	await expect(title(page)).toHaveText("Fund 12");
	await expect(picked(page)).toHaveText("Fund 12");
	await expect(list(page)).toHaveAttribute("data-kept", "yes");
	expect(await list(page).evaluate((pane) => pane.scrollTop)).toBe(top);
	await axe(page, "A Bucket beside its list");

	// Previous and next, in the list's order.
	await expect(detail(page).getByRole("link", { name: "Next Bucket" })).toBeDisabled();
	await detail(page).getByRole("link", { name: "Previous Bucket" }).click();
	await expect(title(page)).toHaveText("Fund 11");
	await expect(picked(page)).toHaveText("Fund 11");
	await detail(page).getByRole("link", { name: "Next Bucket" }).click();
	await expect(title(page)).toHaveText("Fund 12");
	await expect(list(page)).toHaveAttribute("data-kept", "yes");
	expect(await list(page).evaluate((pane) => pane.scrollTop)).toBe(top);

	// Esc goes back to the picked row; ↑ and ↓ move along the rows; Enter opens.
	await page.keyboard.press("Escape");
	await expect(row(page, "Fund 12")).toBeFocused();
	await page.keyboard.press("ArrowUp");
	await expect(row(page, "Fund 11")).toBeFocused();
	await page.keyboard.press("ArrowUp");
	await expect(row(page, "Fund 10")).toBeFocused();
	await page.keyboard.press("ArrowDown");
	await expect(row(page, "Fund 11")).toBeFocused();
	await expect(title(page)).toHaveText("Fund 12");
	await page.keyboard.press("Enter");
	await expect(title(page)).toHaveText("Fund 11");
	await expect(picked(page)).toHaveText("Fund 11");
	await expect(list(page)).toHaveAttribute("data-kept", "yes");

	// Back closes the item: the add form is one step away.
	await page.getByRole("link", { name: "Back to Buckets" }).click();
	await expect(page).toHaveURL(new RegExp(`/plan/${month}/buckets$`));
	await expect(detail(page)).toContainText("Pick a Bucket to see it here.");
	await expect(list(page)).toHaveAttribute("data-kept", "yes");
	await page.context().close();
});

test("a Bucket's and a Commitment's old addresses go to the new ones", async ({ browser }) => {
	const page = await signedInPage(browser, parent.email, desktop);
	await household(page);
	await row(page, "Fund 03").click();
	await expect(title(page)).toHaveText("Fund 03");
	const id = new URL(page.url()).pathname.split("/").pop();

	await page.goto(`/plan/buckets/${id}`);
	await expect(page).toHaveURL(new RegExp(`/plan/${month}/buckets/${id}$`));
	// A deep link shows the list and the item together.
	await expect(title(page)).toHaveText("Fund 03");
	await expect(picked(page)).toHaveText("Fund 03");

	await page.goto(`/plan/buckets/${id}?month=${month}`);
	await expect(page).toHaveURL(new RegExp(`/plan/${month}/buckets/${id}$`));
	await expect(title(page)).toHaveText("Fund 03");

	await page.goto(`/plan/commitments/${id}?month=${month}`);
	await expect(page).toHaveURL(new RegExp(`/plan/${month}/commitments/${id}$`));
	await page.context().close();
});

test("a phone shows the list, then the item with Back", async ({ browser }) => {
	const page = await signedInPage(browser, parent.email, phone);
	await household(page);
	// The list is the page, with the add form after it.
	await expect(page.locator("[data-slot=master-detail-empty]")).toBeVisible();
	await list(page).evaluate((pane) => {
		pane.dataset.kept = "yes";
	});

	await row(page, "Fund 02").click();
	await expect(title(page)).toHaveText("Fund 02");
	await expect(list(page)).toBeHidden();
	await axe(page, "A Bucket on a phone");
	expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(393);

	await page.getByRole("link", { name: "Back to Buckets" }).click();
	await expect(row(page, "Fund 02")).toBeVisible();
	await expect(list(page)).toHaveAttribute("data-kept", "yes");
	await expect(title(page)).toHaveCount(0);
	await page.context().close();
});
