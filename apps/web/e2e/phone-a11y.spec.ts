import { type Browser, expect, type Page, test } from "@playwright/test";
import { settledAxe } from "./axe";
import { createTestParent } from "./parents";
import { clientRendered, createHousehold, signedInPage } from "./session";

// Guards the 393 px phone (#48): tap targets meet WCAG 2.5.8 (24 × 24, hard fail) and axe finds no
// violations in light or dark. Targets under 44 × 44 are listed as annotations, not failures.
const phone = {
	viewport: { width: 393, height: 852 },
	deviceScaleFactor: 2,
	isMobile: true,
	hasTouch: true,
} as const;

const pages = [
	"/month",
	"/transactions",
	"/accounts",
	"/plan",
	"/goals",
	"/reports",
	"/explore",
	"/explore/scenarios",
	"/insights",
	"/review",
	"/review/rules",
	"/household",
	"/insights/perks",
	"/glossary",
	"/ask",
	"/check-in",
];

let parent: Awaited<ReturnType<typeof createTestParent>>;
let household = false;

test.beforeAll(async () => {
	parent = await createTestParent();
});

test.afterAll(async () => {
	await parent?.remove();
});

/** Signs in as the phone and creates the Household once for the whole file. */
async function phonePage(browser: Browser) {
	const page = await signedInPage(browser, parent.email, phone);
	if (!household) await createHousehold(page, "The Rinks", "Alex");
	household = true;
	return page;
}

async function open(page: Page, path: string) {
	// In WebKit the last page's client redirect (/transactions to /transactions/<month>) can land
	// after its header shows, cutting this navigation short: go again once it has.
	await page.goto(path).catch((error: Error) => {
		if (!error.message.includes("interrupted by another navigation")) throw error;
		return page.goto(path);
	});
	await expect(page.locator("[data-slot=page-header]:visible").first(), path).toBeVisible(
		clientRendered,
	);
	await page.evaluate(() => document.fonts.ready);
}

/**
 * Every visible interactive element's hit area: its box joined with an absolutely placed `::after`
 * (the phone hit-area pattern from phase 3). Links inside running text are left out (WCAG's inline
 * exception), as are elements hidden from everyone.
 */
function targets(page: Page) {
	return page.evaluate(() => {
		const selector =
			"a[href],button,input:not([type=hidden]),select,textarea,summary,[role=button],[role=tab],[role=checkbox],[role=switch],[role=radio],[role=combobox],[role=menuitem],[role=option],[role=slider]";
		const hidden = (el: Element) =>
			el.closest("[aria-hidden=true],[inert],.sr-only") !== null ||
			getComputedStyle(el).visibility === "hidden";
		const inline = (el: Element) => {
			if (el.tagName !== "A") return false;
			const block = el.parentElement?.closest("p,li,dd,td");
			return (
				block !== null &&
				block !== undefined &&
				(block.textContent ?? "").trim() !== (el.textContent ?? "").trim()
			);
		};
		const out: { name: string; width: number; height: number }[] = [];
		for (const el of document.querySelectorAll(selector)) {
			const box = el.getBoundingClientRect();
			if (box.width <= 1 || box.height <= 1 || hidden(el) || inline(el)) continue;
			let { left, right, top, bottom } = box;
			const after = getComputedStyle(el, "::after");
			if (after.content !== "none" && after.position === "absolute") {
				const px = (v: string) => (v.endsWith("px") ? Number.parseFloat(v) : 0);
				left = Math.min(left, box.left + px(after.left));
				right = Math.max(right, box.right - px(after.right));
				top = Math.min(top, box.top + px(after.top));
				bottom = Math.max(bottom, box.bottom - px(after.bottom));
			}
			const label =
				el.getAttribute("aria-label") ??
				(el.textContent ?? "").trim() ??
				el.getAttribute("placeholder");
			out.push({
				name: `${el.getAttribute("data-slot") ?? el.tagName.toLowerCase()} "${(label || el.id).slice(0, 30)}"`,
				width: Math.round(right - left),
				height: Math.round(bottom - top),
			});
		}
		return out;
	});
}

test("tap targets on a 393 px phone are at least 24 × 24", async ({ browser }) => {
	test.setTimeout(120_000);
	const page = await phonePage(browser);
	const small: string[] = [];
	for (const path of pages) {
		await open(page, path);
		const found = await targets(page);
		expect(found.length, `${path}: no targets found`).toBeGreaterThan(0);
		test.info().annotations.push({ type: "targets", description: `${path} ${found.length}` });
		const tiny = found.filter((t) => t.width < 24 || t.height < 24);
		expect
			.soft(
				tiny.map((t) => `${t.name} ${t.width}×${t.height}`),
				`${path}: targets under 24 × 24`,
			)
			.toEqual([]);
		for (const t of found) {
			if (t.width < 44 || t.height < 44) small.push(`${path} ${t.name} ${t.width}×${t.height}`);
		}
	}
	for (const description of new Set(small))
		test.info().annotations.push({ type: "under 44 × 44", description });
	await page.context().close();
});

// The "?" help button, Switch and Checkbox are smaller than 44 px and carry a 44 × 44 `::after`
// tap area (#74). It has to be centred on the control and on top: a tap 20 px to any side of the
// control's middle must reach it (or a neighbour of the same kind whose own area starts there),
// not the row or card that follows.
test("help buttons, switches and tick boxes have a centred 44 × 44 tap area nothing covers", async ({
	browser,
}) => {
	test.setTimeout(120_000);
	const page = await phonePage(browser);
	let probed = 0;
	for (const path of ["/household", "/month", "/plan", "/accounts"]) {
		await open(page, path);
		if (path === "/household") {
			// On a phone the Nudge switches wait behind a button (#74). A click before the page has
			// come alive in the browser does nothing, so click (only while closed) until it opens.
			const more = page.getByRole("button", { name: "Choose which Nudges you get" });
			const box = await more.boundingBox();
			expect(box?.height, "the fold button's height").toBeGreaterThanOrEqual(44);
			await expect(async () => {
				if ((await more.getAttribute("aria-expanded")) !== "true") await more.click();
				await expect(more).toHaveAttribute("aria-expanded", "true", { timeout: 2_000 });
			}).toPass(clientRendered);
			await expect(page.getByRole("switch").first()).toBeVisible();
		}
		const found = await page.evaluate(() => {
			const selector = "[data-slot=switch],[data-slot=checkbox],[data-slot=button][data-size=help]";
			const px = (v: string) => (v.endsWith("px") ? Number.parseFloat(v) : Number.NaN);
			const wrong: string[] = [];
			let count = 0;
			for (const el of document.querySelectorAll<HTMLElement>(selector)) {
				if (el.offsetParent === null || el.closest("[aria-hidden=true],[inert]")) continue;
				count++;
				el.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
				const name = `${el.dataset.slot} "${(el.getAttribute("aria-label") ?? el.id).slice(0, 40)}"`;
				// The area's size: the control's inside (what its insets are measured from) less the insets.
				const after = getComputedStyle(el, "::after");
				const width = el.clientWidth - px(after.left) - px(after.right);
				const height = el.clientHeight - px(after.top) - px(after.bottom);
				if (!(width >= 44 && height >= 44) || Math.abs(px(after.left) - px(after.right)) > 0.5)
					wrong.push(`${name}: tap area ${width} × ${height}, ${after.left} / ${after.right}`);
				const box = el.getBoundingClientRect();
				const x = box.left + box.width / 2;
				const y = box.top + box.height / 2;
				for (const [dx, dy, side] of [
					[-20, 0, "left of"],
					[20, 0, "right of"],
					[0, -20, "above"],
					[0, 20, "below"],
				] as const) {
					if (x + dx < 0 || y + dy < 0 || x + dx >= innerWidth || y + dy >= innerHeight) continue;
					const hit = document.elementFromPoint(x + dx, y + dy);
					if (hit === el || (hit && el.contains(hit)) || hit?.closest(selector)) continue;
					wrong.push(
						`${name}: a tap ${side} it lands on <${hit?.tagName.toLowerCase()}> "${(hit?.textContent ?? "").trim().slice(0, 30)}"`,
					);
				}
			}
			return { count, wrong };
		});
		probed += found.count;
		expect.soft(found.wrong, `${path}: tap areas`).toEqual([]);
		if (path === "/household") expect(found.count, "Household's switches").toBeGreaterThan(0);
	}
	expect(probed).toBeGreaterThan(0);
	await page.context().close();
});

test("axe finds no violations on a 393 px phone, light and dark", async ({ browser }) => {
	test.setTimeout(240_000);
	const page = await phonePage(browser);
	for (const colorScheme of ["light", "dark"] as const) {
		await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
		for (const path of pages) {
			await open(page, path);
			const { violations } = await (await settledAxe(page))
				.withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
				.analyze();
			expect
				.soft(
					violations.map(
						(v) =>
							`${v.id}: ${v.nodes
								.map((n) => n.target.join(" "))
								.slice(0, 4)
								.join(", ")}`,
					),
					`${colorScheme} ${path}: axe violations`,
				)
				.toEqual([]);
		}
	}
	await page.context().close();
});
