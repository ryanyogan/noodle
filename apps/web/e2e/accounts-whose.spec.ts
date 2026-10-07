import { expect, type Page, test } from "@playwright/test";
import { ulid } from "ulid";
import { createTestParent } from "./parents";
import { seedSql } from "./seed-sql";
import { choose, createPlannedHousehold, hydrated, savedBy, signedInPage } from "./session";

// Accounts are listed by whose they are (issue 144, ADR-0059): the Parent looking first, then the
// other Parent, then the Household's. A new one is the Parent's who adds it unless they say, and
// whose it is can be changed on the Account's page.

let parent: Awaited<ReturnType<typeof createTestParent>>;

test.beforeEach(async () => {
	parent = await createTestParent();
});

test.afterEach(async () => {
	await parent?.remove();
});

const groupTitles = (page: Page) => page.locator("[data-slot=section-group] > h2");
const group = (page: Page, name: string | RegExp) => page.getByRole("region", { name });
const toast = (page: Page, text: string) => page.getByRole("status").filter({ hasText: text });

/** Adds an Account from the header's sheet, or the empty page's form when it is the first. */
async function addAccount(
	page: Page,
	account: { name: string; kind?: string; balance?: string; whose?: string },
) {
	const sheet = page.getByRole("dialog", { name: "Add an Account" });
	const header = page.getByRole("button", { name: "Add Account" });
	const first = (await page.getByText("Accounts are where the money is").count()) > 0;
	if (!first) await header.click();
	const form = first ? page : sheet;
	await form.getByLabel("Name").fill(account.name);
	if (account.kind) await choose(form, "Kind", account.kind);
	if (account.whose) await choose(form, "Whose Account", account.whose);
	if (account.balance)
		await form
			.getByLabel(account.kind === "Loan" ? "Owed now" : "Balance now")
			.fill(account.balance);
	await form.getByRole("button", { name: "Add Account" }).click();
	await expect(page.getByRole("link", { name: new RegExp(`^${account.name}`) })).toBeVisible();
}

test("Accounts are grouped by whose they are, and a Parent says whose one is", async ({
	browser,
}) => {
	test.slow();
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, { baseline: "5,000", buckets: [["Fun", "300"]] });
	// The other Parent, as if they had joined.
	const cori = ulid();
	await seedSql([
		`insert into members (id, household_id, kind, name, clerk_user_id) select '${cori}', m.household_id, 'parent', 'Cori', 'seeded-${cori}' from members m where m.clerk_user_id = '${parent.userId}'`,
	]);

	await page.goto("/accounts");
	await hydrated(page.getByRole("button", { name: "Add Account" }));
	// The picker starts on the Parent adding it: left alone, the Account is theirs.
	await addAccount(page, { name: "Joint checking", balance: "2,000", whose: "The Household" });
	await addAccount(page, { name: "My savings", kind: "Savings", balance: "500" });
	await addAccount(page, { name: "My car loan", kind: "Loan", balance: "9,000" });
	await addAccount(page, { name: "Her checking", balance: "750", whose: "Cori" });

	// The Parent looking first, then the other Parent, then the Household's.
	await expect(groupTitles(page)).toHaveText([
		/^(?!Cori|The Household).+’s Accounts$/,
		"Cori’s Accounts",
		"The Household’s Accounts",
	]);
	const mine = page.locator("[data-slot=section-group]").first();
	await expect(mine.getByRole("link", { name: /^My savings/ })).toBeVisible();
	// Within a group Cash and Cards and loans are as before, and the group says what it adds up to.
	await expect(mine.getByRole("region", { name: "Cash" })).toContainText("My savings");
	await expect(mine.getByRole("region", { name: "Cards and loans" })).toContainText("My car loan");
	await expect(mine.locator("[data-slot=whose-total]")).toHaveText("Cash $500 · Owed $9,000");
	await expect(group(page, "Cori’s Accounts").getByRole("link")).toHaveText([/Her checking/]);
	await expect(group(page, "The Household’s Accounts").getByRole("link")).toHaveText([
		/Joint checking/,
	]);
	await expect(
		group(page, "The Household’s Accounts").locator("[data-slot=whose-total]"),
	).toHaveText("Cash $2,000");
	// The page's Totals are still everyone's.
	await expect(page.getByRole("region", { name: "Totals" })).toContainText("$3,250");

	// Saying the joint one is Cori's moves it to her group; the Household's, now empty, goes.
	await page.getByRole("link", { name: /^Joint checking/ }).click();
	await expect(page.getByRole("combobox", { name: "Whose Account" })).toHaveText("The Household");
	const saved = savedBy(page, "setAccountWhose");
	await choose(page, "Whose Account", "Cori");
	await expect(toast(page, "Joint checking is Cori’s now.")).toBeVisible();
	await saved;
	await page.goto("/accounts");
	await expect(groupTitles(page)).toHaveText([/’s Accounts$/, "Cori’s Accounts"]);
	await expect(group(page, "Cori’s Accounts").getByRole("link")).toHaveText([
		/Joint checking/,
		/Her checking/,
	]);
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
		true,
	);
});
