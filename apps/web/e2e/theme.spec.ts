import { expect, type Page, test } from "@playwright/test";
import { createTestParent } from "./parents";
import { createPlannedHousehold, moreItem, openMore, signedInPage } from "./session";

// The theme (issue 124): a Parent picks Light, Dark or Device in the account menu: the Sidebar's
// Parent menu on a computer, the foot of More on a phone. It applies at once, is remembered on this
// device, and is there before the first paint of the next load. Device follows the device's setting.

let parent: Awaited<ReturnType<typeof createTestParent>>;

test.beforeAll(async ({ browser }) => {
	parent = await createTestParent();
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, { baseline: "5,000", buckets: [["Groceries", "600"]] });
	await page.context().close();
});

test.afterAll(async () => {
	await parent?.remove();
});

/** What the page is drawn in: the attribute the Parent's choice sets, and the scheme CSS ends up with. */
const drawn = (page: Page) =>
	page.evaluate(() => ({
		chosen: document.documentElement.getAttribute("data-theme"),
		scheme: getComputedStyle(document.documentElement).colorScheme,
		bars: [...document.querySelectorAll("meta[name=theme-color]")]
			.filter((meta) => matchMedia(meta.getAttribute("media") ?? "all").matches)
			.map((meta) => meta.getAttribute("data-theme-color")),
	}));

const shot = async (page: Page, name: string) => {
	if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/${name}.png` });
};

test("a Parent switches to Dark and back to Light in the account menu, and it is remembered", async ({
	browser,
}) => {
	const page = await signedInPage(browser, parent.email, {
		viewport: { width: 1440, height: 900 },
		colorScheme: "light",
	});
	await page.goto("/month");
	const button = page.getByRole("button", { name: /Account menu/ });
	const menu = page.getByRole("menu");
	const themes = menu.getByRole("group", { name: "Theme" });
	const option = (name: string) => themes.getByRole("menuitemradio", { name, exact: true });
	const open = async () => {
		// Ready once React and Clerk are (as shell.spec.ts waits): before then a press does nothing.
		await page.locator("[data-parent-menu][data-ready=true]").waitFor({ state: "attached" });
		await button.click();
		await expect(themes.getByRole("menuitemradio")).toHaveText(["Light", "Dark", "Device"]);
	};

	// Nothing chosen yet: the device decides, and the menu says so.
	await open();
	await expect(option("Device")).toBeChecked();
	expect(await drawn(page)).toEqual({ chosen: null, scheme: "light", bars: ["light"] });
	await shot(page, "menu-1440-light");

	// Dark, at once, with the menu still open and saying which is chosen.
	await option("Dark").click();
	await expect(option("Dark")).toBeChecked();
	await expect(option("Device")).not.toBeChecked();
	expect(await drawn(page)).toEqual({ chosen: "dark", scheme: "dark", bars: ["dark"] });
	await shot(page, "menu-1440-dark");

	// Remembered: the next load is dark from its first paint, before React has taken over.
	await page.reload({ waitUntil: "commit" });
	await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
	await page.waitForLoadState("load");
	expect(await drawn(page)).toEqual({ chosen: "dark", scheme: "dark", bars: ["dark"] });

	// Back to Light, by keyboard: the menu opens on the chosen set and Enter chooses.
	await open();
	await expect(option("Dark")).toBeChecked();
	await option("Light").focus();
	await page.keyboard.press("Enter");
	await expect(option("Light")).toBeChecked();
	expect(await drawn(page)).toEqual({ chosen: "light", scheme: "light", bars: ["light"] });

	// Light holds on a device set to dark; Device hands the choice back to the device.
	await page.emulateMedia({ colorScheme: "dark" });
	expect(await drawn(page)).toEqual({ chosen: "light", scheme: "light", bars: ["light"] });
	await option("Device").click();
	await expect(option("Device")).toBeChecked();
	expect(await drawn(page)).toEqual({ chosen: null, scheme: "dark", bars: ["dark"] });
	await page.reload();
	expect(await drawn(page)).toEqual({ chosen: null, scheme: "dark", bars: ["dark"] });
	await page.context().close();
});

test("on a phone, a Parent switches to Dark and back to Light at the foot of More", {
	tag: "@phone",
}, async ({ browser }) => {
	const page = await signedInPage(browser, parent.email, {
		viewport: { width: 393, height: 852 },
		isMobile: true,
		hasTouch: true,
		colorScheme: "light",
	});
	await page.goto("/month");
	const themesIn = async () => {
		const sheet = await openMore(page);
		const themes = sheet
			.getByRole("region", { name: "Your account" })
			.getByRole("radiogroup", { name: "Theme" });
		await expect(themes.getByRole("radio")).toHaveText(["Light", "Dark", "Device"]);
		return themes;
	};

	let themes = await themesIn();
	await expect(themes.getByRole("radio", { name: "Device" })).toBeChecked();
	// Once the sheet has slid up: the control is in the sheet's foot, which stays put.
	await expect(themes).toBeInViewport({ ratio: 0.99 });
	await shot(page, "more-393-light");
	await themes.getByRole("radio", { name: "Dark" }).click();
	await expect(themes.getByRole("radio", { name: "Dark" })).toBeChecked();
	expect(await drawn(page)).toEqual({ chosen: "dark", scheme: "dark", bars: ["dark"] });
	await shot(page, "more-393-dark");

	await page.reload({ waitUntil: "commit" });
	await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
	await page.waitForLoadState("load");

	themes = await themesIn();
	await expect(themes.getByRole("radio", { name: "Dark" })).toBeChecked();
	await themes.getByRole("radio", { name: "Light" }).click();
	await expect(themes.getByRole("radio", { name: "Light" })).toBeChecked();
	expect(await drawn(page)).toEqual({ chosen: "light", scheme: "light", bars: ["light"] });
	// Nothing runs off the side of a 393 window.
	expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(393);
	await page.context().close();
});

// The foot of More stays put (issue 124): the theme, Manage account and Sign out are together and in
// view without scrolling, on a tall phone and a small one, and only the destinations scroll above.
test("on a phone, the theme, Manage account and Sign out stay at the foot of More while the list scrolls", {
	tag: "@phone",
}, async ({ browser }) => {
	const page = await signedInPage(browser, parent.email, {
		viewport: { width: 393, height: 852 },
		isMobile: true,
		hasTouch: true,
		colorScheme: "light",
	});
	await page.goto("/month");
	const sizes = [
		[393, 852, "light"],
		[375, 667, "light"],
		[320, 568, "light"],
		[393, 852, "dark"],
		[320, 568, "dark"],
	] as const;
	for (const [width, height, scheme] of sizes) {
		const at = `${width}x${height} ${scheme}`;
		await page.emulateMedia({ colorScheme: scheme });
		await page.setViewportSize({ width, height });
		const sheet = await openMore(page);
		const list = sheet.getByRole("navigation", { name: "More" });
		const account = sheet.getByRole("region", { name: "Your account" });
		const themes = account.getByRole("radiogroup", { name: "Theme" });
		const controls = [
			...(await themes.getByRole("radio").all()),
			account.getByRole("button", { name: "Manage account" }),
			account.getByRole("button", { name: "Sign out" }),
		];
		expect(controls, at).toHaveLength(5);
		// Once it has slid up, the sheet ends at the bottom of the window.
		await expect
			.poll(async () => {
				const box = await sheet.boundingBox();
				return Math.round((box?.y ?? 0) + (box?.height ?? 0));
			}, at)
			.toBe(height);
		// The sheet itself has nothing to scroll: only the list does.
		expect(
			await sheet.evaluate((el) => [el.scrollTop, el.scrollHeight - el.clientHeight]),
			at,
		).toEqual([0, 0]);
		expect(await list.evaluate((el) => el.scrollTop), at).toBe(0);
		const top = (await sheet.boundingBox())?.y ?? 0;
		for (const control of controls) {
			const box = await control.boundingBox();
			if (!box) throw new Error(`${at}: a control of the foot has no box`);
			// All of it inside the sheet and the window, and big enough for a thumb.
			expect(box.y, at).toBeGreaterThanOrEqual(top);
			expect(box.y + box.height, at).toBeLessThanOrEqual(height + 0.5);
			expect(box.x, at).toBeGreaterThanOrEqual(0);
			expect(box.x + box.width, at).toBeLessThanOrEqual(width + 0.5);
			expect(box.height, at).toBeGreaterThanOrEqual(44);
		}
		await shot(page, `more-${width}-${scheme}`);

		// The last destination comes fully into view above the foot.
		await list.evaluate((el) => el.scrollTo(0, el.scrollHeight));
		const last = await moreItem(sheet, "Glossary").boundingBox();
		const listBox = await list.boundingBox();
		const foot = await account.boundingBox();
		if (!last || !listBox || !foot) throw new Error(`${at}: the sheet's parts have no box`);
		expect(last.y, at).toBeGreaterThanOrEqual(listBox.y);
		expect(last.y + last.height, at).toBeLessThanOrEqual(foot.y + 0.5);
		expect(await sheet.evaluate((el) => el.scrollTop), at).toBe(0);
		// Nothing runs off the side.
		expect(await page.evaluate(() => document.documentElement.scrollWidth), at).toBe(width);
		expect(await list.evaluate((el) => el.scrollWidth - el.clientWidth), at).toBe(0);
		await shot(page, `more-${width}-${scheme}-end`);

		await sheet.getByRole("button", { name: "Close" }).click();
		await expect(sheet).toBeHidden();
	}
	await page.context().close();
});
