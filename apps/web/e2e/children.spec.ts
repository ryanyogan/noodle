import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { createTestParent } from "./parents";
import {
	clientRendered,
	createPlannedHousehold,
	pickQuickAddBucket,
	signedInPage,
} from "./session";

let parent: Awaited<ReturnType<typeof createTestParent>>;

test.beforeEach(async () => {
	parent = await createTestParent();
});

test.afterEach(async () => {
	await parent?.remove();
});

const children = (page: Page) =>
	page.getByRole("region", { name: "Children" }).getByRole("listitem");
const sheet = (page: Page) => page.getByRole("dialog", { name: "Quick Add" });
const costOf = (page: Page, name: string) => page.getByRole("region", { name, exact: true });

async function expectNoAxeViolations(page: Page, what: string) {
	const { violations } = await new AxeBuilder({ page })
		.withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
		.analyze();
	expect(
		violations.map((v) => `${v.id}: ${v.help}`),
		`${what}: axe violations`,
	).toEqual([]);
}

async function goToHousehold(page: Page) {
	await page.goto("/household");
	await expect(page.getByRole("heading", { name: "Children" })).toBeVisible();
}

async function addChild(page: Page, name: string) {
	await page.getByLabel("Add a Child").fill(name);
	await page.getByRole("button", { name: "Add Child" }).click();
	await expect(children(page).filter({ hasText: name })).toBeVisible();
}

/** Opens Quick Add, types an amount, picks who it was For, then the Bucket. */
async function quickAdd(page: Page, amount: string, bucket: string, forName?: string) {
	await page.getByRole("link", { name: "Quick Add" }).click();
	await expect(sheet(page)).toBeVisible();
	await page.keyboard.type(amount);
	if (forName) {
		await sheet(page)
			.getByRole("button", { name: /^For: / })
			.click();
		await sheet(page)
			.getByRole("radiogroup", { name: "For" })
			.getByRole("radio", { name: forName })
			.click();
	}
	await pickQuickAddBucket(sheet(page), bucket);
	await expect(sheet(page)).toBeHidden();
}

test("a Parent adds, renames, recolours, and removes Children", async ({ browser }) => {
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, { baseline: "5,000", buckets: [["Fun", "200"]] });
	await goToHousehold(page);
	await addChild(page, "Maya");
	await addChild(page, "Leo");
	await expect(children(page)).toHaveCount(2);

	// The pencil opens the Child's sheet (#51): name and colour, saved together.
	await page.getByRole("button", { name: "Edit Leo" }).click();
	const leoSheet = page.getByRole("dialog", { name: "Leo" });
	await expect(leoSheet).toBeVisible();
	await expectNoAxeViolations(page, "Child sheet");
	await leoSheet.getByLabel("Name").fill("Leon");
	await leoSheet.getByRole("radio", { name: "Violet" }).check();
	await leoSheet.getByRole("button", { name: "Save" }).click();
	await expect(leoSheet).toBeHidden();
	await expect(page.getByRole("button", { name: "Edit Leon" })).toBeVisible();

	await page.reload();
	await expect(page.getByRole("button", { name: "Edit Leon" })).toBeVisible();
	await page.getByRole("button", { name: "Edit Leon" }).click();
	await expect(
		page.getByRole("dialog", { name: "Leon" }).getByRole("radio", { name: "Violet" }),
	).toBeChecked();
	await page.keyboard.press("Escape");

	await page.getByRole("button", { name: "Edit Maya" }).click();
	const maya = page.getByRole("dialog", { name: "Maya" });
	await maya.getByRole("button", { name: "Remove", exact: true }).click();
	await page.getByRole("button", { name: "Remove Maya" }).click();
	await expect(maya).toBeHidden();
	await expect(children(page)).toHaveCount(1);
	await page.reload();
	await expect(children(page)).toHaveCount(1);
	await expect(children(page)).toContainText("Leon");

	// A removed Child can't be picked for new spending.
	await page.getByRole("link", { name: "Quick Add" }).click();
	await sheet(page)
		.getByRole("button", { name: /^For: / })
		.click();
	const forPicker = sheet(page).getByRole("radiogroup", { name: "For" });
	await expect(forPicker.getByRole("radio", { name: "Leon" })).toBeVisible();
	await expect(forPicker.getByRole("radio", { name: "Maya" })).toHaveCount(0);
	await page.context().close();
});

test("Quick Add is For Everyone unless a Child is picked, and each Child's cost is in Reports", async ({
	browser,
}) => {
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, {
		baseline: "5,000",
		buckets: [
			["Groceries", "1,200"],
			["Hockey", "400"],
			["Fun", "200"],
		],
	});
	await goToHousehold(page);
	await addChild(page, "Maya");
	await addChild(page, "Leo");

	// Everyone, then each Child, then each Parent; Everyone is picked to start with.
	await page.keyboard.press("q");
	await sheet(page)
		.getByRole("button", { name: /^For: / })
		.click();
	const forPicker = sheet(page).getByRole("radiogroup", { name: "For" });
	await expect(forPicker.getByRole("radio")).toHaveText(["Everyone", "Maya", "Leo", "Alex"]);
	await expect(forPicker.getByRole("radio", { name: "Everyone" })).toHaveAttribute(
		"aria-checked",
		"true",
	);
	await page.keyboard.press("Escape");
	await page.keyboard.press("Escape");

	await quickAdd(page, "64.99", "Hockey", "Leo");
	await quickAdd(page, "20", "Fun", "Leo");
	await quickAdd(page, "186.42", "Groceries");

	// What a Child cost is a report: Household links to it in Reports › People, filtered to them.
	await expect(page.getByRole("heading", { name: "What each Child cost" })).toHaveCount(0);
	await children(page).getByRole("link", { name: "See what Leo costs" }).click();
	await expect(page).toHaveURL(/\/reports\?.*view=people.*member=/);
	const leo = costOf(page, "Leo");
	await expect(leo.getByRole("row", { name: /^Hockey/ })).toHaveText(/Hockey\$64\.99\$64\.99/);
	await expect(leo.getByRole("row", { name: /^Fun/ })).toHaveText(/Fun\$20\$20/);
	await expect(leo.getByRole("row", { name: /^Total/ })).toHaveText(/Total\$84\.99\$84\.99/);
	// Filtered to Leo, Maya's costs aren't shown.
	await expect(costOf(page, "Maya")).toHaveCount(0);
	// Groceries for Everyone is the Household's, not counted under either Child.
	await expect(page.getByText(/^Spending For Everyone counts once/)).toContainText(
		"$186.42 this month",
	);

	// A full load of Reports is slow on a cold dev server (see clientRendered).
	await page.goto("/reports?view=people");
	await expect(costOf(page, "Maya")).toContainText("Nothing yet", clientRendered);
	await expect(costOf(page, "Leo").getByRole("row", { name: /^Total/ })).toHaveText(
		/Total\$84\.99\$84\.99/,
	);
	await page.context().close();
});
