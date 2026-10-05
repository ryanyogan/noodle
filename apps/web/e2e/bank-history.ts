import type { Page } from "@playwright/test";

/** The question asked before Plaid Link opens for a new Bank Connection: how far back (#89). */
export const historySheet = (page: Page) =>
	page.getByRole("dialog", { name: "How far back should Noodle bring in what you spent?" });

/**
 * Answers it and goes on to the bank. Specs take "Last 30 days" unless they say otherwise: it
 * holds every line the fake bank has on any day of the month, where "This month only" (what's
 * chosen to begin with) keeps fewer early in a month.
 */
export async function continueToBank(page: Page, choice = "Last 30 days") {
	const sheet = historySheet(page);
	await sheet.getByRole("radio", { name: choice }).check();
	await sheet.getByRole("button", { name: "Continue to your bank" }).click();
}
