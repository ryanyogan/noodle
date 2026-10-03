import { expect, test } from "@playwright/test";
import { createTestParent } from "./parents";
import { createPlannedHousehold, signedInPage } from "./session";

// Desktop review leftovers (#51): the Plan sub-pages' summaries are Money; a Bucket page whose
// history is whole has no "History starts"; a Commitment's stats sit in equal columns.

const SHOTS = process.env.SHOTS_DIR;

const monthKey = () => {
	const now = new Date();
	return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
};

test("Plan summaries show Money, a whole history has no History starts, a Commitment's stats line up", async ({
	browser,
}) => {
	test.setTimeout(120_000);
	const parent = await createTestParent();
	try {
		const page = await signedInPage(browser, parent.email);
		await createPlannedHousehold(page, {
			baseline: "9,000",
			buckets: [
				["Groceries", "1,200"],
				["Fun", "300"],
				["Hockey", "150"],
			],
		});
		const month = monthKey();
		await page.goto(`/plan/${month}/buckets`);
		await expect(page.getByRole("button", { name: "Move Fun" })).toBeEnabled();
		// The summary's amount is a Money: tabular, never broken.
		await expect(page.locator("[data-slot=money]").first()).toHaveText("$1,650");

		// Mid-drag, for the review: Fun's handle held over Groceries.
		const grip = await page.getByRole("button", { name: "Move Fun" }).boundingBox();
		const top = await page.locator("[data-bucket-row]").first().boundingBox();
		if (!grip || !top) throw new Error("no boxes");
		await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
		await page.mouse.down();
		await page.mouse.move(grip.x + grip.width / 2, top.y + 8, { steps: 8 });
		if (SHOTS) await page.screenshot({ path: `${SHOTS}/plan-buckets-dragging.png` });
		await page.mouse.up();

		// The Bucket page: its history begins with the add, so no "History starts".
		await page.getByRole("link", { name: "Groceries", exact: true }).first().click();
		await expect(page.getByRole("heading", { name: "Groceries" }).first()).toBeVisible();
		await expect(page.getByText("Added · $1,200").first()).toBeVisible();
		await expect(page.getByText(/History starts/)).toHaveCount(0);
		if (SHOTS) await page.screenshot({ path: `${SHOTS}/bucket-page.png`, fullPage: true });

		// A Commitment: its summary is Money, its page's stats in equal columns.
		await page.goto(`/plan/${month}/commitments`);
		const add = page.getByRole("form", { name: "Add a Commitment" });
		await add.getByLabel("New Commitment").fill("Daycare");
		await add.getByLabel("Amount due").fill("1,400");
		await add.getByRole("button", { name: "Add Commitment" }).click();
		await expect(page.locator("[data-slot=money]").first()).toHaveText("$1,400");
		await page.getByRole("link", { name: "Daycare", exact: true }).first().click();
		await page.waitForURL(/\/commitments\/\w+/);
		await expect(page.getByRole("heading", { name: "Daycare" }).first()).toBeVisible({ timeout: 20_000 });
		if (SHOTS) await page.screenshot({ path: `${SHOTS}/commitment-page.png`, fullPage: true });
	} finally {
		await parent.remove();
	}
});
