import { expect, type Page, test } from "@playwright/test";
import { createTestParent } from "./parents";
import { openToDo, savedBy, signedInPage } from "./session";

// "Apply suggested amounts" (#72): setup scales the starter Buckets to the take-home pay a Parent
// gives at step 2. When take-home pay later changes on Plan › Income, This Month offers each
// starter Bucket its new share in one go, leaving a Bucket a Parent changed by hand as it is.

const PAY = "What lands in your account in a normal month, after tax?";
const APPLY = "Apply suggested amounts";

/** With SHOTS_DIR set, pictures of the page at 1440 and 393 wide, for looking at by hand. */
async function shots(page: Page, name: string) {
	const dir = process.env.SHOTS_DIR;
	if (!dir) return;
	const before = page.viewportSize();
	for (const [width, height] of [
		[1440, 900],
		[393, 852],
	] as const) {
		await page.setViewportSize({ width, height });
		await page.waitForTimeout(400);
		await page.screenshot({ path: `${dir}/${name}-${width}.png`, fullPage: true });
	}
	if (before) await page.setViewportSize(before);
}

/** A new Household set up with $5,000 take-home pay and the starter Buckets, left at step 5. */
async function setUpThenLater(page: Page): Promise<string> {
	await page.goto("/welcome");
	await page.getByLabel("Household name").fill("The Starters");
	await page.getByLabel("Your name").fill("Alex");
	await page.getByRole("button", { name: "Create Household" }).click();
	await expect(page).toHaveURL(/\/setup$/);
	const next = async (step: number) => {
		const saved = savedBy(page, "saveSetup");
		await page.getByRole("button", { name: "Continue", exact: true }).click();
		await saved;
		await expect(page.getByText(`Step ${step} of 7`)).toBeVisible();
	};
	await page.getByRole("radio", { name: /I’ll add things by hand/ }).check();
	await next(2);
	await page.getByRole("textbox", { name: PAY }).fill("5,000");
	await next(3);
	await next(4);
	await next(5);
	await page.getByRole("link", { name: "Set up later" }).click();
	await expect(page).toHaveURL(/\/month\//);
	const month = new URL(page.url()).pathname.split("/")[2];
	if (!month) throw new Error(`No month in ${page.url()}`);
	return month;
}

/** Raises take-home pay to $6,000 from this month on, on Plan › Income. */
async function raisePay(page: Page, month: string) {
	await page.goto(`/plan/${month}/income`);
	await page.getByRole("button", { name: "Edit take-home pay" }).click();
	const sheet = page.getByRole("dialog", { name: "Take-home pay" });
	await sheet.getByRole("textbox", { name: "Take-home pay" }).fill("6,000");
	const saved = savedBy(page, "setTakeHomePay");
	await sheet.getByRole("button", { name: "Save", exact: true }).click();
	await saved;
	await expect(page.getByText("$6,000").first()).toBeVisible();
}

async function allowanceOf(page: Page, month: string, bucket: string) {
	await page.goto(`/plan/${month}#buckets`);
	await page.getByRole("button", { name: `Edit ${bucket}` }).click();
	const sheet = page.getByRole("dialog", { name: bucket });
	const value = await sheet.getByRole("textbox", { name: "Allowance", exact: true }).inputValue();
	await page.keyboard.press("Escape");
	return value.replace(/\.00$/, "").replace(/,/g, "");
}

const toDo = (page: Page) => page.getByRole("region", { name: "To do" });

test("Apply all gives the starter Buckets their share of new take-home pay and leaves one changed by hand", async ({
	browser,
}) => {
	test.slow();
	const parent = await createTestParent();
	try {
		const page = await signedInPage(browser, parent.email);
		const month = await setUpThenLater(page);
		// Setup's own amounts match the pay it was given: nothing to suggest yet.
		await expect(toDo(page).getByText(APPLY)).toHaveCount(0);
		const groceriesBefore = await allowanceOf(page, month, "Groceries");
		await raisePay(page, month);

		// Gas changed by hand.
		await page.goto(`/plan/${month}#buckets`);
		await page.getByRole("button", { name: "Edit Gas" }).click();
		const sheet = page.getByRole("dialog", { name: "Gas" });
		await sheet.getByRole("textbox", { name: "Allowance", exact: true }).fill("450");
		const saved = savedBy(page, "setAllowance");
		await sheet.getByRole("button", { name: "Save", exact: true }).click();
		await saved;

		await page.goto(`/month/${month}`);
		await openToDo(page, APPLY);
		const region = toDo(page);
		await expect(region).toContainText("→");
		await expect(region).not.toContainText("Gas");
		const listed = await region.innerText();
		const groceries = /Groceries[\s\S]*?→\s*\$([\d,]+)/.exec(listed);
		expect(groceries, listed).not.toBeNull();
		const suggested = groceries?.[1]?.replace(/,/g, "") ?? "";
		expect(Number(suggested)).toBeGreaterThan(Number(groceriesBefore));
		await shots(page, "apply-item");

		const applied = savedBy(page, "applySuggestedAmounts");
		await region.getByRole("button", { name: "Apply all" }).click();
		await applied;
		await expect(region.getByText(APPLY)).toHaveCount(0);
		await page.reload();
		await expect(page.locator("[data-slot=page-header]:visible")).toContainText("This Month");
		await expect(toDo(page).getByText(APPLY)).toHaveCount(0);

		expect(await allowanceOf(page, month, "Gas")).toBe("450");
		expect(await allowanceOf(page, month, "Groceries")).toBe(suggested);
	} finally {
		await parent.remove();
	}
});

test("Not now stops offering the suggested amounts", async ({ browser }) => {
	test.slow();
	const parent = await createTestParent();
	try {
		const page = await signedInPage(browser, parent.email);
		const month = await setUpThenLater(page);
		await raisePay(page, month);
		await page.goto(`/month/${month}`);
		await openToDo(page, APPLY);
		await toDo(page).getByRole("button", { name: "Not now" }).click();
		await expect(toDo(page).getByText(APPLY)).toHaveCount(0);
		await page.reload();
		await expect(page.locator("[data-slot=page-header]:visible")).toContainText("This Month");
		await page.waitForTimeout(1500);
		await expect(toDo(page).getByText(APPLY)).toHaveCount(0);
	} finally {
		await parent.remove();
	}
});
