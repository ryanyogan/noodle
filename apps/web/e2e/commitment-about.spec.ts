import { expect, type Page, test } from "@playwright/test";
import { openCommitmentForm } from "./commitment-form";
import { createTestParent } from "./parents";
import { choose, createPlannedHousehold, savedBy, signedInPage, switchTo } from "./session";

// A bill that varies (issue 135): a Commitment whose amount is "about", and where a month's over
// or under goes.

let parent: Awaited<ReturnType<typeof createTestParent>>;

test.beforeEach(async () => {
	parent = await createTestParent();
});

test.afterEach(async () => {
	await parent?.remove();
});

const edit = (page: Page, commitment: string) =>
	page.getByRole("button", { name: `Edit ${commitment}` });
const planRow = (page: Page, commitment: string) =>
	page.getByRole("row").filter({ has: edit(page, commitment) });
const commitmentRow = (page: Page, name: string) =>
	page.getByRole("listitem", { name: new RegExp(`^${name}: `) });

const monthAfter = (month: string) => {
	const [year = 0, m = 0] = month.split("-").map(Number);
	return new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "UTC" }).format(
		new Date(Date.UTC(year, m, 1)),
	);
};

test("a Parent sets a bill that varies to About, and a month over says where it goes", async ({
	browser,
}) => {
	// Several pages and a reload: on a slow server it runs close to the usual 30 seconds.
	test.slow();
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, { baseline: "9,000", buckets: [["Groceries", "1,200"]] });
	await switchTo(page, "Plan");
	await page
		.getByRole("navigation", { name: "Plan pages" })
		.getByRole("link", { name: "Commitments", exact: true })
		.click();
	const month = /\/plan\/(\d{4}-\d{2})\//.exec(page.url())?.[1];
	if (!month) throw new Error(`No month in ${page.url()}`);

	const form = await openCommitmentForm(page);
	await form.getByLabel("New Commitment").fill("Power");
	await form.getByLabel("Amount due").fill("140");
	await expect(form.getByRole("combobox", { name: "The amount is", exact: true })).toHaveText(
		"The same each time",
	);
	await choose(form, "The amount is", "About: it varies");
	const added = savedBy(page, "addCommitment");
	await form.getByRole("button", { name: "Add Commitment" }).click();
	await added;
	// The list is headed "Bills"; the thing is still a Commitment.
	await expect(page.getByLabel(/^Bills in [A-Z][a-z]+: totals$/)).toBeVisible();
	// Before its first charge, "about" what the Plan sets aside.
	await expect(planRow(page, "Power")).toContainText("About $140");
	// The next one starts at "The same each time" again.
	await openCommitmentForm(page);
	await expect(form.getByRole("combobox", { name: "The amount is", exact: true })).toHaveText(
		"The same each time",
	);

	// It is kept: the edit form opens on "About".
	await page.keyboard.press("Escape");
	await page.reload();
	await expect(planRow(page, "Power")).toContainText("About $140");
	await edit(page, "Power").click();
	const sheet = page.getByRole("dialog", { name: "Power" });
	await expect(sheet.getByRole("combobox", { name: "The amount is", exact: true })).toHaveText(
		"About: it varies",
	);
	await sheet.getByRole("button", { name: "Cancel" }).click();
	await expect(sheet).toBeHidden();

	// This month's bill comes in $35 over: Free to Spend isn't touched, and the row says where the
	// difference goes.
	await switchTo(page, "Month");
	const power = commitmentRow(page, "Power");
	await power.getByRole("button", { name: "Record payment" }).click();
	await power.getByLabel("Amount paid to Power").fill("175");
	const paid = savedBy(page, "addCommitmentPayment");
	await power.getByRole("button", { name: "Record", exact: true }).click();
	await paid;
	const carry = `Power came in $35 over · comes out of what carries to ${monthAfter(month)}`;
	await expect(power).toHaveAccessibleName(`Power: $175 paid of $140 expected, ${carry}`);
	await expect(power).toContainText(carry);
	await expect(power).not.toContainText("more than expected");

	// The Commitment's own page says the same, with the amount its charges come to.
	await power.getByRole("link", { name: "Power" }).click();
	const cost = page.getByRole("region", { name: "Cost a year" });
	await expect(cost).toContainText(carry);
	await expect(cost).toContainText("About $175");
	await page.context().close();
});
