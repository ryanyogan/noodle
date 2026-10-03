import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { createTestParent } from "./parents";
import {
	createPlannedHousehold,
	reloadUntil,
	signedInPage,
	uploadStatement,
	waitForReview,
} from "./session";

// Suggestions (#58, ADR-0027): a statement with months of a recurring charge gets a Commitment
// suggestion on This Month after the background run. Add creates the Commitment; Not now sticks.

let parent: Awaited<ReturnType<typeof createTestParent>>;

test.beforeEach(async () => {
	parent = await createTestParent();
});

test.afterEach(async () => {
	await parent?.remove();
});

const shots =
	"/tmp/claude-1000/-home-ryan-Work-noodle/350084fd-f9e1-4b75-9ecf-7a4034e88af2/scratchpad/s58c";

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

test("a recurring charge is suggested as a Commitment; Add creates it, Not now sticks", async ({
	browser,
}) => {
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, { baseline: "6000", buckets: [["Groceries", "600"]] });
	const lines: [string, string, string][] = [];
	for (const ago of [92, 61, 31, 1]) {
		lines.push(["PLANET FITNESS CLUB", "49.99", daysAgo(ago)]);
		lines.push(["SPOTIFY USA", "11.99", daysAgo(ago + 2)]);
	}
	await uploadStatement(page, lines, true);

	const card = page.getByTestId("suggested");
	await reloadUntil(page, "/month", async () => {
		await expect(card).toContainText("Planet Fitness looks like a Commitment", {
			timeout: 2_000,
		});
		await expect(card).toContainText("Spotify looks like a Commitment", { timeout: 2_000 });
	});
	await expect(card).toContainText("$49.99 a month, seen 4 times.");
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.screenshot({ path: `${shots}/this-month-1440.png`, fullPage: true });
	await axe(page, "This Month with Suggested at 1440");

	// On a phone: no sideways scroll, and each button is a 44px target.
	await page.setViewportSize({ width: 393, height: 852 });
	await card.scrollIntoViewIfNeeded();
	await card.screenshot({ path: `${shots}/suggested-393.png` });
	expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(393);
	for (const button of await card.getByRole("button").all()) {
		expect((await button.boundingBox())?.height).toBeGreaterThanOrEqual(44);
	}
	await axe(page, "This Month with Suggested at 393");

	await card.getByRole("button", { name: "Not now: Spotify" }).click();
	await expect(card).not.toContainText("Spotify");
	// Add opens the terms first, filled in from the charges, to change before adding.
	await card.getByRole("button", { name: "Add Commitment: Planet Fitness" }).click();
	const terms = card.getByRole("form", { name: /Planet Fitness, before adding/ });
	await expect(terms.getByRole("textbox", { name: "Name" })).toHaveValue("Planet Fitness");
	await expect(terms.getByRole("textbox", { name: "Amount due" })).toHaveValue("49.99");
	await terms.getByRole("textbox", { name: "Amount due" }).fill("52");
	expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(393);
	await axe(page, "Suggested Commitment terms at 393");
	await terms.getByRole("button", { name: "Add Commitment" }).click();
	await expect(card).toBeHidden();

	await page.reload();
	await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
	await expect(page.getByTestId("suggested")).toBeHidden();
	const month = page.url().match(/\/month\/(\d{4}-\d{2})/)?.[1];
	await page.goto(`/plan/${month}/commitments`);
	await expect(page.getByText("Planet Fitness").first()).toBeVisible();
	await expect(page.getByText("$52 expected this month")).toBeVisible();
	await expect(page.getByText("Spotify")).toHaveCount(0);
});

test("steady pet spending is suggested as a Bucket on This Month and in the Add Buckets sheet; adding it there takes the suggestion", async ({
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

	const card = page.getByTestId("suggested");
	await reloadUntil(page, "/month", () =>
		expect(card).toContainText("A Bucket for Pets", { timeout: 2_000 }),
	);
	await expect(card).toContainText("10 charges");
	const month = page.url().match(/\/month\/(\d{4}-\d{2})/)?.[1];

	await page.setViewportSize({ width: 393, height: 852 });
	await page.goto(`/plan/${month}/buckets`);
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

	// Taken, not left for the next run to drop: gone from This Month at once.
	await page.goto(`/month/${month}`);
	await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
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
	await page.screenshot({
		path: "/tmp/claude-1000/-home-ryan-Work-noodle/350084fd-f9e1-4b75-9ecf-7a4034e88af2/scratchpad/s58d1/review-rule-393.png",
		fullPage: true,
	});
	expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(393);
	await axe(page, "Review with a Rule suggestion at 393");

	await card.getByRole("button", { name: "Add Rule: Acme Widgets" }).click();
	await expect(card).toBeHidden();
	// The new Rule looks again at Review in the background and files the fourth one.
	await reloadUntil(page, review, async () => {
		await expect(page.getByText("Nothing to review")).toBeVisible({ timeout: 2_000 });
	});
	await expect(page.getByTestId("suggested")).toBeHidden();
});
