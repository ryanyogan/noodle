import { expect, type Locator, type Page, test } from "@playwright/test";
import { openCommitmentForm } from "./commitment-form";
import { measure } from "./overflow";
import { createTestParent } from "./parents";
import { chooseKind, createPlannedHousehold, savedBy, signedInPage } from "./session";

// The Plan's Commitments are grouped by what each one is (issue 153): credit cards, loans, then
// bills, from the Account each pays down (ADR-0050). Every group has its name and what it takes
// this month; the total under them is the whole list's. With only plain bills there are no groups.

let parent: Awaited<ReturnType<typeof createTestParent>>;

test.beforeEach(async () => {
	parent = await createTestParent();
});

test.afterEach(async () => {
	await parent?.remove();
});

const table = (page: Page) => page.getByRole("grid", { name: /^Commitments in/ });
const groupNames = (page: Page) => table(page).locator("[data-commitment-group]");
/** A group's own row: its name and its subtotals. */
const groupRow = (page: Page, name: string) =>
	table(page)
		.locator("[data-slot=data-table-group]")
		.filter({ has: page.locator("[data-commitment-group]", { hasText: name }) });
/** The rows of the table's body, group rows among them, as their first lines of text. */
const lines = (page: Page) =>
	table(page)
		.locator("[data-slot=data-table-body]")
		.getByRole("row")
		.evaluateAll((rows) =>
			rows.map(
				(row) =>
					row.querySelector("[data-commitment-group], a")?.textContent?.trim() ?? "(no name)",
			),
		);

/** Adds a card or loan on the Accounts page: its form when there are none yet, else its sheet. */
async function addAccount(page: Page, name: string, kind: "credit-card" | "loan", owed: string) {
	await page.goto(new URL("/accounts", page.url()).href);
	await expect(page.getByRole("heading", { level: 1 })).toHaveText("Accounts");
	const first = await page.getByText("Accounts are where the money is").count();
	if (!first) await page.getByRole("button", { name: "Add Account" }).click();
	const form = first
		? page.getByRole("main")
		: page.getByRole("dialog", { name: "Add an Account" });
	await form.getByLabel("Name").fill(name);
	// The card is kept by hand, so a Commitment for it is for a balance being carried.
	await chooseKind(form, kind, "I add them by hand");
	await form.getByLabel("Owed now").fill(owed);
	const saved = savedBy(page, "addAccount");
	await form.getByRole("button", { name: "Add Account" }).click();
	await saved;
	await expect(page.getByRole("link", { name: new RegExp(`^${name}, `) })).toBeVisible();
}

/** Picks a card or loan under "Pays down": its option also carries what's owed. */
async function paysDown(page: Page, form: Locator, name: string) {
	await form.getByRole("combobox", { name: "Pays down", exact: true }).click();
	await page
		.getByRole("listbox")
		.getByRole("option", { name: new RegExp(`^${name}`) })
		.click();
	await expect(page.getByRole("listbox")).toBeHidden();
}

test("Commitments are grouped into credit cards, loans and bills, each with what it takes; only bills has no groups", async ({
	browser,
}) => {
	test.slow();
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, {
		baseline: "6,000",
		buckets: [["Groceries", "1,200"]],
		commitments: [
			{ name: "Fiber internet", amountCents: 7_500, cadence: "monthly", dueDay: 1 },
			{ name: "Water and trash", amountCents: 4_000, cadence: "monthly", dueDay: 1 },
		],
	});
	const month = /\/month\/(\d{4}-\d{2})/.exec(page.url())?.[1];
	await page.setViewportSize({ width: 1280, height: 900 });
	await page.goto(`/plan/${month}/commitments`);
	await expect(page.getByRole("button", { name: "Add Commitment", exact: true })).toBeEnabled();

	// Only plain bills: one list, as before, with no group names.
	await expect(table(page)).toContainText("Fiber internet");
	await expect(groupNames(page)).toHaveCount(0);
	expect(await lines(page)).toEqual(["Fiber internet", "Water and trash"]);
	const foot = table(page).locator("[data-slot=data-table-foot]");
	await expect(foot).toContainText("$115");

	// One that pays down a card kept by hand (so it is for a balance being carried).
	await addAccount(page, "Quartz Rewards Card", "credit-card", "1,800");
	await addAccount(page, "Hatchback Loan", "loan", "9,000");
	await page.goto(`/plan/${month}/commitments`);
	await expect(page.getByRole("button", { name: "Add Commitment", exact: true })).toBeEnabled();
	let form = await openCommitmentForm(page);
	await form.getByLabel("New Commitment").fill("Quartz card payment");
	await form.getByLabel("Amount due").fill("200");
	await paysDown(page, form, "Quartz Rewards Card");
	await form
		.getByRole("checkbox", { name: "This is a set payment on a balance I’m carrying" })
		.check();
	let added = savedBy(page, "addCommitment");
	await form.getByRole("button", { name: "Add Commitment" }).click();
	await added;
	await expect(form).toBeHidden();

	// With two kinds the groups show, the new one in the group its Account puts it in.
	await expect(groupNames(page)).toHaveText(["Credit cards", "Bills"]);

	// And one that pays down a loan.
	form = await openCommitmentForm(page);
	await form.getByLabel("New Commitment").fill("Hatchback payment");
	await form.getByLabel("Amount due").fill("350");
	await paysDown(page, form, "Hatchback Loan");
	added = savedBy(page, "addCommitment");
	await form.getByRole("button", { name: "Add Commitment" }).click();
	await added;
	await expect(form).toBeHidden();

	// Three groups in order, each over its own rows.
	await expect(groupNames(page)).toHaveText(["Credit cards", "Loans", "Bills"]);
	expect(await lines(page)).toEqual([
		"Credit cards",
		"Quartz card payment",
		"Loans",
		"Hatchback payment",
		"Bills",
		"Fiber internet",
		"Water and trash",
	]);
	// Each group's subtotal, and the same total as the whole list's.
	await expect(groupRow(page, "Credit cards")).toContainText("$200");
	await expect(groupRow(page, "Loans")).toContainText("$350");
	await expect(groupRow(page, "Bills")).toContainText("$115");
	await expect(foot).toContainText("$665");
	// The row already says what it pays down.
	const row = (name: string) => table(page).getByRole("row").filter({ hasText: name });
	await expect(row("Quartz card payment")).toContainText("Pays down Quartz Rewards Card");
	await expect(row("Hatchback payment")).toContainText("Pays down Hatchback Loan");

	// The groups are worked out again on a fresh load, from the Accounts the page loads.
	await page.reload();
	await expect(groupNames(page)).toHaveText(["Credit cards", "Loans", "Bills"]);

	// Editing from the table still works, and the group's subtotal follows.
	await expect(async () => {
		const sheet = page.getByRole("dialog", { name: "Hatchback payment" });
		if (!(await sheet.isVisible()))
			await page.getByRole("button", { name: "Edit Hatchback payment" }).click({ timeout: 2_000 });
		await expect(sheet).toBeVisible({ timeout: 2_000 });
	}).toPass();
	const sheet = page.getByRole("dialog", { name: "Hatchback payment" });
	await sheet.getByLabel("Amount", { exact: true }).fill("360");
	const saved = savedBy(page, "updateCommitment");
	await sheet.getByRole("button", { name: "Save", exact: true }).click();
	await saved;
	await expect(sheet).toBeHidden();
	await expect(groupRow(page, "Loans")).toContainText("$360");
	await expect(foot).toContainText("$675");

	// A 320px phone: each group is a short list under its name and subtotal; nothing scrolls sideways.
	await page.setViewportSize({ width: 320, height: 700 });
	await expect(groupNames(page)).toHaveText(["Credit cards", "Loans", "Bills"]);
	for (const name of ["Credit cards", "Loans", "Bills"]) {
		await expect(groupRow(page, name)).toBeVisible();
	}
	await expect(groupRow(page, "Credit cards")).toContainText("$200");
	await expect(groupRow(page, "Loans")).toContainText("$360");
	await expect(groupRow(page, "Bills")).toContainText("$115");
	const size = await measure(page);
	expect(size.scrollWidth).toBeLessThanOrEqual(size.width);
});
