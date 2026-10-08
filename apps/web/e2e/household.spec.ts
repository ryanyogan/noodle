import { clerk, setupClerkTestingToken } from "@clerk/testing/playwright";
import { expect, test } from "@playwright/test";
import { settledAxe } from "./axe";
import { createTestParent } from "./parents";
import { clientRendered, createPlannedHousehold, setUpLater, signedInPage } from "./session";

test("a signed-out visitor is sent to sign in, keeping where they were going", async ({ page }) => {
	await page.goto("/month/2026-08");
	await expect(page).toHaveURL(/\/sign-in\?redirect_url=.*%2Fmonth%2F2026-08/);
});

test("a signed-out visitor keeps the address's query too, as a bank's return needs (#71)", async ({
	page,
}) => {
	await page.goto("/bank/return?oauth_state_id=abc");
	await expect(page).toHaveURL(/\/sign-in\?redirect_url=.*%2Fbank%2Freturn%3Foauth_state_id%3Dabc/);
	expect(new URL(page.url()).searchParams.get("redirect_url")).toBe(
		"/bank/return?oauth_state_id=abc",
	);
});

test("a new Parent signs in, creates a Household, and can leave setup for an empty This Month", async ({
	page,
}) => {
	const parent = await createTestParent();
	try {
		await setupClerkTestingToken({ page });
		await page.goto("/");
		await clerk.signIn({ page, emailAddress: parent.email });

		await page.goto("/month");
		await expect(page).toHaveURL(/\/welcome/);

		await page.getByLabel("Household name").fill("The Testers");
		await page.getByLabel("Your name").fill("Alex");
		await page.getByRole("button", { name: "Create Household" }).click();

		// The get-started wizard comes first; the Get started checklist is the fallback.
		await expect(page.getByText("Step 1 of 7")).toBeVisible();
		await setUpLater(page);
		await expect(page).toHaveURL(/\/month\/\d{4}-\d{2}$/);
		await expect(page.locator("[data-slot=page-header]:visible")).toContainText("This Month");
		await expect(page.getByText("The Testers")).toBeVisible();
		await expect(page.getByRole("region", { name: "Get started" })).toContainText(
			"Set your take-home pay",
		);

		// A Parent with a Household never sees the create step again.
		await page.goto("/welcome");
		await expect(page).toHaveURL(/\/month\/\d{4}-\d{2}$/);
	} finally {
		await parent.remove();
	}
});

test("Household settings is settings only, grouped under short headings (#69)", async ({
	browser,
}) => {
	const parent = await createTestParent();
	try {
		const page = await signedInPage(browser, parent.email);
		await createPlannedHousehold(page, { baseline: "5,000", buckets: [["Fun", "200"]] });
		await page.goto("/household");
		await expect(page.getByRole("heading", { level: 2 })).toHaveText([
			"Household",
			"People",
			"Bringing in spending",
			"Setup",
			"Reminders",
			"Your data",
			"Danger zone",
		]);
		// Account is the sidebar's on a desktop; a phone has it as the last group.
		await expect(page.getByRole("heading", { name: "Children", level: 3 })).toBeVisible();
		await expect(page.getByText("Where the money went for each person")).toHaveCount(0);
		await expect(page.getByRole("link", { name: "the Glossary" })).toHaveCount(0);
		await expect(
			page
				.getByRole("navigation", { name: "Main" })
				.getByRole("link", { name: "Household settings" }),
		).toHaveAttribute("aria-current", "page");

		// axe on a desktop and a phone, once hydrated.
		await expect(page.getByRole("button", { name: "Run setup again" })).toBeEnabled(clientRendered);
		for (const width of [1440, 393]) {
			await page.setViewportSize({ width, height: 900 });
			const { violations } = await (await settledAxe(page))
				.withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
				.analyze();
			expect(
				violations.map((v) => `${v.id}: ${v.help}`),
				`${width}: axe violations`,
			).toEqual([]);
		}
		await page.setViewportSize({ width: 1440, height: 900 });

		// The Household's name and time zone are set here; the name shows in the header at once.
		await page.getByLabel("Household name").fill("The Renamed");
		await page.getByRole("combobox", { name: "Time zone" }).click();
		await page.getByRole("option", { name: "Pacific" }).click();
		await page.getByRole("button", { name: "Save", exact: true }).click();
		await expect(page.locator("[data-slot=page-header]:visible")).toContainText("The Renamed");
		await page.reload();
		await expect(page.getByLabel("Household name")).toHaveValue("The Renamed");
		await expect(page.getByRole("combobox", { name: "Time zone" })).toHaveText("Pacific");
		await page.context().close();
	} finally {
		await parent.remove();
	}
});
