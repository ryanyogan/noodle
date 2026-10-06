import { expect, test } from "@playwright/test";
import { createTestParent } from "./parents";
import {
	clientRendered,
	createPlannedHousehold,
	reloadUntil,
	signedInPage,
	uploadStatement,
} from "./session";

// Undo toasts on a desktop (issue 123): filing Review cards one straight after the other in the
// list raises an "Always file …?" offer and an Undo toast for each. Sonner draws only so many, and
// with three filings the first one's Undo used to be among those left out. Now Review keeps one
// offer at a time and the Toaster draws six, so every filing still inside its ten seconds has an
// Undo that is drawn and can be pressed, and the oldest one really puts its card back.

let parent: Awaited<ReturnType<typeof createTestParent>>;

test.beforeEach(async () => {
	parent = await createTestParent();
});

test.afterEach(async () => {
	await parent?.remove();
});

for (const [width, height] of [
	[1440, 900],
	[1024, 768],
] as const) {
	test(`at ${width} three Review cards filed in a row each keep an Undo toast that can be pressed, and the oldest still undoes`, async ({
		browser,
	}) => {
		test.slow();
		const page = await signedInPage(browser, parent.email, { viewport: { width, height } });
		await createPlannedHousehold(page, {
			baseline: "5,000",
			buckets: [
				["Groceries", "1,200"],
				["Gas", "300"],
			],
		});
		const thisMonth = page.url();
		// The fake categorizer guesses Gas for four of them: four cards with Confirm.
		await uploadStatement(
			page,
			[
				["CORNER GAS MART", "22.50"],
				["VALLEY GAS STOP", "30.00"],
				["HILLTOP GAS", "41.00"],
				["RIVER GAS DEPOT", "18.00"],
				["CITY OF OAKLAND PARKING", "12.00"],
			],
			true,
		);
		const cards = page.getByTestId("review-card");
		const confirm = cards.getByRole("button", { name: "Confirm", exact: true });
		const list = new URL("/review?view=list", thisMonth).href;
		await reloadUntil(page, list, async () => {
			await expect(cards).toHaveCount(5, { timeout: 2_000 });
			await expect(confirm).toHaveCount(4, { timeout: 2_000 });
		});
		await expect(confirm.first()).toBeEnabled(clientRendered);

		// The toasts Sonner holds that haven't begun to leave. One past Sonner's limit stays in the
		// page with `data-visible=false`: see-through and not pressable.
		const held = page.locator("[data-sonner-toast][data-removed=false]");
		const undoToasts = held.filter({ has: page.getByRole("button", { name: "Undo" }) });
		const offers = held.filter({ hasText: "Always file “" });

		// Three cards filed, each as soon as the one before has its Undo toast (which comes once the
		// filing is saved, after its offer): the order that used to push the first Undo out.
		const filed: string[] = [];
		for (let nth = 1; nth <= 3; nth++) {
			const name = await cards
				.filter({ has: page.getByRole("button", { name: "Confirm", exact: true }) })
				.first()
				.getByRole("heading", { level: 3 })
				.innerText();
			filed.push(name);
			await confirm.first().click();
			await expect(cards).toHaveCount(5 - nth);
			await expect(undoToasts).toHaveCount(nth);
		}
		// The pointer leaves the list; it isn't over the toasts either, which would hold their time.
		await page.mouse.move(5, 5);

		// Every filing's Undo is drawn, whole and inside the window; one offer, the newest filing's.
		for (const name of filed) {
			const mine = undoToasts.filter({ hasText: new RegExp(`\\(${name}\\) filed`, "i") });
			await expect(mine, `the Undo toast for ${name}`).toHaveCount(1);
			await expect(mine).toHaveAttribute("data-visible", "true");
			await expect(mine).toHaveCSS("opacity", "1");
			await expect(mine.getByRole("button", { name: "Undo" })).toBeInViewport({ ratio: 1 });
		}
		await expect(offers).toHaveCount(1);
		await expect(offers).toContainText(filed[2] as string);
		await expect(offers).toHaveAttribute("data-visible", "true");

		// The oldest Undo takes a real press (one left out by Sonner takes none), and its card is back.
		await undoToasts
			.filter({ hasText: new RegExp(`\\(${filed[0]}\\) filed`, "i") })
			.getByRole("button", { name: "Undo" })
			.click({ timeout: 5_000 });
		await page.mouse.move(5, 5);
		await expect(cards).toHaveCount(3);
		await expect(confirm).toHaveCount(2);
		await expect(undoToasts).toHaveCount(2);

		// It really is undone, and only it: once the toasts have gone, a fresh load has that card to
		// review again and the other two stay filed.
		await expect.poll(() => held.count(), { timeout: 15_000 }).toBe(0);
		await reloadUntil(page, list, async () => {
			await expect(cards).toHaveCount(3, { timeout: 3_000 });
		});
		await expect(confirm.first()).toBeEnabled(clientRendered);
		await expect(confirm).toHaveCount(2);
		const headings = cards.getByRole("heading", { level: 3 });
		await expect(headings.filter({ hasText: filed[0] as string })).toHaveCount(1);
		await expect(headings.filter({ hasText: filed[1] as string })).toHaveCount(0);
		await expect(headings.filter({ hasText: filed[2] as string })).toHaveCount(0);
	});
}
