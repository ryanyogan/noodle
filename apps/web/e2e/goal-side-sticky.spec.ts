import { expect, test } from "@playwright/test";
import { ulid } from "ulid";
import { createTestParent } from "./parents";
import { seedSql } from "./seed-sql";
import { clientRendered, createPlannedHousehold, signedInPage } from "./session";

// A Goal with a long History on a wide desktop (#73, ADR-0033): its progress card and actions sit
// beside History, start on the same line, and stay in view while the page scrolls. Nothing scrolls
// in a pane of its own.

const wide = { viewport: { width: 1920, height: 1080 } };
/** Months of History seeded; the page shows the latest twelve. */
const MONTHS = 14;
/** The space kept above the held column (the shell's top padding at lg). */
const INSET = 24;

let parent: Awaited<ReturnType<typeof createTestParent>>;
test.beforeEach(async () => {
	parent = await createTestParent();
});
test.afterEach(async () => {
	await parent?.remove();
});

const q = (value: string) => `'${value.replaceAll("'", "''")}'`;

test("a Goal's progress and actions stay in view while a long History scrolls", async ({
	browser,
}) => {
	test.slow();
	const page = await signedInPage(browser, parent.email, wide);
	await createPlannedHousehold(page, { baseline: "6200", buckets: [["Groceries", "800"]] });
	const household = `(select household_id from members where clerk_user_id = ${q(parent.userId)})`;
	const member = `(select id from members where clerk_user_id = ${q(parent.userId)})`;
	const now = new Date();
	const monthKey = (monthsAgo: number) =>
		new Date(Date.UTC(now.getFullYear(), now.getMonth() - monthsAgo, 1)).toISOString().slice(0, 7);
	const account = ulid();
	const goal = ulid();
	await seedSql([
		`insert into accounts (id, household_id, name, kind, bank_connection_id, external_id, mask) values (${q(account)}, ${household}, 'Ally Savings', 'savings', null, null, null);`,
		`insert into account_balances (id, household_id, account_id, amount_cents, created_by_member_id) values (${q(ulid())}, ${household}, ${q(account)}, 2000000, ${member});`,
		`insert into goals (id, household_id, account_id, name, target_cents, target_date, from_month) values (${q(goal)}, ${household}, ${q(account)}, 'Hawaii trip', 600000, null, ${q(monthKey(MONTHS - 1))});`,
		// Three fundings a month, so the latest twelve months are far taller than the window.
		...Array.from(
			{ length: MONTHS * 3 },
			(_, i) =>
				`insert into moves (id, household_id, kind, month, amount_cents, created_by_member_id, to_goal_id) values (${q(ulid())}, ${household}, 'goal-funding', ${q(monthKey(Math.floor(i / 3)))}, 1000, ${member}, ${q(goal)});`,
		),
	]);

	await page.goto(`/goals/${goal}`);
	const side = page.locator("[data-slot=goal-side]");
	// Measured after the page is live: the column is held only while all of it fits the window.
	await expect(side).toHaveAttribute("data-fits", "true", clientRendered);

	const measure = () =>
		page.evaluate(() => {
			const root = document.scrollingElement ?? document.documentElement;
			const held = document.querySelector<HTMLElement>("[data-slot=goal-side]");
			const history = document.getElementById("goal-history")?.closest("section");
			if (!held || !history) return null;
			const scrollers: string[] = [];
			for (
				let el: Element | null = held.parentElement;
				el && el !== root && el !== document.body;
				el = el.parentElement
			) {
				const style = getComputedStyle(el);
				// A scrolling or hidden ancestor would hold the column to itself, not the window.
				if ([style.overflowX, style.overflowY].some((o) => o !== "visible" && o !== "clip")) {
					scrollers.push(`${el.tagName}.${el.getAttribute("data-slot") ?? ""}`);
				}
			}
			const sideBox = held.getBoundingClientRect();
			const historyBox = history.getBoundingClientRect();
			return {
				position: getComputedStyle(held).position,
				scrolled: root.scrollTop,
				sideTop: sideBox.top,
				sideLeft: sideBox.left,
				sideBottom: sideBox.bottom,
				historyTop: historyBox.top,
				historyRight: historyBox.right,
				historyHeight: historyBox.height,
				window: window.innerHeight,
				scrollers,
			};
		});

	const before = await measure();
	expect(before).not.toBeNull();
	if (!before) return;
	expect(before.position).toBe("sticky");
	expect(before.scrollers, "no ancestor clips or scrolls the held column").toEqual([]);
	// Two columns that start on the same line, History far taller than the window.
	expect(before.sideLeft).toBeGreaterThanOrEqual(before.historyRight);
	expect(Math.abs(before.sideTop - before.historyTop)).toBeLessThanOrEqual(1);
	expect(before.historyHeight).toBeGreaterThan(before.window);

	// Scroll the page (the one scroll there is) well into History: the column is held at the inset,
	// whole and in view.
	await expect(async () => {
		await page.evaluate(() => window.scrollTo(0, 700));
		const after = await measure();
		expect(after?.scrolled).toBeGreaterThanOrEqual(690);
		expect(Math.abs((after?.sideTop ?? 0) - INSET)).toBeLessThanOrEqual(1);
		expect(after?.historyTop).toBeLessThan(0);
		expect(after?.sideBottom).toBeLessThanOrEqual(after?.window ?? 0);
	}).toPass({ timeout: 10_000 });
	await expect(page.getByRole("button", { name: "Add money" })).toBeInViewport();
});
