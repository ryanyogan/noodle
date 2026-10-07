import { expect, type Page, test } from "@playwright/test";
import { createTestParent } from "./parents";
import { createPlannedHousehold, signedInPage } from "./session";

// Issue 140: an open page learns that a newer build was deployed and refreshes at a safe moment.
// A test can't deploy, so it names another build in a cookie only its own browser carries
// (src/build-id.ts; read only in a build made with AI_MODEL=stub): the server then answers with
// that build, and a page loaded from then on counts as loaded with it.

const UPDATED = "Noodle was updated";

/** Marks the page so a later check can tell whether it was reloaded. */
const markLoaded = (page: Page) =>
	page.evaluate(() => {
		(window as { loadedOnce?: boolean }).loadedOnce = true;
	});

/** True once the page is another load than the one marked. False while it is still navigating. */
const reloaded = (page: Page) =>
	page
		.evaluate(
			() =>
				document.readyState === "complete" &&
				(window as { loadedOnce?: boolean }).loadedOnce !== true,
		)
		.catch(() => false);

/** "Deploys" `build` for this browser. HttpOnly: the page can't read it, as with a cached shell. */
const deploy = (page: Page, build: string, { httpOnly = false } = {}) =>
	page
		.context()
		.addCookies([
			{ name: "noodle-dev-build", value: build, url: new URL(page.url()).origin, httpOnly },
		]);

/** What a reconnecting live connection does: has the page ask the server which build it is. */
const hearOfIt = (page: Page) =>
	page
		.evaluate(() => void window.dispatchEvent(new Event("noodle:live-connected")))
		.catch(() => {});

const remembered = (page: Page) =>
	page.evaluate(() => JSON.parse(localStorage.getItem("noodle.app-update") ?? "null"));

async function household(page: Page) {
	await createPlannedHousehold(page, { baseline: "5,000", buckets: [["Groceries", "1,200"]] });
	// The page has opened and written down the build it runs.
	await expect.poll(() => remembered(page), { timeout: 20_000 }).not.toBeNull();
}

test("an idle page refreshes when a newer build is deployed, and says so once", async ({
	browser,
}) => {
	// A Household, a full load or two and its own waits: more than a loaded machine does in the usual time.
	test.slow();
	const parent = await createTestParent();
	try {
		const page = await signedInPage(browser, parent.email);
		await household(page);
		await markLoaded(page);

		await deploy(page, "next-1");
		await expect
			.poll(
				async () => {
					await hearOfIt(page);
					return reloaded(page);
				},
				{ timeout: 30_000 },
			)
			.toBe(true);
		await expect(page.getByText(UPDATED)).toBeVisible({ timeout: 15_000 });
		await expect(page.getByRole("button", { name: "Refresh now" })).toHaveCount(0);
		expect(await remembered(page)).toMatchObject({ seen: "next-1", triedFor: null });

		// Once per version per device: the next load of the same build says nothing.
		await page.reload();
		await expect.poll(async () => (await remembered(page))?.seen).toBe("next-1");
		await page.waitForTimeout(1_000);
		await expect(page.getByText(UPDATED)).toHaveCount(0);
		await page.context().close();
	} finally {
		await parent.remove();
	}
});

test("a page being typed in says so, waits, and refreshes once the field is empty again", async ({
	browser,
}) => {
	// A Household, a full load or two and its own waits: more than a loaded machine does in the usual time.
	test.slow();
	const parent = await createTestParent();
	try {
		const page = await signedInPage(browser, parent.email);
		await household(page);
		await page.goto(`${new URL(page.url()).pathname}?sheet=quick-add`);
		const note = page.getByRole("dialog").getByLabel("Note");
		await note.fill("milk and eggs");
		await expect.poll(() => remembered(page)).not.toBeNull();
		await markLoaded(page);

		await deploy(page, "next-2");
		await expect
			.poll(
				async () => {
					await hearOfIt(page);
					return page.getByRole("button", { name: "Refresh now" }).isVisible();
				},
				{ timeout: 30_000 },
			)
			.toBe(true);
		await expect(page.getByText(UPDATED)).toBeVisible({ timeout: 15_000 });
		// Several of its own checks later, what was typed is still there on the same page.
		await page.waitForTimeout(4_500);
		expect(await reloaded(page)).toBe(false);
		await expect(note).toHaveValue("milk and eggs");

		// Nothing typed any more: it goes by itself.
		await note.fill("");
		await expect.poll(() => reloaded(page), { timeout: 15_000 }).toBe(true);
		await expect(page.getByText(UPDATED)).toBeVisible({ timeout: 15_000 });
		await expect(page.getByRole("button", { name: "Refresh now" })).toHaveCount(0);
		await page.context().close();
	} finally {
		await parent.remove();
	}
});

test("a refresh that brings the same old page is not tried again", async ({ browser }) => {
	// A Household, a full load or two and its own waits: more than a loaded machine does in the usual time.
	test.slow();
	const parent = await createTestParent();
	try {
		const page = await signedInPage(browser, parent.email);
		await household(page);
		await markLoaded(page);

		// The server says "next-3", but the page it serves still counts as the old build.
		await deploy(page, "next-3", { httpOnly: true });
		await expect
			.poll(
				async () => {
					await hearOfIt(page);
					return reloaded(page);
				},
				{ timeout: 30_000 },
			)
			.toBe(true);
		await expect.poll(async () => (await remembered(page))?.triedFor).toBe("next-3");
		await markLoaded(page);

		// It keeps hearing of that build and never refreshes for it again, nor says it was updated.
		for (let i = 0; i < 3; i++) {
			await hearOfIt(page);
			await page.waitForTimeout(2_500);
		}
		expect(await reloaded(page)).toBe(false);
		await expect(page.getByText(UPDATED)).toHaveCount(0);
		await page.context().close();
	} finally {
		await parent.remove();
	}
});
