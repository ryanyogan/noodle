import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";
import { createPlannedHousehold, savedBy, signedInPage } from "./session";
import { type SharedParent, test } from "./worker-parent";

// The Plan's Buckets list (#57): amounts and names changed in place, with how far a change
// reaches; Buckets moved by keyboard and by drag, said aloud and saved; Left to plan in view.

let parent: SharedParent;

test.beforeEach(async ({ sharedParent }) => {
	parent = sharedParent;
});

const monthKey = (offset = 0) => {
	const now = new Date();
	const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

async function openBuckets(page: Page, month = monthKey()) {
	await page.goto(`/plan/${month}/buckets`);
	await expect(page.getByRole("button", { name: "Add Buckets", exact: true })).toBeEnabled();
}

const names = (page: Page) =>
	page
		.locator("[data-bucket-row]")
		.evaluateAll((rows) => rows.map((row) => row.querySelector("a")?.textContent ?? ""));

async function axe(page: Page, label: string) {
	const { violations } = await new AxeBuilder({ page })
		.withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
		.analyze();
	expect(
		violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`),
		label,
	).toEqual([]);
}

test("Buckets are changed in the list, with either reach, and moved by keyboard and drag", async ({
	browser,
}) => {
	test.setTimeout(180_000);
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, {
		baseline: "9,000",
		buckets: [
			["Groceries", "800"],
			["Gas", "200"],
			["Fun", "100"],
		],
	});
	await openBuckets(page);
	const left = page.getByText(/^Left to plan/);
	await expect(left).toContainText("$7,900");

	// From this month on: Left to plan follows the typing, Enter saves.
	await page.getByRole("button", { name: "Change Groceries: $800" }).click();
	const groceries = page.getByRole("form", { name: "Change Groceries" });
	const amount = groceries.getByRole("textbox", { name: "Allowance" });
	await expect(amount).toBeFocused();
	await page.keyboard.type("900");
	await expect(left).toContainText("$7,800");
	await expect(groceries.getByRole("radio", { name: /^From .* on$/ })).toBeChecked();
	let saved = savedBy(page, "setAllowance");
	await page.keyboard.press("Enter");
	await saved;
	await expect(groceries).toBeHidden();
	await expect(page.getByRole("button", { name: "Change Groceries: $900" })).toBeVisible();

	// Just this month.
	await page.getByRole("button", { name: "Change Gas: $200" }).click();
	const gas = page.getByRole("form", { name: "Change Gas" });
	await gas.getByRole("textbox", { name: "Allowance" }).fill("250");
	await gas.getByRole("radio", { name: /^Just / }).click();
	saved = savedBy(page, "setAllowance");
	await gas.getByRole("textbox", { name: "Allowance" }).press("Enter");
	await saved;
	await expect(page.getByRole("button", { name: "Change Gas: $250" })).toBeVisible();

	// Escape puts it away unsaved, and Left to plan goes back.
	await page.getByRole("button", { name: "Change Fun: $100" }).click();
	await page.keyboard.type("999");
	await page.keyboard.press("Escape");
	await expect(page.getByRole("form", { name: "Change Fun" })).toBeHidden();
	await expect(page.getByRole("button", { name: "Change Fun: $100" })).toBeVisible();
	await expect(left).toContainText("$7,750");

	// The name changes in place too.
	await page.getByRole("button", { name: "Change Fun: $100" }).click();
	await page
		.getByRole("form", { name: "Change Fun" })
		.getByRole("textbox", { name: "Name" })
		.fill("Fun money");
	saved = savedBy(page, "updateBucket");
	await page.keyboard.press("Enter");
	await saved;
	await expect(page.getByRole("button", { name: "Edit Fun money" })).toBeVisible();

	await axe(page, "Buckets page at 1440");

	// By keyboard: the handle and the arrow keys, said aloud.
	const said = page.getByTestId("reorder-said");
	await expect(said).toHaveAttribute("aria-live", "assertive");
	await page.getByRole("button", { name: "Move Fun money" }).focus();
	saved = savedBy(page, "reorderBuckets");
	await page.keyboard.press("ArrowUp");
	await saved;
	await expect(said).toHaveText("Fun money moved to position 2 of 3");
	await expect(page.getByRole("button", { name: "Move Fun money" })).toBeFocused();
	saved = savedBy(page, "reorderBuckets");
	await page.keyboard.press("ArrowUp");
	await saved;
	await expect(said).toHaveText("Fun money moved to position 1 of 3");
	expect(await names(page)).toEqual(["Fun money", "Groceries", "Gas"]);

	// By drag: Gas from the bottom to the top.
	const handle = await page.getByRole("button", { name: "Move Gas" }).boundingBox();
	const top = await page.locator("[data-bucket-row]").first().boundingBox();
	if (!handle || !top) throw new Error("No rows to drag");
	saved = savedBy(page, "reorderBuckets");
	await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
	await page.mouse.down();
	await page.mouse.move(handle.x + handle.width / 2, top.y + 4, { steps: 8 });
	await page.mouse.up();
	await saved;
	await expect(said).toHaveText("Gas moved to position 1 of 3");
	expect(await names(page)).toEqual(["Gas", "Fun money", "Groceries"]);

	// All of it was saved: the order, both amounts, and next month's.
	await page.reload();
	await expect(page.locator("[data-bucket-row]").first()).toContainText("Gas");
	expect(await names(page)).toEqual(["Gas", "Fun money", "Groceries"]);
	await expect(page.getByRole("button", { name: "Change Gas: $250" })).toBeVisible();
	await openBuckets(page, monthKey(1));
	await expect(page.getByRole("button", { name: "Change Groceries: $900" })).toBeVisible();
	await expect(page.getByRole("button", { name: "Change Gas: $200" })).toBeVisible();

	// Phone width: the Buckets page and the sheet.
	await page.setViewportSize({ width: 393, height: 852 });
	await openBuckets(page);
	await axe(page, "Buckets page at 393");
	await page.getByRole("button", { name: "Add Buckets", exact: true }).click();
	const sheet = page.getByRole("dialog", { name: "Add Buckets" });
	await expect(sheet).toBeVisible();
	await expect(sheet.getByRole("button", { name: "Add Buckets" })).toBeInViewport();
	await axe(page, "Add Buckets sheet at 393");
	await page.keyboard.press("Escape");
	await page.setViewportSize({ width: 1440, height: 900 });
	await openBuckets(page);
	await page.getByRole("button", { name: "Add Buckets", exact: true }).click();
	await expect(sheet).toBeVisible();
	// The footer stays in view on a long list.
	await expect(sheet.getByRole("button", { name: "Cancel" })).toBeInViewport();
	await axe(page, "Add Buckets sheet at 1440");

	if (process.env.SHOTS) {
		for (const [width, height] of [
			[1440, 900],
			[393, 852],
		] as const) {
			await page.setViewportSize({ width, height });
			for (const colorScheme of ["light", "dark"] as const) {
				await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
				await openBuckets(page);
				await page.getByRole("button", { name: "Change Groceries: $900" }).click();
				await page.keyboard.type("950");
				await page.screenshot({ path: `${process.env.SHOTS}/list-${width}-${colorScheme}.png` });
				await page.keyboard.press("Escape");
				await page.getByRole("button", { name: "Add Buckets", exact: true }).click();
				await expect(sheet).toBeVisible();
				await page.screenshot({ path: `${process.env.SHOTS}/sheet-${width}-${colorScheme}.png` });
				await page.keyboard.press("Escape");
			}
		}
	}
});
