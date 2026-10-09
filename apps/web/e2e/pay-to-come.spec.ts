import { expect, type Page, test } from "@playwright/test";
import { ulid } from "ulid";
import { measure } from "./overflow";
import { createTestParent } from "./parents";
import { seedSql } from "./seed-sql";
import {
	clientRendered,
	createPlannedHousehold,
	hydrated,
	pickDate,
	signedInPage,
} from "./session";

// Pay to come on Plan › Income (issue 159, phase a): a Parent whose pay varies records pay that
// is earned and not in yet, sees it said as late once its expected day has passed, and says it is
// in when the money lands, in whole or in part. None of it is Income until it arrives.

let parent: Awaited<ReturnType<typeof createTestParent>>;

test.beforeEach(async () => {
	parent = await createTestParent();
});

test.afterEach(async () => {
	await parent?.remove();
});

const q = (value: string) => `'${value.replaceAll("'", "''")}'`;
const section = (page: Page) => page.getByTestId("pay-to-come");
const waiting = (page: Page) => section(page).getByTestId("pay-waiting");
const arrived = (page: Page) => section(page).getByTestId("pay-arrived");
const total = (page: Page) => section(page).getByTestId("pay-to-come-total");
const toast = (page: Page, text: string) => page.getByRole("status").filter({ hasText: text });
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

test("a Parent whose pay varies keeps pay that is earned and not in yet, and says it is in when it lands", async ({
	browser,
}) => {
	test.slow();
	const page = await signedInPage(browser, parent.email, {
		viewport: { width: 1440, height: 900 },
	});
	await createPlannedHousehold(page, { baseline: "5,000", buckets: [["Groceries", "1,200"]] });
	const month = /\/month\/(\d{4}-\d{2})/.exec(page.url())?.[1];
	if (!month) throw new Error(`No month in ${page.url()}`);
	await page.goto(`/plan/${month}/income`);

	// Nothing is waiting, and the page's three figures are as they were.
	await expect(section(page)).toHaveCount(1, clientRendered);
	await expect(section(page)).toContainText("Nothing earned is waiting to come in.");
	const summary = page.getByTestId("income-summary");
	const figures = await summary.innerText();
	const add = section(page).getByRole("button", { name: "Add pay to come" });
	await hydrated(add);
	await add.click();
	const sheet = page.getByRole("dialog");

	// Without who it is from and how much, it isn't saved.
	await sheet.getByRole("button", { name: "Save" }).click();
	await expect(sheet.getByText("Say who it’s from")).toBeVisible();
	await expect(sheet.getByText("Enter how much")).toBeVisible();
	await sheet.getByLabel("Who it’s from").fill("Larkspur Studio");
	await sheet.getByLabel("Amount").fill("1,800");
	await sheet.getByRole("button", { name: "Save" }).click();
	await expect(sheet).toBeHidden();
	await expect(toast(page, "$1,800 from Larkspur Studio is earned, not in yet")).toBeVisible();
	await expect(waiting(page)).toHaveCount(1);
	await expect(waiting(page).first()).toContainText("Larkspur Studio");
	await expect(waiting(page).first()).toContainText("No day expected");
	await expect(total(page)).toHaveText("Earned, not in yet: $1,800");

	// A second, expected three days ago: said plainly as late. The first client's name is offered.
	await add.click();
	await expect(sheet.locator('datalist option[value="Larkspur Studio"]')).toHaveCount(1);
	await sheet.getByLabel("Who it’s from").fill("Tern & Co");
	await sheet.getByLabel("Amount").fill("950");
	await pickDate(sheet, "Expected", day(Date.now() - 3 * 86_400_000));
	await sheet.getByRole("button", { name: "Save" }).click();
	await expect(sheet).toBeHidden();
	await expect(waiting(page)).toHaveCount(2);
	const tern = waiting(page).filter({ hasText: "Tern & Co" });
	await expect(tern).toContainText(/Late by [234] days/);
	await expect(tern).toHaveAttribute("data-late", "true");
	await expect(total(page)).toHaveText("Earned, not in yet: $2,750");
	// It counts nowhere: Income so far, the take-home pay and what is still expected haven't moved.
	expect(await summary.innerText()).toBe(figures);

	// Their pay lands a wire fee short: offered, never taken silently. Yes takes it as all of it,
	// and the month's Income is the money that landed.
	const [year, monthOf] = month.split("-").map(Number);
	const lands = day(Date.UTC(year ?? 1970, monthOf ?? 1, 0));
	const household = `(select household_id from members where clerk_user_id = ${q(parent.userId)})`;
	const member = `(select id from members where clerk_user_id = ${q(parent.userId)})`;
	const income = (cents: number, note: string) =>
		`insert into income (id, household_id, date, amount_cents, note, pay_member_id) values (${q(ulid())}, ${household}, ${q(lands)}, ${cents}, ${q(note)}, ${member})`;
	await seedSql([income(177_500, "Larkspur wire")]);
	await page.reload();
	const offer = section(page).getByTestId("pay-to-come-offer");
	await expect(offer).toHaveCount(1, clientRendered);
	await expect(offer).toContainText("$1,775 came in");
	await expect(offer).toContainText("(Larkspur wire). Is this it?");
	await expect(offer).toContainText("$25 less than what’s to come");
	await page.screenshot({ path: "test-results/shots/pay-to-come-1440.png", fullPage: true });
	const yes = offer.getByRole("button", { name: "Yes, it’s in" });
	await hydrated(yes);
	await yes.click();
	await expect(toast(page, "Larkspur Studio is in")).toBeVisible();
	await expect(waiting(page)).toHaveCount(1);
	await expect(arrived(page)).toHaveCount(1);
	await expect(arrived(page).first()).toContainText("Larkspur Studio");
	await expect(arrived(page).first()).toContainText("$1,775 of Income");
	await expect(total(page)).toHaveText("Earned, not in yet: $950");
	await expect(summary).toContainText("$1,775");
	await expect(summary).not.toContainText("$1,800");

	// A payment for part of the other: nothing is offered; the Parent says it, and the rest waits.
	await seedSql([income(40_000, "Tern part payment")]);
	await page.reload();
	await expect(waiting(page)).toHaveCount(1, clientRendered);
	await expect(offer).toHaveCount(0);
	const edit = tern.getByRole("button", { name: "Edit pay to come from Tern & Co" });
	await hydrated(edit);
	await edit.click();
	const choice = sheet.getByTestId("pay-to-come-choice").filter({ hasText: "$400 came in" });
	await choice.getByRole("button", { name: "It’s part of it" }).click();
	await expect(sheet).toBeHidden();
	await expect(tern).toContainText("$400 of $950 is in");
	await expect(total(page)).toHaveText("Earned, not in yet: $550");
	await expect(arrived(page)).toHaveCount(2);

	// A phone: nothing runs off the side, with the lists and with the form open.
	await page.setViewportSize({ width: 393, height: 852 });
	await expect(waiting(page)).toHaveCount(1);
	let size = await measure(page);
	expect(size.sticking).toEqual([]);
	expect(size.scrollWidth).toBeLessThanOrEqual(size.width);
	await page.screenshot({ path: "test-results/shots/pay-to-come-393.png", fullPage: true });
	await edit.click();
	await expect(sheet.getByLabel("Amount")).toHaveValue("950");
	size = await measure(page);
	expect(size.sticking).toEqual([]);
	expect(size.scrollWidth).toBeLessThanOrEqual(size.width);
	await page.screenshot({ path: "test-results/shots/pay-to-come-393-form.png" });

	// Changed: less than what has arrived is refused; more is kept.
	await sheet.getByLabel("Amount").fill("300");
	await sheet.getByRole("button", { name: "Save" }).click();
	await expect(sheet.getByText("That’s less than what has already arrived of it.")).toBeVisible();
	await sheet.getByLabel("Amount").fill("1,000");
	await sheet.getByRole("button", { name: "Save" }).click();
	await expect(sheet).toBeHidden();
	await expect(total(page)).toHaveText("Earned, not in yet: $600");

	// Undo: Larkspur waits again, and that line of Income is not offered for it a second time.
	await page.setViewportSize({ width: 1440, height: 900 });
	await arrived(page)
		.filter({ hasText: "Larkspur Studio" })
		.getByRole("button", { name: "Undo: this isn’t the pay from Larkspur Studio" })
		.click();
	await expect(waiting(page)).toHaveCount(2);
	await expect(arrived(page)).toHaveCount(1);
	await expect(total(page)).toHaveText("Earned, not in yet: $2,400");
	await expect(offer).toHaveCount(0);
	// The Income that landed is still Income.
	await expect(summary).toContainText("$2,175");

	// Removed, and the server keeps what is left.
	await edit.click();
	await sheet.getByRole("button", { name: "Remove" }).click();
	await expect(sheet).toBeHidden();
	await expect(waiting(page)).toHaveCount(1);
	await expect(arrived(page)).toHaveCount(0);
	await page.reload();
	await expect(waiting(page)).toHaveCount(1, clientRendered);
	await expect(waiting(page).first()).toContainText("Larkspur Studio");
	await expect(total(page)).toHaveText("Earned, not in yet: $1,800");
	await page.context().close();
});
