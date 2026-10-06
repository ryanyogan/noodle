import { expect, test } from "@playwright/test";
import { createTestParent } from "./parents";
import { clientRendered, createPlannedHousehold, signedInPage } from "./session";

// Typing in the Transactions search on a slow connection (issue 52). Seen in the iOS Simulator:
// after "co" the keyboard went away and the rest of the word was lost. The search goes into the
// address once typing pauses; while the list for it was loading (longer than 400 ms) the whole
// page gave way to its loading state, which took the field, and so the keyboard, with it.

let parent: Awaited<ReturnType<typeof createTestParent>>;

test.beforeEach(async () => {
	parent = await createTestParent();
});

test.afterEach(async () => {
	await parent?.remove();
});

test("on a slow connection the Transactions search keeps the keyboard and every letter typed", async ({
	browser,
}) => {
	test.slow();
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, { baseline: "5,000", buckets: [["Groceries", "1,200"]] });
	const month = new URL(page.url()).pathname.match(/\d{4}-\d{2}/)?.[0];
	expect(month, "This Month's address names its month").toBeTruthy();
	await page.goto(`/transactions/${month}`);
	const field = page.getByLabel("Search notes and merchants");
	// The field is off until React has the page.
	await expect(field).toBeEnabled(clientRendered);

	// From here every answer from the server takes over a second.
	await page.route(/\/_serverFn\//, async (route) => {
		await new Promise((done) => setTimeout(done, 1_200));
		await route.continue().catch(() => {});
	});
	await field.click();
	await expect(field).toBeFocused();
	// Looked at on every frame: the field is in the page, enabled and holds the keyboard.
	await page.evaluate(() => {
		const seen = { gone: 0, disabled: 0, blurred: 0 };
		Object.assign(window, { __searchSeen: seen });
		const look = () => {
			const input = document.getElementById("filter-search") as HTMLInputElement | null;
			if (!input?.isConnected || input.offsetParent === null) seen.gone++;
			else if (input.disabled) seen.disabled++;
			else if (document.activeElement !== input) seen.blurred++;
			requestAnimationFrame(look);
		};
		look();
	});

	// Ten letters, one key at a time, slowly enough that the search is sent after each one.
	await page.keyboard.type("watermelon", { delay: 380 });
	await expect(field).toHaveValue("watermelon");
	await expect(field).toBeFocused();
	// The list catches up, and the field is still the one being typed in.
	await expect(page).toHaveURL(/[?&]q=watermelon\b/, { timeout: 15_000 });
	await expect(page.getByText("Nothing matches").first()).toBeVisible({ timeout: 15_000 });
	await expect(field).toHaveValue("watermelon");
	await expect(field).toBeFocused();
	expect(
		await page.evaluate(() => (window as unknown as { __searchSeen: unknown }).__searchSeen),
		"the field never left the page, was never disabled and never lost the keyboard",
	).toEqual({ gone: 0, disabled: 0, blurred: 0 });
});
