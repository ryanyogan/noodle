import { expect } from "@playwright/test";
import { clientRendered, createPlannedHousehold, signedInPage } from "./session";
import { type SharedParent, test } from "./worker-parent";

let parent: SharedParent;

test.beforeEach(async ({ sharedParent }) => {
	parent = sharedParent;
});

test("how far ahead Explore and the Scenarios look is in the link, 2 years unless picked (#51)", async ({
	browser,
}) => {
	test.slow();
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, { baseline: "5,000", buckets: [["Groceries", "1,200"]] });

	await page.goto("/explore?lever=baseline:600000");
	const ahead = page.getByLabel("Look ahead");
	const changes = page.getByRole("region", { name: "Your changes" });
	await expect(changes).toContainText("Income $5,000 → $6,000 a month", clientRendered);
	await expect(ahead.getByText("2 years", { exact: true })).toHaveAttribute("data-state", "on");
	// Picking a horizon puts it in the link, and the Changes stay as they are.
	await ahead.getByText("5 years", { exact: true }).click();
	await expect(page).toHaveURL(/[?&]years=5/);
	await expect(changes).toContainText("Income $5,000 → $6,000 a month");
	await expect(changes).toContainText("over 5 years");
	await page.getByLabel("Name", { exact: true }).fill("Raise");
	await page.getByRole("button", { name: "Save Scenario" }).click();
	await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Raise");

	// A link to the Scenarios reopens its horizon, and it carries on to a Scenario and back.
	await page.goto("/explore/scenarios?years=3");
	await expect(page.getByText("Each against the Plan over 3 years")).toBeVisible(clientRendered);
	await expect(ahead.getByText("3 years", { exact: true })).toHaveAttribute("data-state", "on");
	await page.getByRole("link", { name: "Raise", exact: true }).click();
	await expect(page).toHaveURL(/\/explore\/scenarios\/[^?]+\?.*years=3/);
	// The Scenario's own line; the Scenarios list's "Each against the Plan over 3 years" can still
	// be in the document beside it.
	await expect(page.getByText(/^Against the Plan over 3 years/)).toBeVisible();
	await expect(page.getByText("Free to Spend, 3 years").first()).toBeVisible();
	await page.getByRole("link", { name: "Open in Explore" }).click();
	await expect(page).toHaveURL(/\/explore\?.*years=3/);
	await expect(ahead.getByText("3 years", { exact: true })).toHaveAttribute(
		"data-state",
		"on",
		clientRendered,
	);

	// Anything else in the link is the default, 2 years.
	await page.goto("/explore/scenarios?years=7");
	await expect(page.getByText("Each against the Plan over 2 years")).toBeVisible(clientRendered);
});
