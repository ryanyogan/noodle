import { setupClerkTestingToken } from "@clerk/testing/playwright";
import {
	type Browser,
	type BrowserContextOptions,
	expect,
	type Page,
	test,
} from "@playwright/test";
import { INTRO_FILES, INTRO_VIDEO_READY } from "../src/intro-video-files";
import { measure } from "./overflow";
import { createTestParent } from "./parents";
import { createHousehold, signedInPage } from "./session";

// The one-minute intro video (#54) plays from sign-in and from the get-started wizard's Hello
// step, in a Dialog, with captions on offer, and stops when the Dialog closes. Skipped if the
// video's files are taken out again and INTRO_VIDEO_READY (src/intro-video-files.ts) is false.
test.skip(!INTRO_VIDEO_READY, "The intro video's files aren't in place yet (INTRO_VIDEO_READY)");

const desktop = { viewport: { width: 1440, height: 900 } } as const;
const phone = { viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true } as const;
const smallPhone = {
	viewport: { width: 320, height: 640 },
	isMobile: true,
	hasTouch: true,
} as const;

const opener = (page: Page) => page.getByRole("button", { name: "Watch the 1-minute intro" });
const dialog = (page: Page) => page.getByRole("dialog", { name: "Noodle in one minute" });

async function signInPage(browser: Browser, options: BrowserContextOptions) {
	const context = await browser.newContext({ ...options, reducedMotion: "reduce" });
	const page = await context.newPage();
	await setupClerkTestingToken({ page });
	await page.goto("/sign-in");
	return page;
}

/** Opens the player. The button only works once the page is hydrated, so it is tried again. */
async function openPlayer(page: Page) {
	await expect(opener(page)).toBeVisible({ timeout: 15_000 });
	await expect(async () => {
		if (!(await dialog(page).isVisible())) await opener(page).click();
		await expect(dialog(page)).toBeVisible({ timeout: 1000 });
	}).toPass();
	return dialog(page).locator("video");
}

/** The player has the browser's controls, a poster and captions, and waits for the Parent. */
async function expectPlayer(page: Page, cut: "wide" | "vertical") {
	const video = dialog(page).locator("video");
	await expect(video).toHaveAttribute(
		"src",
		cut === "wide" ? INTRO_FILES.wide : INTRO_FILES.vertical,
	);
	await expect(video).toHaveAttribute("preload", "none");
	await expect(video).toHaveAttribute(
		"poster",
		cut === "wide" ? INTRO_FILES.poster : INTRO_FILES.posterVertical,
	);
	await expect(video).toHaveJSProperty("controls", true);
	await expect(video).toHaveJSProperty("autoplay", false);
	await expect(video).toHaveJSProperty("paused", true);
	const track = video.locator("track");
	await expect(track).toHaveAttribute("kind", "captions");
	await expect(track).toHaveAttribute("srclang", "en");
	await expect(track).toHaveAttribute("src", INTRO_FILES.captions);
	// The words are drawn into the film, so the captions are offered but not switched on.
	await expect(track).toHaveJSProperty("default", false);
}

/** Closing with Esc calls pause on the player and winds it back to the start. */
async function expectClosingStops(page: Page) {
	const video = await dialog(page).locator("video").elementHandle();
	if (!video) throw new Error("no player");
	// Counted on the element itself: Playwright's own Chromium can't decode H.264, so whether the
	// film was really running can't be asked of every engine.
	await video.evaluate((el: HTMLVideoElement) => {
		const pause = el.pause.bind(el);
		el.dataset.paused = "0";
		el.pause = () => {
			el.dataset.paused = "1";
			pause();
		};
		el.muted = true;
		void el.play().catch(() => {});
	});
	await page.keyboard.press("Escape");
	await expect(dialog(page)).toBeHidden();
	expect(await video.evaluate((el: HTMLVideoElement) => el.dataset.paused)).toBe("1");
	expect(await video.evaluate((el: HTMLVideoElement) => el.paused)).toBe(true);
	expect(await video.evaluate((el: HTMLVideoElement) => el.currentTime)).toBe(0);
}

test("the video's files are served", async ({ request }) => {
	for (const file of [
		INTRO_FILES.wide,
		INTRO_FILES.vertical,
		INTRO_FILES.poster,
		INTRO_FILES.posterVertical,
	]) {
		const response = await request.head(file);
		expect(response.ok(), file).toBe(true);
	}
	const captions = await request.get(INTRO_FILES.captions);
	expect(captions.ok()).toBe(true);
	expect(await captions.text()).toMatch(/^WEBVTT/);
});

test("sign-in on a desktop: the wide cut opens with captions, and closing stops it", async ({
	browser,
}) => {
	const page = await signInPage(browser, desktop);
	// Lazy: nothing of the video is asked for until the Dialog opens, and no film until play.
	const fetched: string[] = [];
	page.on("request", (request) => {
		const path = new URL(request.url()).pathname;
		if (path.startsWith("/intro/")) fetched.push(path);
	});
	await expect(opener(page)).toBeVisible({ timeout: 15_000 });
	expect(fetched).toEqual([]);
	await openPlayer(page);
	await expectPlayer(page, "wide");
	expect(fetched.filter((path) => path.endsWith(".mp4"))).toEqual([]);
	await expectClosingStops(page);
	// Focus goes back to the button that opened it.
	await expect(opener(page)).toBeFocused();
	await page.context().close();
});

test("sign-in on a phone: the vertical cut, inside the screen", async ({ browser }) => {
	for (const device of [phone, smallPhone]) {
		const page = await signInPage(browser, device);
		await openPlayer(page);
		await expectPlayer(page, "vertical");
		const { width, height } = device.viewport;
		const box = await dialog(page).boundingBox();
		expect(box).not.toBeNull();
		if (box) {
			expect(box.x).toBeGreaterThanOrEqual(0);
			expect(box.y).toBeGreaterThanOrEqual(0);
			expect(box.x + box.width).toBeLessThanOrEqual(width);
			expect(box.y + box.height).toBeLessThanOrEqual(height);
		}
		// The whole player is on screen without scrolling the Dialog, and nothing scrolls sideways.
		await expect(dialog(page).locator("video")).toBeInViewport({ ratio: 1 });
		expect(
			await dialog(page).evaluate((el) => el.scrollHeight <= el.clientHeight + 1),
			`the Dialog doesn't scroll at ${width}×${height}`,
		).toBe(true);
		const { scrollWidth, sticking } = await measure(page);
		expect(scrollWidth, sticking.join("; ")).toBeLessThanOrEqual(width);
		await page.context().close();
	}
});

test("the get-started wizard's Hello step opens the video", async ({ browser }) => {
	const parent = await createTestParent();
	try {
		const page = await signedInPage(browser, parent.email, desktop);
		await createHousehold(page, "The Rinks", "Alex", { viaUi: true });
		await page.goto("/setup");
		await expect(page.getByText("Step 1 of 7").first()).toBeVisible({ timeout: 30_000 });
		await expect(page.locator("[data-slot=intro-video]")).toContainText("See how it works first");
		await expect(page.getByText("coming soon")).toHaveCount(0);
		await openPlayer(page);
		await expectPlayer(page, "wide");
		await expectClosingStops(page);
		// The step is as it was: the Parent can go on.
		await expect(page.getByRole("radio", { name: /by hand/ })).toBeVisible();
		await page.context().close();
	} finally {
		await parent.remove();
	}
});
