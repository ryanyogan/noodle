import { expect, type Locator, type Page } from "@playwright/test";

// Money in on the Transactions page (issue 152, ADR-0061): rows of the table like any other, with
// a "+" and a one-word kind, which open under their row (a page of their own on a phone).

/** Money in's rows in the Transactions table. */
export const moneyInRows = (page: Page) => page.locator('[data-slot="list-row"][data-money-in]');

/** The one-word kind a money-in row says where a Bucket would be, once the table is in columns. */
export const moneyInKind = (row: Locator) => row.locator('[data-slot="row-kind-column"]');

/**
 * Opens the money-in row with `text` in it, as a press on any row of the table does, and gives
 * back the row and its editor. Pressed again until it is open: before the page is live a press
 * does nothing.
 */
export async function openMoneyIn(page: Page, text: string) {
	const row = moneyInRows(page).filter({ hasText: text });
	const editor = page.getByTestId("money-in-editor");
	await expect(row).toBeVisible({ timeout: 30_000 });
	await expect(async () => {
		if (!(await editor.isVisible()))
			await row.locator("button[aria-expanded]").click({ timeout: 2_000 });
		await expect(editor).toBeVisible({ timeout: 3_000 });
	}).toPass({ timeout: 30_000 });
	return { row, editor };
}
