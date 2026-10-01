import { expect, type Page, test } from "@playwright/test";
import { createTestParent } from "./parents";
import { createPlannedHousehold, signedInPage, switchTo } from "./session";

const bucketRow = (page: Page, name: string) =>
	page.getByRole("listitem", { name: new RegExp(`^${name}: `) });

/**
 * Watches the page's connections to its Household Agent; call before it loads. The returned
 * function waits until one is open: it answers the ping a screen sends on coming back into view.
 */
function watchHouseholdAgent(page: Page) {
	let answered = false;
	page.on("websocket", (socket) => {
		if (!socket.url().endsWith("/api/household-agent")) return;
		socket.on("framereceived", (frame) => {
			if (frame.payload === "pong") answered = true;
		});
	});
	return () =>
		expect
			.poll(async () => {
				await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
				return answered;
			})
			.toBe(true);
}

/** Marks the page so a later check can tell it was never reloaded. */
const markLoaded = (page: Page) =>
	page.evaluate(() => {
		(window as { loadedOnce?: boolean }).loadedOnce = true;
	});
const neverReloaded = (page: Page) =>
	page.evaluate(() => (window as { loadedOnce?: boolean }).loadedOnce === true);

/** Whether the page may open a connection to a Household Agent. */
const canConnect = (page: Page) =>
	page.evaluate(
		() =>
			new Promise<boolean>((resolve) => {
				const socket = new WebSocket(
					new URL("/api/household-agent", location.href.replace(/^http/, "ws")),
				);
				socket.onopen = () => {
					socket.close();
					resolve(true);
				};
				socket.onclose = () => resolve(false);
			}),
	);

test("only a signed-in Parent in a Household can connect to its Agent", async ({ browser }) => {
	const signedOut = await (await browser.newContext()).newPage();
	await signedOut.goto("/sign-in");
	expect(await canConnect(signedOut)).toBe(false);
	await signedOut.context().close();

	const parent = await createTestParent();
	try {
		const page = await signedInPage(browser, parent.email);
		await page.goto("/welcome");
		expect(await canConnect(page)).toBe(false);

		await createPlannedHousehold(page, { baseline: "5,000", buckets: [["Groceries", "1,200"]] });
		expect(await canConnect(page)).toBe(true);
		await page.context().close();
	} finally {
		await parent.remove();
	}
});

test("each Parent's screen shows the other's changes without a reload", async ({ browser }) => {
	const first = await createTestParent();
	const second = await createTestParent();
	try {
		const alex = await signedInPage(browser, first.email);
		await createPlannedHousehold(alex, {
			baseline: "5,000",
			buckets: [
				["Groceries", "1,200"],
				["Hockey", "400"],
			],
		});
		await alex.getByRole("link", { name: "Household" }).click();
		await alex.getByLabel("Their email").fill(second.email);
		await alex.getByRole("button", { name: /^Invite/ }).click();
		await expect(alex.getByText(`Invited ${second.email}`)).toBeVisible();
		await markLoaded(alex);

		const sam = await signedInPage(browser, second.email);
		await sam.goto("/welcome");
		const samConnected = watchHouseholdAgent(sam);
		await sam.getByLabel("Your name").fill("Sam");
		await sam.getByRole("button", { name: "Join The Rinks" }).click();
		await expect(sam.getByRole("heading", { level: 1 })).toContainText("This Month");
		await markLoaded(sam);
		await samConnected();

		// Alex's Household page hears that Sam joined.
		await expect(alex.getByRole("listitem").filter({ hasText: "Sam" })).toBeVisible();
		await expect(alex.getByText(`Invited ${second.email}`)).toHaveCount(0);

		// Alex's Quick Add drains Groceries on Sam's screen too.
		await alex.getByRole("link", { name: "This Month", exact: true }).click();
		await alex.getByRole("link", { name: "Quick Add" }).click();
		const sheet = alex.getByRole("dialog", { name: "Quick Add" });
		await expect(sheet).toBeVisible();
		await alex.keyboard.type("85.50");
		await sheet.getByRole("button", { name: /^Groceries/ }).click();
		await expect(sheet).toBeHidden();
		await expect(bucketRow(sam, "Groceries")).toHaveAccessibleName(
			/^Groceries: \$1,114\.50 left of \$1,200/,
		);

		// Sam raises Hockey's allowance, and Alex's This Month follows.
		await switchTo(sam, "Plan");
		await sam
			.getByRole("navigation", { name: "Plan pages" })
			.getByRole("link", { name: "Buckets", exact: true })
			.click();
		await sam.getByRole("button", { name: "Edit Hockey" }).click();
		const hockey = sam.getByRole("dialog", { name: "Hockey" });
		await hockey.getByRole("textbox", { name: "Allowance", exact: true }).fill("500");
		await hockey.getByRole("button", { name: "Save", exact: true }).click();
		await expect(bucketRow(alex, "Hockey")).toHaveAccessibleName(/^Hockey: \$500 left of \$500/);
		await expect(bucketRow(alex, "Groceries")).toHaveAccessibleName(
			/^Groceries: \$1,114\.50 left of \$1,200/,
		);

		expect(await neverReloaded(alex)).toBe(true);
		expect(await neverReloaded(sam)).toBe(true);
		await Promise.all([alex.context().close(), sam.context().close()]);
	} finally {
		await Promise.all([first.remove(), second.remove()]);
	}
});
