import { type Browser, expect, type Page, test } from "@playwright/test";
import { createTestParent } from "./parents";
import {
	createPlannedHousehold,
	hydrated,
	pickQuickAddBucket,
	planBucketsUrl,
	savedBy,
	signedInPage,
} from "./session";

// Deleting a Bucket (issue 98): the Bucket sheet offers Delete, beside Archive, only for a Bucket
// nothing points at. One with a Transaction filed in it says why it can only be archived.

let parent: Awaited<ReturnType<typeof createTestParent>>;

test.beforeEach(async () => {
	parent = await createTestParent();
});

test.afterEach(async () => {
	await parent?.remove();
});

const row = (page: Page, name: string) =>
	page
		.getByRole("grid", { name: "Buckets", exact: true })
		.locator("[data-bucket-row]")
		.filter({ hasText: name });

/** A picture to look at, only when asked for: `SHOTS=after-1440`. */
const shot = async (page: Page, name: string) => {
	if (process.env.SHOTS) {
		await page.screenshot({ path: `test-results/shots/${process.env.SHOTS}-${name}.png` });
	}
};

async function open(browser: Browser, phone: boolean) {
	return signedInPage(
		browser,
		parent.email,
		phone ? { viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true } : undefined,
	);
}

async function deleteOne(page: Page, phone: boolean) {
	await createPlannedHousehold(page, {
		baseline: "5,000",
		buckets: [
			["Groceries", "800"],
			["Fun", "100"],
		],
	});
	// Something filed in Groceries: it can no longer be deleted.
	await page.getByRole("link", { name: "Quick Add" }).click();
	const quick = page.getByRole("dialog", { name: "Quick Add" });
	await expect(quick).toBeVisible();
	await page.keyboard.type("12");
	await quick.getByLabel("Note").fill("milk");
	await pickQuickAddBucket(quick, "Groceries");
	await expect(quick).toBeHidden();

	await page.getByRole("link", { name: "Edit Buckets", exact: true }).click();
	await expect(page).toHaveURL(planBucketsUrl);

	const pencil = page.getByRole("button", { name: "Edit Groceries", exact: true });
	await hydrated(pencil);
	await pencil.click();
	const groceries = page.getByRole("dialog", { name: "Groceries" });
	await expect(groceries.locator("[data-slot=bucket-kept]")).toHaveText(
		"Groceries can’t be deleted: Transactions are filed in it. Archive it instead, and earlier months keep it.",
	);
	await expect(groceries.getByRole("button", { name: "Archive", exact: true })).toBeVisible();
	await expect(groceries.getByRole("button", { name: "Delete", exact: true })).toHaveCount(0);
	await groceries.locator("[data-slot=bucket-kept]").scrollIntoViewIfNeeded();
	await shot(page, "kept");
	await page.keyboard.press("Escape");
	await expect(groceries).toBeHidden();

	// Fun has had nothing filed in it and is new this month: it can go for good.
	await page.getByRole("button", { name: "Edit Fun", exact: true }).click();
	const fun = page.getByRole("dialog", { name: "Fun" });
	const remove = fun.getByRole("button", { name: "Delete", exact: true });
	const archive = fun.getByRole("button", { name: "Archive", exact: true });
	await expect(remove).toBeVisible();
	await expect(fun.locator("[data-slot=bucket-kept]")).toHaveCount(0);
	await remove.scrollIntoViewIfNeeded();
	await shot(page, "delete");
	if (phone) {
		// One row of actions, inside the sheet, at 393 and on the narrowest phone.
		for (const width of [393, 320]) {
			await page.setViewportSize({ width, height: 852 });
			await remove.scrollIntoViewIfNeeded();
			const [a, d] = [await archive.boundingBox(), await remove.boundingBox()];
			expect(d?.y).toBe(a?.y);
			expect((d?.x ?? 0) + (d?.width ?? 0)).toBeLessThanOrEqual(width - 16);
			expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
				width,
			);
			if (width === 320) await shot(page, "delete-320");
		}
		await page.setViewportSize({ width: 393, height: 852 });
	}
	await remove.click();
	const confirm = page.getByRole("alertdialog", { name: "Delete Fun" });
	await expect(confirm).toContainText(
		"Fun goes for good, with its allowance and its Plan history.",
	);
	await shot(page, "confirm");
	const deleted = savedBy(page, "deleteBucket");
	await confirm.getByRole("button", { name: "Delete Fun", exact: true }).click();
	await deleted;
	await expect(row(page, "Fun")).toHaveCount(0);
	await expect(row(page, "Groceries")).toHaveCount(1);

	await page.reload();
	await expect(row(page, "Groceries")).toHaveCount(1);
	await expect(row(page, "Fun")).toHaveCount(0);
	await expect(page.getByRole("link", { name: "Fun", exact: true })).toHaveCount(0);
	await shot(page, "gone");
	// Its Plan changes went with it: the Log has Groceries' and nothing of Fun's.
	await page.getByRole("link", { name: "See what changed" }).click();
	const log = page.getByRole("table", { name: "Log" });
	await expect(
		log.locator("[data-slot=data-table-row]").filter({ hasText: "Groceries" }),
	).not.toHaveCount(0);
	await expect(log).not.toContainText("Fun");
	await page.goBack();
}

test("a Bucket nothing was filed in is deleted; one with spending can only be archived", async ({
	browser,
}) => {
	test.setTimeout(120_000);
	const page = await open(browser, false);
	await deleteOne(page, false);
	await page.context().close();
});

test("a Bucket is deleted from its sheet on a phone", { tag: "@phone" }, async ({ browser }) => {
	test.setTimeout(120_000);
	const page = await open(browser, true);
	await deleteOne(page, true);
	await page.context().close();
});
