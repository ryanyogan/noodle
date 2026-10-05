import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { createTestParent } from "./parents";
import {
	clientRendered,
	createPlannedHousehold,
	reloadUntil,
	signedInPage,
	uploadStatement,
	waitForReview,
} from "./session";

// Review on a phone, one by one and in the list: no card is wider than the screen, whatever is on
// it. The card that was: a likely card payment, whose long "It’s a card payment" button sat beside
// the picker and Edit on one row. Also a suggestion, a merchant with a long name, and one whose
// name is a single long word. Categorization runs with its fake (AI_MODEL=stub): it guesses Gas
// for a merchant with "gas" in its name.

const WIDTHS = [
	[320, 640],
	[375, 667],
	[393, 852],
	[430, 932],
] as const;

const LINES: [what: string, amount: string][] = [
	["AMEX EPAYMENT ACH PMT", "400.00"],
	["CORNER GAS MART", "40.00"],
	["ACME WIDGETS AND INDUSTRIAL FASTENERS OF NORTH AMERICA LLC SPRINGFIELD WAREHOUSE", "19.99"],
	["SUPERCALIFRAGILISTICEXPIALIDOCIOUSHARDWAREANDGARDENSUPPLY*ONLINE4417", "12.50"],
];

let parent: Awaited<ReturnType<typeof createTestParent>>;

test.beforeEach(async () => {
	parent = await createTestParent();
});

test.afterEach(async () => {
	await parent?.remove();
});

/**
 * What doesn't fit: the page if it scrolls sideways, each card that passes an edge of the screen,
 * and each of a card's controls that passes one or (a button, the picker) is under 44px tall. The
 * "?" beside a term is 24px with a 44px hit area drawn by its ::after, which is what's measured.
 */
function misfits(page: Page) {
	return page.evaluate(() => {
		const root = document.documentElement;
		const width = root.clientWidth;
		const found: string[] = [];
		if (root.scrollWidth > width) found.push(`the page is ${root.scrollWidth} wide, of ${width}`);
		const outside = (box: DOMRect) => box.left < -0.5 || box.right > width + 0.5;
		const said = (el: Element) =>
			(el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 40);
		for (const card of document.querySelectorAll("[data-testid=review-card]")) {
			const box = card.getBoundingClientRect();
			const name = said(card.querySelector("h3") ?? card);
			if (outside(box)) {
				found.push(`card "${name}" spans ${Math.round(box.left)}-${Math.round(box.right)}`);
			}
			for (const control of card.querySelectorAll("button, a[href], [role=combobox]")) {
				const at = control.getBoundingClientRect();
				if (at.width === 0 || at.height === 0) continue;
				if (control.closest("[aria-hidden=true],[inert]")) continue;
				if (outside(at)) {
					found.push(
						`"${said(control)}" on "${name}" spans ${Math.round(at.left)}-${Math.round(at.right)}`,
					);
				}
				if (control.matches("a")) continue;
				const hit = Number.parseFloat(getComputedStyle(control, "::after").height) || 0;
				const tall = Math.max(at.height, hit);
				if (tall < 43.5) found.push(`"${said(control)}" on "${name}" is ${Math.round(tall)} tall`);
			}
		}
		return found;
	});
}

async function axe(page: Page, what: string) {
	const { violations } = await new AxeBuilder({ page }).analyze();
	expect(
		violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`),
		what,
	).toEqual([]);
}

test("on a phone no Review card is wider than the screen: a card payment, a suggestion and long names, one by one and in the list", async ({
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
	const thisMonth = page.url();
	await uploadStatement(page, LINES, true);
	await waitForReview(page, new URL("/review", thisMonth).href, `1 of ${LINES.length}`);

	const stack = page.getByTestId("review-stack");
	const top = stack.getByTestId("review-card");
	const mark = top.getByRole("button", { name: "It’s a card payment" });
	const skip = stack.getByRole("button", { name: "Skip" });

	for (const [width, height] of WIDTHS) {
		await page.setViewportSize({ width, height });

		// One by one: each card in turn on top, the card payment among them.
		await page.goto("/review");
		await expect(skip).toBeEnabled(clientRendered);
		await page.evaluate(() => document.fonts.ready);
		let payment = false;
		for (let card = 0; card < LINES.length; card++) {
			await expect(top.getByRole("combobox", { name: /^Where .+ goes$/ })).toBeEnabled();
			if (await mark.isVisible()) {
				payment = true;
				// Its button has the first row; the picker the whole row under it.
				const [button, picker, inside] = await Promise.all([
					mark.boundingBox(),
					top.getByRole("combobox", { name: /^Where .+ goes$/ }).boundingBox(),
					top.boundingBox(),
				]);
				if (!button || !picker || !inside) throw new Error("no card payment card");
				expect(picker.y, `${width}: the picker is under the button`).toBeGreaterThanOrEqual(
					button.y + button.height,
				);
				expect(picker.width, `${width}: the picker has the card's width`).toBeGreaterThan(
					inside.width - 40,
				);
				if (width === 393) await axe(page, "one by one, a card payment on top");
			}
			expect(await misfits(page), `${width}: one by one, card ${card + 1}`).toEqual([]);
			await skip.click();
			// The card flies off and the next one settles.
			await page.waitForTimeout(600);
		}
		expect(payment, `${width}: a card payment came to the top`).toBe(true);
		expect(await misfits(page), `${width}: one by one, after the last skip`).toEqual([]);

		// The list: every card at once.
		const cards = page.getByTestId("review-card");
		await reloadUntil(page, "/review?view=list", async () => {
			await expect(cards).toHaveCount(LINES.length, { timeout: 3_000 });
			await expect(cards.first().getByRole("combobox", { name: /^Where .+ goes$/ })).toBeEnabled({
				timeout: 3_000,
			});
		});
		await page.evaluate(() => document.fonts.ready);
		await expect(
			cards.filter({ hasText: "Card payment — not spending" }).getByRole("button", {
				name: "It’s a card payment",
			}),
		).toBeVisible();
		expect(await misfits(page), `${width}: the list`).toEqual([]);
		if (width === 393) await axe(page, "the list");
	}
});
