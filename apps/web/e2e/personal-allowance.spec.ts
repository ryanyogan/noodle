import { expect, type Page, test } from "@playwright/test";
import { createTestParent } from "./parents";
import { createPlannedHousehold, serverFn, signedInPage } from "./session";

const nav = (page: Page) => page.getByRole("navigation", { name: "Main" });
const quickAddSheet = (page: Page) => page.getByRole("dialog", { name: "Quick Add" });
const editSheet = (page: Page) => page.getByRole("dialog", { name: "Edit Transaction" });
const list = (page: Page) => page.getByRole("list", { name: /^Transactions in / });
const bucketRow = (page: Page, name: string) =>
	page.getByRole("listitem", { name: new RegExp(`^${name}: `) });

const ALEX_PA = "Alex’s Personal Allowance";
const SAM_PA = "Sam’s Personal Allowance";
const ULID = /[0-9A-HJKMNP-TV-Z]{26}/g;

async function quickAdd(page: Page, amount: string, bucket: string, note: string) {
	await page.getByRole("link", { name: "Quick Add" }).click();
	await expect(quickAddSheet(page)).toBeVisible();
	await page.keyboard.type(amount);
	await quickAddSheet(page).getByLabel("Note").fill(note);
	await quickAddSheet(page)
		.getByRole("button", { name: new RegExp(`^${bucket}`) })
		.click();
	await expect(quickAddSheet(page)).toBeHidden();
}

/** Sets up the signed-in Parent's Personal Allowance from the Plan editor; ends on This Month. */
async function setUpPersonalAllowance(page: Page, amount: string, name: string) {
	await nav(page).getByRole("link", { name: "This Month" }).click();
	await page.getByRole("link", { name: "Edit Plan" }).click();
	await page.getByLabel("Your Personal Allowance").fill(amount);
	await page.getByRole("button", { name: "Set up Personal Allowance" }).click();
	await expect(page.getByLabel(`${name} allowance`)).toHaveValue(amount);
	await expect(page.getByRole("button", { name: "Set up Personal Allowance" })).toHaveCount(0);
	await page.getByRole("link", { name: "Back to This Month" }).click();
	await expect(page.getByRole("heading", { level: 1 })).toContainText("This Month");
}

async function openTransactions(page: Page) {
	await nav(page).getByRole("link", { name: "Transactions" }).click();
	await expect(page.getByRole("heading", { level: 1 })).toContainText("Transactions");
}

test("a Personal Allowance's Transactions never reach the other Parent; its totals do", async ({
	browser,
}) => {
	const first = await createTestParent();
	const second = await createTestParent();
	try {
		const alex = await signedInPage(browser, first.email);
		await createPlannedHousehold(alex, { baseline: "5,000", buckets: [["Groceries", "1,200"]] });
		await nav(alex).getByRole("link", { name: "Household" }).click();
		await alex.getByLabel("Their email").fill(second.email);
		await alex.getByRole("button", { name: /^Invite/ }).click();
		await expect(alex.getByText(`Invited ${second.email}`)).toBeVisible();

		const sam = await signedInPage(browser, second.email);
		// Everything Sam's browser is sent about the month and its Transactions.
		const samResponses: Promise<string>[] = [];
		sam.on("response", (response) => {
			const url = new URL(response.url());
			if (serverFn("getMonth")(url) || serverFn("getTransactions")(url)) {
				samResponses.push(response.text());
			}
		});
		await sam.goto("/welcome");
		await sam.getByLabel("Your name").fill("Sam");
		await sam.getByRole("button", { name: "Join The Rinks" }).click();
		await expect(sam.getByRole("heading", { level: 1 })).toContainText("This Month");

		// Each Parent sets their own; each sees the other's amount but can't change it.
		await setUpPersonalAllowance(alex, "150", ALEX_PA);
		await sam.getByRole("link", { name: "Edit Plan" }).click();
		await expect(sam.getByLabel(`${ALEX_PA} allowance`)).toHaveValue("150");
		await expect(sam.getByLabel(`${ALEX_PA} allowance`)).toHaveAttribute("readonly", "");
		await expect(sam.getByRole("button", { name: `Edit ${ALEX_PA}` })).toHaveCount(0);
		await setUpPersonalAllowance(sam, "100", SAM_PA);

		// Alex spends from his, and moves a Groceries purchase into it.
		const giftRequests: string[] = [];
		alex.on("request", (request) => {
			if (serverFn("addQuickAdd")(new URL(request.url())) && request.postData()?.includes("gift")) {
				giftRequests.push(request.postData() ?? "");
			}
		});
		await nav(alex).getByRole("link", { name: "This Month" }).click();
		await quickAdd(alex, "42", ALEX_PA, "Birthday gift for Sam");
		await quickAdd(alex, "20", "Groceries", "Flowers");
		await quickAdd(alex, "10", "Groceries", "Milk");
		await openTransactions(alex);
		await list(alex)
			.getByRole("button", { name: /^Flowers,/ })
			.click();
		await editSheet(alex).getByLabel("Assigned to").selectOption({ label: ALEX_PA });
		await editSheet(alex).getByRole("button", { name: "Save" }).click();
		await expect(editSheet(alex)).toBeHidden();
		await expect(list(alex).getByRole("button", { name: /^Flowers,/ })).toHaveAccessibleName(
			`Flowers, $20, ${ALEX_PA}, For Everyone`,
		);
		await expect(list(alex).getByRole("button", { name: /^Birthday gift for Sam,/ })).toBeVisible();

		// Sam sees both Personal Allowances' totals, and only his own drills into Transactions.
		await nav(sam).getByRole("link", { name: "This Month" }).click();
		await expect(bucketRow(sam, ALEX_PA)).toHaveAccessibleName(
			`${ALEX_PA}: $88 left of $150, private`,
		);
		await expect(bucketRow(sam, ALEX_PA)).toContainText("$62 spent");
		await expect(bucketRow(sam, ALEX_PA).getByRole("link")).toHaveCount(0);
		await expect(bucketRow(sam, SAM_PA)).toHaveAccessibleName(`${SAM_PA}: $100 left of $100`);
		await expect(bucketRow(sam, SAM_PA).getByRole("link", { name: SAM_PA })).toBeVisible();
		await expect(bucketRow(sam, "Groceries")).toContainText("$10 spent");

		// Sam's Quick Add offers his own Personal Allowance, never Alex's.
		await sam.getByRole("link", { name: "Quick Add" }).click();
		await expect(quickAddSheet(sam).getByRole("button", { name: /^Sam’s Personal/ })).toBeVisible();
		await expect(quickAddSheet(sam).getByRole("button", { name: /^Alex’s Personal/ })).toHaveCount(
			0,
		);
		await sam.keyboard.press("Escape");
		await expect(quickAddSheet(sam)).toBeHidden();

		// Sam's Transactions: Alex's Groceries purchase, nothing from Alex's Personal Allowance.
		await openTransactions(sam);
		await expect(list(sam).getByRole("button")).toHaveCount(1);
		await expect(list(sam).getByRole("button")).toHaveAccessibleName(
			"Milk, $10, Groceries, For Everyone",
		);
		await expect(sam.getByLabel("Bucket").locator("option")).toHaveText([
			"All Buckets",
			"Groceries",
			SAM_PA,
		]);
		await list(sam)
			.getByRole("button", { name: /^Milk,/ })
			.click();
		await expect(
			editSheet(sam).getByLabel("Assigned to").locator("option", { hasText: ALEX_PA }),
		).toHaveCount(0);
		await sam.keyboard.press("Escape");

		// Nor was any of it sent to Sam's browser: not a note, not a Transaction ID.
		const sent = await Promise.all(samResponses);
		expect(sent.some((body) => body.includes("Milk"))).toBe(true);
		for (const body of sent) {
			expect(body).not.toContain("Birthday gift");
			expect(body).not.toContain("Flowers");
		}
		// The gift's Quick Add named two IDs: its Personal Allowance, which Sam's Plan does name,
		// and the Transaction's own, which nothing sent to Sam does.
		const giftIds = [...new Set(giftRequests.join(" ").match(ULID) ?? [])];
		expect(giftIds).toHaveLength(2);
		expect(giftIds.filter((id) => sent.some((body) => body.includes(id)))).toHaveLength(1);

		await Promise.all([alex.context().close(), sam.context().close()]);
	} finally {
		await Promise.all([first.remove(), second.remove()]);
	}
});
