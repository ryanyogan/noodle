import { expect, type Page, test } from "@playwright/test";
import { ulid } from "ulid";
import { openMoneyIn } from "./money-in-rows";
import { createTestParent } from "./parents";
import { seedSql } from "./seed-sql";
import { createPlannedHousehold, hydrated, savedBy, signedInPage } from "./session";

// Writing off what is Owed back (issue 158, ADR-0058 "Writing it off"), as a Parent sees it in the
// running month: Kids has a $600 hockey camp with $300 Owed back by Casey and $240 of sticks with
// $120 Owed back, $50 of it Paid back. Written off from the Owed back list or from the purchase,
// what was still owed counts as spending this month in Kids, the item moves under "Written off",
// and undoing it puts every figure back.

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
async function shot(page: Page, name: string) {
	const folder = process.env.OWED_BACK_SHOTS;
	if (folder) await page.screenshot({ path: `${folder}/${name}.png`, fullPage: true });
}

/** The Household with Kids at $400, and the camp and the sticks bought on the month's first day. */
async function household(page: Page) {
	const today = new Date();
	const now = `${today.getFullYear()}-${pad(today.getMonth() + 1)}`;
	const made = await createPlannedHousehold(page, {
		baseline: "5,000",
		buckets: [["Kids", "400"]],
	});
	const kids = made?.bucketIds.Kids;
	if (!kids) throw new Error("The Household wasn't made directly");
	const of = `(select household_id from members where clerk_user_id = ${q(parent.userId)})`;
	const member = `(select id from members where clerk_user_id = ${q(parent.userId)})`;
	const camp = ulid();
	const sticks = ulid();
	// The month's first day: always this month, never after today.
	await seedSql(
		(
			[
				[camp, 60_000, "Hockey camp"],
				[sticks, 24_000, "Hockey sticks"],
			] as const
		).map(
			([id, cents, note]) =>
				`insert into transactions (id, household_id, source, date, amount_cents, note, bucket_id, created_by_member_id) values (${q(id)}, ${of}, 'quick-add', ${q(`${now}-01`)}, ${cents}, ${q(note)}, ${q(kids)}, ${member});`,
		),
	);
	return { now, kids, camp, sticks };
}

/** The purchase's page, with its Owed back block ready to be clicked. */
async function openPurchase(page: Page, month: string, id: string) {
	await page.goto(`/transactions/${month}/${id}`);
	const owedBack = page.getByTestId("owed-back").filter({ visible: true });
	await hydrated(owedBack.getByRole("button").first());
	return owedBack;
}

/** On a purchase's page: "Someone's paying part of this back", Casey, half of it. */
async function sayOwedBack(page: Page, month: string, id: string) {
	const owedBack = await openPurchase(page, month, id);
	await owedBack.getByRole("button", { name: /paying part of this back/ }).click();
	const form = owedBack.getByTestId("owed-back-form");
	await form.getByLabel(/paying it back/).fill("Casey");
	await form.getByRole("button", { name: "Save" }).click();
	await expect(form).toBeHidden();
	return owedBack.getByTestId("owed-back-text");
}

/** The "Owed back" list on the month's Transactions, ready to be clicked. */
async function openList(page: Page, month: string) {
	await page.goto(`/transactions/${month}`);
	const list = page.getByTestId("owed-back-list");
	await expect(list).toBeVisible({ timeout: 30_000 });
	await hydrated(list.getByRole("button").first());
	return list;
}

test("what is written off counts as spending this month in its Bucket, from the list and from the purchase, and Undo puts it back", async ({
	browser,
}) => {
	test.setTimeout(300_000);
	const page = await signedInPage(browser, parent.email);
	await page.setViewportSize({ width: 1440, height: 900 });
	const { now, camp, sticks } = await household(page);

	/** What Kids has spent this month and has left, on This Month and on the Plan. */
	const kidsSpent = async (spent: string, left: string) => {
		await page.goto(`/month/${now}`);
		await expect(page.getByRole("region", { name: "Income" })).toBeVisible({ timeout: 30_000 });
		await expect
			.poll(() => words(page))
			.toMatch(new RegExp(`Kids (Over |Ahead )?\\${spent} spent`));
		await page.goto(`/plan/${now}`);
		// The Plan's Buckets table: its allowance, what it spent and what is left.
		await expect
			.poll(() => words(page), { timeout: 30_000 })
			.toContain(`Kids $400 ${spent} ${left} `);
	};

	// Half of the sticks is Owed back, and $50 of that $120 comes.
	await expect(await sayOwedBack(page, now, sticks)).toHaveText("Owed back $120 · Casey");
	await page.goto(`/month/${now}`);
	const add = page
		.getByRole("region", { name: "Income" })
		.getByRole("button", { name: "Add income" });
	await hydrated(add);
	await add.click();
	const sheet = page.getByRole("dialog", { name: "Add income" });
	await sheet.getByLabel("Amount").fill("50");
	await sheet.getByLabel("Note").fill("Casey");
	const recorded = savedBy(page, "recordIncome");
	await sheet.getByRole("button", { name: "Add income" }).click();
	await recorded;
	await expect(sheet).toBeHidden();
	await page.goto(`/transactions/${now}`);
	const { editor: casey } = await openMoneyIn(page, "Casey");
	await casey.getByRole("button", { name: "Paid back", exact: true }).click();
	const matching = casey.getByTestId("paid-back-matching");
	await expect(matching.getByTestId("paid-back-waits")).toHaveText("All of it is matched.");
	await matching.getByRole("button", { name: "Confirm" }).click();
	await expect(matching).toContainText("$50 is matched to what was Owed back.");
	// Then half of the camp is Owed back too: Kids counts $300 of it and $120 of the sticks.
	await expect(await sayOwedBack(page, now, camp)).toHaveText("Owed back $300 · Casey");
	await kidsSpent("$420", "−$20");

	// From the list: the camp's $300 is written off, and is this month's spending in Kids.
	let list = await openList(page, now);
	await expect(list.getByTestId("owed-back-person")).toHaveText("Casey owes $370");
	await expect(list.getByTestId("owed-back-item")).toHaveCount(2);
	// Each says how long it has been owed, from the month's first day, and Casey's $50 this year.
	const days = new Date().getDate() - 1;
	const age = days === 0 ? "today" : days === 1 ? "1 day" : `${days} days`;
	await expect(list.getByTestId("owed-back-age")).toHaveText([age, age]);
	await expect(
		list.getByTestId("owed-back-item").filter({ hasText: "Hockey sticks" }),
	).toContainText(`${age} · $50 of $120 Paid back`);
	await expect(list.getByTestId("owed-back-paid-year")).toHaveText("· Paid back $50 this year");
	await expect(list.getByTestId("owed-back-written-off")).toHaveCount(0);
	await list.getByRole("button", { name: "Write off the $300 Casey owes for Hockey camp" }).click();
	await expect(page.getByText("Written off. $300 counts as spending this month")).toBeVisible();
	const writtenOff = list.getByTestId("owed-back-written-off");
	await expect(writtenOff).toContainText("Written off");
	await expect(writtenOff.getByRole("listitem")).toHaveCount(1);
	await expect(writtenOff.getByRole("listitem")).toContainText(/Hockey camp.*Casey.*\$300/);
	await expect(list.getByTestId("owed-back-person")).toHaveText("Casey owes $70");
	await expect(list.getByTestId("owed-back-item")).toHaveCount(1);
	// The purchase's row says so, and the month's total has the $300.
	const badges = page.getByTestId("row-owed-back").filter({ visible: true });
	await expect(badges.filter({ hasText: "$300 written off" })).toHaveCount(1);
	await expect.poll(() => words(page)).toContain("Money out $720 Spent in");
	await shot(page, "list-written-off-1440");
	await kidsSpent("$720", "−$320");

	// Undo, from the list: it is Owed back again and Kids is as it was.
	list = await openList(page, now);
	await list.getByRole("button", { name: "Undo writing off $300 for Hockey camp" }).click();
	await expect(list.getByTestId("owed-back-written-off")).toHaveCount(0);
	await expect(list.getByTestId("owed-back-person")).toHaveText("Casey owes $370");
	await expect(badges.filter({ hasText: "$300 owed back by Casey" })).toHaveCount(1);
	await kidsSpent("$420", "−$20");

	// From the purchase: the rest of the sticks after the $50, which is $70.
	let item = await openPurchase(page, now, sticks);
	await expect(item.getByTestId("owed-back-text")).toHaveText("Owed back $70 · Casey");
	await item.getByRole("button", { name: "Write off the rest" }).click();
	await expect(item.getByTestId("owed-back-text")).toHaveText("Written off $70 · Casey");
	await expect(page.getByText("Written off. $70 counts as spending this month")).toBeVisible();
	// While it is written off it can only be undone.
	await expect(item.getByRole("button", { name: "Undo the write-off" })).toBeVisible();
	await expect(item.getByRole("button", { name: "Change" })).toHaveCount(0);
	list = await openList(page, now);
	await expect(list.getByTestId("owed-back-person")).toHaveText("Casey owes $300");
	await expect(list.getByTestId("owed-back-written-off").getByRole("listitem")).toContainText(
		/Hockey sticks.*Casey.*\$70/,
	);
	await expect(badges.filter({ hasText: "$50 Paid back by Casey · $70 written off" })).toHaveCount(
		1,
	);
	await kidsSpent("$490", "−$90");

	// And all of the camp, from the purchase, then undone there.
	item = await openPurchase(page, now, camp);
	await item.getByRole("button", { name: "Write it off" }).click();
	await expect(item.getByTestId("owed-back-text")).toHaveText("Written off $300 · Casey");
	await kidsSpent("$790", "−$390");
	item = await openPurchase(page, now, camp);
	await item.getByRole("button", { name: "Undo the write-off" }).click();
	await expect(item.getByTestId("owed-back-text")).toHaveText("Owed back $300 · Casey");
	await expect(item.getByRole("button", { name: "Write it off" })).toBeVisible();
	await kidsSpent("$490", "−$90");
	await page.context().close();
});

test("the Owed back list fits a phone with Write off on each line @phone", async ({ browser }) => {
	test.setTimeout(300_000);
	const page = await signedInPage(browser, parent.email);
	const { now, camp, sticks } = await household(page);
	await expect(await sayOwedBack(page, now, camp)).toHaveText("Owed back $300 · Casey");
	await expect(await sayOwedBack(page, now, sticks)).toHaveText("Owed back $120 · Casey");
	for (const width of [393, 320]) {
		await page.setViewportSize({ width, height: 800 });
		const list = await openList(page, now);
		const rows = list.getByTestId("owed-back-item");
		await expect(rows).toHaveCount(2);
		expect(
			await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
		).toBe(true);
		const edge = await list.boundingBox();
		await list.scrollIntoViewIfNeeded();
		await shot(page, `list-phone-${width}`);
		for (const row of await rows.all()) {
			const name = await row.getByRole("link").boundingBox();
			const amount = await row.locator("span.font-semibold").boundingBox();
			const button = await row.getByRole("button", { name: /^Write off/ }).boundingBox();
			if (!edge || !name || !amount || !button) throw new Error("A line isn't drawn");
			// The purchase can be read, the amount stands clear of the button, and nothing is cut off.
			expect(name.width).toBeGreaterThanOrEqual(48);
			// How long it has been owed, and the part, are under the name, inside the list.
			const said = await row.getByTestId("owed-back-age").boundingBox();
			if (!said) throw new Error("A line doesn't say how old it is");
			expect(said.y).toBeGreaterThanOrEqual(name.y + name.height - 12);
			await expect(row).toContainText(/ · \$\d+ of \$\d+/);
			expect(button.x - (amount.x + amount.width)).toBeGreaterThanOrEqual(8);
			expect(button.x + button.width).toBeLessThanOrEqual(edge.x + edge.width);
			expect(button.height).toBeGreaterThanOrEqual(44);
		}
	}
	// Written off on a phone, the line under "Written off" fits too.
	const list = page.getByTestId("owed-back-list");
	await list
		.getByRole("button", { name: "Write off the $120 Casey owes for Hockey sticks" })
		.click();
	await expect(list.getByTestId("owed-back-written-off").getByRole("listitem")).toContainText(
		/Hockey sticks.*Casey.*\$120/,
	);
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
		true,
	);
	await shot(page, "list-phone-320-written-off");
	await page.context().close();
});
