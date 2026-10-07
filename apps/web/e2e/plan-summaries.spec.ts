import { expect, test } from "@playwright/test";
import { openCommitmentForm } from "./commitment-form";
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
		await page.goto(`/plan/${month}#buckets`);
		await expect(page.getByRole("button", { name: "Move Fun" })).toBeEnabled();
		// The summary's amount is a Money: tabular, never broken.
		await expect(
			page
				.locator("[data-slot=section-header]")
				.filter({ has: page.locator("h2#buckets") })
				.locator("[data-slot=money]")
				.first(),
		).toHaveText("$1,650");

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
		const add = await openCommitmentForm(page);
		await add.getByLabel("New Commitment").fill("Daycare");
		await add.getByLabel("Amount due").fill("1,400");
		await add.getByRole("button", { name: "Add Commitment" }).click();
		await expect(page.locator("[data-slot=money]").first()).toHaveText("$1,400");
		await page.getByRole("link", { name: "Daycare", exact: true }).first().click();
		await page.waitForURL(/\/commitments\/\w+/);
		await expect(page.getByRole("heading", { name: "Daycare" }).first()).toBeVisible({
			timeout: 20_000,
		});
		if (SHOTS) await page.screenshot({ path: `${SHOTS}/commitment-page.png`, fullPage: true });

		// The list row beside it has the narrow pane to itself: no yearly column, so the name
		// keeps one line instead of breaking mid-word.
		const list = page.locator("[data-slot=master-detail-list]");
		const name = await list.getByRole("link", { name: "Daycare", exact: true }).boundingBox();
		expect(name?.height ?? 0).toBeLessThan(30);
		if (SHOTS) {
			await page.setViewportSize({ width: 1440, height: 900 });
			await page.screenshot({ path: `${SHOTS}/commitment-page-1440.png` });
			await page.setViewportSize({ width: 393, height: 852 });
			await page.goto(`/plan/${month}/commitments`);
			await expect(page.getByRole("button", { name: "Edit Daycare" })).toBeVisible();
			await page.screenshot({ path: `${SHOTS}/commitments-393.png`, fullPage: true });
			await page.setViewportSize({ width: 1280, height: 800 });
			await page.goto(`/plan/${month}/buckets/`);
			await page.getByRole("link", { name: "Groceries", exact: true }).first().click();
			await expect(page.getByRole("heading", { name: "Groceries" }).first()).toBeVisible();
			await page.screenshot({ path: `${SHOTS}/bucket-page-1280.png` });
		}
	} finally {
		await parent.remove();
	}
});
