import { expect, type Page, test } from "@playwright/test";
import { createTestParent } from "./parents";
import { seedReportHistory } from "./reports-seed";
import { clientRendered, createPlannedHousehold, openFromMore, signedInPage } from "./session";

// Phone keyboards (#66): money fields bring up the decimal pad with a Done key, emails the email
// keyboard without capitals or corrections, and search fields a Search key. The shared Input sets
// the email and search defaults; the money inputs set theirs.

const phone = {
	viewport: { width: 393, height: 852 },
	deviceScaleFactor: 2,
	isMobile: true,
	hasTouch: true,
};

let parent: Awaited<ReturnType<typeof createTestParent>>;
test.beforeEach(async () => {
	parent = await createTestParent();
});
test.afterEach(async () => {
	await parent?.remove();
});

/** Fields on the page whose keyboard hints are wrong, by kind. */
const wrongKeyboards = (page: Page) =>
	page.evaluate(() => {
		const name = (el: HTMLInputElement) =>
			el.id || el.getAttribute("aria-label") || el.placeholder || el.outerHTML.slice(0, 60);
		const visible = (el: HTMLElement) => el.getClientRects().length > 0;
		const inputs = [...document.querySelectorAll<HTMLInputElement>("input")].filter(visible);
		const wrong: string[] = [];
		for (const el of inputs) {
			if (el.type === "email") {
				if (el.inputMode !== "email") wrong.push(`${name(el)}: inputmode ${el.inputMode}`);
				if (el.getAttribute("autocapitalize") !== "none") wrong.push(`${name(el)}: capitalizes`);
			}
			// The attribute, not `el.enterKeyHint`: Playwright's WebKit build has no such property
			// (Mobile Safari has had it since iOS 13.4), and the keyboard reads the attribute.
			if (el.type === "search" && el.getAttribute("enterkeyhint") !== "search")
				wrong.push(`${name(el)}: enterkeyhint ${el.getAttribute("enterkeyhint")}`);
			// A money field: the "$" sits just before it.
			const money = el.previousElementSibling?.textContent?.trim() === "$";
			if (money && el.inputMode !== "decimal") wrong.push(`${name(el)}: inputmode ${el.inputMode}`);
			if (el.type === "number") wrong.push(`${name(el)}: type=number`);
		}
		return wrong;
	});

test("fields on a phone bring up the right keyboard", async ({ browser }) => {
	// Four pages and a sheet on one phone: past the 30 s default on a busy machine.
	test.setTimeout(60_000);
	const page = await signedInPage(browser, parent.email, phone);
	await createPlannedHousehold(page, {
		baseline: "6200",
		buckets: [
			["Groceries", "800"],
			["Eating out", "300"],
		],
	});
	await seedReportHistory(parent.userId, 1);

	// Add an Account: a name and a balance.
	await page.goto("/accounts");
	await expect(page.getByLabel("Balance now")).toHaveAttribute("inputmode", "decimal");
	await expect(page.getByLabel("Balance now")).toHaveAttribute("enterkeyhint", "done");
	await expect(page.getByLabel("Name")).toHaveAttribute("autocomplete", "off");
	expect(await wrongKeyboards(page), "Accounts").toEqual([]);

	// Transactions: search, then Edit Transaction's amount.
	await page.goto("/transactions");
	const search = page.locator("#filter-search");
	await expect(search).toHaveAttribute("enterkeyhint", "search");
	// Not inputmode="search": an iPhone then shows its web-search keyboard, whose key reads "go" (#52).
	await expect(search).not.toHaveAttribute("inputmode", "search");
	expect(await wrongKeyboards(page), "Transactions").toEqual([]);
	// The first row with a button (day headings carry no button), once hydrated: before then a
	// press on a row does nothing.
	await expect(search).toBeEnabled(clientRendered);
	// Spending, not money in: its row opens another editor, with no amount to change (issue 152).
	await page
		.locator("[data-index]:not([data-money-in])")
		.filter({ hasNot: page.locator("[data-money-in]") })
		.getByRole("button")
		.first()
		.click();
	const amount = page.locator("#transaction-amount");
	await expect(amount).toHaveAttribute("inputmode", "decimal");
	await expect(amount).toHaveAttribute("enterkeyhint", "done");
	expect(await wrongKeyboards(page), "Edit Transaction").toEqual([]);
	await page.keyboard.press("Escape");
	await expect(amount).toBeHidden();

	// The Glossary's search: it's in the More sheet on a phone. Tried again until it opens, since a
	// press before hydration does nothing.
	await page.goto("/");
	const glossary = page.getByRole("dialog", { name: "Glossary" });
	await expect(async () => {
		await openFromMore(page, "Glossary");
		await expect(glossary).toBeVisible({ timeout: 1_000 });
	}).toPass(clientRendered);
	await expect(glossary.getByRole("searchbox")).toHaveAttribute("enterkeyhint", "search");
	await page.keyboard.press("Escape");
	await expect(glossary).toBeHidden();

	// Inviting the other Parent: the email keyboard, no capitals, and a Send key.
	await page.goto("/household");
	const email = page.locator("#invite-email");
	await expect(email).toHaveAttribute("inputmode", "email");
	await expect(email).toHaveAttribute("autocapitalize", "none");
	await expect(email).toHaveAttribute("enterkeyhint", "send");
	expect(await wrongKeyboards(page), "Household").toEqual([]);
	await page.context().close();
});
