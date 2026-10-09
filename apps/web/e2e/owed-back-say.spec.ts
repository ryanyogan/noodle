import { expect, type Page, test } from "@playwright/test";
import { ulid } from "ulid";
import { measure } from "./overflow";
import { createTestParent } from "./parents";
import { seedSql } from "./seed-sql";
import { createPlannedHousehold, hydrated, signedInPage } from "./session";

// "Someone's paying part of this back" where a purchase is first met (issue 158, ADR-0058): on a
// Review card, in the sheet Edit opens from one, and in Quick Add as it is saved, on a phone and a
// computer. Until now it could only be said on an open Transaction.

let parent: Awaited<ReturnType<typeof createTestParent>>;

test.beforeEach(async () => {
	parent = await createTestParent();
});

test.afterEach(async () => {
	await parent?.remove();
});

const q = (value: string) => `'${value.replaceAll("'", "''")}'`;
const pad = (n: number) => String(n).padStart(2, "0");

/** This month, as the specs' seeded days name it. */
function thisMonth() {
	const today = new Date();
	return `${today.getFullYear()}-${pad(today.getMonth() + 1)}`;
}

/** Purchases waiting in Review, on the month's first day: always this month, never after today. */
async function seedReview(userId: string, lines: [name: string, cents: number][]) {
	const household = `(select household_id from members where clerk_user_id = ${q(userId)})`;
	const member = `(select id from members where clerk_user_id = ${q(userId)})`;
	const account = q(ulid());
	const statements = [
		`insert into accounts (id, household_id, name, kind) values (${account}, ${household}, 'Everyday checking', 'checking');`,
	];
	for (const [name, cents] of lines) {
		const id = q(ulid());
		statements.push(
			`insert into transactions (id, household_id, source, date, amount_cents, note, merchant, account_id, created_by_member_id) values (${id}, ${household}, 'import', ${q(`${thisMonth()}-01`)}, ${cents}, ${q(name)}, ${q(name)}, ${account}, ${member});`,
			`insert into categorizations (transaction_id, household_id, member_id, outcome, method, bucket_id, confidence, merchant) values (${id}, ${household}, ${member}, 'review', 'none', null, null, ${q(name)});`,
		);
	}
	await seedSql(statements);
}

/**
 * What doesn't fit on the screen: the page if it scrolls sideways, anything past its right edge,
 * and each of `within`'s buttons and fields that is under 44px tall or past either edge.
 */
async function misfits(page: Page, within: string) {
	const { scrollWidth, width, sticking } = await measure(page);
	const found = [...sticking];
	if (scrollWidth > width) found.push(`the page is ${scrollWidth} wide, of ${width}`);
	const controls = await page.evaluate((selector) => {
		const wide = document.documentElement.clientWidth;
		const out: string[] = [];
		for (const part of document.querySelectorAll(selector))
			for (const control of part.querySelectorAll("button, input")) {
				const box = control.getBoundingClientRect();
				if (box.width === 0 || box.height === 0) continue;
				if (control.closest("[aria-hidden=true],[inert]")) continue;
				const name = (control.getAttribute("aria-label") ?? control.textContent ?? "").slice(0, 40);
				const hit = Number.parseFloat(getComputedStyle(control, "::after").height) || 0;
				if (Math.max(box.height, hit) < 43.5)
					out.push(`"${name}" is ${Math.round(box.height)} tall`);
				if (box.left < -0.5 || box.right > wide + 0.5)
					out.push(`"${name}" spans ${Math.round(box.left)}-${Math.round(box.right)}`);
			}
		return out;
	}, within);
	return [...found, ...controls];
}

test("on a phone, someone paying part of it back is said from a Review card and from Quick Add, and both fit", {
	tag: "@phone",
}, async ({ browser }) => {
	test.setTimeout(240_000);
	const page = await signedInPage(browser, parent.email, {
		viewport: { width: 393, height: 852 },
		isMobile: true,
		hasTouch: true,
	});
	const now = thisMonth();
	const made = await createPlannedHousehold(page, {
		baseline: "5,000",
		buckets: [["Kids", "400"]],
	});
	if (!made?.bucketIds.Kids) throw new Error("The Household wasn't made directly");
	await seedReview(parent.userId, [["Hockey camp", 60_000]]);

	const card = page.getByTestId("review-stack").getByTestId("review-card").first();
	const say = card.getByTestId("review-owed-back");
	const sheet = page.getByRole("dialog", { name: "Someone’s paying part of this back" });
	// The narrowest phone first, then the owner's.
	for (const [width, height] of [
		[320, 568],
		[393, 852],
	] as const) {
		await page.setViewportSize({ width, height });
		await page.goto("/review");
		await expect(card).toContainText("Hockey camp", { timeout: 30_000 });
		await hydrated(say);
		expect(await misfits(page, "[data-testid=review-card]"), `${width}: the card`).toEqual([]);
		await say.tap();
		const form = sheet.getByTestId("owed-back-form");
		if (width === 320) {
			// Nothing said yet: who and how much are there at once, half of it filled in.
			await expect(form.getByLabel("How much")).toHaveValue("300");
			expect(await misfits(page, "[role=dialog]"), `${width}: the sheet`).toEqual([]);
			await form.getByLabel(/paying it back/).fill("Casey");
			await form.getByRole("button", { name: "Save" }).tap();
			await expect(form).toBeHidden();
		}
		await expect(sheet.getByTestId("owed-back-text")).toHaveText("Owed back $300 · Casey");
		expect(await misfits(page, "[role=dialog]"), `${width}: the sheet, said`).toEqual([]);
		await sheet.getByRole("button", { name: "Done" }).tap();
		await expect(sheet).toBeHidden();
		// The card says it, and is still no wider than the screen.
		await expect(card.getByTestId("review-owed-back-said")).toHaveText("$300 owed back by Casey");
		await expect(say).toHaveAccessibleName("$300 owed back by Casey on Hockey camp: change it");
		expect(await misfits(page, "[data-testid=review-card]"), `${width}: the card, said`).toEqual(
			[],
		);
	}

	// Quick Add: $40 on the keypad, Casey paying half, then the Bucket saves both.
	const quick = page.getByRole("dialog", { name: "Quick Add" });
	for (const [width, height] of [
		[320, 568],
		[393, 852],
	] as const) {
		await page.setViewportSize({ width, height });
		await page.goto("/month?sheet=quick-add");
		await expect(quick).toBeVisible({ timeout: 30_000 });
		const line = quick.getByTestId("quick-add-owed-back");
		await hydrated(line);
		await expect(line).toHaveText("Owed back: Nobody");
		const keypad = quick.getByRole("group", { name: "Keypad" });
		for (const key of ["4", "0"])
			await keypad.getByRole("button", { name: key, exact: true }).tap();
		await line.scrollIntoViewIfNeeded();
		await line.tap();
		await expect(quick.getByLabel("How much")).toHaveValue("20");
		await quick.getByLabel(/paying it back/).fill("Casey");
		const { scrollWidth, width: screen, sticking } = await measure(page);
		expect([scrollWidth <= screen, sticking], `${width}: Quick Add, who and how much`).toEqual([
			true,
			[],
		]);
		await quick.getByRole("button", { name: "Done" }).tap();
		await expect(line).toHaveText("Owed back: $20 · Casey");
		const fits = await measure(page);
		expect([fits.scrollWidth <= fits.width, fits.sticking], `${width}: Quick Add, said`).toEqual([
			true,
			[],
		]);
	}
	// Saved on the owner's phone: the Bucket is $20 down, and the other $20 is said beside it.
	await quick.getByRole("list", { name: "Add to" }).getByRole("button", { name: /^Kids/ }).tap();
	await expect(quick).toBeHidden();
	await expect(page.getByText("$40 added to Kids · $20 owed back by Casey")).toBeVisible();
	await expect
		.poll(async () => (await page.locator("main").innerText()).replace(/\s+/g, " "), {
			timeout: 30_000,
		})
		.toMatch(/Kids (Ahead )?\$20 spent · \$20 owed back/);
	await page.goto(`/transactions/${now}`);
	// Beside the camp still waiting in Review, which says its own.
	await expect(
		page.getByTestId("row-owed-back").filter({ visible: true, hasText: "$20 owed back by Casey" }),
	).toHaveCount(1, { timeout: 30_000 });
	await page.context().close();
});

test("on a computer, someone paying part of it back is said from a Review card, from the sheet Edit opens, and from Quick Add", async ({
	browser,
}) => {
	test.setTimeout(240_000);
	const page = await signedInPage(browser, parent.email);
	await page.setViewportSize({ width: 1440, height: 900 });
	const now = thisMonth();
	const made = await createPlannedHousehold(page, {
		baseline: "5,000",
		buckets: [["Kids", "400"]],
	});
	if (!made?.bucketIds.Kids) throw new Error("The Household wasn't made directly");
	await seedReview(parent.userId, [["Hockey camp", 60_000]]);

	// The card's own button: who and how much in a sheet, half filled in.
	await page.goto("/review");
	const card = page.getByTestId("review-card").filter({ hasText: "Hockey camp" }).first();
	const say = card.getByTestId("review-owed-back");
	await expect(card).toBeVisible({ timeout: 30_000 });
	await hydrated(say);
	await say.click();
	const sheet = page.getByRole("dialog", { name: "Someone’s paying part of this back" });
	const form = sheet.getByTestId("owed-back-form");
	await form.getByLabel(/paying it back/).fill("Casey");
	// Enter in the name saves it.
	await form.getByLabel(/paying it back/).press("Enter");
	await expect(sheet.getByTestId("owed-back-text")).toHaveText("Owed back $300 · Casey");
	await sheet.getByRole("button", { name: "Done" }).click();
	await expect(card.getByTestId("review-owed-back-said")).toHaveText("$300 owed back by Casey");

	// The sheet Edit opens says it too, and changes it: $200 of the $600, without closing the editor.
	await card.getByRole("button", { name: "Edit Hockey camp" }).click();
	const editor = page.getByRole("dialog", { name: "Edit Transaction" });
	const inEditor = editor.getByTestId("owed-back");
	await expect(inEditor.getByTestId("owed-back-text")).toHaveText("Owed back $300 · Casey");
	await inEditor.getByRole("button", { name: "Change" }).click();
	await inEditor.getByLabel("How much").fill("200");
	await inEditor.getByRole("button", { name: "Save" }).click();
	await expect(inEditor.getByTestId("owed-back-text")).toHaveText("Owed back $200 · Casey");
	await expect(editor).toBeVisible();
	await editor.getByRole("button", { name: "Cancel" }).click();
	await expect(card.getByTestId("review-owed-back-said")).toHaveText("$200 owed back by Casey");

	// Quick Add: $90 typed, a third said instead of half, saved with the Bucket.
	await page.goto("/month?sheet=quick-add");
	const quick = page.getByRole("dialog", { name: "Quick Add" });
	const line = quick.getByTestId("quick-add-owed-back");
	await hydrated(line);
	await page.keyboard.type("90");
	await line.click();
	await expect(quick.getByLabel("How much")).toHaveValue("45");
	await quick.getByLabel(/paying it back/).fill("Casey");
	await quick.getByLabel("How much").fill("30");
	await quick.getByRole("button", { name: "Done" }).click();
	await expect(line).toHaveText("Owed back: $30 · Casey");
	await quick.getByRole("option", { name: /^Kids/ }).click();
	await expect(quick).toBeHidden();
	await expect(page.getByText("$90 added to Kids · $30 owed back by Casey")).toBeVisible();
	await page.goto(`/transactions/${now}`);
	await expect(
		page.getByTestId("row-owed-back").filter({ visible: true, hasText: "$30 owed back by Casey" }),
	).toHaveCount(1, { timeout: 30_000 });
	await page.context().close();
});
