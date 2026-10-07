import { expect, type Page, test } from "@playwright/test";
import { ulid } from "ulid";
import { createTestParent } from "./parents";
import { seedSql } from "./seed-sql";
import {
	createPlannedHousehold,
	enterJoinedHousehold,
	hydrated,
	savedBy,
	signedInPage,
	switchTo,
} from "./session";

const waterfall = (page: Page) => page.getByRole("region", { name: "Where take-home pay goes" });
/** The Log in Household settings, and its rows about one item. */
const log = (page: Page) => page.getByRole("table", { name: "Log" });
const rows = (page: Page, what: string) =>
	log(page)
		.locator("[data-slot=data-table-row]")
		.filter({ has: page.getByText(what, { exact: true }) });

/** From the Plan to the Log by the Plan's one link, narrowed to the Plan's month. */
async function seeWhatChanged(page: Page) {
	const link = page.getByRole("link", { name: "See what changed" });
	await expect(link).toHaveCount(1);
	await link.click();
	await expect(page).toHaveURL(/\/household\?month=\d{4}-\d{2}#log$/);
	// Household settings loads everything it shows before it draws: give a busy machine time.
	await expect(page.getByRole("button", { name: /^Takes effect in / })).toBeVisible({
		timeout: 30_000,
	});
	await expect(log(page).locator("[data-slot=data-table-row]").first()).toBeVisible();
}

async function openPart(page: Page, part: "Overview" | "Commitments") {
	await page
		.getByRole("navigation", { name: "Plan pages" })
		.getByRole("link", { name: part, exact: true })
		.click();
	await expect(page.locator("nav[aria-label='Plan pages'] [aria-current=page]")).toHaveText(part);
}

async function backToPlan(page: Page) {
	await page
		.getByRole("navigation", { name: "Plan pages" })
		.getByRole("link", { name: "Overview" })
		.click();
	await expect(waterfall(page)).toBeVisible();
}

test("the Log shows each Plan change, who made it and when; the other Parent's Personal Allowance only as changed", async ({
	browser,
}) => {
	// Two Parents sign in and change the Plan throughout: close to 30 s even run alone.
	test.slow();
	const first = await createTestParent();
	const second = await createTestParent();
	try {
		const page = await signedInPage(browser, first.email);
		await createPlannedHousehold(page, { baseline: "9,000", buckets: [["Groceries", "1,200"]] });

		// Alex brings the other Parent in, so the Plan's changes come from two people.
		await page.getByRole("link", { name: "Household" }).click();
		await page.getByLabel("Their email").fill(second.email);
		await page.getByRole("button", { name: /^Invite/ }).click();
		await expect(page.getByText(`Invited ${second.email}`)).toBeVisible();
		const samPage = await signedInPage(browser, second.email);
		await samPage.goto("/welcome");
		await samPage.getByLabel("Your name").fill("Sam");
		await samPage.getByRole("button", { name: "Join The Rinks" }).click();
		await enterJoinedHousehold(samPage);
		await expect(samPage).toHaveURL(/\/month\/\d{4}-\d{2}$/);

		await page.goto("/month");
		await switchTo(page, "Plan");
		await openPart(page, "Overview");
		// Alex's own Personal Allowance, which Sam never sees the amounts of.
		await page.getByLabel("Your Personal Allowance").fill("150");
		await page.getByRole("button", { name: "Set up Personal Allowance" }).click();
		await expect(
			page.getByRole("button", { name: "Edit Alex’s Personal Allowance" }),
		).toBeVisible();

		await page.getByRole("button", { name: "Edit Groceries" }).click();
		let sheet = page.getByRole("dialog", { name: "Groceries" });
		await sheet.getByRole("textbox", { name: "Allowance", exact: true }).fill("1,500");
		const allowanceSaved = savedBy(page, "setAllowance");
		await sheet.getByRole("button", { name: "Save", exact: true }).click();
		await allowanceSaved;
		// The Bucket's own history, in its sheet.
		await page.getByRole("button", { name: "Edit Groceries" }).click();
		sheet = page.getByRole("dialog", { name: "Groceries" });
		await sheet.getByText("History", { exact: true }).click();
		await expect(sheet.getByText("$1,200 → $1,500")).toBeVisible();
		await expect(sheet.getByText(/^Added · \$1,200/)).toBeVisible();
		// Its oldest change is the add, so the history is whole: no "History starts" (#51).
		await expect(sheet.getByText(/History starts/)).toHaveCount(0);
		await page.keyboard.press("Escape");
		await backToPlan(page);

		await openPart(page, "Commitments");
		const add = page.getByRole("form", { name: "Add a Commitment" });
		await add.getByLabel("New Commitment").fill("Daycare");
		await add.getByLabel("Amount due").fill("1,400");
		await add.getByRole("button", { name: "Add Commitment" }).click();
		await page.getByRole("button", { name: "Edit Daycare" }).click();
		sheet = page.getByRole("dialog", { name: "Daycare" });
		await sheet.getByLabel("Amount", { exact: true }).fill("1,450");
		const termsSaved = savedBy(page, "updateCommitment");
		await sheet.getByRole("button", { name: "Save", exact: true }).click();
		await termsSaved;
		await backToPlan(page);

		// The Plan no longer lists its changes: one link opens the Log at this month.
		await expect(page.locator("section[aria-labelledby=what-changed]")).toHaveCount(0);
		await expect(page.getByText("What changed", { exact: true })).toHaveCount(0);
		await seeWhatChanged(page);

		// Every change is a row: what it was and what it became, who made it and when.
		await expect(rows(page, "Groceries").filter({ hasText: "Added · $1,200" })).toHaveCount(1);
		const raised = rows(page, "Groceries").filter({ hasText: "$1,200 → $1,500" });
		await expect(raised).toHaveCount(1);
		await expect(raised).toContainText("Alex");
		await expect(raised).toContainText(/\w{3} \d{1,2}, \d{4}/);
		await expect(raised).toContainText(/From \w+ on/);
		await expect(rows(page, "Daycare").filter({ hasText: "Added · $1,400" })).toHaveCount(1);
		await expect(rows(page, "Daycare").filter({ hasText: "$1,400 → $1,450" })).toHaveCount(1);
		await expect(rows(page, "Alex’s Personal Allowance")).toContainText("Added · $150");
		// Newest first: the last change made is the first row.
		await expect(log(page).locator("[data-slot=data-table-row]").first()).toContainText(
			"$1,400 → $1,450",
		);
		// Narrowed to a kind of item, from the server.
		await page.getByRole("combobox", { name: "Kind of item" }).click();
		await page.getByRole("option", { name: "Bills", exact: true }).click();
		await expect(page).toHaveURL(/kind=commitment/);
		await expect(rows(page, "Daycare")).toHaveCount(2);
		await expect(rows(page, "Groceries")).toHaveCount(0);

		// Sam sees what Alex changed, but Alex's Personal Allowance only as changed.
		await samPage.goto("/month");
		await switchTo(samPage, "Plan");
		await seeWhatChanged(samPage);
		await expect(rows(samPage, "Daycare").filter({ hasText: "$1,400 → $1,450" })).toContainText(
			"Alex",
		);
		const hidden = log(samPage)
			.locator("[data-slot=data-table-row]")
			.filter({ hasText: "Personal Allowance changed" });
		await expect(hidden).toHaveCount(1);
		await expect(hidden).toContainText("Alex");
		await expect(log(samPage)).not.toContainText("$150");
		await expect(log(samPage)).not.toContainText("Alex’s Personal Allowance");
		// Narrowed to Alex's changes, it is still only that.
		await samPage.getByRole("combobox", { name: "Who made the change" }).click();
		await samPage.getByRole("option", { name: "Alex", exact: true }).click();
		await expect(samPage).toHaveURL(/who=/);
		await expect(hidden).toHaveCount(1);
		await expect(log(samPage)).not.toContainText("$150");
	} finally {
		await Promise.all([first.remove(), second.remove()]);
	}
});

test("the Log sorts by when and by who from the server, and shows a snapshot as it is taken", async ({
	browser,
}) => {
	test.slow();
	const parent = await createTestParent();
	try {
		const page = await signedInPage(browser, parent.email);
		await createPlannedHousehold(page, {
			baseline: "9,000",
			buckets: [
				["Groceries", "1,200"],
				["Fuel", "300"],
			],
		});
		await page.goto("/household#log");
		const all = log(page).locator("[data-slot=data-table-row]");
		await expect(all.first()).toBeVisible({ timeout: 30_000 });
		const newest = await all.allTextContents();
		expect(newest.length).toBeGreaterThanOrEqual(3);

		// A click on When turns the whole Log round: the server sorts, and the address says so.
		const when = log(page).getByRole("button", { name: "When, newest first" });
		await hydrated(when);
		await when.click();
		await expect(page).toHaveURL(/order=oldest/);
		await expect(log(page).getByRole("button", { name: "When, oldest first" })).toBeVisible();
		await expect.poll(() => all.allTextContents()).toEqual([...newest].reverse());

		await log(page).getByRole("button", { name: "Sort by who" }).click();
		await expect(page).toHaveURL(/order=who\b/);
		await expect(log(page).getByRole("button", { name: "Who, A to Z" })).toBeVisible();
		await expect(all).toHaveCount(newest.length);

		// A snapshot taken on this screen is a row of the Log without a reload.
		const snapshots = page.getByRole("region", { name: "Snapshots" });
		await snapshots.getByLabel("Note").fill("Before the holidays");
		await snapshots.getByRole("button", { name: "Take a snapshot" }).click();
		await expect(rows(page, "Snapshot")).toContainText("Before the holidays", { timeout: 40_000 });
		await expect(rows(page, "Snapshot")).toContainText("Right away");
	} finally {
		await parent.remove();
	}
});

const q = (value: string) => `'${value.replaceAll("'", "''")}'`;

test("a Rule made then removed is in the Log twice, as made and as removed, each with its time of day", async ({
	browser,
}) => {
	test.slow();
	const parent = await createTestParent();
	try {
		const page = await signedInPage(browser, parent.email);
		await page.setViewportSize({ width: 1440, height: 900 });
		const made = await createPlannedHousehold(page, {
			baseline: "9,000",
			buckets: [["Groceries", "1,200"]],
		});
		if (!made) throw new Error("The Household wasn't made directly");
		const household = `(select household_id from members where clerk_user_id = ${q(parent.userId)})`;
		const member = `(select id from members where clerk_user_id = ${q(parent.userId)})`;
		const ruleId = ulid();
		// Made yesterday, so "made" and "removed" are on different days as well as times.
		await seedSql([
			`insert into rules (id, household_id, pattern, bucket_id, created_by_member_id, created_at) values (${q(ruleId)}, ${household}, 'costco', (select id from buckets where household_id = ${household} and name = 'Groceries'), ${member}, (unixepoch() - 86400) * 1000);`,
		]);

		// While it stands, the Log has it once, as made.
		await page.goto("/household?kind=rule#log");
		await expect(rows(page, "“costco”")).toHaveCount(1, { timeout: 30_000 });
		await expect(rows(page, "“costco”")).toContainText("Rule made · files into Groceries");

		await page.goto(`/review/rules/${ruleId}`);
		const remove = page.getByRole("button", { name: "Delete Rule" });
		await hydrated(remove);
		await remove.click();
		await page.getByRole("button", { name: "Delete Rule" }).click();
		await expect
			.poll(
				async () => {
					const [found = []] = await seedSql([
						`select kind from log_events where household_id = ${household} order by kind;`,
					]);
					return found.map((row) => row.kind);
				},
				{ timeout: 30_000 },
			)
			.toEqual(["rule-made", "rule-removed"]);

		// Removed: both rows, newest first, each with a time of day.
		await page.goto("/household?kind=rule#log");
		const both = rows(page, "“costco”");
		await expect(both).toHaveCount(2, { timeout: 30_000 });
		await expect(both.nth(0)).toContainText("Rule removed · it filed into Groceries");
		await expect(both.nth(1)).toContainText("Rule made · files into Groceries");
		for (const row of [both.nth(0), both.nth(1)]) {
			await expect(row).toContainText(/[A-Z][a-z]{2} \d{1,2}, \d{1,2}:\d{2} (AM|PM)/);
		}
		expect(await both.nth(0).textContent()).not.toBe(await both.nth(1).textContent());
	} finally {
		await parent.remove();
	}
});

test("on a phone the Log has a Sort control: Newest, Oldest, Who", async ({ browser }) => {
	test.slow();
	const parent = await createTestParent();
	try {
		const page = await signedInPage(browser, parent.email);
		await createPlannedHousehold(page, {
			baseline: "9,000",
			buckets: [
				["Groceries", "1,200"],
				["Fuel", "300"],
			],
		});
		await page.setViewportSize({ width: 393, height: 852 });
		await page.goto("/household#log");
		const all = page.getByLabel("Log", { exact: true }).locator("[data-slot=data-table-row]");
		await expect(all.first()).toBeVisible({ timeout: 30_000 });
		const newest = await all.allTextContents();
		expect(newest.length).toBeGreaterThanOrEqual(3);

		const sort = page.getByRole("combobox", { name: "Sort" });
		await hydrated(sort);
		await expect(sort).toHaveText("Newest");
		await sort.click();
		await page.getByRole("option", { name: "Oldest" }).click();
		await expect(page).toHaveURL(/order=oldest/);
		await expect.poll(() => all.allTextContents()).toEqual([...newest].reverse());
		await sort.click();
		await page.getByRole("option", { name: "Who" }).click();
		await expect(page).toHaveURL(/order=who\b/);
		await expect(all).toHaveCount(newest.length);
		// Nothing runs off the side.
		expect(
			await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
		).toBeLessThanOrEqual(0);

		// With column headers to click, the control isn't there.
		await page.setViewportSize({ width: 1440, height: 900 });
		await expect(sort).toBeHidden();
	} finally {
		await parent.remove();
	}
});
