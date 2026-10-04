import { expect, type Page, test } from "@playwright/test";
import { createTestParent } from "./parents";
import { seedReportHistory } from "./reports-seed";
import { seedSql } from "./seed-sql";
import { clientRendered, createPlannedHousehold, signedInPage } from "./session";

// The phone crowding check (#65): on a busy household whose Bucket names are 12 characters long
// and whose figures run to five digits, no text on This Month, the Plan, a Bucket's page or
// Transactions is cut to fewer than about 12 characters at 320 wide, no amount is cut at all, and
// nothing sticks out past the right edge. FOLD_OUT=dir also saves a shot of each screen at 320x640
// and 393x852, and the run prints the controls smaller than 44 px to look over.
const OUT = process.env.FOLD_OUT;
const month = new Intl.DateTimeFormat("en-CA", {
	timeZone: "America/Chicago",
	year: "numeric",
	month: "2-digit",
}).format(new Date());

const NAMES: [seeded: string, long: string][] = [
	["Groceries", "Weekly shops"],
	["Eating out", "Takeout food"],
	["Kids", "Kids lessons"],
	["Fun", "Family trips"],
];

let parent: Awaited<ReturnType<typeof createTestParent>>;
test.beforeEach(async () => {
	parent = await createTestParent();
});
test.afterEach(async () => {
	await parent?.remove();
});

/** Renames the seeded Buckets to 12-character names, straight in the local D1. */
async function renameBuckets(clerkUserId: string) {
	const q = (value: string) => `'${value.replaceAll("'", "''")}'`;
	const household = `(select household_id from members where clerk_user_id = ${q(clerkUserId)})`;
	await seedSql(
		NAMES.map(
			([from, to]) =>
				`update buckets set name = ${q(to)} where household_id = ${household} and name = ${q(from)};`,
		),
	);
}

/** Text cut short (ellipsis, clamp or clipped), how many characters still show, and small controls. */
function crowding(page: Page) {
	return page.evaluate(() => {
		const width = window.innerWidth;
		const cut: string[] = [];
		for (const el of document.querySelectorAll<HTMLElement>("body *")) {
			if (el.closest("[aria-hidden=true],[inert],.sr-only")) continue;
			const style = getComputedStyle(el);
			if (style.visibility === "hidden" || style.display === "none") continue;
			const clips =
				style.textOverflow === "ellipsis" ||
				style.webkitLineClamp !== "none" ||
				style.overflowX === "hidden" ||
				style.overflowX === "clip";
			if (!clips || el.clientWidth === 0) continue;
			const text = (el.textContent ?? "").trim();
			if (!text || el.scrollWidth <= el.clientWidth + 1) continue;
			const lineClamped = style.webkitLineClamp !== "none" && el.scrollHeight > el.clientHeight + 1;
			const shown = Math.floor((text.length * el.clientWidth) / el.scrollWidth);
			if (shown < 12 || /\$\d/.test(text) || lineClamped)
				cut.push(`"${text.slice(0, 30)}" shows ~${shown} chars`);
		}
		// A word split over two lines (a title squeezed by its actions) is cut too.
		for (const el of document.querySelectorAll<HTMLElement>("h1, h2, h3, [data-slot=list-row]")) {
			if (el.closest("[aria-hidden=true],[inert],.sr-only") || !el.checkVisibility()) continue;
			const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
			for (let node = walker.nextNode(); node; node = walker.nextNode()) {
				for (const word of (node.textContent ?? "").matchAll(/\S{2,}/g)) {
					const range = document.createRange();
					range.setStart(node, word.index);
					range.setEnd(node, word.index + word[0].length);
					const lines = new Set([...range.getClientRects()].map((r) => Math.round(r.top)));
					if (lines.size > 1) cut.push(`"${word[0]}" breaks over ${lines.size} lines`);
				}
			}
		}
		const small = [...document.querySelectorAll<HTMLElement>("main a, main button")]
			.filter((el) => {
				const box = el.getBoundingClientRect();
				return box.width > 0 && (box.height < 44 || box.width < 44) && box.right <= width + 1;
			})
			.map((el) => {
				const box = el.getBoundingClientRect();
				const name = el.getAttribute("aria-label") ?? (el.textContent ?? "").trim();
				return `${name.slice(0, 30)} ${Math.round(box.width)}x${Math.round(box.height)}`;
			});
		return { cut, small, scrollWidth: document.documentElement.scrollWidth, width };
	});
}

const screens = [
	["This Month", "/month"],
	["Plan", `/plan/${month}`],
	["Bucket", "bucket"],
	["Transactions", "/transactions"],
] as const;

async function look(page: Page, size: string, check: boolean) {
	for (const [name, path] of screens) {
		if (path === "bucket") {
			await page.goto("/month");
			await page.getByRole("link", { name: "Weekly shops", exact: true }).click();
			await expect(page.getByText(/^(Left|Over) this month$/)).toBeVisible(clientRendered);
		} else {
			await page.goto(path);
		}
		await expect(page.locator("[data-slot=page-header]:visible").first()).toBeVisible(
			clientRendered,
		);
		await page.evaluate(() => document.fonts.ready);
		await page.waitForTimeout(300);
		if (OUT) await page.screenshot({ path: `${OUT}/${size}-${name}.png`, fullPage: true });
		const found = await crowding(page);
		console.log(`CROWD ${size} ${name} small: ${found.small.join(" | ")}`);
		if (!check) continue;
		expect.soft(found.cut, `${name}: text cut short at ${size}`).toEqual([]);
		expect
			.soft(found.scrollWidth, `${name}: scrolls sideways at ${size}`)
			.toBeLessThanOrEqual(found.width);
	}
}

const phone = { deviceScaleFactor: 1, isMobile: true, hasTouch: true } as const;

test("phone rows aren't crowded at 320 wide", async ({ browser }) => {
	test.setTimeout(240_000);
	const page = await signedInPage(browser, parent.email, {
		...phone,
		viewport: { width: 320, height: 640 },
	});
	await createPlannedHousehold(page, {
		baseline: "16200",
		buckets: [
			["Groceries", "800"],
			["Eating out", "300"],
			["Kids", "400"],
			["Fun", "250"],
		],
	});
	await seedReportHistory(parent.userId, 2);
	await renameBuckets(parent.userId);
	await look(page, "320x640", true);
	if (OUT) {
		const p393 = await signedInPage(browser, parent.email, {
			...phone,
			viewport: { width: 393, height: 852 },
		});
		await look(p393, "393x852", false);
	}
});
