import { expect, test } from "@playwright/test";
import { measure } from "./overflow";
import { createTestParent } from "./parents";
import {
	clientRendered,
	createPlannedHousehold,
	signedInPage,
	uploadStatement,
	waitForReview,
} from "./session";

// Text at 200% on a phone (the nearest a test gets to iOS's largest Dynamic Type): the main pages
// still fit across, Review's tools and its card's controls stay on the screen, and the
// Transactions search still reads "Search".

let parent: Awaited<ReturnType<typeof createTestParent>>;

test.beforeAll(async () => {
	parent = await createTestParent();
});

test.afterAll(async () => {
	await parent?.remove();
});

test("the main pages fit a phone with text at 200%", async ({ browser }) => {
	test.setTimeout(120_000);
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, { baseline: "5,000", buckets: [["Groceries", "1,200"]] });
	// Three cards for Review, brought in before the text grows: a card payment among them, whose
	// button is the longest on a card.
	await uploadStatement(
		page,
		[
			["AMEX EPAYMENT ACH PMT", "400.00"],
			["CORNER GAS MART", "40.00"],
			["CITY OF OAKLAND PARKING", "12.00"],
		],
		true,
	);
	await waitForReview(page, new URL("/review", page.url()).href, "1 of 3");
	await page.addInitScript(() => {
		const large = new CSSStyleSheet();
		large.replaceSync(
			"html { font-size: 200% !important; -webkit-text-size-adjust: 200% !important; }",
		);
		document.adoptedStyleSheets = [...document.adoptedStyleSheets, large];
	});
	for (const path of ["/month", "/transactions", "/accounts", "/plan"]) {
		await page.goto(path);
		await expect(page.locator("[data-slot=page-header]:visible").first()).toBeVisible(
			clientRendered,
		);
		await page.evaluate(() => document.fonts.ready);
		// 32 px or more: Chromium's mobile mode applies the text-size-adjust on top.
		expect(
			await page.evaluate(() =>
				Number.parseFloat(getComputedStyle(document.documentElement).fontSize),
			),
		).toBeGreaterThanOrEqual(32);
		const found = await measure(page);
		expect.soft(found.sticking, `${path}: elements past the right edge`).toEqual([]);
		expect.soft(found.scrollWidth, `${path}: page width`).toBeLessThanOrEqual(found.width);
	}

	// Review, one by one. Its stack is cut at the screen's edges (a card flying off must not widen
	// the page), so a tool or a button past the edge is not something the page's width shows: each
	// control is measured against the screen itself. `window.innerWidth` is no measure here: a phone
	// browser widens it to whatever the page overflows to.
	await page.goto("/review");
	const stack = page.getByTestId("review-stack");
	await expect(stack.getByRole("button", { name: "Skip" })).toBeEnabled(clientRendered);
	await page.evaluate(() => document.fonts.ready);
	const screen = page.viewportSize()?.width ?? 0;
	for (let card = 0; card < 3; card++) {
		const outside = await stack.evaluate((el, width) => {
			const top = el.querySelector("[data-testid=review-card]");
			return [...el.querySelectorAll("button, a[href], [role=combobox], [role=radio]")]
				.filter((control) => !control.closest("[aria-hidden=true],[inert]"))
				.filter(
					(control) => !control.closest("[data-testid=review-card]") || top?.contains(control),
				)
				.map((control) => ({ control, box: control.getBoundingClientRect() }))
				.filter(({ box }) => box.width > 0 && (box.left < -1 || box.right > width + 1))
				.map(
					({ control, box }) =>
						`"${(control.getAttribute("aria-label") ?? control.textContent ?? "").trim().slice(0, 40)}" spans ${Math.round(box.left)}-${Math.round(box.right)} of ${width}`,
				);
		}, screen);
		expect.soft(outside, `Review, card ${card + 1}: controls past the screen's edges`).toEqual([]);
		if (card < 2) {
			const heading = stack.getByTestId("review-card").first().getByRole("heading", { level: 3 });
			const was = await heading.textContent();
			await stack.getByRole("button", { name: "Skip" }).click();
			await expect(heading).not.toHaveText(was ?? "", { timeout: 10_000 });
		}
	}

	// The search's placeholder fits its box rather than being cut to "Se".
	await page.goto("/transactions");
	const search = page.getByRole("searchbox", { name: "Search notes and merchants" });
	await expect(search).toBeEnabled(clientRendered);
	const fit = await search.evaluate((input: HTMLInputElement) => {
		const style = getComputedStyle(input);
		const context = document.createElement("canvas").getContext("2d");
		if (!context) return { text: 0, room: 0 };
		context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
		const room =
			input.clientWidth -
			Number.parseFloat(style.paddingLeft) -
			Number.parseFloat(style.paddingRight);
		return {
			text: Math.ceil(context.measureText(input.placeholder).width),
			room: Math.floor(room),
		};
	});
	expect(fit.text).toBeLessThanOrEqual(fit.room);
});
