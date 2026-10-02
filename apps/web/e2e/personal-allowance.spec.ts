import { expect, type Page, test } from "@playwright/test";
import { createTestParent } from "./parents";
import {
	choose,
	createPlannedHousehold,
	enterJoinedHousehold,
	serverFn,
	signedInPage,
	switchTo,
} from "./session";

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

/** Opens this month's Buckets in the Plan, from This Month. */
async function openPlanBuckets(page: Page) {
	await switchTo(page, "Plan");
	await page
		.getByRole("navigation", { name: "Plan pages" })
		.getByRole("link", { name: "Buckets", exact: true })
		.click();
	await expect(page.locator("[data-slot=page-header]")).toContainText("Buckets");
}

/** A Bucket's row in the Plan. */
const planRow = (page: Page, name: string) => page.getByRole("listitem").filter({ hasText: name });

/** Sets up the signed-in Parent's Personal Allowance from the Plan; ends on This Month. */
async function setUpPersonalAllowance(page: Page, amount: string, name: string) {
	await nav(page).getByRole("link", { name: "This Month" }).click();
	await openPlanBuckets(page);
	await page.getByLabel("Your Personal Allowance").fill(amount);
	await page.getByRole("button", { name: "Set up Personal Allowance" }).click();
	await expect(page.getByRole("button", { name: `Edit ${name}` })).toBeVisible();
	await expect(planRow(page, name)).toContainText(`$${amount}`);
	await expect(page.getByRole("button", { name: "Set up Personal Allowance" })).toHaveCount(0);
	await page.getByRole("link", { name: "Back to Plan" }).click();
	await switchTo(page, "Month");
}

async function openTransactions(page: Page) {
	await nav(page).getByRole("link", { name: "Transactions" }).click();
	await expect(page.locator("[data-slot=page-header]")).toContainText("Transactions");
}

test("a Personal Allowance's Transactions never reach the other Parent; its totals do", async ({
	browser,
}) => {
	// Two Parents sign in and each set up a Personal Allowance before any spending: over 30 s even
	// run alone.
	test.slow();
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
		await enterJoinedHousehold(sam);
		await expect(sam.locator("[data-slot=page-header]")).toContainText("This Month");

		// Each Parent sets their own; each sees the other's amount but can't change it.
		await setUpPersonalAllowance(alex, "150", ALEX_PA);
		await openPlanBuckets(sam);
		await expect(planRow(sam, ALEX_PA)).toContainText("$150");
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
		await choose(editSheet(alex), "Assigned to", ALEX_PA);
		await editSheet(alex).getByRole("button", { name: "Save" }).click();
		await expect(editSheet(alex)).toBeHidden();
		await expect(list(alex).getByRole("button", { name: /^Flowers,/ })).toHaveAccessibleName(
			`Flowers, $20, ${ALEX_PA}, For Everyone`,
		);
		await expect(list(alex).getByRole("button", { name: /^Birthday gift for Sam,/ })).toBeVisible();

		// A Target run: $70 of groceries, $30 of it a gift from his Personal Allowance.
		await nav(alex).getByRole("link", { name: "This Month" }).click();
		await quickAdd(alex, "100", "Groceries", "Target run");
		await openTransactions(alex);
		await list(alex)
			.getByRole("button", { name: /^Target run,/ })
			.click();
		await editSheet(alex).getByRole("button", { name: "Split", exact: true }).click();
		const split = (n: number) =>
			editSheet(alex).getByRole("group", { name: `Split ${n}`, exact: true });
		await split(1).getByLabel("Amount").fill("70");
		await choose(split(2), "Assigned to", ALEX_PA);
		await split(2).getByLabel("Amount").fill("30");
		await editSheet(alex).getByRole("button", { name: "Save" }).click();
		await expect(editSheet(alex)).toBeHidden();
		await expect(list(alex).getByRole("button", { name: /^Target run,/ })).toHaveAccessibleName(
			`Target run, $100, Split across 2: Groceries, ${ALEX_PA}`,
		);

		// Sam sees both Personal Allowances' totals.
		await nav(sam).getByRole("link", { name: "This Month" }).click();
		// Early in a month $92 of $150 is ahead of pace; later it isn't.
		await expect(bucketRow(sam, ALEX_PA)).toHaveAccessibleName(
			new RegExp(`^${ALEX_PA}: \\$58 left of \\$150(, ahead of pace)?, private$`),
		);
		await expect(bucketRow(sam, ALEX_PA)).toContainText("$92 spent");
		await expect(bucketRow(sam, SAM_PA)).toHaveAccessibleName(`${SAM_PA}: $100 left of $100`);
		await expect(bucketRow(sam, SAM_PA).getByRole("link", { name: SAM_PA })).toBeVisible();
		await expect(bucketRow(sam, "Groceries")).toContainText("$80 spent");

		// Alex's Personal Allowance has a page for Sam too: its totals, and nothing spent from it.
		await bucketRow(sam, ALEX_PA).getByRole("link", { name: ALEX_PA }).click();
		await expect(sam.locator("[data-slot=page-header]")).toContainText(ALEX_PA);
		const thisMonth = sam.getByRole("region", { name: "Left this month" });
		await expect(thisMonth).toContainText("$58");
		await expect(thisMonth).toContainText("$92");
		await expect(sam.getByText("only its Parent sees what’s spent from it")).toBeVisible();
		await expect(sam.getByRole("main")).not.toContainText("Target run");
		await expect(sam.getByRole("button", { name: "Edit", exact: true })).toHaveCount(0);
		await nav(sam).getByRole("link", { name: "This Month" }).click();

		// Sam's Quick Add offers his own Personal Allowance, never Alex's.
		await sam.getByRole("link", { name: "Quick Add" }).click();
		await expect(quickAddSheet(sam).getByRole("button", { name: /^Sam’s Personal/ })).toBeVisible();
		await expect(quickAddSheet(sam).getByRole("button", { name: /^Alex’s Personal/ })).toHaveCount(
			0,
		);
		await sam.keyboard.press("Escape");
		await expect(quickAddSheet(sam)).toBeHidden();

		// Sam's Transactions: Alex's Groceries purchases, nothing from Alex's Personal Allowance.
		await openTransactions(sam);
		await expect(list(sam).getByRole("button")).toHaveCount(2);
		await expect(list(sam).getByRole("button", { name: /^Milk,/ })).toHaveAccessibleName(
			"Milk, $10, Groceries, For Everyone",
		);
		// The Target run as only its Groceries Split, without its note; Sam can't change it.
		const targetRun = list(sam).getByRole("button", { name: /^Quick Add,/ });
		await expect(targetRun).toHaveAccessibleName("Quick Add, $70, Split across 1: Groceries");
		await targetRun.click();
		const shown = sam.getByRole("dialog", { name: "Transaction", exact: true });
		await expect(
			shown.getByText("Part of this is in Alex’s Personal Allowance, so only Alex can change it."),
		).toBeVisible();
		await expect(shown).toContainText("$70");
		await expect(shown).not.toContainText("$30");
		await expect(shown.getByRole("button", { name: /Save|Delete|Split/ })).toHaveCount(0);
		await expect(shown.getByRole("textbox")).toHaveCount(0);
		await sam.keyboard.press("Escape");
		await expect(shown).toBeHidden();
		await sam.getByRole("combobox", { name: "Bucket", exact: true }).click();
		await expect(sam.getByRole("listbox").getByRole("option")).toHaveText([
			"All Buckets",
			"Groceries",
			SAM_PA,
		]);
		await sam.keyboard.press("Escape");
		await list(sam)
			.getByRole("button", { name: /^Milk,/ })
			.click();
		await editSheet(sam).getByRole("combobox", { name: "Assigned to" }).click();
		await expect(sam.getByRole("listbox").getByRole("option").first()).toBeVisible();
		await expect(sam.getByRole("listbox").getByRole("option", { name: ALEX_PA })).toHaveCount(0);
		await sam.keyboard.press("Escape");
		await expect(sam.getByRole("listbox")).toBeHidden();
		await sam.keyboard.press("Escape");

		// Nor was any of it sent to Sam's browser: not a note, not a Transaction ID.
		const sent = await Promise.all(samResponses);
		expect(sent.some((body) => body.includes("Milk"))).toBe(true);
		for (const body of sent) {
			expect(body).not.toContain("Birthday gift");
			expect(body).not.toContain("Flowers");
			expect(body).not.toContain("Target run");
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
