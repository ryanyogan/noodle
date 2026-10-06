import { expect, type Page, test } from "@playwright/test";
import { createTestParent } from "./parents";
import { createPlannedHousehold, signedInPage } from "./session";

// Plan › Income is a table a Parent works in (issue 133): whose pay is said in the row, each
// Parent has a total, and Income typed in by hand can be edited.

let parent: Awaited<ReturnType<typeof createTestParent>>;

test.beforeEach(async () => {
	parent = await createTestParent();
});

test.afterEach(async () => {
	await parent?.remove();
});

const income = (page: Page) => page.getByRole("region", { name: "Income" });
const toast = (page: Page, text: string) => page.getByRole("status").filter({ hasText: text });

async function addIncome(page: Page, amount: string, note: string) {
	await income(page).getByRole("button", { name: "Add income" }).click();
	const sheet = page.getByRole("dialog", { name: "Add income" });
	await sheet.getByLabel("Amount").fill(amount);
	await sheet.getByLabel("Note").fill(note);
	await sheet.getByRole("button", { name: "Add income" }).click();
	await expect(sheet).toBeHidden();
}

test("whose pay is said in the Income table, totalled per Parent, and typed Income is edited", async ({
	browser,
}) => {
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, { baseline: "5,000", buckets: [["Groceries", "1,200"]] });
	const month = /\/month\/(\d{4}-\d{2})/.exec(page.url())?.[1];
	if (!month) throw new Error(`No month in ${page.url()}`);
	await page.goto(`/plan/${month}/income`);
	await addIncome(page, "2,500", "Paycheck");

	const table = income(page).getByRole("table", { name: /^Income in / });
	await expect(table).toContainText("Paycheck");
	await expect(table).toContainText("Typed in");

	// It is the Household's until a Parent says whose pay it is.
	const whose = table.getByRole("combobox", { name: "Whose pay is $2,500 from Paycheck" });
	await expect(whose).toContainText("The Household");
	await whose.click();
	const first = page.getByRole("option").first();
	const name = ((await first.textContent()) ?? "").trim();
	expect(name).not.toBe("The Household");
	await first.click();
	const said = toast(page, `$2,500 is ${name}’s pay`);
	await expect(said).toBeVisible();
	const totals = income(page).getByRole("region", { name: "Whose pay" });
	await expect(totals).toContainText(`${name}’s pay`);
	await expect(totals).toContainText("$2,500");

	// Saying it offers to remember the sender.
	await said
		.getByRole("button", { name: `Always treat deposits from Paycheck as ${name}’s pay` })
		.click();
	await expect(toast(page, `Deposits from Paycheck are ${name}’s pay from now on`)).toBeVisible();

	// The server keeps it, not just this screen.
	await page.reload();
	await expect(whose).toContainText(name);

	// Typed in by hand, so its amount can be changed as well as what it's from.
	await income(page).getByRole("button", { name: "Actions for $2,500 of income" }).click();
	await page.getByRole("menuitem", { name: "Edit" }).click();
	const sheet = page.getByRole("dialog", { name: "Edit income" });
	await sheet.getByRole("textbox", { name: "From" }).fill("September pay");
	await sheet.getByLabel("Amount").fill("2,600");
	await sheet.getByRole("button", { name: "Save" }).click();
	await expect(toast(page, "Saved your change to this Income")).toBeVisible();
	await expect(table).toContainText("September pay");
	await expect(income(page)).toContainText("$2,600 received of $5,000 usual take-home pay");
	await expect(totals).toContainText("$2,600");
	await page.context().close();
});
