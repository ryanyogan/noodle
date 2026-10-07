import { expect, type Page, test } from "@playwright/test";
import { ulid } from "ulid";
import { createTestParent } from "./parents";
import { seedSql } from "./seed-sql";
import {
	choose,
	createPlannedHousehold,
	hydrated,
	openToDo,
	savedBy,
	signedInPage,
} from "./session";

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
async function seedCheckIn(clerkUserId: string, week: string) {
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
	await seedSql(statements);
}

test("a seeded Check-in walks Review, Insights and Extra income to a done state", async ({
	browser,
}) => {
	// Planning the month and seeding take most of the default budget.
	test.slow();
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, { baseline: "5,000", buckets: [["Groceries", "1,200"]] });

	// Today is the Check-in day, so this week's starts today.
	const { day, weekday } = today();
	await page.getByRole("link", { name: /^Household( settings)?$/ }).click();
	const checkInDay = page.getByRole("combobox", { name: "Check-in day" });
	await expect(checkInDay).toHaveText("Sunday");
	// On a Sunday (CI's clock is UTC, so a US evening can be Sunday there) it already is, and
	// choosing it again changes nothing, so there's no save to wait for.
	if (weekday !== "Sunday") {
		const saved = savedBy(page, "setCheckInDay");
		await choose(page, "Check-in day", weekday);
		await saved;
	}

	await seedCheckIn(parent.userId, day);

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
	await expect(page.getByRole("list", { name: "Waiting in Review" })).toContainText(
		"Corner Hardware",
	);
	await expect(page.getByRole("link", { name: "Open full page" })).toBeVisible();
	await page.getByRole("button", { name: "Skip for now" }).click();

	await expect(page.getByText("2 of 3")).toBeVisible();
	await expect(page.getByRole("heading", { name: "1 new Insight" })).toBeVisible();
	const newInsights = page.getByRole("list", { name: "New Insights" });
	await expect(newInsights).toContainText("Internet went up $10");
	await expect(newInsights).toContainText("It was $60 and is $70 now.");
	// Leaving to look at the Insight and coming Back picks up at the same card.
	await page.getByRole("link", { name: "Open full page" }).click();
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

/**
 * The other Parent's Personal Allowance in a Check-in, written straight into the local D1: Jordan's
 * gift in his Personal Allowance with a leftover Review row, and a Transaction waiting in Review
 * whose kept guess is his Personal Allowance.
 */
async function seedPrivateReview(clerkUserId: string, day: string) {
	const household = `(select household_id from members where clerk_user_id = ${q(clerkUserId)})`;
	const jordan = `(select id from members where household_id = ${household} and name = 'Jordan')`;
	const allowance = `(select id from buckets where owner_member_id = ${jordan})`;
	const gift = ulid();
	const hardware = ulid();
	const statements = [
		`insert into transactions (id, household_id, source, date, amount_cents, note, bucket_id, created_by_member_id) values (${q(gift)}, ${household}, 'quick-add', ${q(day)}, 4200, 'Birthday gift for Sam', ${allowance}, ${jordan});`,
		`insert into categorizations (transaction_id, household_id, member_id, outcome, merchant) values (${q(gift)}, ${household}, ${jordan}, 'review', 'Secret Gift Shop');`,
		`insert into transactions (id, household_id, source, date, amount_cents, note, created_by_member_id) values (${q(hardware)}, ${household}, 'quick-add', ${q(day)}, 1800, 'Corner Hardware', ${jordan});`,
		`insert into categorizations (transaction_id, household_id, member_id, outcome, merchant, bucket_id) values (${q(hardware)}, ${household}, ${jordan}, 'review', 'Corner Hardware', ${allowance});`,
	];
	await seedSql(statements);
}

test("the other Parent's Check-in lists nothing from a Personal Allowance in Review", async ({
	browser,
}) => {
	test.slow();
	const page = await signedInPage(browser, parent.email);
	// Jordan, the other Parent, never signs in here; his Personal Allowance is what must not show.
	await createPlannedHousehold(page, {
		baseline: "5,000",
		buckets: [["Groceries", "1,200"]],
		otherParent: { name: "Jordan", personalAllowanceCents: 15_000 },
	});
	const { day, weekday } = today();
	await page.getByRole("link", { name: /^Household( settings)?$/ }).click();
	await expect(page.getByRole("combobox", { name: "Check-in day" })).toHaveText("Sunday");
	// Sunday is already the Check-in day, so on a Sunday (UTC on CI) there's no save to wait for.
	if (weekday !== "Sunday") {
		const saved = savedBy(page, "setCheckInDay");
		await choose(page, "Check-in day", weekday);
		await saved;
	}

	await seedPrivateReview(parent.userId, day);

	// Everything this Parent's browser is sent from here on.
	const bodies: Promise<string>[] = [];
	page.on("response", (response) => {
		const type = response.request().resourceType();
		if (type === "fetch" || type === "document") bodies.push(response.text().catch(() => ""));
	});
	await page.getByRole("link", { name: "This Month", exact: true }).click();
	await page
		.getByRole("navigation", { name: "Main" })
		.getByRole("link", { name: /^Check-in/ })
		.click();
	await expect(page.getByRole("heading", { name: "1 Transaction in Review" })).toBeVisible();
	const waiting = page.getByRole("list", { name: "Waiting in Review" });
	await expect(waiting.getByRole("listitem")).toHaveCount(1);
	await expect(waiting).toContainText("Corner Hardware");
	await expect(waiting).not.toContainText(/gift|Personal Allowance/i);
	for (const body of await Promise.all(bodies)) {
		expect(body).not.toContain("Birthday gift");
		expect(body).not.toContain("Secret Gift Shop");
	}
});

/** A planned Household whose Check-in week starts today, with Sam as its other Parent. */
async function householdOnCheckInDay(page: Page) {
	await createPlannedHousehold(page, { baseline: "5,000", buckets: [["Groceries", "1,200"]] });
	const { day, weekday } = today();
	await page.getByRole("link", { name: /^Household( settings)?$/ }).click();
	const checkInDay = page.getByRole("combobox", { name: "Check-in day" });
	await expect(checkInDay).toHaveText("Sunday");
	if (weekday !== "Sunday") {
		const saved = savedBy(page, "setCheckInDay");
		await choose(page, "Check-in day", weekday);
		await saved;
	}
	return day;
}

/** Opens the Check-in from the sidebar and waits until the week's stack has been started. */
async function openCheckIn(page: Page) {
	const started = savedBy(page, "startCheckInStack");
	await page.getByRole("link", { name: "This Month", exact: true }).click();
	await page
		.getByRole("navigation", { name: "Main" })
		.getByRole("link", { name: /^Check-in/ })
		.click();
	await started;
}

test("cards dealt with stay in the week's stack as a line each, counted, with Next and Finish", async ({
	browser,
}) => {
	test.slow();
	const page = await signedInPage(browser, parent.email);
	const day = await householdOnCheckInDay(page);
	await seedCheckIn(parent.userId, day);
	const household = `(select household_id from members where clerk_user_id = ${q(parent.userId)})`;
	const me = `(select id from members where clerk_user_id = ${q(parent.userId)})`;
	const sam = `(select id from members where household_id = ${household} and name = 'Sam')`;

	await openCheckIn(page);
	await expect(page.getByText("1 of 3")).toBeVisible();
	await expect(page.getByRole("heading", { name: "1 Transaction in Review" })).toBeVisible();

	// Elsewhere in the app: the Transaction leaves Review (with no record of who, as one filed
	// before that was kept) and Sam dismisses the Insight. The Extra income still waits.
	await seedSql([
		`delete from categorizations where household_id = ${household};`,
		`delete from transactions where household_id = ${household};`,
		`update insights set status = 'dismissed', decided_by_member_id = ${sam} where household_id = ${household};`,
	]);
	await page.reload();

	// The stack is still three cards: the two dealt with each say what was done.
	await expect(page.getByText("1 of 3")).toBeVisible();
	await expect(
		page.getByRole("heading", { name: "1 Transaction cleared from Review" }),
	).toBeVisible();
	await expect(page.getByRole("button", { name: /^Skip/ })).toBeHidden();
	const next = page.getByRole("button", { name: "Next", exact: true });
	await hydrated(next);
	await next.click();

	await expect(page.getByText("2 of 3")).toBeVisible();
	await expect(page.getByRole("heading", { name: "Sam decided 1 Insight" })).toBeVisible();
	// Both lines are in the week's steps, beside the card.
	const steps = page.getByRole("navigation", { name: "Check-in steps" });
	await expect(steps).toContainText("1 Transaction cleared from Review");
	await expect(steps).toContainText("Sam decided 1 Insight");
	// Meanwhile this Parent puts the Extra income in Groceries. Every card is dealt with now, but
	// they are part-way through: the lines keep their Next, and the last one its Finish.
	await seedSql([
		`insert into moves (id, household_id, kind, month, to_bucket_id, amount_cents, created_by_member_id) values (${q(ulid())}, ${household}, 'windfall', ${q(day.slice(0, 7))}, (select id from buckets where household_id = ${household} and name = 'Groceries'), 25000, ${me});`,
	]);
	await page.reload();
	await expect(page.getByText("2 of 3")).toBeVisible();
	await hydrated(next);
	await next.click();

	await expect(page.getByText("3 of 3")).toBeVisible();
	await expect(
		page.getByRole("heading", { name: "You decided $250 of Extra income" }),
	).toBeVisible();
	const finished = savedBy(page, "completeCheckIn");
	await page.getByRole("button", { name: "Finish", exact: true }).click();
	await finished;
	await expect(page.getByText("You’re done for this week")).toBeVisible();
	await expect(page.getByText(/Still waiting for you/)).toBeHidden();
	// The week's steps stay, with what was done.
	await expect(steps.getByRole("listitem")).toHaveCount(3);
	await expect(steps).toContainText("You decided $250 of Extra income");
});

test("a card that first appears mid-week joins the end of the week's stack", async ({
	browser,
}) => {
	test.slow();
	const page = await signedInPage(browser, parent.email);
	const day = await householdOnCheckInDay(page);
	const household = `(select household_id from members where clerk_user_id = ${q(parent.userId)})`;
	const member = `(select id from members where clerk_user_id = ${q(parent.userId)})`;
	// The week starts with an Insight and Extra income; nothing is in Review.
	await seedSql([
		`insert into insights (id, household_id, kind, title, body, yearly_impact_cents, transaction_ids, commitment_ids, fingerprint) values (${q(ulid())}, ${household}, 'price-increase', 'Internet went up $10', 'It was $60 and is $70 now.', 12000, '[]', '[]', ${q(ulid())});`,
		`insert into income (id, household_id, date, amount_cents, note, created_by_member_id) values (${q(ulid())}, ${household}, ${q(day)}, 525000, 'Paycheck and bonus', ${member});`,
	]);

	await openCheckIn(page);
	await expect(page.getByText("1 of 2")).toBeVisible();
	await expect(page.getByRole("heading", { name: "1 new Insight" })).toBeVisible();

	// Later in the week a Transaction reaches Review.
	const transaction = ulid();
	const joined = savedBy(page, "startCheckInStack");
	await seedSql([
		`insert into transactions (id, household_id, source, date, amount_cents, note, created_by_member_id) values (${q(transaction)}, ${household}, 'quick-add', ${q(day)}, 4200, 'Corner Hardware', ${member});`,
		`insert into categorizations (transaction_id, household_id, member_id, outcome, merchant) values (${q(transaction)}, ${household}, ${member}, 'review', 'Corner Hardware');`,
	]);
	await page.reload();
	await joined;

	// Review would be first in a fresh stack; this week it is the third card, after the two the
	// week started with, and the Parent is still on the first.
	await expect(page.getByText("1 of 3")).toBeVisible();
	await expect(page.getByRole("heading", { name: "1 new Insight" })).toBeVisible();
	const steps = page.getByRole("navigation", { name: "Check-in steps" }).getByRole("listitem");
	await expect(steps).toHaveCount(3);
	await expect(steps.nth(0)).toContainText("Insights");
	await expect(steps.nth(1)).toContainText("Extra income");
	await expect(steps.nth(2)).toContainText("Review");
	// And it stays there on the next look.
	await page.reload();
	await expect(steps.nth(2)).toContainText("1 Transaction in Review");
	const skip = page.getByRole("button", { name: "Skip for now" });
	await hydrated(skip);
	await skip.click();
	await skip.click();
	await expect(page.getByText("3 of 3")).toBeVisible();
	await expect(page.getByRole("heading", { name: "1 Transaction in Review" })).toBeVisible();
	await expect(steps.nth(0)).toContainText("Skipped");
});

test("a Parent arriving after the other cleared everything sees who did, every line, and one Finish", async ({
	browser,
}) => {
	test.slow();
	const page = await signedInPage(browser, parent.email);
	const day = await householdOnCheckInDay(page);
	await seedCheckIn(parent.userId, day);
	const household = `(select household_id from members where clerk_user_id = ${q(parent.userId)})`;
	const sam = `(select id from members where household_id = ${household} and name = 'Sam')`;

	await openCheckIn(page);
	await expect(page.getByText("1 of 3")).toBeVisible();

	// Sam goes through all of it: files the Transaction from Review (filing notes who), dismisses
	// the Insight, and puts the Extra income in Groceries.
	await seedSql([
		`update transactions set review_cleared_by_member_id = ${sam}, review_cleared_at = unixepoch() * 1000 where household_id = ${household};`,
		`delete from categorizations where household_id = ${household};`,
		`update insights set status = 'dismissed', decided_by_member_id = ${sam} where household_id = ${household};`,
		`insert into moves (id, household_id, kind, month, to_bucket_id, amount_cents, created_by_member_id) values (${q(ulid())}, ${household}, 'windfall', ${q(day.slice(0, 7))}, (select id from buckets where household_id = ${household} and name = 'Groceries'), 25000, ${sam});`,
	]);
	await page.reload();

	// One summary: who cleared it, each card's line, and Finish. No Next to press through.
	await expect(page.getByRole("heading", { name: "Sam cleared these 3" })).toBeVisible();
	const lines = page.getByRole("list", { name: "Dealt with this week" }).getByRole("listitem");
	await expect(lines).toHaveCount(3);
	await expect(lines.nth(0)).toContainText("Sam cleared 1 Transaction from Review");
	await expect(lines.nth(1)).toContainText("Sam decided 1 Insight");
	await expect(lines.nth(2)).toContainText("Sam decided $250 of Extra income");
	await expect(page.getByText("1 of 3")).toBeHidden();
	await expect(page.getByRole("button", { name: "Next", exact: true })).toBeHidden();
	await expect(page.getByRole("button", { name: /^Skip/ })).toBeHidden();

	const finish = page.getByRole("button", { name: "Finish", exact: true });
	await hydrated(finish);
	const finished = savedBy(page, "completeCheckIn");
	await finish.click();
	await finished;
	await expect(page.getByText("You’re done for this week")).toBeVisible();
	await expect(page.getByText(/Still waiting for you/)).toBeHidden();
});

test("a skipped card is still skipped on coming back the same week", async ({ browser }) => {
	test.slow();
	const page = await signedInPage(browser, parent.email);
	const day = await householdOnCheckInDay(page);
	await seedCheckIn(parent.userId, day);

	await openCheckIn(page);
	await expect(page.getByText("1 of 3")).toBeVisible();
	await expect(page.getByRole("heading", { name: "1 Transaction in Review" })).toBeVisible();
	const skip = page.getByRole("button", { name: "Skip for now" });
	await hydrated(skip);
	const skipped = savedBy(page, "skipCheckInCard");
	await skip.click();
	await skipped;
	await expect(page.getByText("2 of 3")).toBeVisible();

	// Leaving and coming back (nothing in the address says what was passed): Review is still
	// skipped, and the Check-in picks up at the card after it.
	await page.getByRole("link", { name: "This Month", exact: true }).click();
	await page
		.getByRole("navigation", { name: "Main" })
		.getByRole("link", { name: /^Check-in/ })
		.click();
	await expect(page).not.toHaveURL(/past=/);
	await expect(page.getByText("2 of 3")).toBeVisible();
	await expect(page.getByRole("heading", { name: "1 new Insight" })).toBeVisible();
	const steps = page.getByRole("navigation", { name: "Check-in steps" }).getByRole("listitem");
	await expect(steps.nth(0)).toContainText("Skipped");
	await expect(steps.nth(1)).toContainText("1 new Insight");

	// And after a reload, and once the week's Check-in is finished.
	await page.reload();
	await expect(steps.nth(0)).toContainText("Skipped");
	await hydrated(skip);
	await skip.click();
	const finished = savedBy(page, "completeCheckIn");
	await page.getByRole("button", { name: "Skip and finish" }).click();
	await finished;
	await expect(page.getByText("You’re done for this week")).toBeVisible();
	await expect(page.getByText(/Still waiting for you: 1 Transaction in Review/)).toBeVisible();
	await page.reload();
	await expect(steps.nth(0)).toContainText("Skipped");
});

test("a skipped card can be opened again from the steps and from Still waiting for you, and dealt with", async ({
	browser,
}) => {
	test.slow();
	const page = await signedInPage(browser, parent.email);
	const day = await householdOnCheckInDay(page);
	await seedCheckIn(parent.userId, day);
	const household = `(select household_id from members where clerk_user_id = ${q(parent.userId)})`;

	await openCheckIn(page);
	await expect(page.getByRole("heading", { name: "1 Transaction in Review" })).toBeVisible();
	const skip = page.getByRole("button", { name: "Skip for now" });
	await hydrated(skip);
	const skipped = savedBy(page, "skipCheckInCard");
	await skip.click();
	await skipped;
	await expect(page.getByText("2 of 3")).toBeVisible();

	// From the steps beside the card: the skipped step has a way back to its card, by keyboard too.
	const steps = page.getByRole("navigation", { name: "Check-in steps" }).getByRole("listitem");
	await expect(steps.nth(0)).toContainText("Skipped");
	const openReview = page.getByRole("link", { name: "Open Review, skipped" });
	await expect(steps.nth(0).getByRole("link", { name: "Open Review, skipped" })).toBeVisible();
	// The card on screen, and one not yet met, have no such link.
	await expect(page.getByRole("link", { name: /^Open (Insights|Extra income)/ })).toHaveCount(0);
	await steps.nth(0).getByRole("link", { name: "Open Review, skipped" }).focus();
	await page.keyboard.press("Enter");
	await expect(page).toHaveURL(/open=review/);
	await expect(page.getByText("1 of 3")).toBeVisible();
	await expect(page.getByRole("heading", { name: "1 Transaction in Review" })).toBeVisible();
	await expect(page.getByRole("list", { name: "Waiting in Review" })).toContainText(
		"Corner Hardware",
	);
	await expect(page.getByRole("link", { name: "Open full page" })).toBeVisible();
	await expect(steps.nth(0)).toHaveAttribute("aria-current", "step");
	// Leaving it leaves it skipped, back where the Parent was; so does a reload.
	await page.getByRole("button", { name: "Leave it skipped" }).click();
	await expect(page).not.toHaveURL(/open=/);
	await expect(page.getByText("2 of 3")).toBeVisible();
	await expect(page.getByRole("heading", { name: "1 new Insight" })).toBeVisible();
	await page.reload();
	await expect(steps.nth(0)).toContainText("Skipped");
	await expect(page.getByText("2 of 3")).toBeVisible();

	// On a phone the steps aren't beside the card: the same way back is in "So far this week".
	await page.setViewportSize({ width: 393, height: 852 });
	const soFar = page.getByRole("list", { name: "So far this week" });
	await expect(soFar.getByRole("link", { name: "Open Review, skipped" })).toBeVisible();
	await soFar.getByRole("link", { name: "Open Review, skipped" }).click();
	await expect(page.getByRole("heading", { name: "1 Transaction in Review" })).toBeVisible();
	// What waits arrives under the heading and moves the buttons down: wait for it before pressing.
	await expect(page.getByRole("list", { name: "Waiting in Review" })).toContainText(
		"Corner Hardware",
	);
	await page.getByRole("button", { name: "Leave it skipped" }).click();
	await expect(page.getByRole("heading", { name: "1 new Insight" })).toBeVisible();
	await page.setViewportSize({ width: 1440, height: 900 });

	// Skipping the rest finishes the week. Each thing still waiting opens its card.
	await hydrated(skip);
	await skip.click();
	const finished = savedBy(page, "completeCheckIn");
	await page.getByRole("button", { name: "Skip and finish" }).click();
	await finished;
	await expect(page.getByText("You’re done for this week")).toBeVisible();
	await expect(
		page.getByText(/Still waiting for you: 1 Transaction in Review, 1 new/),
	).toBeVisible();
	await expect(openReview).toHaveCount(1);
	await page.getByRole("link", { name: "1 Transaction in Review", exact: true }).click();
	await expect(page).toHaveURL(/open=review/);
	await expect(page.getByRole("heading", { name: "1 Transaction in Review" })).toBeVisible();
	await expect(page.getByRole("button", { name: "Leave it skipped" })).toBeVisible();

	// Dealt with from the card: its page, where the Transaction leaves Review (with no record of
	// who, as the tests above do it), and back. "Skipped" gives way to what was done, and Review is
	// no longer among what waits.
	await page.getByRole("link", { name: "Open full page" }).click();
	await expect(page).toHaveURL(/\/review/);
	await seedSql([
		`delete from categorizations where household_id = ${household};`,
		`delete from transactions where household_id = ${household};`,
	]);
	await page.goBack();
	await expect(page.getByText("You’re done for this week")).toBeVisible();
	await expect(steps.nth(0)).toContainText("1 Transaction cleared from Review");
	await expect(steps.nth(0)).not.toContainText("Skipped");
	await expect(page.getByText(/Still waiting for you: 1 new Insight/)).toBeVisible();
	await expect(page.getByRole("link", { name: /^Open Review/ })).toHaveCount(0);
	await expect(steps.nth(1).getByRole("link", { name: "Open Insights, skipped" })).toBeVisible();
});
