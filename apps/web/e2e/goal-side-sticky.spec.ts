import { expect, test } from "@playwright/test";
import { ulid } from "ulid";
import { createTestParent } from "./parents";
import { seedSql } from "./seed-sql";
import { clientRendered, createPlannedHousehold, signedInPage } from "./session";

// A Goal with a long History on a wide desktop. It opens in the panel from the right (issue 107,
// ADR-0047), which is one column: the progress card and what to do with it come first, History
// after them, and the panel scrolls on its own while the page under it stays where it is. (Before
// the panel, the Goal had two columns beside the list and the progress column was held in view.)

const wide = { viewport: { width: 1920, height: 1080 } };
/** Months of History seeded; the page shows the latest twelve. */
const MONTHS = 14;

let parent: Awaited<ReturnType<typeof createTestParent>>;
test.beforeEach(async () => {
	parent = await createTestParent();
});
test.afterEach(async () => {
	await parent?.remove();
});

const q = (value: string) => `'${value.replaceAll("'", "''")}'`;

test("a Goal's panel scrolls by itself: progress and actions first, a long History under them", async ({
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
	const panel = page.locator("[data-slot=master-detail-detail]");
	await expect(panel).toHaveAttribute("data-panel-mode", "beside", clientRendered);
	await expect(panel.locator("[data-slot=detail-title]")).toHaveText("Hawaii trip");

	const measure = () =>
		page.evaluate(() => {
			const box = document.querySelector<HTMLElement>("[data-slot=master-detail-detail]");
			const side = box?.querySelector<HTMLElement>("[data-slot=goal-side]");
			const history = document.getElementById("goal-history")?.closest("section");
			const add = [...(box?.querySelectorAll("button") ?? [])].find(
				(button) => button.textContent?.trim() === "Add money",
			);
			if (!box || !side || !history || !add) return null;
			return {
				position: getComputedStyle(box).position,
				overflow: getComputedStyle(box).overflowY,
				// In one column the side's box dissolves, so nothing in it is held.
				sideDisplay: getComputedStyle(side).display,
				top: box.getBoundingClientRect().top,
				height: box.clientHeight,
				content: box.scrollHeight,
				scrolled: box.scrollTop,
				pageScrolled: (document.scrollingElement ?? document.documentElement).scrollTop,
				addTop: add.getBoundingClientRect().top,
				addBottom: add.getBoundingClientRect().bottom,
				historyTop: history.getBoundingClientRect().top,
				historyBottom: history.getBoundingClientRect().bottom,
				window: window.innerHeight,
			};
		});

	const before = await measure();
	expect(before).not.toBeNull();
	if (!before) return;
	// The panel is a layer the height of the window with a scroll of its own; History is far taller.
	expect(before.position).toBe("fixed");
	expect(before.overflow).toBe("auto");
	expect(before.top).toBe(0);
	expect(before.height).toBe(before.window);
	expect(before.content).toBeGreaterThan(before.window * 1.5);
	expect(before.sideDisplay).toBe("contents");
	// Progress and its actions are what the panel opens on; History follows them.
	expect(before.addTop).toBeGreaterThan(0);
	expect(before.addBottom).toBeLessThanOrEqual(before.window);
	expect(before.historyTop).toBeGreaterThan(before.addBottom);
	await expect(page.getByRole("button", { name: "Add money" })).toBeInViewport();

	// A wheel over the panel scrolls the panel to the end of History; the page doesn't move.
	await panel.hover();
	await expect(async () => {
		await page.mouse.wheel(0, 4000);
		const after = await measure();
		expect(after?.scrolled).toBeGreaterThan(0);
		expect(
			Math.abs((after?.scrolled ?? 0) + (after?.height ?? 0) - (after?.content ?? 0)),
		).toBeLessThanOrEqual(1);
		expect(after?.pageScrolled).toBe(0);
		expect(after?.historyBottom).toBeLessThanOrEqual(after?.window ?? 0);
	}).toPass({ timeout: 10_000 });
	// Back to the top, the actions are in reach again.
	await panel.evaluate((box) => box.scrollTo(0, 0));
	await expect(page.getByRole("button", { name: "Add money" })).toBeInViewport();
	await page.context().close();
});
