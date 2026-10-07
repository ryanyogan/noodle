import { expect, type Page, test } from "@playwright/test";
import { openCommitmentForm } from "./commitment-form";
import { createTestParent } from "./parents";
import { createPlannedHousehold, signedInPage, switchTo } from "./session";

let parent: Awaited<ReturnType<typeof createTestParent>>;

test.beforeEach(async () => {
	parent = await createTestParent();
});

test.afterEach(async () => {
	await parent?.remove();
});

/** The Scenario's total Free to Spend over the months projected. */
const scenarioTotal = (page: Page) =>
	page
		.getByRole("row", { name: /^Over 2 years/ })
		.getByRole("cell")
		.nth(1);
const changes = (page: Page) => page.getByRole("region", { name: "Your changes" });
/** One of "Your changes", by its words. */
const change = (page: Page, words: string | RegExp) =>
	changes(page).getByRole("listitem", { name: words });
const amount = (page: Page, label: string) => page.getByRole("textbox", { name: label });

async function type(page: Page, label: string, value: string) {
	await amount(page, label).fill(value);
	await amount(page, label).press("Enter");
}

test("a Parent tweaks the Plan in a sandbox: amounts, new things, date ranges and muting", async ({
	browser,
}) => {
	const page = await signedInPage(browser, parent.email);
	// $9,000 − $1,400 Daycare − $1,600 in allowances: $6,000 Free to Spend a month.
	await createPlannedHousehold(page, {
		baseline: "9,000",
		buckets: [
			["Groceries", "1,200"],
			["Hockey", "400"],
		],
	});
	await switchTo(page, "Plan");
	await page
		.getByRole("navigation", { name: "Plan pages" })
		.getByRole("link", { name: "Commitments", exact: true })
		.click();
	const addCommitment = await openCommitmentForm(page);
	await addCommitment.getByLabel("New Commitment").fill("Daycare");
	await addCommitment.getByLabel("Amount due").fill("1,400");
	await addCommitment.getByRole("button", { name: "Add Commitment" }).click();
	await expect(page.getByRole("button", { name: "Edit Daycare" })).toBeVisible();

	await page.getByRole("link", { name: "Explore", exact: true }).click();
	await expect(page.getByRole("heading", { level: 1 })).toHaveText("Explore");
	await expect(scenarioTotal(page)).toHaveText("$144,000");
	await expect(changes(page)).toContainText("Nothing changed yet");

	// A Commitment's amount, typed: $400 a month less.
	await page.getByRole("button", { name: "Edit Daycare" }).click();
	await type(page, "Daycare amount", "1,000");
	await expect(change(page, "Daycare $1,400 → $1,000 a month")).toContainText(
		"Frees $9,600 over 2 years",
	);
	await expect(scenarioTotal(page)).toHaveText("$153,600");

	// A one-off expense this month: the Projected balance takes it, Free to Spend doesn't.
	await page.getByRole("button", { name: "Add one-off" }).click();
	const oneOff = page.getByRole("form", { name: "New one-off" });
	await oneOff.getByRole("textbox", { name: "Name" }).fill("New roof");
	await oneOff.getByRole("textbox", { name: "Amount" }).fill("3,000");
	await oneOff.getByRole("textbox", { name: "Amount" }).press("Tab");
	await oneOff.getByRole("button", { name: "Add", exact: true }).click();
	await expect(change(page, /^One-off expense: New roof \$3,000/)).toContainText(
		"Takes $3,000 from the projected balance",
	);
	await expect(scenarioTotal(page)).toHaveText("$153,600");
	// $6,400 in the first month, less the roof.
	await expect(page.getByText(/^Projected balance at its lowest \$3,400 in /)).toBeVisible();

	// A new Bucket at $200 a month.
	await page.getByRole("button", { name: "Add Bucket", exact: true }).click();
	const bucket = page.getByRole("form", { name: "New Bucket" });
	await bucket.getByRole("textbox", { name: "Name" }).fill("Swim");
	await bucket.getByRole("textbox", { name: "Allowance" }).fill("200");
	await bucket.getByRole("textbox", { name: "Allowance" }).press("Tab");
	await bucket.getByRole("button", { name: "Add", exact: true }).click();
	await expect(change(page, "New Bucket: Swim $200 a month")).toContainText(
		"Costs $4,800 over 2 years",
	);
	await expect(scenarioTotal(page)).toHaveText("$148,800");

	// Take-home pay $1,000 lower for six months, a year from now.
	await page.getByRole("button", { name: "Edit Take-home pay" }).click();
	await type(page, "Take-home pay", "8,000");
	await page.getByRole("combobox", { name: "Take-home pay from" }).click();
	await page.getByRole("listbox").getByRole("option").nth(12).click();
	await page.getByRole("combobox", { name: "Take-home pay until" }).click();
	await page.getByRole("listbox").getByRole("option").nth(6).click();
	const takeHomePay = change(page, /^Income \$9,000 → \$8,000 a month from \w+ \d{4} until/);
	await expect(takeHomePay).toContainText("Costs $6,000 over 2 years");
	await expect(scenarioTotal(page)).toHaveText("$142,800");

	// Leaving the Daycare change out says what it would do; its button says what it does.
	const daycare = change(page, "Daycare $1,400 → $1,000 a month");
	const leaveOut = daycare.getByRole("button", { name: "Leave out" });
	await leaveOut.hover();
	await expect(page.getByRole("tooltip", { name: "Leave it out" })).toBeVisible();
	await leaveOut.click();
	await expect(leaveOut).toHaveAttribute("aria-pressed", "true");
	await expect(daycare).toContainText("Would free $9,600 over 2 years");
	await expect(scenarioTotal(page)).toHaveText("$133,200");
	await expect(page.getByText(/^Projected balance at its lowest \$2,800 in /)).toBeVisible();
	await expect(page.getByText("4 changes (1 left out) to the Plan")).toBeVisible();

	// Counted again, then removed from the list: back to the Plan's Daycare.
	await leaveOut.click();
	await expect(scenarioTotal(page)).toHaveText("$142,800");
	await daycare.getByRole("button", { name: "Remove" }).click();
	await expect(daycare).toHaveCount(0);
	await expect(amount(page, "Daycare amount")).toHaveValue("1,400");
	await expect(scenarioTotal(page)).toHaveText("$133,200");
});
