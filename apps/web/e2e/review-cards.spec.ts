import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { createTestParent } from "./parents";
import {
	accountKindLabel,
	choose,
	createPlannedHousehold,
	enterJoinedHousehold,
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
/** What Sort says beside the card (and to a screen reader) after each decision. */
const said = (page: Page) => page.getByTestId("review-said");
/** Focus rests on the top card after each decision, so the keys work at once. */
const focusedCard = (page: Page) => page.locator("#review-top");

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

/** Opens the top card's picker by its button and picks. */
async function pick(page: Page, label: string, option: string) {
	await top(page).getByRole("combobox", { name: label, exact: true }).click();
	await page.getByRole("listbox").getByRole("option", { name: option, exact: true }).click();
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
	// Focus moved to the next card, so ↓ works straight after the button.
	await expect(focusedCard(page)).toBeFocused();
	await page.keyboard.press("ArrowDown");
	await expect(top(page).getByRole("heading", { level: 3 })).not.toHaveText(second);
	await expect(stack(page)).toContainText("1 of 3");

	// Confirm by button, Undo by button: back on top.
	const gas = await toGuessed(page);
	await top(page).getByRole("button", { name: "Confirm" }).click();
	await expect(said(page)).toHaveText(`Filed ${gas} in Gas. 2 left.`);
	await expect(focusedCard(page)).toBeFocused();
	// Sort says so beside the card; no toast sits over it.
	await expect(page.locator("[data-slot=toast]")).toHaveCount(0);
	await expect(stack(page)).toContainText("2 of 3");
	await expect(top(page).getByRole("heading", { level: 3 })).not.toHaveText(gas);
	await stack(page).getByRole("button", { name: "Undo" }).click();
	await expect(top(page).getByRole("heading", { level: 3 })).toHaveText(gas);
	await expect(said(page)).toHaveText(`${gas} is back on top.`);
	await expect(focusedCard(page)).toBeFocused();
	await expect(stack(page)).toContainText("1 of 3");

	// Confirm by →, Undo by Z.
	await expect(stack(page).getByRole("button", { name: "Undo" })).toBeDisabled();
	await page.keyboard.press("ArrowRight");
	await expect(stack(page)).toContainText("2 of 3");
	await expect(stack(page).getByRole("button", { name: "Undo" })).toBeEnabled();
	await page.keyboard.press("z");
	await expect(top(page).getByRole("heading", { level: 3 })).toHaveText(gas);

	// Pick another by ←, Undo by Ctrl+Z.
	await expect(stack(page).getByRole("button", { name: "Undo" })).toBeDisabled();
	await page.keyboard.press("ArrowLeft");
	await expect(page.getByRole("listbox")).toBeVisible();
	await page.keyboard.type("Groceries");
	await page.keyboard.press("Enter");
	await expect(said(page)).toHaveText(`Filed ${gas} in Groceries. 2 left.`);
	await expect(stack(page)).toContainText("2 of 3");
	await expect(stack(page).getByRole("button", { name: "Undo" })).toBeEnabled();
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
	await expect(page.getByText("All sorted", { exact: true })).toBeVisible();
	await expect(page.getByText(/You did 3\./)).toBeVisible();
	await expect(page.getByLabel(/to review$/)).toHaveCount(0);

	// Focus is on the finish, and Undo there puts the last one back.
	await expect(page.locator("#review-finish")).toBeFocused();
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
	await expect(said(page)).toHaveText(`Filed ${gas} in Gas. 2 left.`);
	await expect(stack(page)).toContainText("2 of 3");
	await expect(top(page).getByRole("heading", { level: 3 })).not.toHaveText(gas);
});

/** A date `days` ago, as a statement writes it. */
const daysAgo = (days: number) =>
	new Date(Date.now() - days * 86_400_000).toLocaleDateString("en-US");

/** Skips until the top card says `text`. */
async function toCard(page: Page, text: string | RegExp) {
	for (let i = 0; i < 5 && !(await top(page).innerText()).match(text); i++) {
		await stack(page).getByRole("button", { name: "Skip" }).click();
	}
	await expect(top(page)).toContainText(text);
}

async function axe(page: Page, what: string) {
	const { violations } = await new AxeBuilder({ page }).analyze();
	expect(
		violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`),
		what,
	).toEqual([]);
}

test("a card splits, makes a Rule, can't be filed from a month with no Plan, and Sort passes axe", async ({
	browser,
}) => {
	test.slow();
	const page = await signedInPage(browser, parent.email);
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
			["ACME WIDGETS LLC", "19.99"],
			["OLD BOOKSHOP", "12.00", daysAgo(45)],
		],
		true,
	);
	await page.goto(new URL("/review", thisMonth).href);
	await expect(stack(page)).toContainText("1 of 3");
	await axe(page, "Sort at desktop width");

	// A month with no Plan: → says so instead of doing nothing, and the card stays.
	await toCard(page, "has no Plan yet");
	const old = await topName(page);
	await focusedCard(page).focus();
	await page.keyboard.press("ArrowRight");
	await expect(said(page)).toContainText(`has no Plan yet, so ${old} can only be skipped.`);
	await expect(top(page).getByRole("heading", { level: 3 })).toHaveText(old);
	await expect(top(page).getByRole("button", { name: "Split" })).toHaveCount(0);
	await page.keyboard.press("ArrowLeft");
	await expect(page.getByRole("listbox")).toHaveCount(0);
	await expect(stack(page)).toContainText("1 of 3");

	// Split: by its button, then by S, the editor opens on its Splits.
	await toCard(page, "ACME WIDGETS");
	await top(page).getByRole("button", { name: "Split" }).click();
	const editor = page.getByRole("dialog");
	await expect(editor.getByRole("group", { name: "Split 2" })).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(editor).toHaveCount(0);
	await focusedCard(page).focus();
	await page.keyboard.press("s");
	await expect(editor).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(editor).toHaveCount(0);

	// No Personal Allowance yet: P says so.
	await focusedCard(page).focus();
	await page.keyboard.press("p");
	await expect(said(page)).toContainText("You don’t have a Personal Allowance");

	// Make a Rule: by its button and by R, it starts from the merchant.
	await top(page).getByRole("button", { name: "Make a Rule" }).click();
	const rule = page.getByRole("dialog", { name: "Make a Rule" });
	await expect(rule.getByRole("textbox").first()).toHaveValue("acme widgets");
	await page.keyboard.press("Escape");
	await expect(rule).toHaveCount(0);
	await focusedCard(page).focus();
	await page.keyboard.press("r");
	await expect(rule).toBeVisible();
	await page.keyboard.press("Escape");

	// Filing offers the Rule beside the card, not in a toast over it.
	await toCard(page, "CORNER GAS");
	await top(page).getByRole("button", { name: "Confirm" }).click();
	await expect(page.getByTestId("review-rule-offer")).toContainText(
		/Always file “corner gas.*” in Gas\?/,
	);
	await expect(page.locator("[data-slot=toast]")).toHaveCount(0);

	await page.setViewportSize({ width: 393, height: 852 });
	await axe(page, "Sort on a phone");
});

test("under reduced motion the stack has no drag and no motion, and the buttons still work", async ({
	browser,
}) => {
	test.slow();
	const page = await signedInPage(browser, parent.email);
	await page.emulateMedia({ reducedMotion: "reduce" });
	await setUp(page);
	await page.setViewportSize({ width: 393, height: 852 });
	await expect(page.getByText("Swipe right to confirm, left to pick another")).toHaveCount(0);
	const gas = await toGuessed(page);
	await drag(page, top(page), 180);
	await expect(top(page).getByRole("heading", { level: 3 })).toHaveText(gas);
	await expect(stack(page)).toContainText("1 of 3");
	await top(page).getByRole("button", { name: "Confirm" }).click();
	await expect(said(page)).toHaveText(`Filed ${gas} in Gas. 2 left.`);
	// Nothing flies off.
	await expect(page.locator("[class*=animate-fly]")).toHaveCount(0);
});

test("a card filed in a Personal Allowance never reaches the other Parent", async ({ browser }) => {
	test.slow();
	const second = await createTestParent();
	try {
		const alex = await signedInPage(browser, parent.email);
		await createPlannedHousehold(alex, { baseline: "5,000", buckets: [["Groceries", "1,200"]] });
		const thisMonth = alex.url();
		const month = new Date().toLocaleDateString("en-CA").slice(0, 7);
		await alex.goto(new URL(`/plan/${month}/buckets`, thisMonth).href);
		await alex.getByLabel("Your Personal Allowance").fill("100");
		await alex.getByRole("button", { name: "Set up Personal Allowance" }).click();
		await expect(alex.getByRole("button", { name: "Set up Personal Allowance" })).toHaveCount(0);
		await uploadStatement(alex, [["SECRET HOBBY SHOP", "25.00"]], true);
		await alex.goto(new URL("/review", thisMonth).href);
		await expect(top(alex)).toContainText("SECRET HOBBY SHOP");
		await top(alex).getByRole("button", { name: "Personal Allowance" }).click();
		await expect(said(alex)).toContainText("Filed SECRET HOBBY SHOP in");
		await expect(alex.getByText(/Only you will see this Rule/)).toBeVisible();

		await alex.goto(new URL("/household", thisMonth).href);
		await alex.getByLabel("Their email").fill(second.email);
		await alex.getByRole("button", { name: /^Invite/ }).click();
		await expect(alex.getByText(`Invited ${second.email}`)).toBeVisible();

		const sam = await signedInPage(browser, second.email);
		const seen: Promise<string>[] = [];
		sam.on("response", (response) => {
			const url = new URL(response.url());
			if (
				serverFn("getMonth")(url) ||
				serverFn("getTransactions")(url) ||
				serverFn("getReview")(url)
			) {
				seen.push(response.text().catch(() => ""));
			}
		});
		await sam.goto("/welcome");
		await sam.getByLabel("Your name").fill("Sam");
		await sam.getByRole("button", { name: /^Join / }).click();
		await enterJoinedHousehold(sam);
		await sam.goto(new URL("/review", thisMonth).href);
		await expect(sam.getByRole("heading", { level: 1 })).toBeVisible();
		await expect(sam.getByText("SECRET HOBBY")).toHaveCount(0);
		await sam.goto(new URL("/transactions", thisMonth).href);
		await expect(sam.locator("[data-slot=page-header]:visible")).toContainText("Transactions");
		await expect(sam.getByText("SECRET HOBBY")).toHaveCount(0);
		for (const body of await Promise.all(seen)) expect(body).not.toContain("SECRET HOBBY");
	} finally {
		await second.remove();
	}
});
