import { expect, type Locator, type Page, test } from "@playwright/test";
import { ulid } from "ulid";
import { createTestParent } from "./parents";
import { seedSql } from "./seed-sql";
import { createPlannedHousehold, hydrated, signedInPage } from "./session";

// Paid back and Owed back (issue 132, ADR-0058), the ticket's scenario from end to end: tuition
// of $1,200 last month with half Owed back by Casey, skates ($45) and the dentist ($80) Owed back
// in full; $700 arrives this month, a Parent says it is Paid back, and it is offered against what
// is open, oldest first that fit. Tuition and skates are settled, the dentist keeps $25 owed, the
// money counts this month where each purchase was filed, and last month stays as it was.

let parent: Awaited<ReturnType<typeof createTestParent>>;

test.beforeEach(async () => {
	parent = await createTestParent();
});

test.afterEach(async () => {
	await parent?.remove();
});

const q = (value: string) => `'${value.replaceAll("'", "''")}'`;
const pad = (n: number) => String(n).padStart(2, "0");

/** This month and the one before it, in the browser's (and so the Household's) time zone. */
function months() {
	const now = new Date();
	const before = new Date(now.getFullYear(), now.getMonth() - 1, 1);
	return {
		now: `${now.getFullYear()}-${pad(now.getMonth() + 1)}`,
		last: `${before.getFullYear()}-${pad(before.getMonth() + 1)}`,
	};
}

/** A picture for a person to look at, only when OWED_BACK_SHOTS names a folder; never compared. */
async function shot(target: Locator, name: string) {
	const folder = process.env.OWED_BACK_SHOTS;
	if (folder) await target.screenshot({ path: `${folder}/${name}.png` });
}

/** A page's words on one line, as a person reads them across. */
const words = async (page: Page) => (await page.locator("main").innerText()).replace(/\s+/g, " ");

const toast = (page: Page, text: string) => page.getByRole("status").filter({ hasText: text });

/** On a purchase's page: "Someone's paying part of this back", Casey, and how much unless half. */
async function sayOwedBack(page: Page, month: string, id: string, amount?: string) {
	await page.goto(`/transactions/${month}/${id}`);
	const owedBack = page.getByTestId("owed-back").filter({ visible: true });
	const say = owedBack.getByRole("button", { name: /paying part of this back/ });
	await hydrated(say);
	await say.click();
	const form = owedBack.getByTestId("owed-back-form");
	await form.getByLabel(/paying it back/).fill("Casey");
	if (amount) {
		await form.getByLabel("How much").fill(amount);
		await form.getByLabel("How much").press("Tab");
	}
	await form.getByRole("button", { name: "Save" }).click();
	await expect(form).toBeHidden();
	return owedBack.getByTestId("owed-back-text");
}

test("$700 Paid back settles tuition and skates, leaves $25 of the dentist owed, and counts this month", async ({
	browser,
}) => {
	// A dozen page loads; a dev server compiling each for the first time takes most of this.
	test.setTimeout(300_000);
	const page = await signedInPage(browser, parent.email);
	await page.setViewportSize({ width: 1440, height: 900 });
	const { now, last } = months();
	const made = await createPlannedHousehold(page, {
		baseline: "5,000",
		buckets: [
			["Kids", "300"],
			["Health", "200"],
		],
		commitments: [{ name: "Tuition", amountCents: 60_000, cadence: "monthly", dueDay: 5 }],
	});
	if (!made) throw new Error("The Household wasn't made directly");

	// Last month's three purchases, written straight into the local D1 (Quick Adds dated then).
	const household = `(select household_id from members where clerk_user_id = ${q(parent.userId)})`;
	const member = `(select id from members where clerk_user_id = ${q(parent.userId)})`;
	const tuition = ulid();
	const skates = ulid();
	const dentist = ulid();
	const purchase = (
		id: string,
		day: string,
		cents: number,
		note: string,
		filed: { bucket?: string | undefined; commitment?: string | undefined },
	) =>
		`insert into transactions (id, household_id, source, date, amount_cents, note, bucket_id, commitment_id, created_by_member_id) values (${q(id)}, ${household}, 'quick-add', ${q(`${last}-${day}`)}, ${cents}, ${q(note)}, ${filed.bucket ? q(filed.bucket) : "null"}, ${filed.commitment ? q(filed.commitment) : "null"}, ${member});`;
	await seedSql([
		purchase(tuition, "05", 120_000, "Tuition", { commitment: made.commitmentIds.Tuition }),
		purchase(skates, "12", 4_500, "Skates", { bucket: made.bucketIds.Kids }),
		purchase(dentist, "20", 8_000, "Dentist", { bucket: made.bucketIds.Health }),
	]);

	// Half of the tuition by default; the skates and the dentist in full.
	await expect(await sayOwedBack(page, last, tuition)).toHaveText("Owed back $600 · Casey");
	await expect(await sayOwedBack(page, last, skates, "45")).toHaveText("Owed back $45 · Casey");
	await expect(await sayOwedBack(page, last, dentist, "80")).toHaveText("Owed back $80 · Casey");

	await page.goto(`/month/${last}`);
	await page.waitForLoadState("networkidle");
	const lastMonthBefore = await words(page);
	await shot(page.locator("main"), "last-month-before-1440");

	// The money arrives this month.
	await page.goto(`/month/${now}`);
	const income = page.getByRole("region", { name: "Income" });
	const add = income.getByRole("button", { name: "Add income" });
	await hydrated(add);
	await add.click();
	const sheet = page.getByRole("dialog", { name: "Add income" });
	await sheet.getByLabel("Amount").fill("700");
	await sheet.getByLabel("Note").fill("Casey");
	await sheet.getByRole("button", { name: "Add income" }).click();
	await expect(sheet).toBeHidden();
	// Nothing is restored yet, and the Commitment says what is owed on it.
	await expect(income).toContainText("$700 received");
	await expect(page.getByText("$600 owed back by Casey").first()).toBeVisible();
	const thisMonthBefore = await words(page);
	expect(thisMonthBefore).toContain("Kids $0 spent $300 of $300");
	expect(thisMonthBefore).toContain("Health $0 spent $200 of $200");
	expect(thisMonthBefore).toMatch(/Tuition Due \w+ 5 \$600 owed back by Casey/);

	// The "Owed back" list, per person: $725 outstanding over three purchases.
	await page.goto(`/transactions/${now}`);
	const list = page.getByTestId("owed-back-list");
	await expect(list.getByTestId("owed-back-person")).toContainText("Casey", { timeout: 30_000 });
	await expect(list.getByTestId("owed-back-person")).toContainText("owes $725");
	await expect(list.getByTestId("owed-back-item")).toHaveCount(3);

	// A Parent says the $700 is Paid back: it is offered oldest first that fit.
	const casey = page
		.getByRole("region", { name: "Money in" })
		.getByTestId("money-in-row")
		.filter({ hasText: "Casey" });
	await casey.getByRole("button", { name: "Change what Casey is" }).click();
	await casey.getByRole("button", { name: "Paid back", exact: true }).click();
	await expect(toast(page, "$700 is Paid back")).toBeVisible();
	const matching = casey.getByTestId("paid-back-matching");
	await expect(matching).toContainText("What is this $700 paying back from Casey?");
	const offered = matching.getByTestId("paid-back-item");
	await expect(offered).toHaveCount(3);
	await expect(offered.nth(0)).toContainText("Tuition");
	await expect(offered.nth(0).getByRole("textbox")).toHaveValue(/^600(\.00)?$/);
	await expect(offered.nth(1)).toContainText("Skates");
	await expect(offered.nth(1).getByRole("textbox")).toHaveValue(/^45(\.00)?$/);
	await expect(offered.nth(2)).toContainText("Dentist");
	await expect(offered.nth(2).getByRole("textbox")).toHaveValue(/^55(\.00)?$/);
	await expect(matching.getByTestId("paid-back-waits")).toHaveText("All of it is matched.");
	await shot(list, "list-1440");
	await shot(casey, "matching-1440");
	await page.setViewportSize({ width: 393, height: 852 });
	await shot(list, "list-393");
	await shot(casey, "matching-393");
	await page.setViewportSize({ width: 1440, height: 900 });

	await matching.getByRole("button", { name: "Confirm" }).click();
	await expect(matching).toContainText("$700 is matched to what was Owed back.");
	await expect(matching).toContainText("Nothing is left to match.");

	// Tuition and skates are settled; the dentist keeps $25 owed.
	await expect(list.getByTestId("owed-back-person")).toContainText("owes $25");
	await expect(list.getByTestId("owed-back-item")).toHaveCount(1);
	await expect(list.getByTestId("owed-back-item")).toContainText("Dentist");
	await expect(list.getByTestId("owed-back-item")).toContainText("$55 of $80 Paid back");
	await shot(list, "list-after-1440");

	// A Parent takes one match off: the skates are owed again and the $45 waits, offered as before.
	const matched = matching.getByTestId("paid-back-match");
	await expect(matched).toHaveCount(3);
	await matched
		.filter({ hasText: "Skates" })
		.getByRole("button", { name: "Take $45 off Skates" })
		.click();
	await expect(toast(page, "Taken off. $45 is Paid back, not matched yet")).toBeVisible();
	await expect(matched).toHaveCount(2);
	await expect(list.getByTestId("owed-back-person")).toContainText("owes $70");
	await expect(matching).toContainText("What is this $45 paying back from Casey?");
	await expect(offered).toHaveCount(2);
	await expect(offered.nth(0)).toContainText("Skates");
	await expect(offered.nth(0).getByRole("textbox")).toHaveValue(/^45(\.00)?$/);
	await shot(casey, "matching-taken-off-1440");
	// And matches it again.
	await matching.getByRole("button", { name: "Confirm" }).click();
	await expect(matched).toHaveCount(3);
	await expect(list.getByTestId("owed-back-person")).toContainText("owes $25");

	// It is kept, and it counts this month, where each purchase was filed: the Buckets and the
	// Commitment get the money back, and none of it is Income.
	await page.goto(`/month/${now}`);
	await expect(page.getByRole("region", { name: "Income" })).toContainText("$0 received", {
		timeout: 30_000,
	});
	const thisMonthAfter = await words(page);
	// Said as money Paid back, never as negative spending or a negative payment.
	expect(thisMonthAfter).toContain("Kids $45 Paid back $345 of $300");
	expect(thisMonthAfter).toContain("Health $55 Paid back $255 of $200");
	expect(thisMonthAfter).toMatch(/Tuition Due \w+ 5 .*?\$600 Paid back by Casey .*?\$0 of \$600/);
	expect(thisMonthAfter).toContain("$0 of $600 paid · $600 Paid back");
	expect(thisMonthAfter).not.toContain("−$");
	expect(thisMonthAfter).not.toContain("less than expected");
	expect(thisMonthAfter).not.toContain("owed back by Casey");
	await shot(page.locator("main"), "this-month-after-1440");
	// Last month is as it was.
	await page.goto(`/month/${last}`);
	await page.waitForLoadState("networkidle");
	expect(await words(page)).toBe(lastMonthBefore);
	const [kept = []] = await seedSql([
		`select counts_on, amount_cents from paid_back_matches where household_id = ${household} order by amount_cents;`,
	]);
	expect(kept.map((match) => match.amount_cents)).toEqual([4_500, 5_500, 60_000]);
	for (const match of kept) expect(String(match.counts_on).slice(0, 7)).toBe(now);
	await page.goto(`/transactions/${last}/${dentist}`);
	// The dentist's own page says what is left of it.
	await expect(page.getByTestId("owed-back-text").filter({ visible: true })).toContainText(
		"Owed back $25 · Casey",
		{ timeout: 30_000 },
	);
	await shot(page.locator("main"), "dentist-1440");
});
