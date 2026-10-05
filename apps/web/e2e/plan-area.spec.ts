import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { createTestParent } from "./parents";
import {
	createPlannedHousehold,
	openFromMore,
	openPlanBuckets,
	savedBy,
	signedInPage,
	switchTo,
} from "./session";

let parent: Awaited<ReturnType<typeof createTestParent>>;

test.beforeEach(async () => {
	parent = await createTestParent();
});

test.afterEach(async () => {
	await parent?.remove();
});

const plan = {
	baseline: "6,000",
	buckets: [
		["Groceries", "1,200"],
		["Hockey", "400"],
	] as [string, string][],
};

const phone = { viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true };

const heading = (page: Page) => page.getByRole("heading", { level: 1 });
const header = (page: Page) => page.locator("[data-slot=page-header]:visible");
const planTabs = (page: Page) => page.getByRole("navigation", { name: "Plan pages" });
const waterfall = (page: Page) => page.getByRole("region", { name: "Where take-home pay goes" });
const planRow = (page: Page, bucket: string) =>
	page
		.locator("[data-bucket-row]")
		.filter({ has: page.getByRole("button", { name: `Edit ${bucket}` }) });

/** The month the page shows, from its URL, and its name ("September"). */
function shownMonth(page: Page) {
	const month = /\/(\d{4})-(\d{2})/.exec(page.url());
	if (!month) throw new Error(`No month in ${page.url()}`);
	const name = (offset: number) =>
		new Date(Date.UTC(Number(month[1]), Number(month[2]) - 1 + offset, 1)).toLocaleString("en-US", {
			month: "long",
			timeZone: "UTC",
		});
	return { name: name(0), next: name(1) };
}

test("on a computer, the Plan is in the sidebar", async ({ browser }) => {
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, plan);
	const { name } = shownMonth(page);

	const sidebar = page.getByRole("navigation", { name: "Main" });
	await sidebar.getByRole("link", { name: "Plan", exact: true }).click();
	await expect(page).toHaveURL(/\/plan\/\d{4}-\d{2}$/);
	await expect(heading(page)).toHaveText(name);
	await expect(waterfall(page)).toContainText("Free to Spend$4,400");
	await page.context().close();
});

test("the overview says where take-home pay goes in words, as parts of one whole (#102)", async ({
	browser,
}) => {
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, plan);
	const month = /\/(\d{4}-\d{2})/.exec(page.url())?.[1];
	await page.goto(`/plan/${month}`);

	// The takeaway, in a sentence: no legend to hunt for.
	await expect(waterfall(page).locator("[data-slot=plan-split-sentence]")).toHaveText(
		"$1,600 of your $6,000 take-home pay is planned. $4,400 is Free to Spend.",
	);
	// One bar, named as the whole of take-home pay; it is decoration, the rows are the content.
	await expect(waterfall(page)).toContainText("Take-home pay$6,000");
	const bar = waterfall(page).locator("[data-slot=plan-split-bar]");
	await expect(bar).toHaveCount(1);
	await expect(bar).toHaveAttribute("aria-hidden", "true");
	await expect(bar.locator("[data-segment]")).toHaveCount(2);

	// A row for every part, in the bar's order, each with its amount and its share. The shares add
	// up to 100, and a part with nothing in it still has its row.
	const rows = waterfall(page).getByRole("list", {
		name: "Where take-home pay goes, part by part",
	});
	await expect(rows.getByRole("listitem")).toHaveText([
		"Commitments$00% of take-home pay",
		"Buckets$1,60027% of take-home pay",
		"Goal funding$00% of take-home pay",
		"Free to Spend$4,40073% of take-home pay",
	]);
	// With room (a card of 36rem or more) the parts are cells in one row under the bar, all on show.
	await expect(waterfall(page).getByRole("button", { name: "Show the parts" })).toBeHidden();
	const tops = await rows
		.getByRole("listitem")
		.evaluateAll((items) => items.map((item) => Math.round(item.getBoundingClientRect().top)));
	expect(new Set(tops).size, "the parts are in one row").toBe(1);
	// One "?" for the section, on its heading.
	await expect(waterfall(page).getByRole("button", { name: /^What’s/ })).toHaveCount(1);

	const { violations } = await new AxeBuilder({ page })
		.include("section[aria-labelledby=plan-waterfall]")
		.withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
		.analyze();
	expect(
		violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`),
	).toEqual([]);

	// On the narrowest phone the parts are rows, and all but Free to Spend wait behind a button.
	// Opened, they are all there, and nothing runs off the side.
	await page.setViewportSize({ width: 320, height: 720 });
	await expect(rows.getByRole("listitem")).toHaveText(["Free to Spend$4,40073% of take-home pay"]);
	const show = waterfall(page).getByRole("button", { name: "Show the parts" });
	await expect(show).toHaveAttribute("aria-expanded", "false");
	await show.click();
	await expect(waterfall(page).getByRole("button", { name: "Hide the parts" })).toHaveAttribute(
		"aria-expanded",
		"true",
	);
	await expect(rows.getByRole("listitem")).toHaveCount(4);
	expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
	await page.context().close();
});

test("on a phone, the Plan is in More and This Month is a tab", { tag: "@phone" }, async ({
	browser,
}) => {
	const page = await signedInPage(browser, parent.email, phone);
	await createPlannedHousehold(page, plan);
	const { name } = shownMonth(page);

	// No switch between the two in either header (#74): the Plan is in More, This Month in the tab bar.
	const views = page.getByRole("navigation", { name: "Month and Plan" });
	await expect(views).toHaveCount(0);
	await openFromMore(page, "Plan");
	await expect(page).toHaveURL(/\/plan\/\d{4}-\d{2}$/);
	await expect(heading(page)).toHaveText(name);
	await expect(waterfall(page)).toContainText("Free to Spend$4,400");
	await expect(views).toHaveCount(0);
	// Under the title, only the Plan's own pages.
	await expect(page.getByRole("navigation", { name: "Plan pages" })).toBeVisible();

	await page
		.getByRole("navigation", { name: "Main" })
		.getByRole("link", { name: "Month", exact: true })
		.click();
	await expect(header(page)).toContainText("This Month");
	await page.context().close();
});

test("the steps from take-home pay to Free to Spend are figures, and the tabs open each part", async ({
	browser,
}) => {
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, plan);
	const { name } = shownMonth(page);
	await switchTo(page, "Plan");

	// A Personal Allowance is its own step, under the Buckets on the Plan's first page.
	await openPlanBuckets(page);
	await page.getByLabel("Your Personal Allowance").fill("150");
	await page.getByRole("button", { name: "Set up Personal Allowance" }).click();
	await expect(page.getByRole("button", { name: "Edit Alex’s Personal Allowance" })).toBeVisible();
	await page
		.getByRole("navigation", { name: "Plan pages" })
		.getByRole("link", { name: "Overview" })
		.click();

	// No row links to a tab right above it (#73).
	await expect(waterfall(page).getByRole("link")).toHaveCount(0);
	for (const [step, tab] of [
		["Take-home pay", "Income"],
		["Commitments", "Commitments"],
		["Goal funding", "Goal funding"],
	]) {
		await expect(waterfall(page)).toContainText(step as string);
		await planTabs(page).getByRole("link", { name: tab, exact: true }).click();
		await expect(planTabs(page).getByRole("link", { name: tab as string })).toHaveAttribute(
			"aria-current",
			"page",
		);
		// The header is the Plan's on every tab.
		await expect(heading(page)).toHaveText(name);
		await page
			.getByRole("navigation", { name: "Plan pages" })
			.getByRole("link", { name: "Overview" })
			.click();
		await expect(heading(page)).toHaveText(name);
	}
	// Buckets and Personal Allowances have no tab: they are under the split, on this page.
	await expect(planTabs(page).getByRole("link", { name: "Buckets", exact: true })).toHaveCount(0);
	await expect(waterfall(page)).toContainText("Buckets");
	await expect(page.getByRole("grid", { name: "Buckets", exact: true })).toBeVisible();
	await expect(page.getByRole("grid", { name: "Personal Allowances", exact: true })).toBeVisible();
	await expect(waterfall(page)).toContainText("Personal Allowances$150");
	await expect(waterfall(page)).toContainText("Free to Spend$4,250");
	await page.context().close();
});

test("a change to just this month leaves next month's Plan as it was", async ({ browser }) => {
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, plan);
	const { name, next } = shownMonth(page);
	await switchTo(page, "Plan");
	await openPlanBuckets(page);

	await page.getByRole("button", { name: "Edit Groceries" }).click();
	const sheet = page.getByRole("dialog", { name: "Groceries" });
	await sheet.getByRole("textbox", { name: "Allowance", exact: true }).fill("1,500");
	await expect(sheet.getByRole("radio", { name: `From ${name} on` })).toBeChecked();
	await sheet.getByRole("radio", { name: `Just ${name}` }).check();
	await expect(sheet).toContainText(`${next} goes back to $1,200.`);
	const saved = savedBy(page, "setAllowance");
	await sheet.getByRole("button", { name: "Save", exact: true }).click();
	expect((await saved).ok()).toBe(true);

	// This month has the new allowance. The month before had no Groceries, so no change to note.
	await expect(planRow(page, "Groceries")).toContainText("$1,500");
	await expect(planRow(page, "Groceries")).not.toContainText("Changed this month");
	await page
		.getByRole("navigation", { name: "Plan pages" })
		.getByRole("link", { name: "Overview" })
		.click();
	await switchTo(page, "Month");
	await expect(
		page.getByRole("listitem", { name: /^Groceries: \$1,500 left of \$1,500/ }),
	).toBeVisible();

	// Next month goes back to the allowance before, and says it changed from this month's.
	await switchTo(page, "Plan");
	await page.getByRole("link", { name: "Next month" }).click();
	await expect(header(page)).toContainText(next);
	await openPlanBuckets(page);
	await expect(heading(page)).toHaveText(next);
	await expect(planRow(page, "Groceries")).toContainText("$1,200");
	await expect(planRow(page, "Groceries")).toContainText("Changed this month · was $1,500");
	await expect(planRow(page, "Hockey")).not.toContainText("Changed this month");
	await page.reload();
	await expect(planRow(page, "Groceries")).toContainText("$1,200");
	await page.context().close();
});

test("going between the Plan's tabs changes only what's below them", async ({ browser }) => {
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, plan);
	await switchTo(page, "Plan");
	await expect(waterfall(page)).toBeVisible();
	const { name, next } = shownMonth(page);
	const month = /\/plan\/(\d{4}-\d{2})/.exec(page.url())?.[1] as string;

	// Mark the header's nodes. A header that re-mounted would be new nodes, without the marks.
	const marked = [
		"[data-slot=section-layout-header]",
		"[data-slot=page-header] h1",
		"nav[aria-label='Plan pages']",
	];
	for (const selector of marked) {
		await page.locator(selector).evaluate((node) => {
			(node as Element & { kept?: boolean }).kept = true;
		});
	}
	const kept = (selector: string) =>
		page.locator(selector).evaluate((node) => (node as Element & { kept?: boolean }).kept === true);
	const box = await planTabs(page).boundingBox();

	for (const [tab, path] of [
		["Income", "/income"],
		["Commitments", "/commitments"],
		["Goal funding", "/goals"],
		["Year", "/year"],
		["Overview", ""],
	] as const) {
		await planTabs(page).getByRole("link", { name: tab }).click();
		await expect(page).toHaveURL(new RegExp(`/plan/${month}${path}$`));
		await expect(planTabs(page).getByRole("link", { name: tab })).toHaveAttribute(
			"aria-current",
			"page",
		);
		// One tab is the current one, the header still names the month, and nothing moved.
		await expect(planTabs(page).locator("[aria-current=page]")).toHaveCount(1);
		await expect(heading(page)).toHaveText(name);
		for (const selector of marked) expect(await kept(selector), `${selector} on ${tab}`).toBe(true);
		expect(await planTabs(page).boundingBox()).toEqual(box);
	}

	// The next month opens on the same tab.
	await planTabs(page).getByRole("link", { name: "Commitments" }).click();
	await page.getByRole("link", { name: "Next month" }).click();
	await expect(page).toHaveURL(/\/plan\/\d{4}-\d{2}\/commitments$/);
	await expect(heading(page)).toHaveText(next);
	await expect(planTabs(page).getByRole("link", { name: "Commitments" })).toHaveAttribute(
		"aria-current",
		"page",
	);
	await page.goBack();
	await expect(page).toHaveURL(new RegExp(`/plan/${month}/commitments$`));
	await page.context().close();
});

test("the take-home split and the Buckets table are one page, and the old Buckets address opens it", async ({
	browser,
}) => {
	test.slow();
	const page = await signedInPage(browser, parent.email, {
		viewport: { width: 1440, height: 900 },
	});
	await createPlannedHousehold(page, plan);
	await switchTo(page, "Plan");
	const month = /\/plan\/(\d{4}-\d{2})/.exec(page.url())?.[1] as string;
	const table = page.getByRole("grid", { name: "Buckets", exact: true });
	const current = planTabs(page).locator("[aria-current]");

	// One page: the split on top, the Buckets table under it in the same column, then Personal
	// Allowances. The tabs are the other parts of the Plan; Buckets isn't one.
	await expect(waterfall(page)).toBeVisible();
	await expect(table).toBeVisible();
	await expect(planTabs(page).getByRole("link")).toHaveText([
		"Overview",
		"Income",
		"Commitments",
		"Goal funding",
		"Year",
	]);
	const split = await waterfall(page).boundingBox();
	const buckets = await table.boundingBox();
	const allowances = await page.locator("#personal-allowances").boundingBox();
	if (!split || !buckets || !allowances) throw new Error("no split, table or allowances");
	expect(buckets.y, "the table is under the split").toBeGreaterThan(split.y + split.height - 1);
	expect(Math.abs(buckets.x - split.x), "in the same column").toBeLessThanOrEqual(1);
	expect(allowances.y, "Personal Allowances under the table").toBeGreaterThan(
		buckets.y + buckets.height - 1,
	);
	// From 1440 what changed is beside that column, not under it, and it is all the rail holds.
	const rail = await page.locator("[data-slot=master-detail-aside]").boundingBox();
	expect(rail?.x ?? 0, "the rail is beside the page").toBeGreaterThan(split.x + split.width - 1);
	await expect(page.getByRole("region", { name: "What changed" })).toBeVisible();
	await expect(page.locator("[data-slot=master-detail-aside]").getByRole("heading")).toHaveText([
		"What changed",
	]);
	// The first Bucket is on the first screen, under the split.
	expect(await page.evaluate(() => window.scrollY)).toBe(0);
	await expect(table.locator("[data-slot=data-table-row]").first()).toBeInViewport({ ratio: 1 });
	const { violations } = await new AxeBuilder({ page }).analyze();
	expect(
		violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`),
		"the Plan's first page: axe violations",
	).toEqual([]);

	// The old Buckets address, in bookmarks and old links, opens this page at its Buckets.
	await page.goto(`/plan/${month}/buckets`);
	await expect(page).toHaveURL(new RegExp(`/plan/${month}#buckets$`));
	await expect(page.locator("h2#buckets")).toBeInViewport();
	await expect(waterfall(page)).toBeAttached();
	await expect(current).toHaveText("Overview");
	// The anchors This Month links to are all on this page.
	for (const id of ["plan-waterfall", "what-changed", "buckets", "personal-allowances"]) {
		await expect(page.locator(`#${id}`), `#${id}`).toHaveCount(1);
	}

	// A Bucket keeps its address, opens over the page, and the first tab is still the current one
	// (and the only one). The page under it is the same node: it did not load again.
	await expect(page.getByRole("button", { name: "Edit Hockey", exact: true })).toBeEnabled();
	await waterfall(page).evaluate((node) => {
		(node as Element & { kept?: boolean }).kept = true;
	});
	await table.getByRole("link", { name: "Hockey", exact: true }).click();
	await expect(page).toHaveURL(new RegExp(`/plan/${month}/buckets/[0-9A-Z]{26}$`));
	await expect(page.locator("[data-slot=detail-header]")).toContainText("Hockey");
	await expect(current).toHaveCount(1);
	await expect(current).toHaveText("Overview");
	await expect(current).toHaveAttribute("aria-current", "page");
	await expect(waterfall(page)).toBeVisible();
	await expect(table).toBeVisible();
	expect(
		await waterfall(page).evaluate((node) => (node as Element & { kept?: boolean }).kept === true),
		"the split stayed mounted while the Bucket opened",
	).toBe(true);
	// Closing it leaves the page where it was, at an address with no hash.
	await page.getByRole("link", { name: "Close Bucket" }).click();
	await expect(page).toHaveURL(new RegExp(`/plan/${month}$`));
	expect(
		await waterfall(page).evaluate((node) => (node as Element & { kept?: boolean }).kept === true),
		"and while it closed",
	).toBe(true);
	await page.context().close();
});

test("on the narrowest phone the Plan's first page has the split and the Buckets, and nothing sideways", {
	tag: "@phone",
}, async ({ browser }) => {
	const page = await signedInPage(browser, parent.email, {
		viewport: { width: 320, height: 700 },
		isMobile: true,
		hasTouch: true,
	});
	await createPlannedHousehold(page, plan);
	await page.goto("/plan");
	await expect(page).toHaveURL(/\/plan\/\d{4}-\d{2}$/);
	const month = new URL(page.url()).pathname.split("/").pop() as string;
	await expect(waterfall(page)).toBeVisible();
	await expect(page.getByRole("button", { name: "Edit Hockey", exact: true })).toBeEnabled();
	await expect(planTabs(page).getByRole("link", { name: "Buckets", exact: true })).toHaveCount(0);
	// The split is short here: the sentence, the bar and Free to Spend, the other parts behind a
	// button. One Add Buckets, beside the heading, and no bar stuck over the list.
	await expect(waterfall(page).getByRole("listitem")).toHaveText([
		"Free to Spend$4,40073% of take-home pay",
	]);
	await expect(waterfall(page).getByRole("button", { name: "Show the parts" })).toBeVisible();
	await expect(page.getByRole("button", { name: "Add Buckets", exact: true })).toHaveCount(1);
	await expect(page.getByRole("button", { name: "Add Buckets", exact: true })).toBeInViewport();
	await expect(page.locator("[data-slot=left-to-plan]")).toHaveCount(0);
	const split = await waterfall(page).boundingBox();
	const buckets = await page.getByRole("grid", { name: "Buckets", exact: true }).boundingBox();
	if (!split || !buckets) throw new Error("no split or no table");
	expect(buckets.y, "the table is under the split").toBeGreaterThan(split.y + split.height - 1);
	expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
	const { violations } = await new AxeBuilder({ page }).analyze();
	expect(
		violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`),
		"the Plan's first page at 320: axe violations",
	).toEqual([]);
	// The old address lands on the Buckets here too; a Bucket is a page of its own with Back.
	await page.goto(`/plan/${month}/buckets`);
	await expect(page).toHaveURL(new RegExp(`/plan/${month}#buckets$`));
	await expect(page.locator("h2#buckets")).toBeInViewport();
	await page.getByRole("link", { name: "Hockey", exact: true }).click();
	await expect(page).toHaveURL(new RegExp(`/plan/${month}/buckets/[0-9A-Z]{26}$`));
	await page.getByRole("link", { name: "Back to Buckets" }).click();
	await expect(page).toHaveURL(new RegExp(`/plan/${month}#buckets$`));
	await expect(page.getByRole("button", { name: "Edit Hockey", exact: true })).toBeVisible();
	await page.context().close();
});

test("the Plan's first page is short: the Buckets start on the first screen, the split follows typing, and the totals are the table's last row", async ({
	browser,
}) => {
	test.slow();
	const page = await signedInPage(browser, parent.email, {
		viewport: { width: 1280, height: 720 },
	});
	await createPlannedHousehold(page, plan);
	await switchTo(page, "Plan");
	const table = page.getByRole("grid", { name: "Buckets", exact: true });
	const firstRow = table.locator("[data-slot=data-table-row]").first();
	const figure = (part: string) =>
		waterfall(page).locator(`[data-part=${part}] [data-slot=plan-split-figure]`);

	// Without scrolling, the first Bucket is on the screen under the split, in a small window and
	// in a larger one.
	for (const viewport of [
		{ width: 1440, height: 900 },
		{ width: 1280, height: 720 },
	]) {
		await page.setViewportSize(viewport);
		await page.evaluate(() => window.scrollTo(0, 0));
		await expect(firstRow, `${viewport.width}x${viewport.height}`).toBeInViewport({ ratio: 1 });
	}

	// What went (issue 109): the bar stuck over the list with its second name for Free to Spend,
	// and the card of totals. One Add Buckets; the rail is what changed, under the page here.
	await expect(page.locator("[data-slot=left-to-plan]")).toHaveCount(0);
	await expect(page.getByText("Left to plan")).toHaveCount(0);
	await expect(page.getByText("Left in Buckets")).toHaveCount(0);
	await expect(page.getByRole("group", { name: /totals$/ })).toHaveCount(0);
	await expect(page.getByRole("button", { name: "Add Buckets", exact: true })).toHaveCount(1);
	await expect(page.getByRole("button", { name: "Add another Bucket" })).toHaveCount(1);
	const rail = page.locator("[data-slot=master-detail-aside]");
	await expect(rail.getByRole("heading")).toHaveText(["What changed"]);
	const railBox = await rail.boundingBox();
	const tableBox = await table.boundingBox();
	if (!railBox || !tableBox) throw new Error("no rail or no table");
	expect(railBox.y, "below 1440 the rail is under the page").toBeGreaterThan(
		tableBox.y + tableBox.height - 1,
	);

	// One number in three places: the split's Buckets, the heading, the table's last row.
	const foot = table.locator("[data-slot=data-table-foot]");
	await expect(figure("buckets")).toHaveText("Buckets$1,600");
	await expect(page.locator("[data-slot=buckets-total]")).toHaveText("$1,600 in Buckets");
	await expect(foot.locator("[data-column=bucket]")).toHaveText("Total");
	await expect(foot.locator("[data-column=allowance]")).toHaveText("$1,600");
	await expect(foot.locator("[data-column=left]")).toContainText("$1,600");

	// Typing an allowance in the sheet: the split behind it follows, and the sheet says Free to
	// Spend itself, since the page is dimmed.
	await page.getByRole("button", { name: "Edit Hockey", exact: true }).click();
	const sheet = page.getByRole("dialog", { name: "Hockey", exact: true });
	const amount = sheet.getByRole("textbox", { name: "Allowance", exact: true });
	const after = sheet.locator("[data-slot=free-to-spend-after]");
	await expect(amount).toBeVisible();
	await expect(after).toBeHidden();
	await amount.fill("500");
	await expect(after).toHaveText("Free to Spend after this: $4,300");
	await expect(figure("free")).toHaveText("Free to Spend$4,300");
	await expect(figure("buckets")).toHaveText("Buckets$1,700");
	await expect(waterfall(page).locator("[data-slot=plan-split-sentence]")).toHaveText(
		"$1,700 of your $6,000 take-home pay is planned. $4,300 is Free to Spend.",
	);
	// More than there is: both say so.
	await amount.fill("5,000");
	await expect(after).toHaveText(
		/^Free to Spend after this: \S\$200\. More is planned than you have this month\.$/,
	);
	await expect(figure("free")).toHaveText(/^Free to Spend\S\$200$/);
	// Put away unsaved, the figures are the saved ones again.
	await page.keyboard.press("Escape");
	await page
		.getByRole("alertdialog", { name: "Discard changes" })
		.getByRole("button", { name: "Discard changes" })
		.click();
	await expect(sheet).toBeHidden();
	await expect(figure("free")).toHaveText("Free to Spend$4,400");
	await expect(figure("buckets")).toHaveText("Buckets$1,600");

	// A Personal Allowance's figures are in line with the Buckets' above it: its table has no
	// handles, and holds their room open where rows are columns.
	const allowances = page.locator("#personal-allowances");
	await allowances.getByRole("textbox").fill("100");
	const added = savedBy(page, "addPersonalAllowance");
	await allowances.getByRole("button", { name: "Set up Personal Allowance" }).click();
	await added;
	const own = page.getByRole("grid", { name: "Personal Allowances", exact: true });
	await expect(own.locator("[data-slot=data-table-row]")).toHaveCount(1);
	const edge = async (grid: typeof table, column: string) => {
		const box = await grid
			.locator(`[data-slot=data-table-row] [data-column=${column}]`)
			.first()
			.boundingBox();
		if (!box) throw new Error(`no ${column} cell`);
		return box.x + box.width;
	};
	for (const width of [1280, 1440]) {
		await page.setViewportSize({ width, height: 900 });
		for (const column of ["allowance", "left"]) {
			expect(
				Math.abs((await edge(table, column)) - (await edge(own, column))),
				`${column} at ${width}`,
			).toBeLessThanOrEqual(1);
		}
	}
	const { violations } = await new AxeBuilder({ page }).analyze();
	expect(
		violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`),
		"the Plan's first page with both tables: axe violations",
	).toEqual([]);
	await page.context().close();
});

test("the old address of the year opens the Plan's Year tab", async ({ browser }) => {
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, plan);
	await switchTo(page, "Plan");
	const month = /\/plan\/(\d{4}-\d{2})/.exec(page.url())?.[1] as string;
	const year = Number(month.slice(0, 4));

	// This year opens on this month; another year on its January.
	await page.goto(`/plan/year/${year}`);
	await expect(page).toHaveURL(new RegExp(`/plan/${month}/year$`));
	await expect(planTabs(page).getByRole("link", { name: "Year" })).toHaveAttribute(
		"aria-current",
		"page",
	);
	await expect(
		page.getByRole("heading", { level: 2, name: String(year), exact: true }),
	).toBeVisible();
	await page.goto(`/plan/year/${year + 1}`);
	await expect(page).toHaveURL(new RegExp(`/plan/${year + 1}-01/year$`));
	await expect(
		page.getByRole("heading", { level: 2, name: String(year + 1), exact: true }),
	).toBeVisible();
	await page.context().close();
});
