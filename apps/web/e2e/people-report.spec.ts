import { expect, type Page, test } from "@playwright/test";
import { createTestParent } from "./parents";
import {
	choose,
	clientRendered,
	createPlannedHousehold,
	pickQuickAddBucket,
	signedInPage,
} from "./session";

// Reports › People for every Member (issue 155): what was spent For each Child, each Parent and
// For Everyone, by Bucket, this month and the year so far; each figure opens the Transactions
// behind it; and a Bucket's page narrowed by who its Transactions were For.

let parent: Awaited<ReturnType<typeof createTestParent>>;

test.beforeEach(async () => {
	parent = await createTestParent();
});

test.afterEach(async () => {
	await parent?.remove();
});

const sheet = (page: Page) => page.getByRole("dialog", { name: "Quick Add" });
const costOf = (page: Page, name: string) => page.getByRole("region", { name, exact: true });
const inBucket = (page: Page) => page.getByRole("region", { name: /^Transactions in / });
const noSidewaysScroll = async (page: Page) =>
	expect(
		await page.evaluate(
			() => document.documentElement.scrollWidth - document.documentElement.clientWidth,
		),
	).toBeLessThanOrEqual(0);

async function addChild(page: Page, name: string) {
	await page.getByLabel("Add a Child").fill(name);
	await page.getByRole("button", { name: "Add Child" }).click();
	await expect(
		page.getByRole("region", { name: "Children" }).getByRole("listitem").filter({ hasText: name }),
	).toBeVisible();
}

/** A Quick Add with a note, For Everyone unless one person is named. */
async function quickAdd(page: Page, amount: string, bucket: string, note: string, who?: string) {
	await page.getByRole("link", { name: "Quick Add" }).click();
	await expect(sheet(page)).toBeVisible();
	await page.keyboard.type(amount);
	await sheet(page).getByLabel("Note").fill(note);
	if (who) {
		await sheet(page)
			.getByRole("button", { name: /^For: / })
			.click();
		await sheet(page)
			.getByRole("radiogroup", { name: "For" })
			.getByRole("radio", { name: who })
			.click();
	}
	await pickQuickAddBucket(sheet(page), bucket);
	await expect(sheet(page)).toBeHidden();
}

test("Reports › People shows every Member and Everyone by Bucket, and each figure opens its Transactions", async ({
	browser,
}) => {
	test.slow();
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, {
		baseline: "5,000",
		buckets: [
			["Health", "600"],
			["Food", "1,200"],
		],
	});
	await page.goto("/household");
	await expect(page.getByRole("heading", { name: "Children" })).toBeVisible();
	await addChild(page, "Maya");
	await addChild(page, "Leo");

	// For one Child, one Parent, two people together, and Everyone, in two Buckets.
	await quickAdd(page, "64", "Health", "Dentist", "Maya");
	await quickAdd(page, "90", "Health", "Physio", "Alex");
	await quickAdd(page, "30", "Health", "Pharmacy", "Maya");
	await quickAdd(page, "20", "Health", "Checkup");
	await quickAdd(page, "186.42", "Food", "Groceries");
	await quickAdd(page, "25", "Food", "Lunches", "Leo");

	// The pharmacy was for both Children: a Transaction's editor takes several people.
	await page.goto("/transactions");
	await page
		.getByRole("grid", { name: /^Transactions in / })
		.getByRole("button", { name: /^Pharmacy, / })
		.click();
	const edit = page
		.locator("[role=dialog], [data-slot=transaction-detail]")
		.filter({ has: page.getByRole("heading", { name: "Edit Transaction" }) });
	await edit.getByRole("toolbar", { name: "For" }).getByRole("button", { name: "Leo" }).click();
	await edit.getByRole("button", { name: "Save" }).click();
	await expect(
		page
			.getByRole("grid", { name: /^Transactions in / })
			.getByRole("button", { name: /^Pharmacy, .*For Maya & Leo/ }),
	).toBeVisible();

	// Every Member has an entry, Children first, and Everyone its own: nothing is counted twice.
	await page.goto("/reports?view=people");
	await expect(
		page.getByRole("heading", { name: "Where the money went for each person, by Bucket" }),
	).toBeVisible(clientRendered);
	const costs = page.getByRole("region", {
		name: "Where the money went for each person, by Bucket",
	});
	await expect(costs.getByRole("heading", { level: 3 })).toHaveText([
		"Maya",
		"Leo",
		"Alex",
		"Everyone",
	]);
	// Each row is the Bucket, this month, and the year so far. The shared $30 is $15 each.
	const row = (name: string, bucket: string) =>
		costOf(page, name).getByRole("row", { name: new RegExp(`^${bucket}`) });
	await expect(row("Maya", "Health")).toHaveText(/Health\$79\$79/);
	await expect(row("Maya", "Total")).toHaveText(/Total\$79\$79/);
	await expect(costOf(page, "Maya").getByRole("row", { name: /^Food/ })).toHaveCount(0);
	await expect(row("Leo", "Health")).toHaveText(/Health\$15\$15/);
	await expect(row("Leo", "Food")).toHaveText(/Food\$25\$25/);
	await expect(row("Leo", "Total")).toHaveText(/Total\$40\$40/);
	await expect(row("Alex", "Health")).toHaveText(/Health\$90\$90/);
	await expect(row("Alex", "Total")).toHaveText(/Total\$90\$90/);
	await expect(row("Everyone", "Food")).toHaveText(/Food\$186\.42\$186\.42/);
	await expect(row("Everyone", "Health")).toHaveText(/Health\$20\$20/);
	// $79 + $40 + $90 + $206.42 is the $415.42 spent.
	await expect(row("Everyone", "Total")).toHaveText(/Total\$206\.42\$206\.42/);

	// This month's figure opens the Bucket's page narrowed to who it was For.
	await costOf(page, "Maya")
		.getByRole("link", { name: /^Maya, Health, (?!\d{4} so far).*See the Transactions$/ })
		.click();
	await expect(page).toHaveURL(/\/plan\/\d{4}-\d{2}\/buckets\/[0-9A-Z]+\?for=[0-9A-Z]+$/);
	const narrowed = page.url();
	const rows = inBucket(page).getByRole("listitem");
	await expect(rows).toHaveCount(2);
	await expect(inBucket(page).getByRole("button", { name: /^Dentist, / })).toContainText("$64");
	await expect(inBucket(page).getByRole("button", { name: /^Pharmacy, / })).toContainText("$30");
	// $64 and half of the $30 are the $79 of the figure.
	const part = inBucket(page).locator("[data-slot=bucket-for-part]");
	await expect(part).toHaveText(
		/^For Maya: \$79 of the \$204 spent from it in \w+\. Spending for several people counts evenly for each\.$/,
	);

	// The page offers who had spending there, and Everyone; the choice is kept in the address.
	await inBucket(page).getByRole("combobox", { name: "For", exact: true }).click();
	await expect(page.getByRole("listbox").getByRole("option")).toHaveText([
		"Anyone",
		"Maya",
		"Alex",
		"Leo",
		"Everyone",
	]);
	await page.keyboard.press("Escape");
	await choose(inBucket(page), "For", "Alex");
	await expect(rows).toHaveCount(1);
	await expect(inBucket(page).getByRole("button", { name: /^Physio, / })).toContainText("$90");
	await expect(part).toHaveText(/^For Alex: \$90 of the \$204 spent from it in \w+\.$/);
	await choose(inBucket(page), "For", "Everyone");
	await expect(page).toHaveURL(/\?for=everyone$/);
	await expect(rows).toHaveCount(1);
	await expect(inBucket(page).getByRole("button", { name: /^Checkup, / })).toContainText("$20");
	await expect(part).toHaveText(/^For Everyone: \$20 of the \$204 /);
	await choose(inBucket(page), "For", "Anyone");
	await expect(page).not.toHaveURL(/for=/);
	await expect(rows).toHaveCount(4);

	// The year's figure opens Transactions for that person, Bucket and year.
	await page.goto("/reports?view=people");
	await costOf(page, "Leo")
		.getByRole("link", { name: /^Leo, Food, \d{4} so far: \$25\. See the Transactions$/ })
		.click(clientRendered);
	await expect(page).toHaveURL(/\/transactions\/\d{4}-\d{2}\?.*range=year/);
	await expect(page).toHaveURL(/bucket=[0-9A-Z]+/);
	await expect(page).toHaveURL(/for=[0-9A-Z]+/);
	const list = page.getByRole("grid", { name: /^Transactions in / });
	await expect(list.getByRole("button", { name: /^Lunches, \$25, / })).toBeVisible();
	await expect(list.getByRole("button", { name: /^(Groceries|Pharmacy|Dentist), / })).toHaveCount(
		0,
	);

	// On a phone each person is a stacked list, and nothing runs off the side.
	await page.setViewportSize({ width: 320, height: 700 });
	await page.goto("/reports?view=people");
	const leo = page.getByRole("list", { name: "Where the money went for Leo, by Bucket" });
	await expect(leo).toBeVisible(clientRendered);
	await expect(leo.getByRole("listitem").filter({ hasText: "Food" })).toContainText(
		"This month $25",
	);
	await expect(
		page.getByRole("list", { name: "Where the money went for Everyone, by Bucket" }),
	).toContainText("This year $186.42");
	await noSidewaysScroll(page);
	await page.goto(narrowed);
	await expect(inBucket(page).locator("[data-slot=bucket-for-part]")).toContainText(
		"For Maya: $79",
	);
	await noSidewaysScroll(page);
	await page.context().close();
});
