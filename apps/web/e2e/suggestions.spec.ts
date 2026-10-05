import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { createTestParent } from "./parents";
import {
	createPlannedHousehold,
	reloadUntil,
	savedBy,
	signedInPage,
	uploadStatement,
	waitForReview,
} from "./session";

// Suggestions (#58, ADR-0027, #76): a statement with months of a real bill gets a Commitment
// suggestion under Plan › Commitments after the background run, saying why. Never on This Month.
// Add creates the Commitment; Not now sticks. Bucket suggestions show under Plan › Buckets.

let parent: Awaited<ReturnType<typeof createTestParent>>;

test.beforeEach(async () => {
	parent = await createTestParent();
});

test.afterEach(async () => {
	await parent?.remove();
});

const shots =
	"/tmp/claude-1000/-home-ryan-Work-noodle/135121c1-f742-4921-8d27-be919c6ca3f4/scratchpad/s76b";

const shots58d1b =
	"/tmp/claude-1000/-home-ryan-Work-noodle/350084fd-f9e1-4b75-9ecf-7a4034e88af2/scratchpad/s58d1b";

async function axe(page: Page, label: string) {
	const { violations } = await new AxeBuilder({ page })
		.withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
		.analyze();
	expect(
		violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`),
		label,
	).toEqual([]);
}

const daysAgo = (days: number) => {
	const date = new Date();
	date.setDate(date.getDate() - days);
	return date.toLocaleDateString("en-US");
};

/** The same day of an earlier month, as a bill falls. */
const monthsAgo = (months: number, day: number) => {
	const date = new Date();
	date.setDate(1);
	date.setMonth(date.getMonth() - months);
	date.setDate(day);
	return date.toLocaleDateString("en-US");
};

const thisMonth = () => new Date().toLocaleDateString("en-CA").slice(0, 7);

test("a bill is suggested under Plan › Commitments with its reason, not on This Month; Add creates it, Not now sticks", async ({
	browser,
}) => {
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, { baseline: "6000", buckets: [["Groceries", "600"]] });
	const lines: [string, string, string][] = [];
	for (const months of [4, 3, 2, 1]) {
		lines.push(["PLANET FITNESS CLUB", "49.99", monthsAgo(months, 3)]);
		lines.push(["SPOTIFY USA", "11.99", monthsAgo(months, 5)]);
	}
	await uploadStatement(page, lines, true);
	const month = thisMonth();

	const card = page.getByTestId("suggested");
	await reloadUntil(page, `/plan/${month}/commitments`, async () => {
		await expect(card).toContainText("Planet Fitness looks like a Commitment", {
			timeout: 2_000,
		});
		await expect(card).toContainText("Spotify looks like a Commitment", { timeout: 2_000 });
	});
	await expect(card).toContainText(/Planet Fitness, \$49\.99 on the 3rd, \d+ months running\./);
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.screenshot({ path: `${shots}/commitments-1440.png`, fullPage: true });
	await axe(page, "Plan › Commitments with Suggested at 1440");

	// On a phone: no sideways scroll, and each button is a 44px target.
	await page.setViewportSize({ width: 393, height: 852 });
	await page.screenshot({ path: `${shots}/commitments-393.png`, fullPage: true });
	expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(393);
	for (const button of await card.getByRole("button").all()) {
		expect((await button.boundingBox())?.height).toBeGreaterThanOrEqual(44);
	}
	await axe(page, "Plan › Commitments with Suggested at 393");

	// This Month stays a calm glance: no Suggested card there (#76).
	await page.goto(`/month/${month}`);
	await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
	await expect(page.getByTestId("suggested")).toHaveCount(0);
	await expect(page.getByText("looks like a Commitment")).toHaveCount(0);

	await page.goto(`/plan/${month}/commitments`);
	await page.waitForLoadState("networkidle");
	// The card drops a row the moment it's tapped, before the server has answered: wait for the
	// answer too, or the reload below cancels the request and the suggestion is still there (#76).
	const putAway = savedBy(page, "decideSuggestion");
	await card.getByRole("button", { name: "Not now: Spotify" }).click();
	await expect(card).not.toContainText("Spotify");
	expect((await putAway).ok()).toBe(true);
	// Add opens the terms first, filled in from the charges, to change before adding.
	await card.getByRole("button", { name: "Add Commitment: Planet Fitness" }).click();
	const terms = card.getByRole("form", { name: /Planet Fitness, before adding/ });
	await expect(terms.getByRole("textbox", { name: "Name" })).toHaveValue("Planet Fitness");
	await expect(terms.getByRole("textbox", { name: "Amount due" })).toHaveValue("49.99");
	await terms.getByRole("textbox", { name: "Amount due" }).fill("52");
	expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(393);
	await axe(page, "Suggested Commitment terms at 393");
	const added = savedBy(page, "decideSuggestion");
	await terms.getByRole("button", { name: "Add Commitment" }).click();
	await expect(card).toBeHidden();
	expect((await added).ok()).toBe(true);

	await page.reload();
	await expect(page.getByText("Planet Fitness").first()).toBeVisible();
	await expect(page.getByTestId("suggested")).toBeHidden();
	await expect(page.getByText("$52 expected this month")).toBeVisible();
	await expect(page.getByText("Spotify")).toHaveCount(0);
});

test("steady pet spending is suggested as a Bucket under Plan › Buckets and in the Add Buckets sheet; adding it there takes the suggestion", async ({
	browser,
}) => {
	test.slow();
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, { baseline: "6000", buckets: [["Groceries", "600"]] });
	const lines: [string, string, string][] = [];
	for (const [i, ago] of [86, 80, 71, 60, 52, 44, 33, 24, 15, 6].entries()) {
		lines.push(
			i % 2 ? ["CHEWY.COM", "38.50", daysAgo(ago)] : ["PETCO 1234", "41.25", daysAgo(ago)],
		);
	}
	await uploadStatement(page, lines, true);
	const month = thisMonth();

	const card = page.getByTestId("suggested");
	await reloadUntil(page, `/plan/${month}/buckets`, () =>
		expect(card).toContainText("A Bucket for Pets", { timeout: 2_000 }),
	);
	await expect(card).toContainText("10 charges");

	await page.setViewportSize({ width: 393, height: 852 });
	await page.waitForLoadState("networkidle");
	await page.getByRole("button", { name: "Add Buckets", exact: true }).click();
	const sheet = page.getByRole("dialog", { name: "Add Buckets" });
	const pets = sheet.getByRole("checkbox", { name: "Pets", exact: true });
	const row = sheet
		.getByRole("listitem")
		.filter({ has: page.getByRole("checkbox", { name: "Pets", exact: true }) });
	await expect(row).toContainText("Suggested from your spending");
	await expect(pets).not.toBeChecked();
	await sheet.screenshot({ path: `${shots58d1b}/add-buckets-suggested-393.png` });
	expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(393);

	await pets.check();
	await row.getByRole("textbox").fill("150");
	await sheet.getByRole("button", { name: /^Add \d+ Buckets?$/ }).click();
	await expect(page.getByRole("button", { name: "Edit Pets" })).toBeVisible();
	await expect(page.getByText("$150").first()).toBeVisible();

	// Taken, not left for the next run to drop: gone from under the list at once.
	await expect(page.getByText("A Bucket for Pets")).toHaveCount(0);
});

test("filing one merchant into one Bucket by hand 3 times suggests a Rule on Review; Add Rule files the next", async ({
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
	const review = new URL("/review", page.url()).href;
	await uploadStatement(
		page,
		[
			["ACME WIDGETS LLC", "19.99"],
			["ACME WIDGETS LLC", "24.50"],
			["ACME WIDGETS LLC", "12.00"],
			["ACME WIDGETS LLC", "31.25"],
		],
		true,
	);
	await waitForReview(page, review, "1 of 4");
	const stack = page.getByTestId("review-stack");
	const top = stack.getByTestId("review-card");
	for (const left of ["2 of 4", "3 of 4", "4 of 4"]) {
		await top.getByRole("combobox", { name: "Where Acme Widgets goes", exact: true }).click();
		await page.getByRole("listbox").getByRole("option", { name: "Groceries", exact: true }).click();
		await expect(stack).toContainText(left);
	}

	const card = page.getByTestId("suggested");
	await reloadUntil(page, review, async () => {
		await expect(card).toContainText("Always put Acme Widgets in Groceries?", { timeout: 2_000 });
	});
	await expect(card).toContainText("You've done it 3 times.");
	await page.setViewportSize({ width: 393, height: 852 });
	expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(393);
	await axe(page, "Review with a Rule suggestion at 393");

	// reloadUntil left a fresh load: a click before React hydrates does nothing, and the card stays.
	await page.waitForLoadState("networkidle");
	// As above: the reload must not cancel the Add the card has already hidden.
	const added = savedBy(page, "decideSuggestion");
	await card.getByRole("button", { name: "Add Rule: Acme Widgets" }).click();
	await expect(card).toBeHidden();
	expect((await added).ok()).toBe(true);
	// The new Rule looks again at Review in the background and files the fourth one.
	await reloadUntil(page, review, async () => {
		await expect(page.getByText("Nothing to review")).toBeVisible({ timeout: 2_000 });
	});
	await expect(page.getByTestId("suggested")).toBeHidden();
});
