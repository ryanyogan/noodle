import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { createTestParent } from "./parents";
import { createPlannedHousehold, savedBy, serverFn, signedInPage } from "./session";
import { realTouch, swipe } from "./touch";

// The Plan's Buckets list (#57, #98): a row opens the one Bucket sheet, where its amount (with how
// far the change reaches) and name change; Buckets moved by keyboard and by drag, said aloud and
// saved; Left to plan follows what's typed. Dragging (issue 106): down as well as up, from the
// smallest movement, under a finger, saved once per drop.

let parent: Awaited<ReturnType<typeof createTestParent>>;

test.beforeEach(async () => {
	parent = await createTestParent();
});

test.afterEach(async () => {
	await parent?.remove();
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

const row = (page: Page, name: string) =>
	page.locator("[data-bucket-row]").filter({ has: page.getByRole("link", { name, exact: true }) });

/** Opens a Bucket's sheet by its amount in the list, as a tap anywhere on its row does. */
async function openByAmount(page: Page, name: string, amount: string) {
	await row(page, name).getByText(amount, { exact: true }).first().click();
	return page.getByRole("dialog", { name, exact: true });
}

async function axe(page: Page, label: string) {
	const { violations } = await new AxeBuilder({ page })
		.withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
		.analyze();
	expect(
		violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`),
		label,
	).toEqual([]);
}

test("Buckets are changed in one sheet from the list, with either reach, and moved by keyboard and drag", async ({
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

	// From this month on: the row's amount opens the sheet on its amount, Left to plan follows the
	// typing, Enter saves.
	const groceries = await openByAmount(page, "Groceries", "$800");
	const amount = groceries.getByRole("textbox", { name: "Allowance", exact: true });
	await expect(amount).toBeFocused();
	await page.keyboard.type("900");
	await expect(left).toContainText("$7,800");
	await expect(groceries.getByRole("radio", { name: /^From .* on$/ })).toBeChecked();
	let saved = savedBy(page, "setAllowance");
	await page.keyboard.press("Enter");
	await saved;
	await expect(groceries).toBeHidden();
	await expect(row(page, "Groceries")).toContainText("$900");

	// Just this month, from the pencil: the same sheet.
	await page.getByRole("button", { name: "Edit Gas", exact: true }).click();
	const gas = page.getByRole("dialog", { name: "Gas", exact: true });
	await gas.getByRole("textbox", { name: "Allowance", exact: true }).fill("250");
	await gas.getByRole("radio", { name: /^Just / }).click();
	saved = savedBy(page, "setAllowance");
	await gas.getByRole("textbox", { name: "Allowance", exact: true }).press("Enter");
	await saved;
	await expect(gas).toBeHidden();
	await expect(row(page, "Gas")).toContainText("$250");

	// Escape asks before throwing away what was typed; discarded, Left to plan goes back.
	const fun = await openByAmount(page, "Fun", "$100");
	await expect(fun.getByRole("textbox", { name: "Allowance", exact: true })).toBeFocused();
	await page.keyboard.type("999");
	await expect(left).toContainText("$6,851");
	await page.keyboard.press("Escape");
	await page
		.getByRole("alertdialog", { name: "Discard changes" })
		.getByRole("button", { name: "Discard changes" })
		.click();
	await expect(fun).toBeHidden();
	await expect(row(page, "Fun")).toContainText("$100");
	await expect(left).toContainText("$7,750");

	// The name changes in the same sheet.
	await openByAmount(page, "Fun", "$100");
	await fun.getByRole("textbox", { name: "Name" }).fill("Fun money");
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
	// Letting go of the handle on a row didn't open that row's sheet.
	await expect(page.getByRole("dialog")).toHaveCount(0);

	// All of it was saved: the order, both amounts, and next month's.
	await page.reload();
	await expect(page.locator("[data-bucket-row]").first()).toContainText("Gas");
	expect(await names(page)).toEqual(["Gas", "Fun money", "Groceries"]);
	await expect(row(page, "Gas")).toContainText("$250");
	await openBuckets(page, monthKey(1));
	await expect(row(page, "Groceries")).toContainText("$900");
	await expect(row(page, "Gas")).toContainText("$200");

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
				await page.getByRole("button", { name: "Edit Groceries", exact: true }).click();
				await page
					.getByRole("dialog", { name: "Groceries", exact: true })
					.getByRole("textbox", { name: "Allowance", exact: true })
					.fill("950");
				await page.screenshot({ path: `${process.env.SHOTS}/list-${width}-${colorScheme}.png` });
				await page.keyboard.press("Escape");
				await page
					.getByRole("alertdialog", { name: "Discard changes" })
					.getByRole("button", { name: "Discard changes" })
					.click();
				await page.getByRole("button", { name: "Add Buckets", exact: true }).click();
				await expect(sheet).toBeVisible();
				await page.screenshot({ path: `${process.env.SHOTS}/sheet-${width}-${colorScheme}.png` });
				await page.keyboard.press("Escape");
			}
		}
	}
});

/** Counts what is sent to save the Buckets' order: a drop sends one, however many rows it passed. */
function reordersSent(page: Page) {
	const sent = { count: 0 };
	page.on("request", (request) => {
		if (serverFn("reorderBuckets")(new URL(request.url()))) sent.count += 1;
	});
	return sent;
}

const handleOf = (page: Page, name: string) =>
	page.getByRole("button", { name: `Move ${name}`, exact: true });

const four: [string, string][] = [
	["Groceries", "800"],
	["Gas", "200"],
	["Fun", "100"],
	["Gifts", "50"],
];

test("A Bucket is dragged by its handle, down as well as up, from the smallest movement, and saved once", async ({
	browser,
}) => {
	test.setTimeout(180_000);
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, { baseline: "9,000", buckets: four });
	await openBuckets(page);
	const sent = reordersSent(page);
	const said = page.getByTestId("reorder-said");

	// Down the whole list: the direction that used to lose the row after the first one it passed.
	let box = await handleOf(page, "Groceries").boundingBox();
	const first = await row(page, "Groceries").boundingBox();
	const last = await page.locator("[data-bucket-row]").last().boundingBox();
	if (!box || !first || !last) throw new Error("No rows to drag");
	let x = box.x + box.width / 2;
	let y = box.y + box.height / 2;
	await page.mouse.move(x, y);
	await page.mouse.down();
	await page.mouse.move(x, last.y + last.height - 4, { steps: 12 });
	// The row is lifted and has come along with the pointer; the page hasn't been reordered yet.
	await expect(row(page, "Groceries")).toHaveAttribute("data-dragged", "true");
	expect((await row(page, "Groceries").boundingBox())?.y ?? 0).toBeGreaterThan(
		first.y + first.height,
	);
	expect(await names(page)).toEqual(["Groceries", "Gas", "Fun", "Gifts"]);
	expect(sent.count).toBe(0);
	let saved = savedBy(page, "reorderBuckets");
	await page.mouse.up();
	await saved;
	await expect(said).toHaveText("Groceries moved to position 4 of 4");
	expect(await names(page)).toEqual(["Gas", "Fun", "Gifts", "Groceries"]);
	await expect(row(page, "Groceries")).not.toHaveAttribute("data-dragged", "true");
	expect(sent.count).toBe(1);
	await expect(page.getByRole("dialog")).toHaveCount(0);

	// A slow drag, a px at a time: it starts after a few px, and moves one place past half a row.
	box = await handleOf(page, "Gas").boundingBox();
	if (!box) throw new Error("No handle");
	x = box.x + box.width / 2;
	y = box.y + box.height / 2;
	await page.mouse.move(x, y);
	await page.mouse.down();
	await page.mouse.move(x, y + 2);
	await expect(row(page, "Gas")).not.toHaveAttribute("data-dragged", "true");
	for (let by = 3; by <= 6; by++) await page.mouse.move(x, y + by);
	await expect(row(page, "Gas")).toHaveAttribute("data-dragged", "true");
	const travel = Math.ceil(first.height * 0.75);
	for (let by = 7; by <= travel; by++) await page.mouse.move(x, y + by);
	saved = savedBy(page, "reorderBuckets");
	await page.mouse.up();
	await saved;
	await expect(said).toHaveText("Gas moved to position 2 of 4");
	expect(await names(page)).toEqual(["Fun", "Gas", "Gifts", "Groceries"]);
	expect(sent.count).toBe(2);

	// A click on the handle moves nothing and opens nothing; the handle has the keyboard.
	await handleOf(page, "Gifts").click();
	await expect(handleOf(page, "Gifts")).toBeFocused();
	await expect(page.getByRole("dialog")).toHaveCount(0);

	// Escape in the middle of a drag puts the row back, and nothing is saved.
	box = await handleOf(page, "Fun").boundingBox();
	if (!box) throw new Error("No handle");
	x = box.x + box.width / 2;
	y = box.y + box.height / 2;
	await page.mouse.move(x, y);
	await page.mouse.down();
	await page.mouse.move(x, y + first.height * 1.6, { steps: 6 });
	await expect(row(page, "Fun")).toHaveAttribute("data-dragged", "true");
	await page.keyboard.press("Escape");
	await expect(row(page, "Fun")).not.toHaveAttribute("data-dragged", "true");
	await expect(said).toHaveText("Fun put back at position 1 of 4");
	await page.mouse.up();
	expect(await names(page)).toEqual(["Fun", "Gas", "Gifts", "Groceries"]);
	await expect(page.getByRole("dialog")).toHaveCount(0);

	// The arrow keys still move it. By now anything the clicks or the Escape had sent would have
	// been counted: three drops and moves, three saves.
	await handleOf(page, "Fun").focus();
	saved = savedBy(page, "reorderBuckets");
	await page.keyboard.press("ArrowDown");
	await saved;
	await expect(said).toHaveText("Fun moved to position 2 of 4");
	expect(await names(page)).toEqual(["Gas", "Fun", "Gifts", "Groceries"]);
	expect(sent.count).toBe(3);

	await page.reload();
	await expect(page.locator("[data-bucket-row]").first()).toContainText("Gas");
	expect(await names(page)).toEqual(["Gas", "Fun", "Gifts", "Groceries"]);
	await page.context().close();
});

test("A Bucket is dragged by its handle under a finger, and the rest of the row scrolls the page", {
	tag: "@phone",
}, async ({ browser }) => {
	test.setTimeout(180_000);
	const page = await signedInPage(browser, parent.email, {
		viewport: { width: 393, height: 852 },
		isMobile: true,
		hasTouch: true,
	});
	await createPlannedHousehold(page, { baseline: "9,000", buckets: four });
	await openBuckets(page);
	const sent = reordersSent(page);

	// The handle is a thumb's size, and is the one part of the row that doesn't scroll.
	const handle = handleOf(page, "Groceries");
	await handle.scrollIntoViewIfNeeded();
	const size = await handle.boundingBox();
	const height = (await row(page, "Groceries").boundingBox())?.height;
	if (!size || !height) throw new Error("No rows to drag");
	expect(size.width).toBeGreaterThanOrEqual(44);
	expect(size.height).toBeGreaterThanOrEqual(44);
	expect(await handle.evaluate((el) => getComputedStyle(el).touchAction)).toBe("none");
	expect(await row(page, "Groceries").evaluate((el) => getComputedStyle(el).touchAction)).not.toBe(
		"none",
	);

	// A finger on the handle, carried a row and a half down: two places, one save.
	const saved = savedBy(page, "reorderBuckets");
	await swipe(page, handle, height * 1.6);
	await saved;
	await expect(page.getByTestId("reorder-said")).toHaveText("Groceries moved to position 3 of 4");
	expect(await names(page)).toEqual(["Gas", "Fun", "Groceries", "Gifts"]);
	expect(sent.count).toBe(1);
	await expect(page.getByRole("dialog")).toHaveCount(0);

	// A finger anywhere else on the row scrolls the page and moves nothing. Only Chromium's touches
	// are real enough to scroll (see `swipe`).
	if (realTouch(page)) {
		await page.setViewportSize({ width: 393, height: 480 });
		const body = row(page, "Gas").getByText("$200", { exact: true }).first();
		const before = (await body.boundingBox())?.y;
		if (before === undefined) throw new Error("No row to touch");
		await swipe(page, body, -160);
		await expect
			.poll(async () => (await body.boundingBox())?.y ?? before)
			.toBeLessThan(before - 40);
		expect(await names(page)).toEqual(["Gas", "Fun", "Groceries", "Gifts"]);
		expect(sent.count).toBe(1);
		await expect(page.getByRole("dialog")).toHaveCount(0);
	}
	await page.context().close();
});
