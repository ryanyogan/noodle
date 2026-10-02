import { expect, test } from "@playwright/test";
import { createTestParent } from "./parents";
import { savedBy, signedInPage } from "./session";

// The get-started wizard's shell (#53): a new Household lands on it, Hello chooses how spending
// comes in, Take-home pay is set on the Plan, Back works, and a reload resumes where it was.

test("a new Household goes through Hello and Take-home pay, and a reload resumes", async ({
	browser,
}) => {
	const parent = await createTestParent();
	try {
		const page = await signedInPage(browser, parent.email);
		await page.goto("/welcome");
		await page.getByLabel("Household name").fill("The Starters");
		await page.getByLabel("Your name").fill("Alex");
		await page.getByRole("button", { name: "Create Household" }).click();

		await expect(page).toHaveURL(/\/setup$/);
		await expect(page.getByText("Step 1 of 7")).toBeVisible();
		await expect(page.getByText("about 8 minutes left")).toBeVisible();
		const by = page.getByRole("radio", { name: /I’ll add things by hand/ });
		await by.check();
		let saved = savedBy(page, "saveSetup");
		await page.getByRole("button", { name: "Continue" }).click();
		await saved;

		await expect(page.getByText("Step 2 of 7")).toBeVisible();
		const pay = page.getByRole("textbox", {
			name: "What lands in your account in a normal month, after tax?",
		});
		// Help for biweekly pay: one paycheck × 26 ÷ 12.
		await page.getByRole("button", { name: "Paid every two weeks?" }).click();
		await page.getByRole("textbox", { name: "One paycheck" }).fill("2400");
		await page.getByRole("button", { name: "Use $5,200" }).click();
		await expect(pay).toHaveValue(/^5,?200(\.00)?$/);

		// Back keeps Hello's choice.
		saved = savedBy(page, "saveSetup");
		await page.getByRole("button", { name: "Back" }).click();
		await saved;
		await expect(page.getByText("Step 1 of 7")).toBeVisible();
		await expect(by).toBeChecked();
		await page.getByRole("button", { name: "Continue" }).click();

		await pay.fill("5,000");
		const takeHomePaySaved = savedBy(page, "setTakeHomePay");
		saved = savedBy(page, "saveSetup");
		await page.getByRole("button", { name: "Continue" }).click();
		await takeHomePaySaved;
		await saved;
		await expect(page.getByText("Step 3 of 7")).toBeVisible();

		// Leaving and coming back resumes on the same step, with the answers kept.
		await page.reload();
		await expect(page.getByText("Step 3 of 7")).toBeVisible();
		await page.getByRole("button", { name: "Back" }).click();
		await expect(pay).toHaveValue(/^5,?000(\.00)?$/);

		// The take-home pay landed on the Plan.
		await page.getByRole("link", { name: "Set up later" }).click();
		await expect(page).toHaveURL(/\/month\//);
		await page.goto("/plan");
		await expect(page.getByText(/\$5,000/).first()).toBeVisible();
	} finally {
		await parent.remove();
	}
});
