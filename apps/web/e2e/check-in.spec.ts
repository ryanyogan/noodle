import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { ulid } from "ulid";
import { createTestParent } from "./parents";
import { choose, createPlannedHousehold, openToDo, savedBy, signedInPage } from "./session";

let parent: Awaited<ReturnType<typeof createTestParent>>;

test.beforeEach(async () => {
	parent = await createTestParent();
});

test.afterEach(async () => {
	await parent?.remove();
});

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Today in the browser's (and so the Household's) time zone, which is this machine's. */
const today = () => {
	const now = new Date();
	const pad = (n: number) => String(n).padStart(2, "0");
	return {
		day: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
		weekday: WEEKDAYS[now.getDay()] ?? "Sunday",
	};
};

const q = (value: string) => `'${value.replaceAll("'", "''")}'`;

/**
 * What a week leaves for a Check-in, written straight into the local D1: a Transaction waiting in
 * Review, a new Insight, $250 of income beyond take-home pay, and a second Parent, Sam, who has
 * already done this week's (`week`).
 */
function seedCheckIn(clerkUserId: string, week: string) {
	const household = `(select household_id from members where clerk_user_id = ${q(clerkUserId)})`;
	const member = `(select id from members where clerk_user_id = ${q(clerkUserId)})`;
	const transaction = ulid();
	const sam = ulid();
	const statements = [
		`insert into transactions (id, household_id, source, date, amount_cents, note, created_by_member_id) values (${q(transaction)}, ${household}, 'quick-add', ${q(week)}, 4200, 'Corner Hardware', ${member});`,
		`insert into categorizations (transaction_id, household_id, member_id, outcome, merchant) values (${q(transaction)}, ${household}, ${member}, 'review', 'Corner Hardware');`,
		`insert into insights (id, household_id, kind, title, body, yearly_impact_cents, transaction_ids, commitment_ids, fingerprint) values (${q(ulid())}, ${household}, 'price-increase', 'Internet went up $10', 'It was $60 and is $70 now.', 12000, '[]', '[]', ${q(ulid())});`,
		`insert into income (id, household_id, date, amount_cents, note, created_by_member_id) values (${q(ulid())}, ${household}, ${q(week)}, 525000, 'Paycheck and bonus', ${member});`,
		`insert into members (id, household_id, kind, name) values (${q(sam)}, ${household}, 'parent', 'Sam');`,
		`insert into check_ins (household_id, member_id, week) values (${household}, ${q(sam)}, ${q(week)});`,
	];
	const file = join(mkdtempSync(join(tmpdir(), "noodle-check-in-")), "seed.sql");
	writeFileSync(file, statements.join("\n"));
	execFileSync("bunx", ["wrangler", "d1", "execute", "noodle", "--local", `--file=${file}`], {
		stdio: "ignore",
	});
}

test("a seeded Check-in walks Review, Insights and Extra income to a done state", async ({
	browser,
}) => {
	// Planning the month and seeding through wrangler take most of the default budget.
	test.slow();
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, { baseline: "5,000", buckets: [["Groceries", "1,200"]] });

	// Today is the Check-in day, so this week's starts today.
	const { day, weekday } = today();
	await page.getByRole("link", { name: /^Household( settings)?$/ }).click();
	const checkInDay = page.getByRole("combobox", { name: "Check-in day" });
	await expect(checkInDay).toHaveText("Sunday");
	const saved = savedBy(page, "setCheckInDay");
	await choose(page, "Check-in day", weekday);
	await saved;

	seedCheckIn(parent.userId, day);

	// On the day, This Month says so, and the sidebar marks it until it's done.
	await page.getByRole("link", { name: "This Month", exact: true }).click();
	await openToDo(page, "Check-in");
	await expect(page.getByRole("heading", { name: "It’s Check-in day" })).toBeVisible();
	const sidebarCheckIn = page
		.getByRole("navigation", { name: "Main" })
		.getByRole("link", { name: /^Check-in/ });
	await expect(sidebarCheckIn).toHaveAccessibleName("Check-in not done this week");
	await sidebarCheckIn.click();
	await expect(page.locator("[data-slot=page-header]:visible")).toContainText("Check-in");

	// Sweeps has nothing in it (last month had no Plan), so it's skipped.
	await expect(page.getByText("1 of 3")).toBeVisible();
	await expect(page.getByRole("heading", { name: "1 Transaction in Review" })).toBeVisible();
	await expect(page.getByRole("link", { name: "Open Review" })).toBeVisible();
	await page.getByRole("button", { name: "Skip for now" }).click();

	await expect(page.getByText("2 of 3")).toBeVisible();
	await expect(page.getByRole("heading", { name: "1 new Insight" })).toBeVisible();
	await expect(page.getByText("Internet went up $10")).toBeVisible();
	// Leaving to look at the Insight and coming Back picks up at the same card.
	await page.getByRole("link", { name: "Open Insights" }).click();
	await expect(page.locator("[data-slot=page-header]:visible")).toContainText("Insights");
	await page.goBack();
	await expect(page.getByText("2 of 3")).toBeVisible();
	await expect(page.getByRole("heading", { name: "1 new Insight" })).toBeVisible();
	await page.getByRole("button", { name: "Skip for now" }).click();

	await expect(page.getByText("3 of 3")).toBeVisible();
	await expect(page.getByRole("heading", { name: "$250 of Extra income to decide" })).toBeVisible();
	const finished = savedBy(page, "completeCheckIn");
	await page.getByRole("button", { name: "Skip and finish" }).click();
	await finished;

	await expect(page.getByText("You’re done for this week")).toBeVisible();
	// What was skipped still waits, and the Check-in says so.
	await expect(page.getByText(/Still waiting for you: 1 Transaction in Review/)).toBeVisible();
	await expect(sidebarCheckIn).toHaveAccessibleName("Check-in");
	await expect(page.getByText("Sam finished this week’s Check-in.")).toBeVisible();

	// Finishing was recorded: it's still done after a reload.
	await page.reload();
	await expect(page.getByText("You’re done for this week")).toBeVisible();
	await expect(page.getByRole("button", { name: "Skip for now" })).toBeHidden();
});
