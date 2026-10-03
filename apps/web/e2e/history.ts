import { expect, type Page } from "@playwright/test";
import { accountKindLabel, choose } from "./session";

// About three months of a checking Account's history, for the plan draft (onboarding-draft) and
// the Add Buckets sheet's suggestions from spending (add-buckets). With AI_MODEL=stub the draft
// knows Costco is groceries, Chipotle is eating out and Shell is gas.

/** About three months of a checking Account's history, ending today. */
export function history(): string {
	const day = (daysAgo: number) => {
		const date = new Date();
		date.setDate(date.getDate() - daysAgo);
		return date.toLocaleDateString("en-US");
	};
	const lines: string[] = [];
	const debit = (daysAgo: number, what: string, amount: string) =>
		lines.push(`${day(daysAgo)},${what},${amount},`);
	for (let ago = 84; ago >= 0; ago -= 14) lines.push(`${day(ago)},ACME CORP PAYROLL PPD,,2500.00`);
	for (const ago of [80, 50, 20]) {
		debit(ago, "ROCKET MORTGAGE PMT", "2100.00");
		debit(ago - 2, "NETFLIX.COM 866-579-7172 CA", "15.49");
	}
	for (let ago = 83; ago >= 0; ago -= 7) debit(ago, "COSTCO WHSE #0123", "180.00");
	for (let ago = 81; ago >= 0; ago -= 10) debit(ago, "CHIPOTLE 1234", `${20 + (ago % 7)}.50`);
	for (const [ago, amount] of [
		[79, "41.20"],
		[61, "38.75"],
		[44, "52.10"],
		[30, "35.00"],
		[9, "47.65"],
	] as const) {
		debit(ago, "SHELL OIL 5741", amount);
	}
	return ["Transaction Date,Description,Debit,Credit", ...lines].join("\n");
}

/** Adds a checking Account on the Accounts page and uploads its statement. */
export async function uploadHistory(page: Page) {
	await page.getByRole("link", { name: "Accounts", exact: true }).click();
	await expect(page.getByRole("heading", { level: 1 })).toHaveText("Accounts");
	await page.getByLabel("Name").fill("Checking");
	await choose(page, "Kind", accountKindLabel("checking"));
	await page.getByLabel("Balance now").fill("3,000");
	await page.getByRole("button", { name: "Add Account" }).click();
	await page.getByRole("link", { name: /^Checking, / }).click();
	await expect(page.locator("[data-slot=detail-title]:visible")).toContainText("Checking");
	const csv = history();
	await page.getByRole("button", { name: "Upload statement" }).click();
	const sheet = page.getByRole("dialog", { name: "Upload a statement" });
	await sheet
		.getByLabel("Statement file")
		.setInputFiles({ name: "checking.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
	await sheet.getByRole("button", { name: /^Import \d+ lines$/ }).click();
	await expect(sheet).toBeHidden();
}
