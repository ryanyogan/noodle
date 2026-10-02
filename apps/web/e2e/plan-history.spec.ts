import { expect, type Page, test } from "@playwright/test";
import { createTestParent } from "./parents";
import { createPlannedHousehold, savedBy, signedInPage, switchTo } from "./session";

const waterfall = (page: Page) =>
	page.getByRole("region", { name: "From take-home pay to Free to Spend" });
const whatChanged = (page: Page) => page.getByRole("region", { name: "What changed" });
const item = (page: Page, title: string) =>
	whatChanged(page)
		.getByRole("listitem")
		.filter({ has: page.getByText(title, { exact: true }) });

async function openPart(page: Page, part: "Buckets" | "Commitments") {
	await waterfall(page).getByRole("link", { name: part, exact: true }).click();
	await expect(page.locator("[data-slot=page-header]")).toContainText(part);
}

async function backToPlan(page: Page) {
	await page.getByRole("link", { name: "Back to Plan" }).click();
	await expect(waterfall(page)).toBeVisible();
}

test("What changed shows each Plan change and who made it; the other Parent's Personal Allowance only as changed", async ({
	browser,
}) => {
	// Two Parents sign in and change the Plan throughout: close to 30 s even run alone.
	test.slow();
	const first = await createTestParent();
	const second = await createTestParent();
	try {
		const page = await signedInPage(browser, first.email);
		await createPlannedHousehold(page, { baseline: "9,000", buckets: [["Groceries", "1,200"]] });

		// Alex brings the other Parent in, so the Plan's changes come from two people.
		await page.getByRole("link", { name: "Household" }).click();
		await page.getByLabel("Their email").fill(second.email);
		await page.getByRole("button", { name: /^Invite/ }).click();
		await expect(page.getByText(`Invited ${second.email}`)).toBeVisible();
		const samPage = await signedInPage(browser, second.email);
		await samPage.goto("/welcome");
		await samPage.getByLabel("Your name").fill("Sam");
		await samPage.getByRole("button", { name: "Join The Rinks" }).click();
		await expect(samPage).toHaveURL(/\/month\/\d{4}-\d{2}$/);

		await page.goto("/month");
		await switchTo(page, "Plan");
		await openPart(page, "Buckets");
		// Alex's own Personal Allowance, which Sam never sees the amounts of.
		await page.getByLabel("Your Personal Allowance").fill("150");
		await page.getByRole("button", { name: "Set up Personal Allowance" }).click();
		await expect(
			page.getByRole("button", { name: "Edit Alex’s Personal Allowance" }),
		).toBeVisible();

		await page.getByRole("button", { name: "Edit Groceries" }).click();
		let sheet = page.getByRole("dialog", { name: "Groceries" });
		await sheet.getByRole("textbox", { name: "Allowance", exact: true }).fill("1,500");
		const allowanceSaved = savedBy(page, "setAllowance");
		await sheet.getByRole("button", { name: "Save", exact: true }).click();
		await allowanceSaved;
		// The Bucket's own history, in its sheet.
		await page.getByRole("button", { name: "Edit Groceries" }).click();
		sheet = page.getByRole("dialog", { name: "Groceries" });
		await sheet.getByText("History", { exact: true }).click();
		await expect(sheet.getByText("$1,200 → $1,500")).toBeVisible();
		await expect(sheet.getByText(/^Added · \$1,200/)).toBeVisible();
		await expect(sheet.getByText(/History starts/)).toBeVisible();
		await page.keyboard.press("Escape");
		await backToPlan(page);

		await openPart(page, "Commitments");
		const add = page.getByRole("form", { name: "Add a Commitment" });
		await add.getByLabel("New Commitment").fill("Daycare");
		await add.getByLabel("Amount due").fill("1,400");
		await add.getByRole("button", { name: "Add Commitment" }).click();
		await page.getByRole("button", { name: "Edit Daycare" }).click();
		sheet = page.getByRole("dialog", { name: "Daycare" });
		await sheet.getByLabel("Amount", { exact: true }).fill("1,450");
		const termsSaved = savedBy(page, "updateCommitment");
		await sheet.getByRole("button", { name: "Save", exact: true }).click();
		await termsSaved;
		await backToPlan(page);

		// Items added this month read as added, with what they are now.
		await expect(item(page, "Groceries")).toContainText("Added · $1,500");
		await expect(item(page, "Daycare")).toContainText("Added · $1,450");
		await expect(item(page, "Daycare")).toContainText(/Alex · \w{3} \d{1,2}/);
		await expect(item(page, "Alex’s Personal Allowance")).toContainText("Added · $150");
		await expect(whatChanged(page)).toContainText(/History starts/);

		// Sam sees what Alex changed, but Alex's Personal Allowance only as changed.
		await samPage.goto("/month");
		await switchTo(samPage, "Plan");
		await expect(item(samPage, "Daycare")).toContainText("Added · $1,450");
		await expect(item(samPage, "Daycare")).toContainText("Alex");
		const hidden = item(samPage, "Personal Allowance changed");
		await expect(hidden).toContainText("Alex");
		await expect(hidden).not.toContainText("$150");
		await expect(whatChanged(samPage)).not.toContainText("Alex’s Personal Allowance");
	} finally {
		await Promise.all([first.remove(), second.remove()]);
	}
});
