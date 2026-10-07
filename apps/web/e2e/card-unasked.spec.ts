import { expect, test } from "@playwright/test";
import { createTestParent } from "./parents";
import { seedSql } from "./seed-sql";
import { chooseKind, createPlannedHousehold, hydrated, signedInPage } from "./session";

// A card nobody has said how its purchases get in for (issue 141): the add form asks now, but a
// card added by an older copy of the app, or by an add that waited offline, arrives with no
// answer. The Accounts page asks about it by name, the link goes to the card's own page, and
// once a Parent has answered there the Accounts page stops asking.

let parent: Awaited<ReturnType<typeof createTestParent>>;

test.beforeEach(async () => {
	parent = await createTestParent();
});

test.afterEach(async () => {
	await parent?.remove();
});

const q = (value: string) => `'${value.replaceAll("'", "''")}'`;

test("Accounts asks how a card’s purchases get in when it was added with no answer, until a Parent says", async ({
	browser,
}) => {
	test.setTimeout(180_000);
	const page = await signedInPage(browser, parent.email);
	await page.setViewportSize({ width: 1440, height: 900 });
	await createPlannedHousehold(page, { baseline: "5,000", buckets: [["Groceries", "1,200"]] });

	// Two cards, both added with an answer: nothing is asked about either.
	const addCard = async (name: string, owed: string) => {
		await page.goto("/accounts");
		await expect(page.getByRole("heading", { level: 1 })).toHaveText("Accounts");
		await expect(async () => {
			if (!(await page.getByLabel("Name").isVisible()))
				await page.getByRole("button", { name: "Add Account" }).click({ timeout: 2_000 });
			await expect(page.getByLabel("Name")).toBeVisible({ timeout: 1_000 });
		}).toPass();
		await page.getByLabel("Name").fill(name);
		await chooseKind(page, "credit-card", "From its statements");
		await page.getByLabel("Owed now").fill(owed);
		await page.getByRole("button", { name: "Add Account" }).last().click();
		await expect(page.getByRole("link", { name: new RegExp(`^${name}, `) })).toBeVisible();
	};
	await addCard("Store card", "120");
	await addCard("Visa", "800");
	const asks = (card: string) => page.getByText(`How do purchases on ${card} get into Noodle?`);
	const sayHow = (card: string) =>
		page.getByRole("link", { name: `Say how purchases on ${card} get in` });
	await expect(asks("Store card")).toHaveCount(0);
	await expect(asks("Visa")).toHaveCount(0);

	// The Store card as an add with no answer leaves it: nothing said about its purchases.
	const household = `(select household_id from members where clerk_user_id = ${q(parent.userId)})`;
	const answerOf = async () => {
		const [found = []] = await seedSql([
			`select purchases from accounts where household_id = ${household} and name = 'Store card';`,
		]);
		return found[0]?.purchases ?? null;
	};
	expect(await answerOf()).toBe("statements");
	await seedSql([
		`update accounts set purchases = null where household_id = ${household} and name = 'Store card';`,
	]);

	// Accounts asks about that card, by name, and not about the one that has its answer.
	await page.goto("/accounts");
	await expect(asks("Store card")).toBeVisible({ timeout: 30_000 });
	await expect(
		page.getByText(
			"From its statements, by hand, or not at all. It decides how paying the card counts.",
		),
	).toHaveCount(1);
	await expect(asks("Visa")).toHaveCount(0);
	await expect(sayHow("Store card")).toHaveCount(1);

	// "Say how" opens the card's own page, which asks the same and takes the answer.
	await hydrated(sayHow("Store card"));
	await sayHow("Store card").click();
	await expect(page).toHaveURL(/\/accounts\/[^/]+$/);
	await expect(page.locator("[data-slot=detail-title]:visible")).toContainText("Store card");
	const byHand = page.getByRole("button", { name: "I add them by hand", exact: true });
	await expect(asks("Store card").first()).toBeVisible();
	await expect(
		page.getByRole("button", { name: "From its statements", exact: true }),
	).toBeVisible();
	await expect(page.getByRole("button", { name: "They won’t", exact: true })).toBeVisible();
	await hydrated(byHand);
	await byHand.click();
	await expect.poll(answerOf, { timeout: 20_000 }).toBe("hand");

	// Answered: Accounts no longer asks.
	await page.goto("/accounts");
	await expect(page.getByRole("link", { name: /^Store card, / })).toBeVisible({ timeout: 30_000 });
	await page.waitForLoadState("networkidle");
	await expect(asks("Store card")).toHaveCount(0);
	await expect(sayHow("Store card")).toHaveCount(0);
	await page.context().close();
});
