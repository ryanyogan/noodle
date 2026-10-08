import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { createTestParent } from "./parents";
import { seedSql } from "./seed-sql";
import { clientRendered, createHousehold, hydrated, openMore, signedInPage } from "./session";

// The bell (issue 157, ADR-0065): the releases a Parent hasn't seen and the Nudges sent to them,
// in the Sidebar on a computer and in More on a phone. Opening it reads what it lists, on the
// server, so the dot stays gone after a reload.

/** The releases as the Changelog has them, newest first. */
const written = [
	...readFileSync(new URL("../src/changelog/changelog.md", import.meta.url), "utf8")
		.replace(/<!--[\s\S]*?-->/g, "")
		.matchAll(/^## (\d{4}-\d{2}-\d{2}): (.+)$/gm),
].map((match) => ({ id: match[1] ?? "", title: (match[2] ?? "").trim() }));
const [latest, before, third] = written;
if (!latest || !before || !third) throw new Error("The Changelog needs three releases for this");

let parent: Awaited<ReturnType<typeof createTestParent>>;

test.beforeEach(async () => {
	parent = await createTestParent();
});

test.afterEach(async () => {
	await parent?.remove();
});

const q = (value: string) => `'${value.replaceAll("'", "''")}'`;
const member = () => `(select id from members where clerk_user_id = ${q(parent.userId)})`;
const household = () =>
	`(select household_id from members where clerk_user_id = ${q(parent.userId)})`;

const bell = (page: Page) => page.getByRole("button", { name: /^Notifications/ });
const list = (page: Page) => page.getByRole("dialog", { name: "Notifications" });
const sideways = (page: Page) =>
	page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

test("the bell lists an unseen release and a Nudge that was sent, and opening it reads them", async ({
	browser,
}) => {
	test.slow();
	const page = await signedInPage(browser, parent.email, {
		viewport: { width: 1280, height: 900 },
	});
	await createHousehold(page, "The Rinks", "Alex");

	// A Parent who never opened it is met by the latest release only, however many there have been.
	await page.goto("/month");
	await hydrated(bell(page));
	await expect(bell(page)).toHaveAccessibleName("Notifications, 1 unread", clientRendered);
	await expect(bell(page).locator("[data-bell-dot]")).toBeVisible();

	await bell(page).click();
	await expect(list(page)).toBeVisible();
	const rows = list(page).getByRole("listitem");
	await expect(rows).toHaveCount(1);
	await expect(rows.first()).toContainText(latest.title);
	await expect(rows.first()).toContainText("Changelog");
	await expect(rows.first().getByRole("link")).toHaveAttribute(
		"href",
		`/household/changelog#${latest.id}`,
	);
	// The dot goes at once, while the row stays to be pressed.
	await expect(bell(page)).toHaveAccessibleName("Notifications");
	await expect(bell(page).locator("[data-bell-dot]")).toHaveCount(0);

	// Escape closes it and the keyboard is back on the bell.
	await page.keyboard.press("Escape");
	await expect(list(page)).toBeHidden();
	await expect(bell(page)).toBeFocused();

	// It stays read after a reload: the server keeps how far this Parent has read.
	await page.reload();
	await hydrated(bell(page));
	await expect(page.getByRole("heading", { level: 1 })).toBeVisible(clientRendered);
	await bell(page).click();
	await expect(list(page).getByText("Nothing new")).toBeVisible();
	await expect(bell(page)).toHaveAccessibleName("Notifications");
	await expect(list(page).getByRole("link", { name: "See the Changelog" })).toBeVisible();
	await page.keyboard.press("Escape");

	// Read up to the third release back, with a Nudge sent since: two releases and the Nudge.
	await seedSql([
		`update bell_seen set release = ${q(third.id)}, nudges_up_to = 0 where member_id = ${member()}`,
		`insert into sent_nudges (id, household_id, member_id, kind, title, body, url, sent_at) values (${q(`nudge-${parent.userId}`)}, ${household()}, ${member()}, 'bucket-pace', 'Groceries is ahead of pace', '$40 left, with 9 days of the month to go.', '/plan', unixepoch() * 1000)`,
	]);
	await page.reload();
	await hydrated(bell(page));
	await expect(bell(page)).toHaveAccessibleName("Notifications, 3 unread", clientRendered);
	await bell(page).click();
	await expect(rows).toHaveCount(3);
	await expect(rows.filter({ hasText: "Changelog" })).toContainText([latest.title, before.title]);
	const nudge = rows.filter({ hasText: "Groceries is ahead of pace" });
	await expect(nudge).toContainText("$40 left, with 9 days of the month to go.");
	await expect(nudge.getByRole("link")).toHaveAttribute("href", "/plan");

	// A release's row leads to it on the Changelog page.
	await rows.filter({ hasText: before.title }).getByRole("link").click();
	await expect(page).toHaveURL(new RegExp(`/household/changelog#${before.id}$`));
	await expect(list(page)).toBeHidden();
	await expect(page.getByRole("heading", { name: before.title, level: 2 })).toBeInViewport();

	// Read now: the releases are off the list (the Changelog has them); the Nudge stays, read.
	await page.reload();
	await hydrated(bell(page));
	await expect(page.getByRole("heading", { level: 1 })).toBeVisible(clientRendered);
	await bell(page).click();
	await expect(rows).toHaveCount(1);
	await expect(rows.first()).toContainText("Groceries is ahead of pace");
	await expect(rows.first().getByText("unread")).toHaveCount(0);
	await expect(bell(page)).toHaveAccessibleName("Notifications");
	// The Nudge's row leads where the Nudge did.
	await rows.first().getByRole("link").click();
	await expect(page).toHaveURL(/\/plan/);

	await page.context().close();
});

test("on a 320px phone the bell is in More, marked on the tab bar, and nothing scrolls sideways", async ({
	browser,
}) => {
	test.slow();
	const page = await signedInPage(browser, parent.email, {
		viewport: { width: 320, height: 640 },
	});
	await createHousehold(page, "The Rinks", "Alex");

	await page.goto("/month");
	const more = page
		.getByRole("navigation", { name: "Main" })
		.getByRole("link", { name: "More", exact: true });
	await hydrated(more);
	await expect(more.locator("[data-bell-dot]")).toBeVisible(clientRendered);

	const sheet = await openMore(page);
	const row = sheet.getByRole("button", { name: "Notifications, 1 unread" });
	await expect(row).toBeVisible();
	expect((await row.boundingBox())?.height).toBeGreaterThanOrEqual(44);
	await row.click();
	await expect(list(page)).toBeVisible();
	await expect(list(page).getByRole("listitem")).toContainText([latest.title]);
	expect(await sideways(page)).toBeLessThanOrEqual(0);
	const box = await list(page).boundingBox();
	expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
	expect((box?.x ?? 0) + (box?.width ?? 321)).toBeLessThanOrEqual(320);
	await expect(more.locator("[data-bell-dot]")).toHaveCount(0);

	// Escape closes the list only; the sheet is still there, with the keyboard on the row.
	await page.keyboard.press("Escape");
	await expect(list(page)).toBeHidden();
	await expect(sheet).toBeVisible();
	await expect(sheet.getByRole("button", { name: "Notifications", exact: true })).toBeFocused();

	// The release's row takes the sheet's place: the Changelog, at that release.
	await sheet.getByRole("button", { name: "Notifications", exact: true }).click();
	await list(page)
		.getByRole("link", { name: new RegExp(latest.title.slice(0, 20)) })
		.click();
	await expect(page).toHaveURL(new RegExp(`/household/changelog#${latest.id}$`));
	await expect(sheet).toBeHidden();
	expect(await sideways(page)).toBeLessThanOrEqual(0);

	await page.reload();
	await hydrated(more);
	await expect(page.getByRole("heading", { level: 1 })).toBeVisible(clientRendered);
	await expect(more.locator("[data-bell-dot]")).toHaveCount(0);

	await page.context().close();
});
