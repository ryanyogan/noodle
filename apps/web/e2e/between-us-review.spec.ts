import { expect, test } from "@playwright/test";
import { createTestParent } from "./parents";
import {
	clientRendered,
	createPlannedHousehold,
	hydrated,
	signedInPage,
	uploadStatement,
	waitForReview,
} from "./session";

// Money sent to a person, waiting in Review (issue 92): its card offers "It’s between us" first and
// a Bucket second. On the narrowest phone the action and Edit share a row and the picker has the
// whole row under them. Saying so marks it as a Transfer with one side: it leaves Review and is no
// Bucket's spending.

let parent: Awaited<ReturnType<typeof createTestParent>>;

test.beforeEach(async () => {
	parent = await createTestParent();
});

test.afterEach(async () => {
	await parent?.remove();
});

test("a Zelle to a person is offered as between us in Review, fits a 320px phone, and leaves Review once said", async ({
	browser,
}) => {
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, {
		baseline: "5,000",
		buckets: [["Groceries", "1,200"]],
	});
	const thisMonth = page.url();
	const month = /\d{4}-\d{2}/.exec(thisMonth)?.[0] ?? "";
	await uploadStatement(page, [["ZELLE PAYMENT TO SAM RINK 99120044", "400.00"]], true);

	await page.setViewportSize({ width: 320, height: 640 });
	await waitForReview(page, new URL("/review", thisMonth).href, "1 of 1");
	const stack = page.getByTestId("review-stack");
	const top = stack.getByTestId("review-card");
	await expect(stack.getByRole("button", { name: "Skip" })).toBeEnabled(clientRendered);
	await page.evaluate(() => document.fonts.ready);

	await expect(top).toHaveAttribute("data-between-us", "");
	await expect(top).toContainText("It’s between us · not spending");
	await expect(top).toContainText("Looks like money sent to a person");
	await expect(top.getByTestId("review-between-us-why")).toContainText(
		"Money one of you sent the other isn’t spending.",
	);
	// No Bucket is suggested for it, so there is nothing to confirm by habit.
	await expect(top.getByRole("button", { name: "Confirm" })).toHaveCount(0);

	const action = top.getByRole("button", { name: "It’s between us", exact: true });
	const picker = top.getByRole("combobox", { name: /^Where .+ goes$/ });
	await expect(action).toBeVisible();
	await expect(picker).toBeEnabled();
	const [button, edit, under, inside] = await Promise.all([
		action.boundingBox(),
		top.getByRole("button", { name: /^Edit / }).boundingBox(),
		picker.boundingBox(),
		top.boundingBox(),
	]);
	if (!button || !edit || !under || !inside) throw new Error("the card's controls aren't drawn");
	// The action and Edit share the first row; the picker has the whole row under them.
	expect(Math.abs(button.y + button.height / 2 - (edit.y + edit.height / 2))).toBeLessThan(2);
	expect(under.y).toBeGreaterThanOrEqual(button.y + button.height);
	expect(under.width).toBeGreaterThan(inside.width - 40);
	expect(button.height).toBeGreaterThanOrEqual(43.5);
	for (const box of [button, edit, under, inside]) {
		expect(box.x).toBeGreaterThanOrEqual(0);
		expect(box.x + box.width).toBeLessThanOrEqual(320.5);
	}
	expect(
		await page.evaluate(
			() => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
		),
	).toBe(true);

	await hydrated(action);
	await action.click();
	await expect(page.getByRole("status").filter({ hasText: "marked as between us" })).toBeVisible();
	await expect(stack.getByTestId("review-card")).toHaveCount(0);

	// It stays out of Review, and its row says what it is.
	await page.goto(new URL(`/transactions/${month}`, thisMonth).href);
	await expect(page.getByText("Between us · out of Visa").first()).toBeVisible();
	await page.goto(new URL("/review", thisMonth).href);
	await expect(page.getByRole("heading", { level: 1 })).toHaveText("Review");
	await expect(page.getByTestId("review-card")).toHaveCount(0);
});
