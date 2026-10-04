import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
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

	// The page scrolls as one (no pane scrolls on its own, #73). Picking from far down the list
	// keeps the same node and the row where it was in the window. (The window's own scroll may
	// change: the list loses its column headings as it narrows beside the Bucket.)
	await list(page).evaluate((pane) => {
		pane.dataset.kept = "yes";
	});
	await row(page, "Fund 12").scrollIntoViewIfNeeded();
	expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
	const top = (await row(page, "Fund 12").boundingBox())?.y ?? -1;
	await row(page, "Fund 12").click();
	await expect(page).toHaveURL(new RegExp(`/plan/${month}/buckets/[0-9A-Z]{26}$`));
	await expect(title(page)).toHaveText("Fund 12");
	await expect(picked(page)).toHaveText("Fund 12");
	await expect(list(page)).toHaveAttribute("data-kept", "yes");
	expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
	expect(Math.abs(((await row(page, "Fund 12").boundingBox())?.y ?? -1) - top)).toBeLessThanOrEqual(
		2,
	);
	// The Bucket stays in view beside the list, its top inside the window.
	expect((await detail(page).boundingBox())?.y ?? -1).toBeGreaterThanOrEqual(0);
	await axe(page, "A Bucket beside its list");

	// The list beside it is the way between Buckets (#73): no Back and no previous and next here.
	await expect(detail(page).locator("[data-slot=detail-pager]")).toBeHidden();
	await expect(page.getByRole("link", { name: "Back to Buckets" })).toHaveCount(0);

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

	// The Buckets tab closes the item: the add form is one step away.
	await page.getByRole("link", { name: "Buckets", exact: true }).click();
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

test("a phone shows the list, then the item with Back", { tag: "@phone" }, async ({ browser }) => {
	const page = await signedInPage(browser, parent.email, phone);
	await household(page);
	// The list is the page, with Add Buckets in its sticky bar.
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

test("Goals and Accounts keep their list beside the picked item", async ({ browser }) => {
	test.slow();
	const page = await signedInPage(browser, parent.email, desktop);
	await withGoals(page);
	const goal = (name: string) => list(page).getByRole("link", { name: new RegExp(`^${name}, `) });

	// Nothing picked: the right pane holds the summary.
	await expect(list(page)).toHaveAttribute("aria-label", "Goals");
	await expect(detail(page)).toContainText("A month to stay on track");
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
	await axe(page, "A Goal beside its list");

	// The other Goal is one step away in the list, not repeated in the header; Esc returns to the row.
	await expect(detail(page).locator("[data-slot=detail-pager]")).toBeHidden();
	await list(page)
		.getByRole("link", { name: /^Car, / })
		.click();
	await expect(title(page)).toHaveText("Car");
	await expect(picked(page)).toHaveAccessibleName(/^Car, /);
	await expect(list(page)).toHaveAttribute("data-kept", "yes");
	await page.keyboard.press("Escape");
	await expect(goal("Car")).toBeFocused();

	// A deep link shows the list and the item together.
	await page.reload();
	await expect(title(page)).toHaveText("Car");
	await expect(picked(page)).toHaveAccessibleName(/^Car, /);
	await expect(page.getByRole("link", { name: "Back to Goals" })).toHaveCount(0);
	await page.getByRole("link", { name: "Goals", exact: true }).first().click();
	await expect(page).toHaveURL(/\/goals$/);
	await expect(detail(page)).toContainText("A month to stay on track");

	// Accounts: the same, with Bank Connections under the list and the totals beside it.
	await page.goto("/accounts");
	await expect(page.getByRole("button", { name: "Add Account" })).toBeEnabled();
	await expect(list(page)).toHaveAttribute("aria-label", "Accounts");
	await expect(detail(page).getByRole("region", { name: "Totals" })).toBeVisible();
	await axe(page, "Accounts, nothing picked");
	await list(page).evaluate((pane) => {
		pane.dataset.kept = "yes";
	});
	await list(page)
		.getByRole("link", { name: /^Joint Savings, / })
		.click();
	await expect(page).toHaveURL(/\/accounts\/[0-9A-Z]{26}$/);
	await expect(title(page)).toHaveText("Joint Savings");
	await expect(picked(page)).toHaveAccessibleName(/^Joint Savings, /);
	await expect(list(page)).toHaveAttribute("data-kept", "yes");
	await axe(page, "An Account beside its list");

	// Its old address under Goals still arrives, with the list beside it.
	const id = new URL(page.url()).pathname.split("/").pop();
	await page.goto(`/goals/accounts/${id}`);
	await expect(page).toHaveURL(new RegExp(`/accounts/${id}$`));
	await expect(title(page)).toHaveText("Joint Savings");
	await expect(picked(page)).toHaveAccessibleName(/^Joint Savings, /);
	await page.getByRole("link", { name: "Accounts", exact: true }).first().click();
	await expect(detail(page).getByRole("region", { name: "Totals" })).toBeVisible();
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

test("a Transaction opens beside its month's list, which keeps its place", async ({ browser }) => {
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
	seedReportHistory(parent.userId, 8);
	await page.goto("/transactions");
	const rows = page.locator("[data-slot=list-row] > button");
	const pane = page.locator("[data-slot=transaction-detail]");
	const marked = page.locator("[data-slot=list-row] > button[aria-current]");
	// Hydrated: before then a press on a row does nothing.
	await expect(page.getByLabel("Search notes and merchants")).toBeEnabled();
	await expect(rows.first()).toBeVisible();

	// Nothing picked: the rail holds the filters and the month's total.
	await expect(page.locator("[data-slot=split-rail]").getByTestId("month-total")).toBeVisible();
	await expect(page.locator("[data-slot=split-rail]").getByLabel("Bucket")).toBeVisible();
	await expect(pane).toHaveCount(0);

	// Picked from part-way down: it opens in the rail at its own address, and the page stays put.
	await page.evaluate(() => window.scrollTo(0, 300));
	const inView = await rows.evaluateAll((all) =>
		all.findIndex((el) => {
			const box = el.getBoundingClientRect();
			return box.top > 150 && box.bottom < 600;
		}),
	);
	expect(inView).toBeGreaterThanOrEqual(0);
	await rows.nth(inView).click();
	await expect(page).toHaveURL(/\/transactions\/\d{4}-\d{2}\/[0-9A-Z]{26}$/);
	await expect(pane.locator("[data-slot=detail-title]")).toBeVisible();
	await expect(marked).toHaveCount(1);
	const y = await page.evaluate(() => window.scrollY);
	await axe(page, "A Transaction beside its list");

	// The next one down is one step away in the header; the list hasn't moved.
	const first = page.url();
	await pane.getByRole("link", { name: "Next Transaction" }).click();
	await expect(page).not.toHaveURL(first);
	await expect(marked).toHaveCount(1);
	expect(await page.evaluate(() => window.scrollY)).toBe(y);

	// A deep link shows the list and the Transaction together; Esc closes the pane.
	await page.reload();
	await expect(pane.locator("[data-slot=detail-title]")).toBeVisible();
	await expect(marked).toHaveCount(1);
	// Hydrated (the filters are there, out of sight, while a Transaction is open).
	await expect(page.getByLabel("Search notes and merchants")).toBeEnabled();
	await page.keyboard.press("Escape");
	await expect(pane).toHaveCount(0);
	await expect(page).toHaveURL(/\/transactions\/\d{4}-\d{2}$/);
	await expect(page.locator("[data-slot=split-rail]").getByTestId("month-total")).toBeVisible();
	await page.context().close();
});

const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth);

test("a Transaction's address shows it whatever the list has loaded, and is a page on a phone", async ({
	browser,
}) => {
	test.slow();
	const page = await signedInPage(browser, parent.email, desktop);
	await createPlannedHousehold(page, { baseline: "6200", buckets: [["Groceries", "800"]] });
	seedReportHistory(parent.userId, 2);
	await page.goto("/transactions");
	const rows = page.locator("[data-slot=list-row] > button");
	const paneTitle = page.locator("[data-slot=transaction-detail] [data-slot=detail-title]");
	await expect(page.getByLabel("Search notes and merchants")).toBeEnabled();
	await rows.first().click();
	await expect(paneTitle).toBeVisible();
	const address = new URL(page.url()).pathname;
	const name = await paneTitle.innerText();

	// Left out of the list by its filters, the Transaction is fetched by its ID.
	await page.goto(`${address}?q=nothing-is-called-this`);
	await expect(paneTitle).toHaveText(name, clientRendered);
	await expect(page.getByText("Nothing matches")).toBeVisible();

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

test("a Rule opens beside the Rules list, and is a page with Back on a phone", async ({
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

	// Picked: its editor is in the right pane at its own address; the list is the same node.
	await items.first().click();
	await expect(page).toHaveURL(/\/review\/rules\/[0-9A-Z]{26}$/);
	const editor = page.getByRole("region", { name: "Rule details" });
	await expect(editor.locator("[data-slot=detail-title]")).toBeVisible();
	await expect(picked(page)).toHaveCount(1);
	await expect(list(page)).toHaveAttribute("data-kept", "yes");
	await expect(items).toHaveCount(2);
	await axe(page, "A Rule beside the list");

	// The other Rule is one step away in the list beside it (no pager in the header at desktop).
	const first = page.url();
	const firstTitle = await title(page).innerText();
	await expect(editor.getByRole("link", { name: "Next Rule" })).toHaveCount(0);
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

test("a kept Scenario opens beside the Scenarios list, and Compare still works", async ({
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

	// Nothing picked: ticking a Scenario compares it with the Plan in the right pane.
	await page.getByRole("checkbox", { name: "Compare “Raise”" }).check();
	await expect(numbers.getByRole("columnheader")).toHaveText(["Number", "Plan", "Raise"]);
	await expect(page).toHaveURL(/\/explore\/scenarios\?compare=[0-9A-Z]{26}$/);

	// Picked: the Scenario is read beside the list, at its own address, with what's compared kept.
	await row(page, "Pay cut").click();
	await expect(page).toHaveURL(/\/explore\/scenarios\/[0-9A-Z]{26}\?compare=[0-9A-Z]{26}$/);
	await expect(title(page)).toHaveText("Pay cut");
	await expect(picked(page)).toHaveCount(1);
	await expect(detail(page).getByRole("region", { name: "Your changes" })).toContainText(
		"Income $5,000 → $4,500 a month",
	);
	await expect(detail(page).getByRole("link", { name: "Open in Explore" })).toBeVisible();
	await expect(detail(page).getByRole("tab", { name: "Projected balance" })).toBeVisible();
	await expect(numbers).toHaveCount(0);
	await expect(page.getByRole("checkbox", { name: "Compare “Raise”" })).toBeChecked();
	await expect(list(page)).toHaveAttribute("data-kept", "yes");
	await axe(page, "A Scenario beside the list");

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
	expect(await overflow(page)).toBeLessThanOrEqual(393);
	await axe(page, "A Scenario on a phone");
	await page.getByRole("link", { name: "Back to Scenarios" }).click();
	await expect(page).toHaveURL(/\/explore\/scenarios(\?.*)?$/);
	await expect(row(page, "Pay cut")).toBeVisible();
	await page.context().close();
});
