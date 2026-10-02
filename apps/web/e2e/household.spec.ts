import { clerk, setupClerkTestingToken } from "@clerk/testing/playwright";
import { expect, test } from "@playwright/test";
import { createTestParent } from "./parents";
import { setUpLater } from "./session";

test("a signed-out visitor is sent to sign in, keeping where they were going", async ({ page }) => {
	await page.goto("/month/2026-08");
	await expect(page).toHaveURL(/\/sign-in\?redirect_url=.*%2Fmonth%2F2026-08/);
});

test("a new Parent signs in, creates a Household, and can leave setup for an empty This Month", async ({
	page,
}) => {
	const parent = await createTestParent();
	try {
		await setupClerkTestingToken({ page });
		await page.goto("/");
		await clerk.signIn({ page, emailAddress: parent.email });

		await page.goto("/month");
		await expect(page).toHaveURL(/\/welcome/);

		await page.getByLabel("Household name").fill("The Testers");
		await page.getByLabel("Your name").fill("Alex");
		await page.getByRole("button", { name: "Create Household" }).click();

		// The get-started wizard comes first; the Get started checklist is the fallback.
		await expect(page.getByText("Step 1 of 7")).toBeVisible();
		await setUpLater(page);
		await expect(page).toHaveURL(/\/month\/\d{4}-\d{2}$/);
		await expect(page.locator("[data-slot=page-header]")).toContainText("This Month");
		await expect(page.getByText("The Testers")).toBeVisible();
		await expect(page.getByRole("region", { name: "Get started" })).toContainText(
			"Set your take-home pay",
		);

		// A Parent with a Household never sees the create step again.
		await page.goto("/welcome");
		await expect(page).toHaveURL(/\/month\/\d{4}-\d{2}$/);
	} finally {
		await parent.remove();
	}
});
