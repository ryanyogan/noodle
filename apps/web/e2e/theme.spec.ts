import { expect, type Page, test } from "@playwright/test";
import { createTestParent } from "./parents";
import { createPlannedHousehold, openMore, signedInPage } from "./session";

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
	// Once the sheet has slid up. At 393 by 852 the control is the sheet's last row in view, its last
	// couple of pixels under the sheet's fade: the account row is a short scroll below it.
	await expect(themes).toBeInViewport({ ratio: 0.9 });
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
