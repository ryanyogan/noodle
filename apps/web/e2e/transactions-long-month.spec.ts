import { expect, test } from "@playwright/test";
import { ulid } from "ulid";
import { createTestParent } from "./parents";
import { seedSql } from "./seed-sql";
import { clientRendered, createPlannedHousehold, signedInPage } from "./session";

// A month with 400 Transactions on a desktop (#73): every row is drawn in the page's own flow (no
// windowed list, no scroll pane of the list's own, ADR-0033), the rows load as the page scrolls,
// and a row far down still opens beside the list.

const desktop = { viewport: { width: 1440, height: 900 } };
const ROWS = 400;

let parent: Awaited<ReturnType<typeof createTestParent>>;
test.beforeEach(async () => {
	parent = await createTestParent();
});
test.afterEach(async () => {
	await parent?.remove();
});

const q = (value: string) => `'${value.replaceAll("'", "''")}'`;

test("a 400-row month draws every row, scrolls with the page and opens a row", async ({
	browser,
}) => {
	test.slow();
	const page = await signedInPage(browser, parent.email, desktop);
	await createPlannedHousehold(page, { baseline: "6200", buckets: [["Groceries", "800"]] });
	const household = `(select household_id from members where clerk_user_id = ${q(parent.userId)})`;
	const member = `(select id from members where clerk_user_id = ${q(parent.userId)})`;
	// This month, on days up to today, so none is in the future.
	const now = new Date();
	const month = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1)).toISOString().slice(0, 8);
	await seedSql(
		Array.from({ length: ROWS }, (_, i) => {
			const day = String(1 + (i % now.getDate())).padStart(2, "0");
			return `insert into transactions (id, household_id, source, date, amount_cents, note, created_by_member_id) values (${q(ulid())}, ${household}, 'quick-add', ${q(`${month}${day}`)}, ${500 + i}, ${q(`Shop ${i + 1}`)}, ${member});`;
		}),
	);

	await page.goto("/transactions");
	await expect(page.getByLabel("Search notes and merchants")).toBeEnabled(clientRendered);
	const rows = page.locator("[data-slot=list-row]");
	await expect(rows.first()).toBeVisible();
	// The first page only: the rest come as the end of the list nears the screen.
	expect(await rows.count()).toBeLessThan(ROWS);

	// Scrolling the page (not a pane) to its end brings the next rows in, until all are there.
	await expect(async () => {
		await page.evaluate(() => {
			const root = document.scrollingElement ?? document.documentElement;
			root.scrollTo(0, root.scrollHeight);
		});
		await expect(rows).toHaveCount(ROWS, { timeout: 1_000 });
	}).toPass({ timeout: 60_000 });
	await expect(page.locator("[data-loading-more]")).toHaveCount(0);

	const measured = await page.evaluate(() => {
		const root = document.scrollingElement ?? document.documentElement;
		const list = document.querySelector("[data-index]")?.parentElement;
		if (!list) return null;
		const scrollers: string[] = [];
		for (
			let el: Element | null = list;
			el && el !== root && el !== document.body;
			el = el.parentElement
		) {
			const y = getComputedStyle(el).overflowY;
			if ((y === "auto" || y === "scroll") && el.scrollHeight > el.clientHeight + 1) {
				scrollers.push(el.tagName);
			}
		}
		const items = [...list.children] as HTMLElement[];
		return {
			scrolled: root.scrollTop,
			pageHeight: root.scrollHeight,
			listHeight: list.getBoundingClientRect().height,
			rowsHeight: items.reduce((sum, item) => sum + item.getBoundingClientRect().height, 0),
			// Rows in the flow, not placed by hand.
			placed: items.filter((item) => getComputedStyle(item).position === "absolute").length,
			scrollers,
		};
	});
	expect(measured).not.toBeNull();
	if (!measured) return;
	expect(measured.scrolled).toBeGreaterThan(1_000);
	expect(measured.scrollers, "the list scrolls with the page, in no pane of its own").toEqual([]);
	expect(measured.placed).toBe(0);
	// The list is as tall as its rows (no estimate, no blank band), and the page holds all of it.
	expect(Math.abs(measured.listHeight - measured.rowsHeight)).toBeLessThan(ROWS);
	expect(measured.pageHeight).toBeGreaterThan(measured.listHeight);

	// The last row, far down the page, opens beside the list.
	const last = rows.last().locator("button:not([role=checkbox])");
	await last.scrollIntoViewIfNeeded();
	await last.click();
	await expect(
		page.locator("[data-slot=transaction-detail] [data-slot=detail-title]"),
	).toBeVisible();
});
