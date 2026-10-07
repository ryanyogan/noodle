import { expect, test } from "@playwright/test";
import { ulid } from "ulid";
import { signFakeWebhook } from "../src/server/plaid-fake-webhook-key";
import { continueToBank } from "./bank-history";
import { createTestParent } from "./parents";
import { seedSql } from "./seed-sql";
import { createHousehold, hydrated, signedInPage } from "./session";

// A line the bank withdraws after money back on it counted in a month that has ended (issue 141,
// ADR-0058): it stays, marked "Kept", and opening it says "The bank took this back …". The fake
// bank drops Chipotle on its later sync. The restore in an ended month is written straight into
// the local D1: no test can wait for a month to end.

let parent: Awaited<ReturnType<typeof createTestParent>>;

test.beforeEach(async () => {
	parent = await createTestParent();
});

test.afterEach(async () => {
	await parent?.remove();
});

const q = (value: string) => `'${value.replaceAll("'", "''")}'`;
const pad = (n: number) => String(n).padStart(2, "0");
const dayKey = (date: Date) =>
	`${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const daysAgo = (days: number) => {
	const now = new Date();
	return new Date(now.getFullYear(), now.getMonth(), now.getDate() - days);
};
const monthName = (date: Date) => date.toLocaleDateString("en-US", { month: "long" });

test("a purchase the bank takes back after its money back counted in an ended month stays, and says so", async ({
	browser,
}) => {
	test.setTimeout(240_000);
	const page = await signedInPage(browser, parent.email, {
		viewport: { width: 1440, height: 900 },
	});
	await createHousehold(page, "The Rinks", "Alex");
	await page.getByRole("link", { name: "Accounts", exact: true }).click();
	await page.getByRole("button", { name: "Connect a bank" }).click();
	await continueToBank(page);
	await page
		.getByRole("dialog", { name: "Which of these do you have already?" })
		.getByRole("button", { name: "Start bringing them in" })
		.click();
	await expect(
		page.getByRole("region", { name: "Bank Connections" }).getByRole("listitem"),
	).toContainText("4 Accounts · Up to date");

	// Chipotle ($23.40, 12 days back) got $5 back, linked as a Refund that counted two months ago.
	const household = `(select household_id from members where clerk_user_id = ${q(parent.userId)})`;
	const chipotleDay = daysAgo(12);
	const ended = dayKey(new Date(chipotleDay.getFullYear(), chipotleDay.getMonth() - 1, 15));
	const refund = ulid();
	const purchase = (cents: number) =>
		`(select id from transactions where household_id = ${household} and amount_cents = ${cents})`;
	await seedSql([
		`insert into income (id, household_id, date, amount_cents, note, kind) values (${q(refund)}, ${household}, ${q(ended)}, 500, 'Chipotle refund', 'refund');`,
		`insert into refund_links (income_id, household_id, transaction_id, counts_on) values (${q(refund)}, ${household}, ${purchase(2340)}, ${q(ended)});`,
	]);

	// The bank says there's news: among it, Chipotle is withdrawn.
	const [results = []] = await seedSql([
		`select b.external_id as item from bank_connections b join members m on m.household_id = b.household_id where m.clerk_user_id = ${q(parent.userId)}`,
	]);
	const body = JSON.stringify({
		webhook_type: "TRANSACTIONS",
		webhook_code: "SYNC_UPDATES_AVAILABLE",
		item_id: String(results[0]?.item),
	});
	const synced = await page.request.post("/webhooks/plaid", {
		headers: {
			"Content-Type": "application/json",
			"Plaid-Verification": await signFakeWebhook(body),
		},
		data: body,
	});
	expect(synced.status()).toBe(200);
	await expect
		.poll(
			async () =>
				(
					await seedSql([
						`select bank_took_back_on as day from transactions where household_id = ${household} and amount_cents = 2340`,
					])
				)[0]?.[0]?.day ?? null,
			{ timeout: 60_000 },
		)
		.not.toBeNull();

	// It is still in its month, with a quiet "Kept" on its row.
	await page.goto(`/transactions/${dayKey(chipotleDay).slice(0, 7)}`);
	const chipotle = page.getByRole("button", { name: /^Chipotle, \$23\.40, / });
	await expect(chipotle).toBeVisible({ timeout: 30_000 });
	const row = page.getByRole("row").filter({ has: chipotle });
	await expect(row.getByTestId("bank-took-back")).toHaveText("Kept");

	// Opening it says what happened, and when.
	await hydrated(chipotle);
	await chipotle.click();
	const note = page.getByTestId("bank-took-back-note");
	// It names the month its money back counted in as well as its own: neither changes.
	const endedMonth = new Date(chipotleDay.getFullYear(), chipotleDay.getMonth() - 1, 15);
	await expect(note).toHaveText(
		`The bank took this back today. It stays here so ${monthName(endedMonth)} and ${monthName(chipotleDay)} don’t change.`,
	);

	// On a phone the list says "Kept" too, and the sheet says the same sentence.
	await page.setViewportSize({ width: 393, height: 852 });
	await page.goto(`/transactions/${dayKey(chipotleDay).slice(0, 7)}`);
	const kept = page.getByTestId("bank-took-back").filter({ visible: true });
	await expect(kept).toHaveText("Kept", { timeout: 30_000 });
	await hydrated(chipotle);
	await chipotle.click();
	await expect(note.filter({ visible: true })).toContainText("The bank took this back today.");

	// A purchase the bank lowered instead says what the bank says now (the marks are written
	// straight in: the fake bank lowers nothing).
	const costcoDay = daysAgo(5);
	await seedSql([
		`update transactions set bank_took_back_on = ${q(dayKey(costcoDay))}, bank_amount_cents = 9000, version = version + 1 where id = ${purchase(11230)};`,
	]);
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.goto(`/transactions/${dayKey(costcoDay).slice(0, 7)}`);
	const costco = page.getByRole("button", { name: /^Costco, \$112\.30, / });
	await expect(costco).toBeVisible({ timeout: 30_000 });
	await hydrated(costco);
	await costco.click();
	const on = costcoDay.toLocaleDateString("en-US", {
		weekday: "short",
		month: "short",
		day: "numeric",
	});
	await expect(note).toHaveText(
		`The bank changed this to $90 on ${on}. It stays as it was so ${monthName(costcoDay)} doesn’t change.`,
	);
	await page.context().close();
});
