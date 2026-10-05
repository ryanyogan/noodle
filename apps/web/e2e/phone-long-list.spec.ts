import { expect, test } from "@playwright/test";
import { createTestParent } from "./parents";
import { seedReportHistory } from "./reports-seed";
import { clientRendered, createPlannedHousehold, signedInPage } from "./session";
import { realTouch, swipe } from "./touch";

// A busy Transactions month on a phone (#66): flung with a touch and scrolled with a wheel, the
// list never shows a blank gap and the frames keep up. Long tasks come from the
// Performance API where the browser has them (Chromium); every browser counts frame gaps.

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

test("a busy month flings without blank gaps or long frames", async ({ browser }) => {
	const page = await signedInPage(browser, parent.email, phone);
	await createPlannedHousehold(page, {
		baseline: "6200",
		buckets: [
			["Groceries", "800"],
			["Eating out", "300"],
			["Kids", "400"],
			["Fun", "250"],
		],
	});
	await seedReportHistory(parent.userId, 2);
	// Last month, which is full: this month's rows stop at today, too few to scroll far.
	await page.goto("/transactions");
	const title = page.getByRole("heading", { level: 1 });
	const thisMonth = (await title.textContent()) ?? "";
	await page.getByRole("link", { name: "Previous month" }).click();
	await expect(title).not.toHaveText(thisMonth);
	const rows = page.locator("[data-index]");
	await expect(rows.first()).toBeVisible();
	await expect(page.locator("#filter-search")).toBeEnabled(clientRendered);

	await page.evaluate(() => {
		const w = window as unknown as { longTasks: number[]; frames: number[]; stop: boolean };
		w.longTasks = [];
		w.frames = [];
		w.stop = false;
		if (PerformanceObserver.supportedEntryTypes?.includes("longtask"))
			new PerformanceObserver((list) => {
				for (const entry of list.getEntries()) w.longTasks.push(entry.duration);
			}).observe({ type: "longtask" });
		let last = performance.now();
		const tick = (now: number) => {
			w.frames.push(now - last);
			last = now;
			if (!w.stop) requestAnimationFrame(tick);
		};
		requestAnimationFrame(tick);
	});

	/** Gaps in the list inside the screen: stretches between rows no row covers. */
	const gaps = () =>
		page.evaluate(() => {
			const top = Math.max(
				0,
				document.querySelector("[data-index]")?.parentElement?.getBoundingClientRect().top ?? 0,
			);
			const bottom = Math.min(
				window.innerHeight,
				document.querySelector("[data-index]")?.parentElement?.getBoundingClientRect().bottom ?? 0,
			);
			// Day labels and the "loading more" mark are rows of the table too, between the Transactions.
			const boxes = [
				...document.querySelectorAll(
					"[data-index], [data-slot=data-table-group], [data-slot=data-table-more]",
				),
			]
				.map((el) => el.getBoundingClientRect())
				.filter((box) => box.bottom > top && box.top < bottom)
				.sort((a, b) => a.top - b.top);
			const found: string[] = [];
			let reached = top;
			for (const box of boxes) {
				if (box.top - reached > 2) found.push(`${Math.round(reached)}-${Math.round(box.top)}`);
				reached = Math.max(reached, box.bottom);
			}
			if (bottom - reached > 2) found.push(`${Math.round(reached)}-${Math.round(bottom)}`);
			return found;
		});

	// Playwright has no mouse wheel in mobile WebKit ("Mouse wheel is not supported"), and its
	// swipe can't scroll there either: the page is scrolled by script instead, which still makes
	// the list draw the rows for wherever it lands.
	const wheel = (dy: number) =>
		realTouch(page) ? page.mouse.wheel(0, dy) : page.evaluate((dy) => window.scrollBy(0, dy), dy);
	const start = await page.evaluate(() => window.scrollY);
	for (let i = 0; i < 4; i++) {
		// A quick flick up, where a flick can scroll (Chromium). Elsewhere it moves nothing, and
		// after the first scroll the row it would start on is drawn above the screen, out of reach.
		if (realTouch(page)) await swipe(page, rows.nth(2), -360, 3);
		expect(await gaps(), `after flick ${i + 1}`).toEqual([]);
		await page.mouse.move(196, 500);
		await wheel(900);
		await page.waitForTimeout(150);
		expect(await gaps(), `after wheel ${i + 1}`).toEqual([]);
	}
	expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(start + 1000);
	// And back up in one go.
	await wheel(-20000);
	await page.waitForTimeout(300);
	expect(await gaps(), "back at the top").toEqual([]);

	const { longTasks, frames } = await page.evaluate(() => {
		const w = window as unknown as { longTasks: number[]; frames: number[]; stop: boolean };
		w.stop = true;
		return { longTasks: w.longTasks, frames: w.frames.slice(1) };
	});
	const sorted = [...frames].sort((a, b) => a - b);
	const p90 = sorted[Math.floor(sorted.length * 0.9)] ?? 0;
	// Lenient for a shared headless machine: most frames inside 50 ms, no task over 250 ms.
	// Frame times are Chromium's only: CI's WebKit draws without a GPU and with no flick to draw
	// for (34 frames in the whole test, 111 ms at p90), which says nothing about an iPhone.
	if (realTouch(page)) expect(p90, `frame times p90 of ${frames.length}`).toBeLessThan(50);
	expect(Math.max(0, ...longTasks), "longest task").toBeLessThan(250);
	await page.context().close();
});
