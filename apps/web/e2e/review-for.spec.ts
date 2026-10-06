import { expect, test } from "@playwright/test";
import { ulid } from "ulid";
import { createTestParent } from "./parents";
import { seedSql } from "./seed-sql";
import {
	clientRendered,
	createPlannedHousehold,
	reloadUntil,
	signedInPage,
	uploadStatement,
} from "./session";

// For on the Review card (issue 138): chips beside the Bucket picker. Confirm saves the Bucket and
// the For, and "Always file …?" remembers the For in the Rule, which files the merchant's next line.

let parent: Awaited<ReturnType<typeof createTestParent>>;

test.beforeEach(async () => {
	parent = await createTestParent();
});

test.afterEach(async () => {
	await parent?.remove();
});

const q = (value: string) => `'${value.replaceAll("'", "''")}'`;

test("a Review card filed For a Child: the Rule offered remembers it and files the next line", async ({
	browser,
}) => {
	test.slow();
	const page = await signedInPage(browser, parent.email, {
		viewport: { width: 1440, height: 900 },
	});
	await createPlannedHousehold(page, {
		baseline: "5,000",
		buckets: [
			["Groceries", "1,200"],
			["Gas", "300"],
		],
	});
	const thisMonth = page.url();
	const household = `(select household_id from members where clerk_user_id = ${q(parent.userId)})`;
	await seedSql([
		`insert into members (id, household_id, kind, name) values (${q(ulid())}, ${household}, 'child', 'Mia')`,
	]);
	// The fake categorizer guesses Gas for both: two cards of one merchant, each with Confirm.
	await uploadStatement(
		page,
		[
			["CORNER GAS MART", "22.50"],
			["CORNER GAS MART", "31.00"],
		],
		true,
	);
	const cards = page.getByTestId("review-card");
	const confirm = cards.getByRole("button", { name: "Confirm", exact: true });
	await reloadUntil(page, new URL("/review?view=list", thisMonth).href, async () => {
		await expect(confirm).toHaveCount(2, { timeout: 2_000 });
	});
	await expect(confirm.first()).toBeEnabled(clientRendered);

	// Each card says who it is For, Everyone to begin with; a Child's chip takes its place.
	const card = cards.first();
	const chip = (name: string) => card.getByRole("button", { name, exact: true });
	await expect(chip("Everyone")).toHaveAttribute("aria-pressed", "true");
	await chip("Mia").click();
	await expect(chip("Mia")).toHaveAttribute("aria-pressed", "true");
	await expect(chip("Everyone")).toHaveAttribute("aria-pressed", "false");
	// The other card keeps its own.
	await expect(cards.nth(1).getByRole("button", { name: "Mia", exact: true })).toHaveAttribute(
		"aria-pressed",
		"false",
	);

	// Confirm files it in the suggestion, For Mia, and the Rule offered says so.
	await confirm.first().click();
	const offer = page.locator("[data-sonner-toast]").filter({ hasText: "Always file “" });
	await expect(offer).toContainText(/Always file “Corner Gas Mart.*” in Gas, For Mia\?/i);
	await offer.getByRole("button", { name: "Always file" }).click();
	// The Rule files the merchant's other line: nothing is left to review.
	await expect(cards).toHaveCount(0);

	// The Rule remembers the For, and has filed the line that was still waiting.
	await page
		.getByRole("navigation", { name: "Review pages" })
		.getByRole("link", { name: "Rules" })
		.click();
	await expect(
		page.getByRole("link", { name: /^corner gas mart.*, Gas, For Mia, Filed 1 so far$/i }),
	).toBeVisible(clientRendered);
	await page.context().close();
});

test("in One by one a card's For chips set who it is filed For", async ({ browser }) => {
	test.slow();
	const page = await signedInPage(browser, parent.email, {
		viewport: { width: 1440, height: 900 },
	});
	await createPlannedHousehold(page, {
		baseline: "5,000",
		buckets: [
			["Groceries", "1,200"],
			["Gas", "300"],
		],
	});
	const thisMonth = page.url();
	const household = `(select household_id from members where clerk_user_id = ${q(parent.userId)})`;
	await seedSql([
		`insert into members (id, household_id, kind, name) values (${q(ulid())}, ${household}, 'child', 'Mia')`,
	]);
	await uploadStatement(page, [["CORNER GAS MART", "22.50"]], true);
	const cards = page.getByTestId("review-card");
	const confirm = cards.getByRole("button", { name: "Confirm", exact: true });
	await reloadUntil(page, new URL("/review", thisMonth).href, async () => {
		await expect(confirm).toHaveCount(1, { timeout: 2_000 });
	});
	await expect(confirm).toBeEnabled(clientRendered);
	await cards.first().getByRole("button", { name: "Mia", exact: true }).click();
	await confirm.click();
	// Sort asks beside the stack, with the For in the question.
	await expect(page.getByText(/Always file “Corner Gas Mart.*” in Gas, For Mia\?/i)).toBeVisible();
	await page.context().close();
});
