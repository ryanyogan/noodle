import { expect, type Page, test } from "@playwright/test";
import { createTestParent } from "./parents";
import {
	clientRendered,
	createPlannedHousehold,
	reloadUntil,
	serverFn,
	signedInPage,
	uploadStatement,
} from "./session";

// Review decisions left waiting when a phone's page goes (issue 128, ADR-0056). A Parent confirms
// two cards on a slow connection and the page is gone before either is answered: the first DID
// reach the server and only its answer was lost; the second was still waiting its turn and was
// never sent. When the app is next open both are sent again. The server knows the first as the
// change it already has and takes the second, so each Transaction is filed once, the Bucket's
// spent counts each once, and the only thing said is that what was waiting has been saved. The
// spec named for a phone runs in WebKit too, where the owners' iPhones are. Categorization runs
// with its fake (AI_MODEL=stub): it guesses Gas for a merchant with "gas" in its name.

/** An iPhone's screen, with touch. */
const phone = {
	viewport: { width: 393, height: 852 },
	deviceScaleFactor: 2,
	isMobile: true,
	hasTouch: true,
};

let parent: Awaited<ReturnType<typeof createTestParent>>;

test.beforeEach(async () => {
	parent = await createTestParent();
});

test.afterEach(async () => {
	await parent?.remove();
});

/** The ways a Parent's phone leaves a page; each answers with the page they are on next. */
const leavings: Record<string, (page: Page, url: string) => Promise<Page>> = {
	reloaded: async (page) => {
		await page.reload();
		return page;
	},
	"closed and the app opened again": async (page, url) => {
		const context = page.context();
		await page.close();
		const next = await context.newPage();
		await next.goto(url);
		return next;
	},
};

/** What this device has written down to send again. */
const writtenDown = (page: Page) =>
	page.evaluate(() =>
		Object.keys(localStorage)
			.filter((name) => name.startsWith("noodle.outbox."))
			.flatMap((name) => JSON.parse(localStorage.getItem(name) ?? "[]") as unknown[]),
	);

for (const [how, leave] of Object.entries(leavings)) {
	test(`two Review cards confirmed just before the page is ${how} are each filed once: the one whose answer was lost and the one never sent`, async ({
		browser,
	}) => {
		// A statement, the background categorization, and several whole page loads.
		test.slow();
		const page = await signedInPage(browser, parent.email, phone);
		const context = page.context();
		await createPlannedHousehold(page, {
			baseline: "5,000",
			buckets: [
				["Groceries", "1,200"],
				["Gas", "300"],
			],
		});
		const thisMonth = page.url();
		await uploadStatement(
			page,
			[
				["CORNER GAS MART", "20.00"],
				["VALLEY GAS STOP", "30.00"],
				["HILLTOP GAS", "41.00"],
			],
			true,
		);
		const list = new URL("/review?view=list", thisMonth).href;
		const cards = (on: Page) => on.getByTestId("review-card");
		const confirm = (on: Page) => cards(on).getByRole("button", { name: "Confirm", exact: true });
		await reloadUntil(page, list, async () => {
			await expect(cards(page)).toHaveCount(3, { timeout: 2_000 });
			await expect(confirm(page)).toHaveCount(3, { timeout: 2_000 });
		});
		await expect(confirm(page).first()).toBeEnabled(clientRendered);

		// The server takes a decision, but its answer never reaches the page.
		let held = true;
		let landed = 0;
		let release = () => {};
		const released = new Promise<void>((resolve) => {
			release = resolve;
		});
		await context.route(serverFn("updateTransaction"), async (route) => {
			if (!held) return route.continue();
			await route.fetch().catch(() => null);
			landed += 1;
			await released;
			await route.abort().catch(() => {});
		});
		let asked = 0;
		context.on("request", (request) => {
			if (serverFn("updateTransaction")(new URL(request.url()))) asked += 1;
		});

		// The first two as the list has them; what each card says is kept, for the sum below.
		const amounts: string[] = [];
		for (let nth = 1; nth <= 2; nth++) {
			amounts.push(await cards(page).first().innerText());
			await confirm(page).first().click();
			await expect(cards(page)).toHaveCount(3 - nth);
			if (nth === 1) await expect.poll(() => landed).toBe(1);
		}
		// The first is at the server unanswered; the second is waiting its turn, not sent.
		expect(asked).toBe(1);
		expect(await writtenDown(page)).toHaveLength(2);

		held = false;
		const next = await leave(page, list);
		const toasts = next.locator("[data-sonner-toast]");
		await expect(
			toasts.filter({ hasText: "Saved what was still waiting when you left." }),
		).toHaveCount(1, { timeout: 30_000 });
		// The repeat of the first and the second, once each; nothing refused, nothing failed.
		await expect.poll(() => asked).toBe(3);
		await expect(
			toasts.filter({ hasText: /changed on another screen|Couldn’t|left out/ }),
		).toHaveCount(0);
		await expect(cards(next)).toHaveCount(1, { timeout: 20_000 });
		await expect.poll(() => writtenDown(next)).toEqual([]);

		// What the server has: the two filed once each (a third decision, or one filed twice, would
		// change the count of cards or Gas's spent), and the one never decided still waiting.
		const confirmed = amounts.join(" ");
		const spent =
			(confirmed.includes("20") ? 20 : 0) +
			(confirmed.includes("30") ? 30 : 0) +
			(confirmed.includes("41") ? 41 : 0);
		await next.goto(thisMonth);
		await expect(next.getByRole("listitem", { name: /^Gas: / })).toContainText(`$${spent} spent`, {
			timeout: 20_000,
		});
		// Nothing was waiting this time: nothing is sent again and nothing is said.
		await next.goto(list);
		await expect(cards(next)).toHaveCount(1, { timeout: 20_000 });
		await expect(confirm(next).first()).toBeEnabled(clientRendered);
		expect(asked).toBe(3);
		await expect(next.locator("[data-sonner-toast]")).toHaveCount(0);

		release();
		await context.close();
	});
}
