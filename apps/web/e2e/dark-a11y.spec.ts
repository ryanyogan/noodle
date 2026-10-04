import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { createTestParent } from "./parents";
import { clientRendered, createHousehold, signedInPage } from "./session";

// Warm paper (#75): axe on the main pages at desktop width in dark mode (the specs mostly run light).
const pages = ["/month", "/accounts", "/goals", "/reports", "/plan", "/transactions", "/household"];

let parent: Awaited<ReturnType<typeof createTestParent>>;
test.beforeAll(async () => {
	parent = await createTestParent();
});
test.afterAll(async () => {
	await parent?.remove();
});

test("axe finds no violations on a desktop in dark mode", async ({ browser }) => {
	test.setTimeout(180_000);
	const page = await signedInPage(browser, parent.email, {
		viewport: { width: 1440, height: 900 },
	});
	await createHousehold(page, "The Rinks", "Alex");
	await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
	for (const path of pages) {
		await page.goto(path);
		await expect(page.locator("[data-slot=page-header]:visible").first()).toBeVisible(
			clientRendered,
		);
		await page.evaluate(() => document.fonts.ready);
		const { violations } = await new AxeBuilder({ page })
			.withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
			.analyze();
		expect
			.soft(
				violations.map(
					(v) =>
						`${v.id}: ${v.nodes
							.map((n) => `${n.target.join(" ")} ${n.any[0]?.message ?? ""}`)
							.slice(0, 4)
							.join(" | ")}`,
				),
				`dark ${path}: axe violations`,
			)
			.toEqual([]);
	}
	await page.context().close();
});
