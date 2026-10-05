import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { createTestParent } from "./parents";
import {
	accountKindLabel,
	choose,
	clientRendered,
	createPlannedHousehold,
	reloadUntil,
	savedBy,
	signedInPage,
	uploadStatement,
	waitForReview,
} from "./session";

// Review on a phone, one by one and in the list: no card is wider than the screen, whatever is on
// it. The card that was: a likely card payment, whose long "It’s a card payment" button sat beside
// the picker and Edit on one row. Every kind of payment card is here (ADR-0050): one a Commitment
// pays down (Confirm), one to a card Noodle follows (a Transfer), one to a card it doesn't ("Make
// it a Commitment", with two more choices on a row under the picker; on the narrowest phones one
// ends the card's why and the other sits beside the picker). On the shortest phone (320×640) each
// of them leaves Skip and Undo above the bottom bar with nothing scrolled. Also a suggestion, a
// merchant with a long name, and one whose name is a single long word. Categorization runs with its fake (AI_MODEL=stub): it guesses Gas
// for a merchant with "gas" in its name.

const WIDTHS = [
	[320, 640],
	[375, 667],
	[393, 852],
	[430, 932],
] as const;

const LINES: [what: string, amount: string][] = [
	// A Commitment pays this card down: "Payment to American Express", with Confirm.
	["AMERICAN EXPRESS ACH PMT M8054 WEB ID: 2005032111", "612.50"],
	// A card Noodle follows: "It’s a card payment".
	["CHASE CREDIT CRD AUTOPAY", "400.00"],
	// A card Noodle doesn't have: "Make it a Commitment".
	["DISCOVER E-PAYMENT 4821", "250.00"],
	["CORNER GAS MART", "40.00"],
	["ACME WIDGETS AND INDUSTRIAL FASTENERS OF NORTH AMERICA LLC SPRINGFIELD WAREHOUSE", "19.99"],
	["SUPERCALIFRAGILISTICEXPIALIDOCIOUSHARDWAREANDGARDENSUPPLY*ONLINE4417", "12.50"],
];

/**
 * The cards waiting: the lines. The purchase that makes Chase Freedom a card Noodle follows isn't
 * one of them: the fake knows Shell and files it in Gas.
 */
const WAITING = LINES.length;

/** Each kind of payment card (the card's data-payment), and its first action. */
const PAYMENTS = {
	commitment: { role: "button", name: "Confirm" },
	followed: { role: "button", name: "It’s a card payment" },
	"not-followed": { role: "link", name: "Make it a Commitment" },
} as const;

/** Adds an Account on the Accounts page: its form when there are none yet, else its sheet. */
async function addAccount(page: Page, name: string, kind: string, owed?: string) {
	await page.goto(new URL("/accounts", page.url()).href);
	await expect(page.getByRole("heading", { level: 1 })).toHaveText("Accounts");
	const first = await page.getByText("Accounts are where the money is").count();
	if (!first) await page.getByRole("button", { name: "Add Account" }).click();
	const form = first
		? page.getByRole("main")
		: page.getByRole("dialog", { name: "Add an Account" });
	await form.getByLabel("Name").fill(name);
	await choose(form, "Kind", accountKindLabel(kind));
	if (owed) await form.getByLabel("Owed now").fill(owed);
	const saved = savedBy(page, "addAccount");
	await form.getByRole("button", { name: "Add Account" }).click();
	await saved;
	await expect(page.getByRole("link", { name: new RegExp(`^${name}, `) })).toBeVisible();
}

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
	return page.evaluate(async () => {
		// A card on its way in is drawn at 96% of its size for a moment (card-in), so its 44px buttons
		// measure 42: wait until the cards have stopped moving, but no longer than two seconds, so one
		// that never arrives is still measured as it is.
		const moving = [
			...document.querySelectorAll("[data-testid=review-stack], [data-testid=review-card]"),
		]
			.flatMap((part) => part.getAnimations({ subtree: true }))
			.filter((motion) => motion.effect?.getComputedTiming().iterations !== Infinity)
			.map((motion) => motion.finished.catch(() => undefined));
		await Promise.race([Promise.all(moving), new Promise((done) => setTimeout(done, 2_000))]);
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

/**
 * Where Skip and Undo end, and where the screen's room for them does (the top of the bar fixed to
 * its bottom, or the screen's own edge), with the page and everything around the stack scrolled
 * back to the top.
 */
function skipAndUndo(page: Page) {
	return page.evaluate(() => {
		const stack = document.querySelector("[data-testid=review-stack]");
		for (let el: Element | null = stack; el; el = el.parentElement) el.scrollTop = 0;
		window.scrollTo(0, 0);
		const tall = window.innerHeight;
		let floor = tall;
		for (const el of document.querySelectorAll("body *")) {
			const style = getComputedStyle(el);
			if (style.position !== "fixed" && style.position !== "sticky") continue;
			if (style.visibility === "hidden" || style.display === "none") continue;
			const box = el.getBoundingClientRect();
			if (
				box.height > 0 &&
				box.bottom >= tall - 1 &&
				box.top > tall / 2 &&
				box.width >= window.innerWidth * 0.9
			) {
				floor = Math.min(floor, box.top);
			}
		}
		const bottoms = [...(stack?.querySelectorAll("button") ?? [])]
			.filter((button) => ["Skip", "Undo"].includes((button.textContent ?? "").trim()))
			.map((button) => Math.round(button.getBoundingClientRect().bottom));
		return { floor: Math.round(floor), bottoms };
	});
}

async function axe(page: Page, what: string) {
	const { violations } = await new AxeBuilder({ page }).analyze();
	expect(
		violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`),
		what,
	).toEqual([]);
}

test("on a phone no Review card is wider than the screen: every kind of payment card, a suggestion and long names, one by one and in the list", async ({
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
	const month = /\d{4}-\d{2}/.exec(thisMonth)?.[0] ?? "";

	// A card Noodle follows: a purchase on it came in today.
	await addAccount(page, "Chase Freedom", "credit-card", "900");
	await page.getByRole("link", { name: /^Chase Freedom, / }).click();
	await expect(page.locator("[data-slot=detail-title]:visible")).toContainText("Chase Freedom");
	const today = await page.evaluate(() => new Date().toLocaleDateString("en-US"));
	await page.getByRole("button", { name: "Upload statement" }).click();
	const upload = page.getByRole("dialog", { name: "Upload a statement" });
	await upload.getByLabel("Statement file").setInputFiles({
		name: "chase.csv",
		mimeType: "text/csv",
		buffer: Buffer.from(
			`Transaction Date,Description,Debit,Credit\n${today},SHELL OIL 5741,38.50,`,
		),
	});
	await upload.getByRole("button", { name: "Import 1 line" }).click();
	await expect(upload).toBeHidden();
	// A card kept by hand, with a Commitment that pays it down.
	await addAccount(page, "American Express", "credit-card", "2,000");
	await page.goto(new URL(`/plan/${month}/commitments`, thisMonth).href);
	const addForm = page.getByRole("form", { name: "Add a Commitment" });
	await addForm.getByLabel("New Commitment").fill("Amex payment");
	await addForm.getByLabel("Amount due").fill("2,300");
	await addForm.getByRole("combobox", { name: "Pays down", exact: true }).click();
	await page
		.getByRole("listbox")
		.getByRole("option", { name: /^American Express/ })
		.click();
	const added = savedBy(page, "addCommitment");
	await addForm.getByRole("button", { name: "Add Commitment" }).click();
	await added;
	// The lines themselves come in on a third card.
	await addAccount(page, "Visa", "credit-card", "800");
	await page.goto(thisMonth);
	await uploadStatement(page, LINES);
	await waitForReview(page, new URL("/review", thisMonth).href, `1 of ${WAITING}`);

	const stack = page.getByTestId("review-stack");
	const top = stack.getByTestId("review-card");
	const skip = stack.getByRole("button", { name: "Skip" });

	for (const [width, height] of WIDTHS) {
		await page.setViewportSize({ width, height });

		// One by one: each card in turn on top, the card payment among them.
		await page.goto("/review");
		await expect(skip).toBeEnabled(clientRendered);
		await page.evaluate(() => document.fonts.ready);
		const seen = new Set<string>();
		for (let card = 0; card < WAITING; card++) {
			await expect(top.getByRole("combobox", { name: /^Where .+ goes$/ })).toBeEnabled();
			const kind = (await top.getAttribute("data-payment")) as keyof typeof PAYMENTS | null;
			if (kind) {
				seen.add(kind);
				// Its first action has the first row; the picker the whole row under it.
				const first = top.getByRole(PAYMENTS[kind].role, { name: PAYMENTS[kind].name });
				await expect(first).toBeVisible();
				const [button, picker, inside] = await Promise.all([
					first.boundingBox(),
					top.getByRole("combobox", { name: /^Where .+ goes$/ }).boundingBox(),
					top.boundingBox(),
				]);
				if (!button || !picker || !inside) throw new Error("no card payment card");
				expect(picker.y, `${width}: the picker is under the button`).toBeGreaterThanOrEqual(
					button.y + button.height,
				);
				// On the narrowest phones a card Noodle doesn't follow has its other two choices folded in:
				// "Connect the card" ends the why, and "It’s a card payment" is beside the picker.
				const folded = kind === "not-followed" && width < 360;
				if (folded) {
					await expect(
						top.getByTestId("review-payment-why").getByRole("link", { name: "Connect the card" }),
					).toBeVisible();
					const beside = await top
						.getByRole("button", { name: "It’s a card payment" })
						.boundingBox();
					expect(beside?.y, `${width}: under the first action`).toBeGreaterThanOrEqual(
						button.y + button.height,
					);
					expect(beside?.x, `${width}: beside the picker`).toBeGreaterThanOrEqual(
						picker.x + picker.width,
					);
				} else {
					expect(picker.width, `${width}: the picker has the card's width`).toBeGreaterThan(
						inside.width - 40,
					);
				}
				if (height === 640) {
					// The shortest phone: Skip and Undo are on the screen, above its bottom bar, unscrolled.
					const fit = await skipAndUndo(page);
					expect(fit.bottoms, `${width}×${height}: Skip and Undo are there`).toHaveLength(2);
					for (const bottom of fit.bottoms) {
						expect(
							bottom,
							`${width}×${height}: a ${kind} payment leaves Skip and Undo above ${fit.floor} without scrolling`,
						).toBeLessThanOrEqual(fit.floor);
					}
				}
				if (kind === "not-followed" && !folded) {
					// Its other two choices are under the picker, inside the card.
					const others = await Promise.all([
						top.getByRole("link", { name: "Connect the card" }).boundingBox(),
						top.getByRole("button", { name: "It’s a card payment" }).boundingBox(),
					]);
					for (const other of others) {
						expect(other?.y, `${width}: under the picker`).toBeGreaterThanOrEqual(
							picker.y + picker.height,
						);
					}
				}
				if (width === 393) await axe(page, `one by one, a ${kind} payment on top`);
			}
			expect(await misfits(page), `${width}: one by one, card ${card + 1}`).toEqual([]);
			await skip.click();
			// The card flies off and the next one settles.
			await page.waitForTimeout(600);
		}
		expect([...seen].sort(), `${width}: every kind of payment card came to the top`).toEqual(
			Object.keys(PAYMENTS).sort(),
		);
		expect(await misfits(page), `${width}: one by one, after the last skip`).toEqual([]);

		// The list: every card at once.
		const cards = page.getByTestId("review-card");
		await reloadUntil(page, "/review?view=list", async () => {
			await expect(cards).toHaveCount(WAITING, { timeout: 3_000 });
			await expect(cards.first().getByRole("combobox", { name: /^Where .+ goes$/ })).toBeEnabled({
				timeout: 3_000,
			});
		});
		await page.evaluate(() => document.fonts.ready);
		for (const [kind, action] of Object.entries(PAYMENTS)) {
			await expect(
				page
					.locator(`[data-testid=review-card][data-payment=${kind}]`)
					.getByRole(action.role, { name: action.name }),
				`${width}: the list's ${kind} payment card`,
			).toBeVisible();
		}
		expect(await misfits(page), `${width}: the list`).toEqual([]);
		if (width === 393) await axe(page, "the list");
	}
});
