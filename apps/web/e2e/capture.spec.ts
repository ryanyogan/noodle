import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect } from "@playwright/test";
import { createPlannedHousehold, signedInPage } from "./session";
import { type SharedParent, test } from "./worker-parent";

// Tap to capture: a Parent makes their capture token on the Household page, and what the iPhone
// Shortcut sends (the fixture, as Get Contents of URL posts it) becomes their Quick Add.

let parent: SharedParent;

test.beforeEach(async ({ sharedParent }) => {
	parent = sharedParent;
});

const shortcutRequest = JSON.parse(
	readFileSync(join(import.meta.dirname, "fixtures", "capture-request.json"), "utf8"),
);

test("a payment the Shortcut sends shows up as the Parent's Quick Add", async ({ browser }) => {
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, { baseline: "5,000", buckets: [["Eating out", "300"]] });
	const transactions = page.url().replace(/\/month\/(\d{4}-\d{2}).*$/, "/transactions/$1");

	await page.goto("/household");
	const capture = page.getByRole("region", { name: "Tap to capture" });
	await capture.getByRole("button", { name: "Set up" }).click();
	const guide = page.getByRole("dialog", { name: "Set up tap to capture" });
	await expect(guide.getByRole("button", { name: "Copy URL" })).toBeVisible();
	await expect(
		guide.getByRole("listitem").filter({ hasText: "Get Contents of URL" }),
	).toBeVisible();
	const token =
		(await guide
			.locator("code")
			.filter({ hasText: /^noodle_/ })
			.textContent()) ?? "";
	const url = await guide
		.locator("code")
		.filter({ hasText: /\/api\/capture$/ })
		.textContent();
	await page.keyboard.press("Escape");
	await expect(capture).toContainText("Your iPhone Shortcut’s token was made");

	// Sent twice, as a retrying Shortcut might: it's one Quick Add.
	const body = { ...shortcutRequest, at: new Date().toISOString() };
	for (let i = 0; i < 2; i++) {
		const response = await page.request.post(url ?? "", {
			headers: { Authorization: `Bearer ${token}` },
			data: body,
		});
		expect(response.status()).toBe(202);
	}
	const refused = await page.request.post(url ?? "", {
		headers: { Authorization: "Bearer noodle_wrong" },
		data: body,
	});
	expect(refused.status()).toBe(401);

	await page.goto(transactions);
	const row = page.getByRole("button", { name: /^Blue Bottle Coffee, \$5\.75, Unassigned/ });
	// The ingest Queue delivers it within moments; the list refetches when it lands.
	await expect(async () => {
		await page.reload();
		await expect(row).toBeVisible({ timeout: 2_000 });
	}).toPass({ timeout: 20_000 });
	await expect(row).toHaveCount(1);

	// Categorized like an Import's lines: a merchant the model is sure of is filed, and marked.
	const starbucks = await page.request.post(url ?? "", {
		headers: { Authorization: `Bearer ${token}` },
		data: { merchant: "Starbucks", amount: "$6.40", at: new Date().toISOString() },
	});
	expect(starbucks.status()).toBe(202);
	const filed = page.getByRole("button", {
		name: /^Starbucks, \$6\.40, Eating out \(filed automatically\)/,
	});
	await expect(async () => {
		await page.reload();
		await expect(filed).toBeVisible({ timeout: 2_000 });
	}).toPass({ timeout: 20_000 });
	await expect(row).toBeVisible();

	// Revoked, the token no longer captures anything.
	await page.goto("/household");
	await capture.getByRole("button", { name: "Revoke" }).click();
	await page.getByRole("alertdialog").getByRole("button", { name: "Revoke token" }).click();
	await expect(capture.getByRole("button", { name: "Set up" })).toBeVisible();
	const afterRevoke = await page.request.post(url ?? "", {
		headers: { Authorization: `Bearer ${token}` },
		data: body,
	});
	expect(afterRevoke.status()).toBe(401);
});
