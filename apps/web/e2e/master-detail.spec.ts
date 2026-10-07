import { expect, type Page, test } from "@playwright/test";
import { settledAxe } from "./axe";
import { createTestParent } from "./parents";
import { seedReportHistory } from "./reports-seed";
import {
	accountKindLabel,
	choose,
	clientRendered,
	createPlannedHousehold,
	signedInPage,
} from "./session";

// Guards the list beside its item (#67): the list stays mounted and keeps its scroll while the
// detail changes, old addresses still arrive, a phone shows one level at a time, and the keys
// work. Buckets stand for the Plan's pages, and Goals and Accounts are walked after them: all share
// MasterDetail and its helpers.
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
const rail = (page: Page) => page.locator("[data-slot=master-detail-aside]");
const title = (page: Page) => page.locator("[data-slot=detail-title]");
const row = (page: Page, name: string) => list(page).getByRole("link", { name, exact: true });
const picked = (page: Page) => list(page).locator("[data-md-item][aria-current]");

async function household(page: Page) {
	await createPlannedHousehold(page, {
		baseline: "9,000",
		buckets: names.map((name) => [name, "50"] as [string, string]),
	});
	await page.goto(`/plan/${month}#buckets`);
	await expect(row(page, "Fund 01")).toBeVisible();
	// Hydrated: a node marked before then could be replaced by the client's render.
	await expect(page.getByRole("button", { name: "Edit Fund 01" })).toBeEnabled();
}

async function axe(page: Page, what: string) {
	const { violations } = await (await settledAxe(page)).analyze();
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

	// Nothing picked: the Plan has the page's width, with no rail (what changed is the Log, issue
	// 139) and no panel.
	await expect(rail(page)).toHaveCount(0);
	await expect(page.getByRole("link", { name: "See what changed" })).toHaveCount(1);
	await expect(detail(page)).toHaveCount(0);
	const widthBefore = (await list(page).boundingBox())?.width;
	// The list pane is the Plan's first page: the take-home split with the Buckets under it.
	await expect(list(page)).toHaveAttribute("aria-label", "The Plan");
	await expect(list(page).getByRole("region", { name: "Where take-home pay goes" })).toBeVisible();
	await axe(page, "Buckets, nothing picked");

	// The page scrolls as one (no pane scrolls on its own, #73). Picking from far down the list
	// keeps the same node.
	await list(page).evaluate((pane) => {
		pane.dataset.kept = "yes";
	});
	await row(page, "Fund 12").scrollIntoViewIfNeeded();
	expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
	await row(page, "Fund 12").click();
	await expect(page).toHaveURL(new RegExp(`/plan/${month}/buckets/[0-9A-Z]{26}$`));
	await expect(title(page)).toHaveText("Fund 12");
	await expect(picked(page)).toHaveText("Fund 12");
	await expect(list(page)).toHaveAttribute("data-kept", "yes");
	// The first tab stays the current one on a Bucket's address, and it is the only one (#73): the
	// Bucket is open over that tab's page.
	await expect(page.locator("nav[aria-label='Plan pages'] [aria-current=page]")).toHaveText(
		"Overview",
	);
	await expect(page.locator("nav[aria-label='Plan pages'] [aria-current]")).toHaveCount(1);
	// The Bucket is in a panel on the window's right edge (issue 107), the height of the window;
	// with no rail to lie over, the page gives it a rail's width, so it covers none of the list.
	await expect(detail(page)).toHaveAttribute("aria-label", "Bucket details");
	const panelBox = await detail(page).boundingBox();
	expect(panelBox?.y).toBe(0);
	const listBox = await list(page).boundingBox();
	expect(listBox?.width).toBeLessThan(widthBefore ?? 0);
	expect((listBox?.x ?? 0) + (listBox?.width ?? 0)).toBeLessThanOrEqual((panelBox?.x ?? 0) - 16);
	await axe(page, "A Bucket in its panel");

	// Previous and next are in the panel's header; Back is the phone's.
	await expect(detail(page).locator("[data-slot=detail-pager]")).toBeVisible();
	await expect(page.getByRole("link", { name: "Back to Buckets" })).toBeHidden();

	// Esc closes the panel and goes back to the row; ↑ and ↓ move along the rows; Enter opens.
	await page.keyboard.press("Escape");
	await expect(page).toHaveURL(new RegExp(`/plan/${month}$`));
	await expect(detail(page)).toHaveCount(0);
	await expect(row(page, "Fund 12")).toBeFocused();
	await page.keyboard.press("ArrowUp");
	await expect(row(page, "Fund 11")).toBeFocused();
	await page.keyboard.press("ArrowUp");
	await expect(row(page, "Fund 10")).toBeFocused();
	await page.keyboard.press("ArrowDown");
	await expect(row(page, "Fund 11")).toBeFocused();
	await page.keyboard.press("Enter");
	await expect(title(page)).toHaveText("Fund 11");
	await expect(picked(page)).toHaveText("Fund 11");
	await expect(list(page)).toHaveAttribute("data-kept", "yes");

	// The page's own tab closes the item: Add Buckets is one step away.
	await page
		.getByRole("navigation", { name: "Plan pages" })
		.getByRole("link", { name: "Overview", exact: true })
		.click();
	await expect(page).toHaveURL(new RegExp(`/plan/${month}$`));
	await expect(rail(page)).toHaveCount(0);
	await expect(detail(page)).toHaveCount(0);
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

test("a phone shows the list, then the item with Back", { tag: "@phone" }, async ({ browser }) => {
	const page = await signedInPage(browser, parent.email, phone);
	await household(page);
	// The list is the page, with Add Buckets beside the Buckets heading.
	await expect(page.getByRole("button", { name: "Add Buckets" })).toBeVisible();
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

/** A Household with one Account and two Goals in it, left on Goals once it has hydrated. */
async function withGoals(page: Page) {
	await createPlannedHousehold(page, { baseline: "5,000", buckets: [["Groceries", "800"]] });
	await page.goto("/accounts");
	await page.getByLabel("Name").fill("Joint Savings");
	await choose(page, "Kind", accountKindLabel("savings"));
	await page.getByLabel("Balance now").fill("8,000");
	await page.getByRole("button", { name: "Add Account" }).click();
	await expect(page.getByRole("link", { name: /^Joint Savings, / })).toBeVisible();
	await page.goto("/goals");
	for (const name of ["Trip", "Car"]) {
		await page.getByRole("button", { name: "Add Goal" }).click();
		const add = page.getByRole("dialog", { name: "Add a Goal" });
		await add.getByLabel("Name").fill(name);
		await add.getByLabel("Target", { exact: true }).fill("3,000");
		await add.getByRole("button", { name: "Add Goal" }).click();
		await expect(add).toBeHidden();
		await expect(list(page).getByRole("link", { name: new RegExp(`^${name}, `) })).toBeVisible();
	}
}

test("Goals and Accounts open the picked item in a panel and the list keeps its width", async ({
	browser,
}) => {
	test.slow();
	const page = await signedInPage(browser, parent.email, desktop);
	await withGoals(page);
	const goal = (name: string) => list(page).getByRole("link", { name: new RegExp(`^${name}, `) });

	// The rail holds the summary, picked or not; no panel until a Goal is picked (issue 107).
	await expect(list(page)).toHaveAttribute("aria-label", "Goals");
	await expect(rail(page)).toContainText("A month to stay on track");
	await expect(detail(page)).toHaveCount(0);
	const listBox = await list(page).boundingBox();
	await axe(page, "Goals, nothing picked");
	await list(page).evaluate((pane) => {
		pane.dataset.kept = "yes";
	});

	await goal("Trip").click();
	await expect(page).toHaveURL(/\/goals\/[0-9A-Z]{26}$/);
	await expect(title(page)).toHaveText("Trip");
	await expect(picked(page)).toHaveAccessibleName(/^Trip, /);
	await expect(list(page)).toHaveAttribute("data-kept", "yes");
	await expect(detail(page)).toHaveAttribute("aria-label", "Goal details");
	await expect(detail(page)).toHaveAttribute("data-panel", "wide");
	// The cards keep their width and place; the panel is over the rail, at the window's top.
	expect(await list(page).boundingBox()).toEqual(listBox);
	const panelBox = await detail(page).boundingBox();
	expect(panelBox?.y).toBe(0);
	expect(panelBox?.x).toBeGreaterThanOrEqual((listBox?.x ?? 0) + (listBox?.width ?? 0));
	await axe(page, "A Goal in its panel");

	// The other Goal is one step away in the list or by the header's next; Esc closes the panel and
	// returns to the row.
	await expect(detail(page).locator("[data-slot=detail-pager]")).toBeVisible();
	await expect(page.getByRole("link", { name: "Close Goal" })).toBeVisible();
	await list(page)
		.getByRole("link", { name: /^Car, / })
		.click();
	await expect(title(page)).toHaveText("Car");
	await expect(picked(page)).toHaveAccessibleName(/^Car, /);
	await expect(list(page)).toHaveAttribute("data-kept", "yes");
	await page.keyboard.press("Escape");
	await expect(page).toHaveURL(/\/goals$/);
	await expect(detail(page)).toHaveCount(0);
	await expect(goal("Car")).toBeFocused();

	// A deep link shows the list with the item's panel open; Close is the way back, not Back.
	await goal("Car").click();
	await expect(title(page)).toHaveText("Car");
	await page.reload();
	await expect(title(page)).toHaveText("Car");
	await expect(picked(page)).toHaveAccessibleName(/^Car, /);
	await expect(page.getByRole("link", { name: "Back to Goals" })).toBeHidden();
	await page.getByRole("link", { name: "Close Goal" }).click();
	await expect(page).toHaveURL(/\/goals$/);
	await expect(detail(page)).toHaveCount(0);
	await expect(rail(page)).toContainText("A month to stay on track");

	// Accounts: the same, with Bank Connections under the list and the totals in the rail.
	await page.goto("/accounts");
	await expect(page.getByRole("button", { name: "Add Account" })).toBeEnabled();
	await expect(list(page)).toHaveAttribute("aria-label", "Accounts");
	await expect(rail(page).getByRole("region", { name: "Totals" })).toBeVisible();
	await axe(page, "Accounts, nothing picked");
	await list(page).evaluate((pane) => {
		pane.dataset.kept = "yes";
	});
	const accountsBox = await list(page).boundingBox();
	await list(page)
		.getByRole("link", { name: /^Joint Savings, / })
		.click();
	await expect(page).toHaveURL(/\/accounts\/[0-9A-Z]{26}$/);
	await expect(title(page)).toHaveText("Joint Savings");
	await expect(picked(page)).toHaveAccessibleName(/^Joint Savings, /);
	await expect(list(page)).toHaveAttribute("data-kept", "yes");
	await expect(detail(page)).toHaveAttribute("aria-label", "Account details");
	await expect(detail(page)).toHaveAttribute("data-panel", "wide");
	expect(await list(page).boundingBox()).toEqual(accountsBox);
	await axe(page, "An Account in its panel");

	// Its old address under Goals still arrives, with the list under its panel.
	const id = new URL(page.url()).pathname.split("/").pop();
	await page.goto(`/goals/accounts/${id}`);
	await expect(page).toHaveURL(new RegExp(`/accounts/${id}$`));
	await expect(title(page)).toHaveText("Joint Savings");
	await expect(picked(page)).toHaveAccessibleName(/^Joint Savings, /);
	await page.getByRole("link", { name: "Close Account" }).click();
	await expect(page).toHaveURL(/\/accounts$/);
	await expect(detail(page)).toHaveCount(0);
	await expect(rail(page).getByRole("region", { name: "Totals" })).toBeVisible();
	await page.context().close();
});

test("a phone shows Goals or Accounts, then the item with Back", { tag: "@phone" }, async ({
	browser,
}) => {
	test.slow();
	const page = await signedInPage(browser, parent.email, phone);
	await withGoals(page);
	for (const [path, name, back] of [
		["/goals", "Trip", "Back to Goals"],
		["/accounts", "Joint Savings", "Back to Accounts"],
	] as const) {
		await page.goto(path);
		const item = list(page).getByRole("link", { name: new RegExp(`^${name}, `) });
		await expect(item).toBeVisible();
		await item.click();
		await expect(title(page)).toHaveText(name);
		await expect(list(page)).toBeHidden();
		// A page of its own, not a layer: it starts under the app's header and scrolls with the window.
		await expect(detail(page)).toHaveCSS("position", "static");
		await expect(
			page.getByRole("link", { name: `Close ${name === "Trip" ? "Goal" : "Account"}` }),
		).toBeHidden();
		await axe(page, `${name} on a phone`);
		expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
			393,
		);
		await page.getByRole("link", { name: back }).click();
		await expect(item).toBeVisible();
		await expect(title(page)).toHaveCount(0);
	}
	await page.context().close();
});

test("a Transaction opens in place under its row, and the table keeps its columns", async ({
	browser,
}) => {
	test.slow();
	const page = await signedInPage(browser, parent.email, desktop);
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
	await page.goto("/transactions");
	const rows = page.locator("[data-slot=list-row] button:not([role=checkbox]):not([data-cell])");
	const pane = page.locator("[data-slot=transaction-detail]");
	const title = pane.locator("[data-slot=detail-title]");
	const marked = page.locator("[data-slot=list-row] button[aria-current]");
	const openRow = page.locator("[data-slot=list-row][aria-current=true]");
	// Hydrated: before then a press on a row does nothing.
	await expect(page.getByLabel("Search notes and merchants")).toBeEnabled();
	await expect(rows.first()).toBeVisible();
	await expect(pane).toHaveCount(0);
	await expect(openRow).toHaveCount(0);
	// Where the header's columns are: they must not move when a row opens.
	const columns = () =>
		page
			.locator("[data-slot=data-table-head] [role=columnheader]")
			.evaluateAll((all) => all.map((el) => Math.round(el.getBoundingClientRect().left)));
	const before = await columns();
	expect(before.length).toBeGreaterThan(3);

	// Picked from part-way down: it opens under its own row, at its own address.
	await page.evaluate(() => window.scrollTo(0, 300));
	const inView = await rows.evaluateAll((all) =>
		all.findIndex((el) => {
			const box = el.getBoundingClientRect();
			return box.top > 150 && box.bottom < 400;
		}),
	);
	expect(inView).toBeGreaterThanOrEqual(0);
	await rows.nth(inView).click();
	await expect(page).toHaveURL(/\/transactions\/\d{4}-\d{2}\/[0-9A-Z]{26}$/);
	await expect(title).toBeVisible();
	await expect(marked).toHaveCount(1);
	await expect(openRow).toHaveCount(1);
	await expect(pane).toHaveCount(1);
	await expect(marked).toHaveAttribute("aria-expanded", "true");
	// The region is named after its Transaction, and focus is on its title.
	const label = (await pane.getAttribute("aria-label")) ?? "";
	expect(label).not.toBe("Transaction details");
	expect(await marked.innerText()).toContain(label);
	await expect(title).toBeFocused();
	// Directly under its row, as wide as the table; the columns and the filters stay where they were.
	const placed = await page.evaluate(() => {
		const row = document.querySelector("[data-slot=list-row][aria-current=true]");
		const region = document.querySelector("[data-slot=transaction-detail]");
		const table = document.querySelector("[data-slot=data-table]");
		if (!row || !region || !table) return null;
		const r = row.getBoundingClientRect();
		const g = region.getBoundingClientRect();
		const t = table.getBoundingClientRect();
		return {
			gap: Math.abs(g.top - r.bottom),
			left: Math.abs(g.left - t.left),
			right: Math.abs(g.right - t.right),
			rowInView: r.top >= 0 && r.bottom <= window.innerHeight,
		};
	});
	expect(placed).toEqual({ gap: 0, left: 0, right: 0, rowInView: true });
	expect(await columns()).toEqual(before);
	await expect(
		page.locator("[data-slot=transaction-filters]").getByTestId("month-total"),
	).toBeVisible();
	await expect(page.locator("[data-slot=split-rail]")).toHaveCount(0);
	// The open row's cells don't edit in the cell (its editor is right there); other rows' still do.
	await expect(openRow.locator("[data-cell]")).toHaveCount(0);
	await expect(page.locator("[data-slot=list-row] [data-cell=name]").first()).toBeAttached();
	// A tick on another row selects it and leaves this one open.
	await page
		.locator("[data-slot=list-row]:not([aria-current=true]) [role=checkbox]")
		.first()
		.click();
	await expect(page.getByRole("region", { name: "Selecting Transactions" })).toBeVisible();
	await expect(openRow).toHaveCount(1);
	await axe(page, "A Transaction open under its row");
	// Esc closes the open row first and keeps the selection; the next Esc ends the selection.
	const first = page.url();
	await page.keyboard.press("Escape");
	await expect(pane).toHaveCount(0);
	await expect(page.getByRole("region", { name: "Selecting Transactions" })).toBeVisible();
	// Focus is back on the row's name button: the control that opened it, not just its row.
	expect(
		await page.evaluate(() => {
			const at = document.activeElement;
			return Boolean(
				at?.matches("button[aria-expanded=false]") && at.closest("[data-slot=list-row]"),
			);
		}),
	).toBe(true);
	await page.keyboard.press("Escape");
	await expect(page.getByRole("region", { name: "Selecting Transactions" })).toHaveCount(0);

	// The next one down is one step away in the header: one row open at a time, and it is in view.
	await page.goto(first);
	await expect(title).toBeVisible();
	await expect(page.getByLabel("Search notes and merchants")).toBeEnabled();
	await pane.getByRole("link", { name: "Next Transaction" }).click();
	await expect(page).not.toHaveURL(first);
	await expect(marked).toHaveCount(1);
	await expect(pane).toHaveCount(1);
	await expect(openRow).toBeInViewport();

	// A deep link opens the row in the list; a click on the open row closes it.
	await page.reload();
	await expect(title).toBeVisible();
	await expect(marked).toHaveCount(1);
	await expect(openRow).toBeInViewport();
	await expect(page.getByLabel("Search notes and merchants")).toBeEnabled();
	await marked.click();
	await expect(pane).toHaveCount(0);
	await expect(page).toHaveURL(/\/transactions\/\d{4}-\d{2}$/);
	await expect(rows.first()).toBeVisible();
	await page.context().close();
});

const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth);

test("a Transaction's address shows it whatever the list has loaded, and is a page on a phone", async ({
	browser,
}) => {
	test.slow();
	const page = await signedInPage(browser, parent.email, desktop);
	await createPlannedHousehold(page, { baseline: "6200", buckets: [["Groceries", "800"]] });
	await seedReportHistory(parent.userId, 2);
	await page.goto("/transactions");
	const rows = page.locator("[data-slot=list-row] button:not([role=checkbox]):not([data-cell])");
	const paneTitle = page.locator("[data-slot=transaction-detail] [data-slot=detail-title]");
	await expect(page.getByLabel("Search notes and merchants")).toBeEnabled();
	await rows.first().click();
	await expect(paneTitle).toBeVisible();
	const address = new URL(page.url()).pathname;
	const name = (await paneTitle.textContent()) ?? "";

	// Left out of the list by its filters, the Transaction is fetched by its ID.
	await page.goto(`${address}?q=nothing-is-called-this`);
	await expect(paneTitle).toHaveText(name, clientRendered);
	await expect(page.getByText("Nothing matches")).toBeVisible();

	// Further down than the list has loaded, or left out while other rows match: it is the table's
	// first row, and no row is marked open.
	await page.goto(`${address}?sort=oldest`);
	await expect(paneTitle).toHaveText(name, clientRendered);

	// On a phone its address is a page with Back: the list is out of the way until then.
	await page.setViewportSize({ width: phone.viewport.width, height: phone.viewport.height });
	await page.goto(address);
	await expect(paneTitle).toHaveText(name, clientRendered);
	await expect(rows.first()).toBeHidden();
	expect(await overflow(page)).toBeLessThanOrEqual(393);
	await axe(page, "A Transaction on a phone");
	await page.getByRole("link", { name: "Back to Transactions" }).click();
	await expect(page).toHaveURL(/\/transactions\/\d{4}-\d{2}$/);
	await expect(rows.first()).toBeVisible();
	await expect(paneTitle).toHaveCount(0);
	await page.context().close();
});

test("a Rule opens in a panel over the Rules page, and is a page with Back on a phone", async ({
	browser,
}) => {
	test.slow();
	const page = await signedInPage(browser, parent.email, desktop);
	await household(page);
	await page.goto("/review/rules");
	const addRule = page.getByRole("button", { name: "Add Rule" });
	for (const [merchant, bucket] of [
		["Acme", "Fund 01"],
		["Corner Gas", "Fund 02"],
	] as const) {
		await expect(addRule).toBeEnabled();
		await addRule.click();
		const add = page.getByRole("dialog", { name: "Add a Rule" });
		await add.getByLabel("Merchant").fill(merchant);
		await choose(add, "Files to", bucket);
		await add.getByRole("button", { name: "Add Rule and file what matches" }).click();
		await expect(add).toBeHidden();
	}
	const items = list(page).locator("[data-md-item]");
	await expect(items).toHaveCount(2);
	await list(page).evaluate((pane) => {
		pane.dataset.kept = "yes";
	});

	// Picked: its editor is in the panel at its own address; the list is the same node, as wide.
	await expect(detail(page)).toHaveCount(0);
	const listBox = await list(page).boundingBox();
	await items.first().click();
	await expect(page).toHaveURL(/\/review\/rules\/[0-9A-Z]{26}$/);
	const editor = page.getByRole("region", { name: "Rule details" });
	await expect(editor.locator("[data-slot=detail-title]")).toBeVisible();
	await expect(picked(page)).toHaveCount(1);
	await expect(list(page)).toHaveAttribute("data-kept", "yes");
	await expect(items).toHaveCount(2);
	await expect(editor).toHaveAttribute("data-panel", "default");
	expect(await list(page).boundingBox()).toEqual(listBox);
	await axe(page, "A Rule in its panel");

	// The other Rule is one step away in the list, or by the header's next.
	const first = page.url();
	const firstTitle = await title(page).innerText();
	await expect(editor.getByRole("link", { name: "Next Rule" })).toBeVisible();
	await list(page).locator("[data-md-item]:not([aria-current])").click();
	await expect(page).not.toHaveURL(first);
	await expect(title(page)).not.toHaveText(firstTitle);
	await expect(picked(page)).toHaveCount(1);
	await picked(page).focus();
	await page.keyboard.press("ArrowUp");
	await expect(items.first()).toBeFocused();
	await page.keyboard.press("Enter");
	await expect(page).toHaveURL(first);
	await expect(list(page)).toHaveAttribute("data-kept", "yes");
	// Esc closes the panel and returns to the Rule's row.
	await page.keyboard.press("Escape");
	await expect(page).toHaveURL(/\/review\/rules$/);
	await expect(editor).toHaveCount(0);
	await expect(items.first()).toBeFocused();
	await items.first().click();
	await expect(page).toHaveURL(first);

	// A deep link shows both; on a phone it is a page with Back.
	await page.reload();
	await expect(title(page)).toHaveText(firstTitle);
	await expect(items).toHaveCount(2);
	await page.setViewportSize({ width: phone.viewport.width, height: phone.viewport.height });
	await expect(title(page)).toHaveText(firstTitle);
	await expect(list(page)).toBeHidden();
	expect(await overflow(page)).toBeLessThanOrEqual(393);
	await axe(page, "A Rule on a phone");
	await page.getByRole("link", { name: "Back to Rules" }).click();
	await expect(page).toHaveURL(/\/review\/rules$/);
	await expect(items.first()).toBeVisible();
	await expect(title(page)).toHaveCount(0);
	await page.context().close();
});

test("a kept Scenario opens in a panel over Compare, which stays, and is a page on a phone", async ({
	browser,
}) => {
	test.slow();
	const page = await signedInPage(browser, parent.email, desktop);
	await createPlannedHousehold(page, { baseline: "5000", buckets: [["Groceries", "800"]] });
	for (const [lever, name] of [
		["baseline:600000", "Raise"],
		["baseline:450000", "Pay cut"],
	] as const) {
		await page.goto(`/explore?lever=${lever}`);
		await expect(page.getByRole("region", { name: "Your changes" })).toContainText(
			"Income",
			clientRendered,
		);
		await page.getByLabel("Name", { exact: true }).fill(name);
		await page.getByRole("button", { name: "Save Scenario" }).click();
		await expect(page.getByLabel("Name", { exact: true })).toHaveValue(name);
	}
	await page.goto("/explore/scenarios");
	await expect(row(page, "Raise")).toBeVisible(clientRendered);
	const numbers = page.getByRole("table", { name: /^Key numbers/ });
	await list(page).evaluate((pane) => {
		pane.dataset.kept = "yes";
	});

	// Nothing ticked: the wide column beside the list says what it is for.
	await expect(rail(page)).toHaveAttribute("aria-label", "Scenarios overview");
	await expect(rail(page)).toHaveText("Tick Scenarios in the list to compare them here.");
	// Ticking a Scenario compares it with the Plan there.
	await page.getByRole("checkbox", { name: "Compare “Raise”" }).check();
	await expect(numbers.getByRole("columnheader")).toHaveText(["Number", "Plan", "Raise"]);
	await expect(page).toHaveURL(/\/explore\/scenarios\?compare=[0-9A-Z]{26}$/);
	// Its charts load after the numbers: measured once they are in.
	await expect(rail(page).getByRole("group", { name: "Projected balance" })).toBeVisible();
	const listBefore = await list(page).boundingBox();
	const compareBefore = await rail(page).boundingBox();
	// Compare is the wide column, not a rail: wider than the list.
	expect(compareBefore?.width ?? 0).toBeGreaterThan(listBefore?.width ?? 0);

	// Picked: the Scenario opens in a panel on the window's right edge, at its own address, with
	// what's compared kept. The list and Compare are where and as wide as they were.
	await row(page, "Pay cut").click();
	await expect(page).toHaveURL(/\/explore\/scenarios\/[0-9A-Z]{26}\?compare=[0-9A-Z]{26}$/);
	await expect(title(page)).toHaveText("Pay cut");
	await expect(picked(page)).toHaveCount(1);
	await expect(detail(page).getByRole("region", { name: "Your changes" })).toContainText(
		"Income $5,000 → $4,500 a month",
	);
	await expect(detail(page).getByRole("link", { name: "Open in Explore" })).toBeVisible();
	await expect(detail(page).getByRole("tab", { name: "Balance" })).toBeVisible();
	await expect(page.getByRole("region", { name: "Scenario details" })).toBeVisible();
	await expect(detail(page)).toHaveCSS("position", "fixed");
	await expect
		.poll(async () => {
			const box = await detail(page).boundingBox();
			return box ? Math.round(box.x + box.width) : -1;
		})
		.toBe(1440);
	const panelBox = await detail(page).boundingBox();
	expect(await list(page).boundingBox()).toEqual(listBefore);
	const compareAfter = await rail(page).boundingBox();
	expect([compareAfter?.x, compareAfter?.y, compareAfter?.width]).toEqual([
		compareBefore?.x,
		compareBefore?.y,
		compareBefore?.width,
	]);
	// The panel is over Compare's right-hand part only: none of the list is under it, and Compare's
	// first columns still show beside it.
	expect((listBefore?.x ?? 0) + (listBefore?.width ?? 0)).toBeLessThanOrEqual(panelBox?.x ?? 0);
	expect(compareBefore?.x ?? 0).toBeLessThan((panelBox?.x ?? 0) - 100);
	// Beside the open Scenario Compare has no room for a column each: every number lists the Plan and
	// the Scenario by name instead, and the table comes back when the panel closes.
	await expect(numbers).toBeHidden();
	const stacked = page.locator("section[aria-labelledby=compare] dl").first();
	await expect(stacked.locator("dt")).toHaveText(["Plan", "Raise"]);
	await expect(stacked.locator("dd").first()).toBeVisible();
	await expect(page.getByRole("checkbox", { name: "Compare “Raise”" })).toBeChecked();
	await expect(list(page)).toHaveAttribute("data-kept", "yes");
	await expect(title(page)).toBeFocused();
	await expect(page.getByRole("link", { name: "Back to Scenarios" })).toBeHidden();
	await axe(page, "A Scenario in its panel");
	// Close and Esc go back to the list with what's compared kept, and focus returns to the row.
	const close = detail(page).getByRole("link", { name: "Close Scenario" });
	await expect(close).toBeVisible();
	await close.click();
	await expect(page).toHaveURL(/\/explore\/scenarios\?compare=[0-9A-Z]{26}$/);
	await expect(detail(page)).toHaveCount(0);
	await expect(numbers.getByRole("columnheader")).toHaveText(["Number", "Plan", "Raise"]);
	await row(page, "Pay cut").click();
	await expect(title(page)).toHaveText("Pay cut");
	await expect(title(page)).toBeFocused();
	await page.keyboard.press("Escape");
	await expect(detail(page)).toHaveCount(0);
	await expect(page).toHaveURL(/\/explore\/scenarios\?compare=[0-9A-Z]{26}$/);
	await expect(row(page, "Pay cut")).toBeFocused();
	await row(page, "Pay cut").click();
	await expect(title(page)).toHaveText("Pay cut");

	// Ticking another keeps the Scenario open; the other Scenario is one step away.
	await page.getByRole("checkbox", { name: "Compare “Pay cut”" }).check();
	await expect(page).toHaveURL(/\/explore\/scenarios\/[0-9A-Z]{26}\?compare=.+(%2C|,).+$/);
	await expect(title(page)).toHaveText("Pay cut");
	await detail(page).getByRole("link", { name: "Next Scenario" }).click();
	await expect(title(page)).toHaveText("Raise");
	await expect(page).toHaveURL(/\?compare=/);
	const address = new URL(page.url()).pathname;

	// A deep link shows both; "Compare" goes back to the comparison.
	await page.reload();
	await expect(title(page)).toHaveText("Raise", clientRendered);
	await expect(row(page, "Pay cut")).toBeVisible();
	await page.getByRole("link", { name: "Compare 2 selected" }).click();
	await expect(numbers.getByRole("columnheader")).toHaveText([
		"Number",
		"Plan",
		"Raise",
		"Pay cut",
	]);
	await expect(title(page)).toHaveCount(0);

	// On a phone the Scenario is a page with Back, which keeps what's compared.
	await page.setViewportSize({ width: phone.viewport.width, height: phone.viewport.height });
	await page.goto(`${address}?compare=`);
	await expect(title(page)).toHaveText("Raise", clientRendered);
	await expect(list(page)).toBeHidden();
	await expect(rail(page)).toBeHidden();
	await expect(detail(page)).toHaveCSS("position", "static");
	await expect(detail(page).getByRole("link", { name: "Close Scenario" })).toBeHidden();
	expect(await overflow(page)).toBeLessThanOrEqual(393);
	await axe(page, "A Scenario on a phone");
	await page.getByRole("link", { name: "Back to Scenarios" }).click();
	await expect(page).toHaveURL(/\/explore\/scenarios(\?.*)?$/);
	await expect(row(page, "Pay cut")).toBeVisible();
	await page.context().close();
});
