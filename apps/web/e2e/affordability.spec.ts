import { expect, type Page, test } from "@playwright/test";
import { createTestParent } from "./parents";
import { currentTab, expectSectionHeaderKept, markSectionHeader } from "./section";
import {
	accountKindLabel,
	choose,
	clientRendered,
	createPlannedHousehold,
	signedInPage,
	switchTo,
} from "./session";

let parent: Awaited<ReturnType<typeof createTestParent>>;

test.beforeEach(async () => {
	parent = await createTestParent();
});

test.afterEach(async () => {
	await parent?.remove();
});

const verdict = (page: Page) => page.getByTestId("affordability-verdict");
const reasons = (page: Page) => verdict(page).getByRole("list", { name: "Reasons" });

test("a home is checked against the Plan, then made a Goal and explored as a Scenario", async ({
	browser,
}) => {
	const page = await signedInPage(browser, parent.email);
	// $10,000 − $1,200 − $400: $8,400 Free to Spend a month.
	await createPlannedHousehold(page, {
		baseline: "10,000",
		buckets: [
			["Groceries", "1,200"],
			["Hockey", "400"],
		],
	});

	// A savings Account to back a Goal.
	await page.getByRole("link", { name: "Accounts", exact: true }).click();
	await page.getByLabel("Name").fill("Ally savings");
	await choose(page, "Kind", accountKindLabel("savings"));
	await page.getByLabel("Balance now").fill("100,000");
	await page.getByRole("button", { name: "Add Account" }).click();
	await expect(page.getByRole("link", { name: /^Ally savings, Savings/ })).toBeVisible();

	await page.getByRole("link", { name: "Explore", exact: true }).click();
	// Only the page below the tabs changes: the header is the same node.
	await markSectionHeader(page);
	await page.getByRole("link", { name: "Can we afford it?" }).click();
	await expect(currentTab(page, "Explore pages")).toHaveText("Can we afford it?");
	await expectSectionHeaderKept(page);

	// The defaults: a $400,000 home, 20% down, 6.5% over 30 years, against gross income
	// estimated from take-home pay ($10,000 is 75% of $13,333). Nothing is set aside yet.
	await expect(verdict(page)).toContainText("A $400,000 home");
	await expect(verdict(page).getByRole("heading", { level: 2 })).toHaveText("Not yet");
	await expect(reasons(page)).toContainText(
		"You have $0 set aside for the $80,000 down payment and about $12,000 in closing costs, $92,000 short. Setting aside all $8,400 of Free to Spend each month, that’s 11 months",
	);
	await expect(reasons(page)).toContainText(
		"Housing would be $2,589 a month, 19.4% of your pay before tax, within the usual 28%.",
	);
	await expect(reasons(page)).toContainText(
		"Housing of $2,589 a month would take Free to Spend from $8,400 to $5,811 a month.",
	);
	await expect(verdict(page).getByRole("row", { name: /^Housing/ })).toContainText("$2,589.29");

	// With the cash set aside, it's Comfortable.
	const otherCash = page.getByLabel("Other savings you’d use");
	await otherCash.fill("95,000");
	await otherCash.press("Enter");
	await expect(verdict(page).getByRole("heading", { level: 2 })).toHaveText("Comfortable");
	await expect(reasons(page)).toContainText(
		"You have $95,000 set aside for the $80,000 down payment",
	);

	// A lower income makes it a Stretch.
	const gross = page.getByLabel("Gross income a month");
	await gross.fill("8,800");
	await gross.press("Enter");
	await expect(verdict(page).getByRole("heading", { level: 2 })).toHaveText("Stretch");
	await expect(reasons(page)).toContainText("29.4% of your pay before tax: above the usual 28%");

	// One tap makes it a Goal.
	await verdict(page).getByRole("button", { name: "Make it a Goal" }).click();
	await expect(page.getByText("“Home down payment” is now a Goal")).toBeVisible();

	// And one tap explores it as a Scenario.
	await verdict(page).getByRole("button", { name: "Explore as a Scenario" }).click();
	await expect(page.getByRole("heading", { level: 1 })).toHaveText("Explore");
	await expect(page.getByLabel("Name", { exact: true })).toHaveValue("$400,000 home");
	await expect(page.getByText(/New home \$2,589\.29 a month from/)).toBeVisible();
	// It's saved: still there after a reload.
	await page.reload();
	await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
		"$400,000 home",
		clientRendered,
	);

	// The Goal is there to fund, undated as the cash is ready now.
	await page.getByRole("link", { name: "Goals", exact: true }).click();
	await expect(
		page.getByRole("link", { name: /^Home down payment, \$0 of \$92,000/ }),
	).toBeVisible();
});

test("a car compares cash, a loan and a lease; anything counts the months to save", async ({
	browser,
}) => {
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, { baseline: "10,000", buckets: [["Groceries", "1,600"]] });
	await page.goto("/explore/afford?kind=car");

	await expect(verdict(page)).toContainText("A $35,000 car, with a loan", clientRendered);
	const monthly = verdict(page).getByRole("row", { name: /^A month/ });
	// Cash, then $30,000 at 7% over 60 months, then the lease.
	await expect(monthly).toHaveText("A month$0$594.04$450");

	await choose(page, "Pay by", "Lease");
	await expect(verdict(page)).toContainText("A $35,000 car, leased");

	await page.getByRole("link", { name: "Anything" }).click();
	await page.getByLabel("Name", { exact: true }).fill("New sofa");
	const price = page.getByLabel("Price");
	await price.fill("20,000");
	await price.press("Enter");
	// $8,400 a month: 3 months of saving.
	await expect(verdict(page)).toContainText("New sofa, $20,000");
	await expect(verdict(page).getByRole("heading", { level: 2 })).toHaveText("Stretch");
	await expect(verdict(page).getByRole("row", { name: /^Still to save/ })).toContainText("$20,000");
	await expect(verdict(page).getByRole("button", { name: "Explore as a Scenario" })).toHaveCount(0);
});

test("a long Commitment name keeps every field of the form in its column", async ({ browser }) => {
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, { baseline: "10,000", buckets: [["Groceries", "1,200"]] });
	// A Commitment with a name as long as a name may be.
	const longName = "Maya’s braces — Dr. Patel’s orthodontics";
	await switchTo(page, "Plan");
	await page
		.getByRole("navigation", { name: "Plan pages" })
		.getByRole("link", { name: "Commitments", exact: true })
		.click();
	const addCommitment = page.getByRole("form", { name: "Add a Commitment" });
	await addCommitment.getByLabel("New Commitment").fill(longName);
	await addCommitment.getByLabel("Amount due").fill("210");
	await addCommitment.getByRole("button", { name: "Add Commitment" }).click();
	await expect(page.getByRole("button", { name: `Edit ${longName}` })).toBeVisible();

	await page.getByRole("link", { name: "Explore", exact: true }).click();
	await page.getByRole("link", { name: "Can we afford it?" }).click();
	await expect(currentTab(page, "Explore pages")).toHaveText("Can we afford it?");
	// Every field stays inside the form's card, at desktop and phone widths.
	// The Commitments are summed up; Edit lists each.
	await page.getByRole("button", { name: "Edit Commitments" }).click();
	for (const width of [1280, 393]) {
		await page.setViewportSize({ width, height: 900 });
		await expect(page.getByLabel(`${longName} is`)).toBeVisible();
		const clipped = await page.evaluate(
			() =>
				[...document.querySelectorAll("main input, main select")].filter((field) => {
					const card = field.closest("[data-slot=card]");
					return (
						card && field.getBoundingClientRect().right > card.getBoundingClientRect().right + 1
					);
				}).length,
		);
		expect(clipped).toBe(0);
	}
	await page.context().close();
});
