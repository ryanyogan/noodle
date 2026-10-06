import { expect, type Page, test } from "@playwright/test";
import { createTestParent } from "./parents";
import {
	clientRendered,
	createPlannedHousehold,
	reloadUntil,
	signedInPage,
	uploadStatement,
} from "./session";

// Toasts on a phone (issue 120): below 1024px one shows at a time. Filing two Review cards in a
// row in the list raises four (an Undo and an "Always file …?" for each), which used to pile up
// over the cards' buttons. The newest is the one drawn; an Undo behind it comes back with the time
// it has left, and pressing it really puts the card back.

let parent: Awaited<ReturnType<typeof createTestParent>>;

test.beforeEach(async () => {
	parent = await createTestParent();
});

test.afterEach(async () => {
	await parent?.remove();
});

/** The toasts Sonner holds that haven't begun to leave, and those of them that are drawn. */
async function toasts(page: Page) {
	const held = page.locator("[data-sonner-toast][data-removed=false]");
	const drawn = held.filter({ visible: true });
	return { held: await held.count(), drawn: await drawn.allInnerTexts() };
}

test("on a phone one toast shows at a time after filing two Review cards, and an Undo that comes back still undoes", async ({
	browser,
}) => {
	test.slow();
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, {
		baseline: "5,000",
		buckets: [
			["Groceries", "1,200"],
			["Gas", "300"],
		],
	});
	const thisMonth = page.url();
	expect(page.viewportSize()?.width, "a phone").toBeLessThan(1024);
	// The fake categorizer guesses Gas for both: two cards with Confirm.
	await uploadStatement(
		page,
		[
			["CORNER GAS MART", "22.50"],
			["VALLEY GAS STOP", "30.00"],
			["CITY OF OAKLAND PARKING", "12.00"],
		],
		true,
	);
	const cards = page.getByTestId("review-card");
	const confirm = cards.getByRole("button", { name: "Confirm", exact: true });
	const list = new URL("/review?view=list", thisMonth).href;
	await reloadUntil(page, list, async () => {
		await expect(cards).toHaveCount(3, { timeout: 2_000 });
		await expect(confirm).toHaveCount(2, { timeout: 2_000 });
	});
	await expect(confirm.first()).toBeEnabled(clientRendered);

	// Two cards filed, one straight after the other.
	await confirm.first().click();
	await expect(cards).toHaveCount(2);
	await confirm.first().click();
	await expect(cards).toHaveCount(1);

	// Several toasts are held, one is drawn, and it stays one while they take their turns.
	await expect(async () => {
		const now = await toasts(page);
		expect(now.held).toBeGreaterThanOrEqual(2);
		expect(now.drawn).toHaveLength(1);
	}).toPass({ timeout: 5_000 });
	for (let look = 0; look < 6; look++) {
		expect((await toasts(page)).drawn.length, `look ${look + 1}: never two at once`).toBeLessThan(
			2,
		);
		await page.waitForTimeout(400);
	}

	// An Undo is back in view within its ten seconds: pressing it puts its card back.
	const undo = page
		.locator("[data-sonner-toast][data-removed=false]")
		.filter({ visible: true })
		.getByRole("button", { name: "Undo" });
	await expect(undo).toBeVisible({ timeout: 9_000 });
	expect((await toasts(page)).drawn, "the Undo is the one toast drawn").toHaveLength(1);
	await undo.click();
	// The pointer leaves the toasts: Sonner holds their time while it rests on one.
	await page.mouse.move(1, 1);
	await expect(cards).toHaveCount(2);
	await expect(confirm).toHaveCount(1);

	// It really is undone: once the toasts have gone, a fresh load still has the card to review,
	// and the other one stays filed.
	await expect.poll(async () => (await toasts(page)).held, { timeout: 15_000 }).toBe(0);
	await reloadUntil(page, list, async () => {
		await expect(cards).toHaveCount(2, { timeout: 3_000 });
	});
	await expect(confirm.first()).toBeEnabled(clientRendered);
	await expect(confirm).toHaveCount(1);
});
