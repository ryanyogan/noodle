import { expect, type Locator, type Page, test } from "@playwright/test";
import { createTestParent } from "./parents";
import {
	accountKindLabel,
	choose,
	createPlannedHousehold,
	serverFn,
	signedInPage,
} from "./session";

// Review's Sort view (#68): one card at a time, every decision by button and by key, Undo, a
// failed save putting the card back, the end of the stack, and the swipe (driven with the mouse:
// the card's pointer handling is the same for touch, less the second-finger cancel). Categorization
// runs with its fake (AI_MODEL=stub): it guesses Gas, unsure, for a merchant with "gas" in its
// name, and nothing for ACME.

let parent: Awaited<ReturnType<typeof createTestParent>>;

test.beforeEach(async () => {
	parent = await createTestParent();
});

test.afterEach(async () => {
	await parent?.remove();
});

const stack = (page: Page) => page.getByTestId("review-stack");
const top = (page: Page) => stack(page).getByTestId("review-card");
const topName = (page: Page) => top(page).getByRole("heading", { level: 3 }).innerText();
const status = (page: Page, text: string | RegExp) =>
	page.getByRole("status").filter({ hasText: text });
/** Lets the page's keys act: a focused button answers keys itself. */
const blur = (page: Page) =>
	page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

/** Uploads a card statement to the Visa Account, adding the Account first if it's new. */
async function uploadStatement(
	page: Page,
	lines: [what: string, amount: string, date?: string][],
	addAccount = false,
) {
	await page.getByRole("link", { name: "Accounts", exact: true }).click();
	await expect(page.getByRole("heading", { level: 1 })).toHaveText("Accounts");
	if (addAccount) {
		await page.getByLabel("Name").fill("Visa");
		await choose(page, "Kind", accountKindLabel("credit-card"));
		await page.getByLabel("Owed now").fill("800");
		await page.getByRole("button", { name: "Add Account" }).click();
	}
	await page.getByRole("link", { name: /^Visa, / }).click();
	await expect(page.locator("[data-slot=detail-title]:visible")).toContainText("Visa");

	// Dated today, so the lines land in the month the Plan was made for.
	const today = await page.evaluate(() => new Date().toLocaleDateString("en-US"));
	const csv = [
		"Transaction Date,Description,Debit,Credit",
		...lines.map(([what, amount, date]) => `${date ?? today},${what},${amount},`),
	].join("\n");
	await page.getByRole("button", { name: "Upload statement" }).click();
	const sheet = page.getByRole("dialog", { name: "Upload a statement" });
	await sheet
		.getByLabel("Statement file")
		.setInputFiles({ name: "visa.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
	await sheet.getByRole("button", { name: `Import ${lines.length} line` }).click();
	await expect(sheet).toBeHidden();
}

/** Skips until the top card has a suggestion to confirm, returning its name. */
async function toGuessed(page: Page) {
	for (let i = 0; i < 4; i++) {
		if (await top(page).getByRole("button", { name: "Confirm" }).isVisible()) break;
		await stack(page).getByRole("button", { name: "Skip" }).click();
	}
	await expect(top(page).getByRole("button", { name: "Confirm" })).toBeVisible();
	return topName(page);
}

/**
 * Opens the top card's picker by its button and picks. The pick is dispatched rather than clicked:
 * on a short desktop window the decisions' toasts can sit over the bottom of the picker's list.
 */
async function pick(page: Page, label: string, option: string) {
	// Off the toasts, which spread out under the pointer.
	await page.mouse.move(0, 0);
	await top(page).getByRole("combobox", { name: label, exact: true }).click();
	await page
		.getByRole("listbox")
		.getByRole("option", { name: option, exact: true })
		.dispatchEvent("click");
}

async function setUp(page: Page) {
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
			["CORNER GAS MART", "40.00"],
			["VALLEY GAS STOP", "30.00"],
			["ACME WIDGETS LLC", "19.99"],
		],
		true,
	);
	await page.goto(new URL("/review", thisMonth).href);
	await expect(stack(page)).toBeVisible();
	await expect(stack(page)).toContainText("1 of 3");
}

test("Review sorts one card at a time: confirm, pick another, skip and undo, by button and by key", async ({
	browser,
}) => {
	test.slow();
	const page = await signedInPage(browser, parent.email);
	await setUp(page);
	await expect(top(page)).toHaveCount(1);
	await expect(page.getByRole("radio", { name: "One by one" })).toBeChecked();

	// Skip, by button and by ↓: it goes to the back, and nothing is counted.
	const first = await topName(page);
	await stack(page).getByRole("button", { name: "Skip" }).click();
	await expect(top(page).getByRole("heading", { level: 3 })).not.toHaveText(first);
	const second = await topName(page);
	await blur(page);
	await page.keyboard.press("ArrowDown");
	await expect(top(page).getByRole("heading", { level: 3 })).not.toHaveText(second);
	await expect(stack(page)).toContainText("1 of 3");

	// Confirm by button, Undo by button: back on top.
	const gas = await toGuessed(page);
	await top(page).getByRole("button", { name: "Confirm" }).click();
	await expect(status(page, `filed in Gas`)).toBeVisible();
	await expect(stack(page)).toContainText("2 of 3");
	await expect(top(page).getByRole("heading", { level: 3 })).not.toHaveText(gas);
	await stack(page).getByRole("button", { name: "Undo" }).click();
	await expect(top(page).getByRole("heading", { level: 3 })).toHaveText(gas);
	await expect(stack(page)).toContainText("1 of 3");

	// Confirm by →, Undo by Z.
	await expect(stack(page).getByRole("button", { name: "Undo" })).toBeDisabled();
	await blur(page);
	await page.keyboard.press("ArrowRight");
	await expect(stack(page)).toContainText("2 of 3");
	await expect(stack(page).getByRole("button", { name: "Undo" })).toBeEnabled();
	await page.keyboard.press("z");
	await expect(top(page).getByRole("heading", { level: 3 })).toHaveText(gas);

	// Pick another by ←, Undo by Ctrl+Z.
	await expect(stack(page).getByRole("button", { name: "Undo" })).toBeDisabled();
	await blur(page);
	await page.keyboard.press("ArrowLeft");
	await expect(page.getByRole("listbox")).toBeVisible();
	await page.keyboard.type("Groceries");
	await page.keyboard.press("Enter");
	await expect(status(page, "filed in Groceries")).toBeVisible();
	await expect(stack(page)).toContainText("2 of 3");
	await expect(stack(page).getByRole("button", { name: "Undo" })).toBeEnabled();
	await blur(page);
	await page.keyboard.press("Control+z");
	await expect(top(page).getByRole("heading", { level: 3 })).toHaveText(gas);

	// Pick another by its button.
	await expect(stack(page).getByRole("button", { name: "Undo" })).toBeDisabled();
	await pick(page, `Where ${gas} goes`, "Groceries");
	await expect(stack(page)).toContainText("2 of 3");
	await page.reload();
	await expect(stack(page)).toContainText("1 of 2");
});

test("a failed save puts the card back on top and says so, and the end of the stack says all sorted", async ({
	browser,
}) => {
	test.slow();
	const page = await signedInPage(browser, parent.email);
	await setUp(page);

	const gas = await toGuessed(page);
	const update = serverFn("updateTransaction");
	await page.route(update, (route) => route.fulfill({ status: 500, body: "Server error" }));
	await top(page).getByRole("button", { name: "Confirm" }).click();
	await expect(status(page, "so it’s back in Review")).toBeVisible();
	await expect(top(page).getByRole("heading", { level: 3 })).toHaveText(gas);
	await expect(stack(page)).toContainText("1 of 3");
	await expect(stack(page).getByRole("button", { name: "Undo" })).toBeDisabled();
	await page.unroute(update);

	// Through to the end: each card in its suggestion, or picked.
	for (let left = 3; left > 0; left--) {
		const confirm = top(page).getByRole("button", { name: "Confirm" });
		if (await confirm.isVisible()) await confirm.click();
		else await pick(page, `Where ${await topName(page)} goes`, "Groceries");
		if (left > 1) await expect(stack(page)).toContainText(`${5 - left} of 3`);
	}
	await expect(page.getByText("All sorted")).toBeVisible();
	await expect(page.getByText(/You did 3\./)).toBeVisible();
	await expect(page.getByLabel(/to review$/)).toHaveCount(0);

	// Undo from the finish puts the last one back.
	await page.mouse.move(0, 0);
	await page.getByRole("main").getByRole("button", { name: "Undo" }).click();
	await expect(stack(page)).toContainText("3 of 3");

	// The list is one tap away and keeps what's left.
	await page.getByRole("radio", { name: "List" }).click();
	await expect(page).toHaveURL(/view=list/);
	await expect(page.getByTestId("review-card")).toHaveCount(1);
	await expect(stack(page)).toHaveCount(0);
});

/** Drags the top card sideways by `dx` with the mouse, in steps. */
async function drag(page: Page, card: Locator, dx: number) {
	const box = await card.getByRole("heading", { level: 3 }).boundingBox();
	if (!box) throw new Error("no card");
	const x = box.x + box.width / 2;
	const y = box.y + box.height / 2;
	await page.mouse.move(x, y);
	await page.mouse.down();
	for (let step = 1; step <= 10; step++) {
		await page.mouse.move(x + (dx * step) / 10, y + step, { steps: 2 });
	}
	await page.mouse.up();
}

test("on a phone the top card swipes: right confirms, left picks another, a short drag does nothing", async ({
	browser,
}) => {
	test.slow();
	const page = await signedInPage(browser, parent.email);
	await setUp(page);
	await page.setViewportSize({ width: 393, height: 852 });
	await expect(page.getByText("Swipe right to confirm, left to pick another")).toBeVisible();

	const gas = await toGuessed(page);
	// Short and slow: springs back.
	const box = await top(page).getByRole("heading", { level: 3 }).boundingBox();
	if (!box) throw new Error("no card");
	await page.mouse.move(box.x + 10, box.y + 5);
	await page.mouse.down();
	await page.mouse.move(box.x + 40, box.y + 5, { steps: 20 });
	await page.mouse.up();
	await expect(top(page).getByRole("heading", { level: 3 })).toHaveText(gas);
	await expect(stack(page)).toContainText("1 of 3");

	// Left: the picker opens over the card.
	await drag(page, top(page), -160);
	await expect(page.getByRole("listbox")).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(page.getByRole("listbox")).toHaveCount(0);
	await expect(stack(page)).toContainText("1 of 3");

	// Right: filed in its suggestion.
	await drag(page, top(page), 180);
	await expect(status(page, "filed in Gas")).toBeVisible();
	await expect(stack(page)).toContainText("2 of 3");
	await expect(top(page).getByRole("heading", { level: 3 })).not.toHaveText(gas);
});
