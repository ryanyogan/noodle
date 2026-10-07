import { expect, type Page } from "@playwright/test";

/** The Plan's add form lives in a sheet; links from Review can already have it open. */
export async function openCommitmentForm(page: Page) {
	const form = page.getByRole("form", { name: "Add a Commitment" });
	if (!(await form.isVisible())) {
		await page.getByRole("button", { name: "Add Commitment", exact: true }).click();
	}
	await expect(form).toBeVisible();
	return form;
}
