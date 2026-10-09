import { expect, type Page, test } from "@playwright/test";
import { ulid } from "ulid";
import { openMoneyIn } from "./money-in-rows";
import { createTestParent } from "./parents";
import { seedSql } from "./seed-sql";
import { createPlannedHousehold, hydrated, savedBy, signedInPage } from "./session";

// What's owed back never counts as the Household's spending (issue 158, ADR-0058 revised
// 2026-10-08), as a Parent sees it for purchases of the running month: a $600 hockey camp in Kids
// with half Owed back by Casey counts $300 against Kids, its row keeps $600 and says the part
// owed, and the Plan says what is owed back this month; a $1,200 tuition payment with half Owed
// back pays its $600 Commitment exactly. Then $900 arrives and is matched: the purchases say Paid
// back, and no figure of the Bucket, the Commitment or the month moves.

let parent: Awaited<ReturnType<typeof createTestParent>>;

test.beforeEach(async () => {
	parent = await createTestParent();
});

test.afterEach(async () => {
	await parent?.remove();
});

const q = (value: string) => `'${value.replaceAll("'", "''")}'`;
const pad = (n: number) => String(n).padStart(2, "0");

/** A page's words on one line, as a person reads them across. */
const words = async (page: Page) => (await page.locator("main").innerText()).replace(/\s+/g, " ");

/** A picture for a person to look at, only when OWED_BACK_SHOTS names a folder; never compared. */
async function shots(page: Page, name: string) {
	const folder = process.env.OWED_BACK_SHOTS;
	if (!folder) return;
	for (const width of [1440, 393]) {
		await page.setViewportSize({ width, height: 900 });
		await page.screenshot({ path: `${folder}/${name}-${width}.png`, fullPage: true });
	}
	await page.setViewportSize({ width: 1440, height: 900 });
}

/** On a purchase's page: "Someone's paying part of this back", Casey, half of it. */
async function sayOwedBack(page: Page, month: string, id: string) {
	await page.goto(`/transactions/${month}/${id}`);
	const owedBack = page.getByTestId("owed-back").filter({ visible: true });
	const say = owedBack.getByRole("button", { name: /paying part of this back/ });
	await hydrated(say);
	await say.click();
	const form = owedBack.getByTestId("owed-back-form");
	await form.getByLabel(/paying it back/).fill("Casey");
	await form.getByRole("button", { name: "Save" }).click();
	await expect(form).toBeHidden();
	return owedBack.getByTestId("owed-back-text");
}

test("the part Owed back on this month’s purchases isn’t spending, the rows and the Plan say it, and Paid back moves nothing", async ({
	browser,
}) => {
	test.setTimeout(300_000);
	const page = await signedInPage(browser, parent.email);
	await page.setViewportSize({ width: 1440, height: 900 });
	const today = new Date();
	const now = `${today.getFullYear()}-${pad(today.getMonth() + 1)}`;
	const made = await createPlannedHousehold(page, {
		baseline: "5,000",
		buckets: [["Kids", "400"]],
		commitments: [{ name: "Tuition", amountCents: 60_000, cadence: "monthly", dueDay: 5 }],
	});
	const kids = made?.bucketIds.Kids;
	const tuitionId = made?.commitmentIds.Tuition;
	if (!kids || !tuitionId) throw new Error("The Household wasn't made directly");

	const household = `(select household_id from members where clerk_user_id = ${q(parent.userId)})`;
	const member = `(select id from members where clerk_user_id = ${q(parent.userId)})`;
	const camp = ulid();
	const tuition = ulid();
	// The month's first day: always this month, never after today.
	await seedSql([
		`insert into transactions (id, household_id, source, date, amount_cents, note, bucket_id, created_by_member_id) values (${q(camp)}, ${household}, 'quick-add', ${q(`${now}-01`)}, 60000, 'Hockey camp', ${q(kids)}, ${member});`,
		`insert into transactions (id, household_id, source, date, amount_cents, note, commitment_id, created_by_member_id) values (${q(tuition)}, ${household}, 'quick-add', ${q(`${now}-01`)}, 120000, 'Tuition', ${q(tuitionId)}, ${member});`,
	]);

	// Before anything is said, the whole camp counts: Kids is $200 over.
	await page.goto(`/month/${now}`);
	await expect(page.getByRole("region", { name: "Income" })).toBeVisible({ timeout: 30_000 });
	await expect.poll(() => words(page)).toMatch(/Kids (Over )?\$600 spent/);

	await expect(await sayOwedBack(page, now, camp)).toHaveText("Owed back $300 · Casey");
	await expect(await sayOwedBack(page, now, tuition)).toHaveText("Owed back $600 · Casey");

	/** The Bucket, the Commitment and the Plan, as they read once $300 and $600 are Owed back. */
	const figures = async (apart: { kids: string; tuition: string }) => {
		// This Month: only the Household's $300 counts against Kids, and the rest is said beside it.
		await page.goto(`/month/${now}`);
		await expect(page.getByRole("region", { name: "Income" })).toBeVisible({ timeout: 30_000 });
		const kidsLine = new RegExp(
			`Kids (Ahead )?\\$300 spent · ${apart.kids.replace(/[$()]/g, "\\$&")} \\$100 of \\$400`,
		);
		await expect.poll(() => words(page)).toMatch(kidsLine);
		const month = await words(page);
		expect(month).not.toContain("Paid back $");
		expect(month).not.toContain("−$");

		// The Plan's first page: the month's total apart from spending, and a line for each.
		await page.goto(`/plan/${now}`);
		const block = page.getByTestId("owed-back-apart");
		await expect(block).toContainText(
			"$900 owed back on this month’s purchases. It isn’t counted as spending.",
			{ timeout: 30_000 },
		);
		await expect(block.getByTestId(`owed-back-apart-${kids}`)).toHaveText(`Kids: ${apart.kids}`);
		await expect(block.getByTestId(`owed-back-apart-${tuitionId}`)).toHaveText(
			`Tuition: ${apart.tuition}`,
		);

		// The Bucket's own page: $100 left of $400, $300 spent, and what was left out of it.
		await page.goto(`/plan/${now}/buckets/${kids}`);
		const thisMonth = page.getByRole("region", { name: "Left this month" });
		await expect(thisMonth).toContainText("$100of $400", { timeout: 30_000 });
		await expect(thisMonth.getByTestId("bucket-owed-back")).toHaveText(
			`${apart.kids} on this month’s purchases. It isn’t counted as spending.`,
		);
		await expect(thisMonth.locator("[aria-valuetext]")).toHaveAttribute(
			"aria-valuetext",
			"$300 spent of $400, $100 left",
		);
		return month;
	};

	const before = await figures({ kids: "$300 owed back", tuition: "$600 owed back" });
	// The Commitment is paid exactly: $600 of $1,200 was the Household's.
	expect(before).toContain("$600 of $600 paid");
	// On the Bucket's page the purchase keeps its full amount and says the part owed.
	const campRow = page.getByRole("button", {
		name: /^Hockey camp, \$600, \$300 owed back by Casey/,
	});
	await expect(campRow).toBeVisible();
	await expect(page.getByTestId("row-owed-back").filter({ visible: true })).toHaveText(
		"$300 owed back by Casey",
	);
	await shots(page, "bucket-owed");
	await page.goto(`/plan/${now}`);
	await expect(page.getByTestId("owed-back-apart")).toBeVisible({ timeout: 30_000 });
	await shots(page, "plan-owed");

	// The money arrives this month.
	await page.goto(`/month/${now}`);
	const add = page
		.getByRole("region", { name: "Income" })
		.getByRole("button", { name: "Add income" });
	await hydrated(add);
	await add.click();
	const sheet = page.getByRole("dialog", { name: "Add income" });
	await sheet.getByLabel("Amount").fill("900");
	await sheet.getByLabel("Note").fill("Casey");
	const recorded = savedBy(page, "recordIncome");
	await sheet.getByRole("button", { name: "Add income" }).click();
	await recorded;
	await expect(sheet).toBeHidden();

	// The Transactions list: both rows whole, each with the part owed, and a total of our share.
	await page.goto(`/transactions/${now}`);
	const badges = page.getByTestId("row-owed-back").filter({ visible: true });
	// Two purchases of one day come in no promised order.
	const bothSay = async (said: string) => {
		await expect(badges).toHaveCount(2, { timeout: 30_000 });
		await expect(badges.filter({ hasText: `$300 ${said} by Casey` })).toHaveCount(1);
		await expect(badges.filter({ hasText: `$600 ${said} by Casey` })).toHaveCount(1);
	};
	await bothSay("owed back");
	await expect(
		page.getByRole("button", { name: /^Tuition, \$1,200, \$600 owed back by Casey/ }),
	).toBeVisible();
	const listed = await words(page);
	// The month and the day add up to our share, though the rows say $1,200 and $600.
	expect(listed).toContain("Money out $900 Spent in");
	expect(listed).toMatch(/1 Spent \$900 /);
	expect(listed).not.toContain("$1,800");
	await shots(page, "transactions-owed");

	// A Parent says the $900 is Paid back and confirms what it is offered against.
	const { editor: casey } = await openMoneyIn(page, "Casey");
	await casey.getByRole("button", { name: "Paid back", exact: true }).click();
	const matching = casey.getByTestId("paid-back-matching");
	await expect(matching.getByTestId("paid-back-item")).toHaveCount(2);
	await expect(matching.getByTestId("paid-back-waits")).toHaveText("All of it is matched.");
	await matching.getByRole("button", { name: "Confirm" }).click();
	await expect(matching).toContainText("$900 is matched to what was Owed back.");
	await bothSay("Paid back");
	await shots(page, "transactions-paid");

	// Nothing in the Bucket, the Commitment or the month moved; the Plan says it has all come.
	const after = await figures({
		kids: "$300 owed back (all Paid back)",
		tuition: "$600 owed back (all Paid back)",
	});
	expect(after).toContain("$600 of $600 paid");
	expect(after).toContain("$0 received");
	await expect(page.getByTestId("row-owed-back").filter({ visible: true })).toHaveText(
		"$300 Paid back by Casey",
	);
	await shots(page, "bucket-paid");
	await page.context().close();
});
