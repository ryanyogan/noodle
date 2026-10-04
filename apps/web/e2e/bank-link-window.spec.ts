import { expect, type Page, test } from "@playwright/test";
import { createTestParent } from "./parents";
import { clientRendered, createHousehold, signedInPage } from "./session";

// Plaid Link's window (#70), against E2E's stand-in for it (`noodle.fake-link` = "window"): a
// frame Plaid fixes over the whole window, which on the phone used to sit under the notch with no
// way out. It opens once; Escape, Back and (on a phone) Noodle's own Close take it away; it stays
// inside the safe area; and closing it leaves Accounts as it was, scrolling, with the focus back
// on Connect a bank. Real Link's own screens can't be run here: see the runbook's phone check.

const phone = {
	viewport: { width: 393, height: 852 },
	deviceScaleFactor: 2,
	isMobile: true,
	hasTouch: true,
};
/** An iPhone's notch and home indicator, which Chromium doesn't have: the tokens stand in. */
const inset = { top: 47, bottom: 34 };

let parent: Awaited<ReturnType<typeof createTestParent>>;
test.beforeEach(async () => {
	parent = await createTestParent();
});
test.afterEach(async () => {
	await parent?.remove();
});

const linkFrame = (page: Page) => page.locator('iframe[id^="plaid-link-iframe"]');
const connectButton = (page: Page) => page.getByRole("button", { name: "Connect a bank" }).first();
const scrollLock = (page: Page) => page.evaluate(() => document.body.style.overflow);

async function toAccounts(page: Page) {
	await createHousehold(page, "The Rinks", "Alex");
	await page.goto("/accounts");
	await expect(page.getByRole("heading", { level: 1 })).toHaveText("Accounts");
	await page.evaluate(() =>
		window.sessionStorage.setItem("noodle.fake-link", JSON.stringify("window")),
	);
	await expect(connectButton(page)).toBeEnabled(clientRendered);
}

/** Link is gone and Accounts is as it was. */
async function expectClosed(page: Page) {
	await expect(linkFrame(page)).toHaveCount(0);
	await expect(page.locator("#noodle-bank-link-frame")).toHaveCount(0);
	await expect(page).toHaveURL(/\/accounts$/);
	await expect(page.getByRole("heading", { level: 1 })).toHaveText("Accounts");
	expect(await scrollLock(page)).toBe("");
	await expect(connectButton(page)).toBeEnabled();
	await expect(connectButton(page)).toBeFocused();
}

test("Link opens once, and Escape or Back closes it with Accounts as it was", async ({
	browser,
}) => {
	const page = await signedInPage(browser, parent.email);
	await toAccounts(page);

	await connectButton(page).click();
	await expect(linkFrame(page)).toHaveCount(1);
	// The button waits, so Link can't be opened twice.
	await expect(connectButton(page)).toBeDisabled();
	expect(await scrollLock(page)).toBe("hidden");
	// On a computer Link's own window is left alone: the whole window, no bar of Noodle's.
	await expect(page.locator("#noodle-bank-link-frame")).toBeHidden();
	const box = await linkFrame(page).boundingBox();
	const size = page.viewportSize();
	expect(box?.y).toBe(0);
	expect(box?.height).toBe(size?.height);

	await page.keyboard.press("Escape");
	await expectClosed(page);

	// Back closes it too, and stays on Accounts.
	await connectButton(page).click();
	await expect(linkFrame(page)).toHaveCount(1);
	await page.goBack();
	await expectClosed(page);

	// Nothing is left over: it opens again, once.
	await connectButton(page).click();
	await expect(linkFrame(page)).toHaveCount(1);
	await page.keyboard.press("Escape");
	await expectClosed(page);
});

test("on a phone Link stays clear of the notch and Close is always in reach", {
	tag: "@phone",
}, async ({ browser }) => {
	const page = await signedInPage(browser, parent.email, phone);
	await toAccounts(page);
	await page.evaluate(({ top, bottom }) => {
		const root = document.documentElement.style;
		root.setProperty("--safe-top", `${top}px`);
		root.setProperty("--safe-bottom", `${bottom}px`);
	}, inset);

	await connectButton(page).click();
	await expect(linkFrame(page)).toHaveCount(1);

	// Noodle's Close sits under the notch's edge, above Link, a full tap target.
	const close = page.locator("#noodle-bank-link-frame").getByRole("button", { name: "Close" });
	await expect(close).toBeVisible();
	const closeBox = await close.boundingBox();
	if (!closeBox) throw new Error("Close has no box");
	expect(closeBox.y).toBeGreaterThanOrEqual(inset.top);
	expect(closeBox.height).toBeGreaterThanOrEqual(44);
	expect(closeBox.width).toBeGreaterThanOrEqual(44);

	// Link's frame starts below Close and ends above the home indicator.
	const box = await linkFrame(page).boundingBox();
	if (!box) throw new Error("Link's frame has no box");
	expect(box.y).toBeGreaterThanOrEqual(closeBox.y + closeBox.height);
	expect(box.y + box.height).toBeLessThanOrEqual(phone.viewport.height - inset.bottom);
	expect(box.width).toBe(phone.viewport.width);

	// tap() goes to whatever is at that point: Close isn't under Link's frame.
	await close.tap();
	await expect(linkFrame(page)).toHaveCount(0);
	await expect(page.locator("#noodle-bank-link-frame")).toHaveCount(0);
	await expect(page).toHaveURL(/\/accounts$/);
	expect(await scrollLock(page)).toBe("");
	await expect(connectButton(page)).toBeEnabled();

	// Back (the phone's swipe) closes it as well.
	await connectButton(page).click();
	await expect(linkFrame(page)).toHaveCount(1);
	await page.goBack();
	await expect(linkFrame(page)).toHaveCount(0);
	await expect(page).toHaveURL(/\/accounts$/);
	await expect(connectButton(page)).toBeEnabled();
});
