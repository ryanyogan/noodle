import { expect, test } from "@playwright/test";
import { ulid } from "ulid";
import { createTestParent } from "./parents";
import { seedSql } from "./seed-sql";
import { choose, createPlannedHousehold, hydrated, signedInPage } from "./session";

let parent: Awaited<ReturnType<typeof createTestParent>>;
test.beforeEach(async () => {
	parent = await createTestParent();
});
test.afterEach(async () => {
	await parent?.remove();
});
const q = (value: string) => `'${value.replaceAll("'", "''")}'`;
const household = () =>
	`(select household_id from members where clerk_user_id = ${q(parent.userId)})`;

test("income includes deposits of every kind and can count them as income", async ({ browser }) => {
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, { baseline: "5,000", buckets: [["Groceries", "1,200"]] });
	const month = /\/month\/(\d{4}-\d{2})/.exec(page.url())?.[1];
	if (!month) throw new Error("Missing month");
	const transferred = ulid();
	await seedSql([
		...[
			["Side job", "null", 1],
			["Reimbursement", "'paid-back'", 0],
			["Returned deposit", "'refund'", 0],
		].map(
			([note, kind, review]) =>
				`insert into income (id, household_id, date, amount_cents, note, kind, needs_review) values (${q(ulid())}, ${household()}, '${month}-01', 12500, ${q(String(note))}, ${kind}, ${review})`,
		),
		`insert into income (id, household_id, date, amount_cents, note) values ('${transferred}', ${household()}, '${month}-01', 7500, 'Client deposit')`,
		`insert into transfers (id, household_id, in_income_id) values ('${ulid()}', ${household()}, '${transferred}')`,
	]);
	await page.goto(`/plan/${month}/income`);
	const table = page.getByRole("table", { name: /^Income in/ });
	const summary = page.getByTestId("income-summary");
	const notCounted = page.getByRole("region", { name: "Other money in" });
	const waiting = page.getByRole("region", { name: "Waiting in Review" });
	// Each deposit is on the page once, under what it counts as (issue 145).
	const once = async (name: string) =>
		expect(page.getByText(name, { exact: true })).toHaveCount(1, { timeout: 30_000 });
	for (const name of ["Side job", "Reimbursement", "Returned deposit"]) await once(name);
	await expect(notCounted).toContainText("Reimbursement");
	await expect(notCounted).toContainText("Returned deposit");
	// A Transfer is money the Household had already, moved: it isn't other money in (issue 152).
	await expect(page.getByText("Client deposit", { exact: true })).toHaveCount(0);
	// Their total is said once, under them; nothing counts as Income yet.
	await expect(notCounted).toContainText("$250");
	await expect(summary).toContainText("$0");
	// What waits in Review is named there: here it has a link, and none of Review's controls.
	await expect(waiting).toContainText("Side job");
	await expect(waiting.getByRole("button")).toHaveCount(0);
	await expect(waiting.getByRole("link", { name: "Open Review" })).toHaveAttribute(
		"href",
		"/review",
	);
	// One control per deposit changes what it counts as.
	await expect(notCounted.getByRole("button")).toHaveCount(2);
	await expect(page.getByRole("button", { name: /as income$/i })).toHaveCount(0);
	const change = notCounted.getByRole("button", { name: "Change what Returned deposit is" });
	await hydrated(change);
	await change.click();
	const dialog = page.getByRole("dialog", { name: "Returned deposit" });
	await dialog.getByRole("button", { name: "Income", exact: true }).click();
	await dialog.getByRole("button", { name: "Done with Returned deposit" }).click();
	await expect(table).toContainText("Returned deposit");
	await expect(notCounted).not.toContainText("Returned deposit");
	await once("Returned deposit");
	await expect(summary).toContainText("$125");
	await expect(notCounted).toContainText("$125");
	await page.reload();
	await expect(table).toContainText("Returned deposit");
	await expect(notCounted.getByRole("button")).toHaveCount(1);
	await once("Returned deposit");
	await page.setViewportSize({ width: 390, height: 844 });
	await expect(
		notCounted.getByRole("button", { name: "Change what Reimbursement is" }),
	).toBeVisible();
	await once("Reimbursement");
	await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
	await page.context().close();
});

test("commitments can be added and edited from the table on desktop and phone", async ({
	browser,
}) => {
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, { baseline: "5,000", buckets: [["Groceries", "1,200"]] });
	const month = /\/month\/(\d{4}-\d{2})/.exec(page.url())?.[1];
	await page.goto(`/plan/${month}/commitments`);
	await page.getByRole("button", { name: "Add Commitment", exact: true }).click();
	const add = page.getByRole("dialog", { name: "Add a Commitment" });
	await add.getByLabel("New Commitment").fill("Internet");
	await add.getByLabel("Amount due").fill("75");
	await add.getByRole("button", { name: "Add Commitment" }).click();
	await expect(add).toBeHidden();
	await page.setViewportSize({ width: 1600, height: 1000 });
	const table = page.getByRole("grid", { name: /^Commitments in/ });
	await expect(table.getByRole("columnheader", { name: "Expected", exact: true })).toBeVisible();
	await expect(table.getByRole("columnheader", { name: "Paid", exact: true })).toBeVisible();
	await expect(table.getByRole("columnheader", { name: "Status", exact: true })).toBeVisible();
	await table.getByRole("button", { name: "Edit Internet" }).click();
	const edit = page.getByRole("dialog", { name: "Internet", exact: true });
	await edit.getByLabel("Amount", { exact: true }).fill("85");
	await edit.getByRole("button", { name: "Save", exact: true }).click();
	await expect(edit).toBeHidden();
	await expect(table).toContainText("$85");
	await page.screenshot({ path: "/tmp/noodle-commitments-desktop.png", fullPage: true });
	await page.setViewportSize({ width: 390, height: 844 });
	await expect(table.getByRole("button", { name: "Edit Internet" })).toBeVisible();
	await expect(table).toContainText("$0 paid");
	await page.screenshot({ path: "/tmp/noodle-commitments-phone.png", fullPage: true });
	await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
});

test("commitment totals stay below the table while scrolling a stacked layout", async ({
	browser,
}) => {
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, {
		baseline: "5,000",
		buckets: [["Groceries", "1,200"]],
		commitments: ["Internet", "Rent", "Electricity", "Insurance"].map((name) => ({
			name,
			amountCents: 7500,
			cadence: "monthly",
			dueDay: 1,
		})),
	});
	const month = /\/month\/(\d{4}-\d{2})/.exec(page.url())?.[1];
	await page.goto(`/plan/${month}/commitments`);
	await expect(page.getByRole("grid", { name: /^Commitments in/ })).toContainText("Internet");
	for (const width of [1280, 1024, 1439, 390]) {
		await page.setViewportSize({ width, height: 800 });
		await page.evaluate(() => document.fonts.ready);
		for (const fraction of [0, 0.5, 1, 0.5, 0]) {
			await page.evaluate((fraction) => {
				window.scrollTo(0, fraction * (document.documentElement.scrollHeight - innerHeight));
			}, fraction);
			await expect
				.poll(
					async () =>
						page.evaluate(() => {
							const list = document
								.querySelector('[data-slot="master-detail-list"]')
								?.getBoundingClientRect();
							const totals = document
								.querySelector('[data-slot="master-detail-aside"]')
								?.getBoundingClientRect();
							if (!list || !totals) throw new Error("Missing commitments or totals");
							return totals.top - list.bottom;
						}),
					{ message: `Totals overlap the table at ${width}px, scroll ${fraction}` },
				)
				.toBeGreaterThanOrEqual(0);
		}
	}
});

test("review defaults to suggested and lets an ordinary transaction become a card payment", async ({
	browser,
}) => {
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, { baseline: "5,000", buckets: [["Groceries", "1,200"]] });
	const month = /\/month\/(\d{4}-\d{2})/.exec(page.url())?.[1];
	const checking = ulid();
	const visa = ulid();
	const transaction = ulid();
	await seedSql([
		`insert into accounts (id, household_id, name, kind) values ('${checking}', ${household()}, 'Checking', 'checking'), ('${visa}', ${household()}, 'Visa', 'credit-card')`,
		`insert into transactions (id, household_id, account_id, source, date, amount_cents, note) values ('${transaction}', ${household()}, '${checking}', 'import', '${month}-01', 7500, 'Bank withdrawal')`,
	]);
	await seedSql([
		`insert into categorizations (household_id, transaction_id, merchant, outcome) values ( ${household()}, '${transaction}', 'bank withdrawal', 'review')`,
	]);
	await page.goto("/review");
	const card = page.getByTestId("review-card").filter({ hasText: "Bank withdrawal" });
	const type = card.getByRole("button", { name: "Transaction type: Suggested" });
	await expect(type).toBeEnabled();
	await type.click();
	await expect(page.getByRole("menuitem", { name: "Transfer", exact: true })).toBeVisible();
	await expect(page.getByRole("menuitem", { name: "Between us", exact: true })).toBeVisible();
	// Told apart by what the money moved between (issue 152); one Parent here, so nobody is named.
	await expect(
		page.getByRole("menuitem", { name: "Transfer", exact: true }),
	).toHaveAccessibleDescription(
		"Between your own Accounts, like checking to savings. It isn’t spending.",
	);
	await expect(
		page.getByRole("menuitem", { name: "Between us", exact: true }),
	).toHaveAccessibleDescription("Money one of you sent the other. It isn’t Income or spending.");
	await page.getByRole("menuitem", { name: "Suggested", exact: true }).focus();
	await page.keyboard.press("ArrowRight");
	await expect(card).toBeVisible();
	await page.keyboard.press("Escape");
	await page.screenshot({ path: "/tmp/noodle-review-desktop.png", fullPage: true });
	await page.setViewportSize({ width: 390, height: 844 });
	await page.screenshot({ path: "/tmp/noodle-review-phone.png", fullPage: true });
	await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
	await type.click();
	await page.getByRole("menuitem", { name: "Card payment", exact: true }).click();
	// A keyboard shortcut must not file the hidden suggestion while choosing a payment.
	await page.locator("#review-top").focus();
	await page.keyboard.press("ArrowRight");
	await expect(card.getByRole("combobox", { name: "Payment to" })).toBeVisible();
	await choose(card, "Payment to", "Visa");
	await card.getByRole("button", { name: "It’s a card payment", exact: true }).click();
	await expect(card).toBeHidden();
	const [transfers] = await seedSql([
		`select other_account_id from transfers where out_transaction_id = '${transaction}' and removed_at is null`,
	]);
	await expect(transfers).toEqual([{ other_account_id: visa }]);
	await page.reload();
	await expect(page.getByTestId("review-card").filter({ hasText: "Bank withdrawal" })).toHaveCount(
		0,
	);
});
