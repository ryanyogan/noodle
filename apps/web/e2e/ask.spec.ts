import { expect, type Page } from "@playwright/test";
import { currentTab } from "./section";
import {
	createPlannedHousehold,
	openFromMore,
	pickQuickAddBucket,
	serverFn,
	signedInPage,
} from "./session";
import { type SharedParent, test } from "./worker-parent";

// Ask runs against its deterministic fake model here (AI_MODEL=stub in playwright.config.ts):
// it picks a tool from the question's keywords and answers with the tool's own sentence, so these
// tests check the real tools, streaming, figures and links, never a live model.

let parent: SharedParent;

test.beforeEach(async ({ sharedParent }) => {
	parent = sharedParent;
});

const plan = {
	baseline: "10,000",
	buckets: [
		["Groceries", "1,200"],
		["Hockey", "400"],
	] as [string, string][],
};

const question = (page: Page) => page.getByLabel("Question");
const figures = (page: Page) => page.getByRole("table", { name: "Figures" }).last();

async function ask(page: Page, text: string) {
	await question(page).fill(text);
	await question(page).press("Enter");
}

test("answers cite the Household's figures and link to the screens with more", async ({
	browser,
}) => {
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, plan);
	await page.getByRole("link", { name: "Quick Add" }).click();
	const quickAdd = page.getByRole("dialog", { name: "Quick Add" });
	await page.keyboard.type("40");
	await pickQuickAddBucket(quickAdd, "Hockey");
	await expect(quickAdd).toBeHidden();

	await page.getByRole("link", { name: "Ask", exact: true }).click();
	await expect(page.getByRole("heading", { level: 1 })).toHaveText("Ask");

	await ask(page, "How much did Hockey cost this year?");
	await expect(page.getByText(/^Hockey: \$40 spent from January \d{4}/)).toBeVisible();
	await expect(figures(page)).toContainText("$40");
	await expect(page.getByRole("link", { name: "See Transactions" })).toHaveAttribute(
		"href",
		/^\/transactions\/\d{4}-\d{2}$/,
	);

	// Another question, then its Affordability Check opened in Can we afford it?, filled in.
	await ask(page, "Can we afford a $2,000 trip?");
	await expect(page.getByText(/^Trip at \$2,000: (Comfortable|Stretch)\./)).toBeVisible();
	await expect(figures(page)).toContainText("Still to save");
	await page.getByRole("link", { name: "Open Can we afford it?" }).click();
	await expect(currentTab(page, "Explore pages")).toHaveText("Can we afford it?");
	await expect(page.getByTestId("affordability-verdict")).toContainText("trip, $2,000");
});

test("a failed answer can be retried, from the phone's This Month header", {
	tag: "@phone",
}, async ({ browser }) => {
	const page = await signedInPage(browser, parent.email, {
		viewport: { width: 393, height: 852 },
		isMobile: true,
		hasTouch: true,
	});
	await createPlannedHousehold(page, plan);
	await openFromMore(page, "Ask");
	await expect(page.getByRole("heading", { level: 1 })).toHaveText("Ask");

	const askHousehold = serverFn("askHousehold");
	await page.route(askHousehold, (route) => route.fulfill({ status: 500 }));
	await page.getByRole("button", { name: "How are we doing this month?" }).click();
	await expect(page.getByText("Couldn't answer that just now.")).toBeVisible();

	await page.unroute(askHousehold);
	await page.getByRole("button", { name: "Retry" }).click();
	// $10,000 − $1,200 − $400.
	await expect(page.getByText(/Free to Spend is \$8,400/).first()).toBeVisible();
	await expect(page.getByText("Couldn't answer that just now.")).toBeHidden();
	await page.getByRole("link", { name: /^Open / }).click();
	await expect(page.getByText("Free to Spend").first()).toBeVisible();
});
