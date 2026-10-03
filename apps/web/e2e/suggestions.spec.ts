import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { createTestParent } from "./parents";
import { createPlannedHousehold, reloadUntil, signedInPage, uploadStatement } from "./session";

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
		await expect(card).toContainText("Planet Fitness Club looks like a Commitment", {
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
	await card.getByRole("button", { name: "Add Commitment: Planet Fitness Club" }).click();
	await expect(card).toBeHidden();

	await page.reload();
	await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
	await expect(page.getByTestId("suggested")).toBeHidden();
	const month = page.url().match(/\/month\/(\d{4}-\d{2})/)?.[1];
	await page.goto(`/plan/${month}/commitments`);
	await expect(page.getByText("Planet Fitness Club").first()).toBeVisible();
	await expect(page.getByText("Spotify")).toHaveCount(0);
});
