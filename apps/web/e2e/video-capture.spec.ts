import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	type BrowserContextOptions,
	expect,
	type Locator,
	type Page,
	test,
} from "@playwright/test";
import { ulid } from "ulid";
import { createTestParent } from "./parents";
import { seedSql } from "./seed-sql";
import { createHousehold, openToDo, signedInPage } from "./session";
import { dayOf, q, seedShotsHousehold } from "./shots-household";

// The stills the intro video zooms into (#54): the real app with the page shots' Household, on a
// computer and on a phone. Not a test of anything, so the normal E2E run skips it: it runs only
// with VIDEO_FOOTAGE set, on GitHub (.github/workflows/video.yml), never on a Parent's data.
//
//   bun run video:capture     (VIDEO_FOOTAGE=1, against the built app in CI)
//
// Each PNG is what's in the window, light theme, with less motion asked for so charts are drawn
// as they end up: test-results/video-footage/<name>-desktop.png (1440×900 at 2x) and
// <name>-phone.png (393×852 at 3x). footage.json beside them says where each still's subject sits,
// as fractions of the window, for the video's zooms. A still that fails is noted in failures.txt
// and the rest are still taken.

const OUT = join("test-results", "video-footage");
const enabled = !!process.env.VIDEO_FOOTAGE;

const screens: { name: "desktop" | "phone"; device: BrowserContextOptions }[] = [
	{ name: "desktop", device: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 } },
	{
		name: "phone",
		device: {
			viewport: { width: 393, height: 852 },
			deviceScaleFactor: 3,
			isMobile: true,
			hasTouch: true,
		},
	},
];

// One worker, in order, and no second try: the Household is made once, in beforeAll, and the
// Review still files a line each time it's taken.
test.describe.configure({ mode: "default", retries: 0 });

type Still = {
	name: string;
	path: string;
	/** Taken as the Parent of the Household that hasn't been through the get-started wizard. */
	fresh?: boolean;
	ready?: (page: Page) => Promise<void>;
	/** What the still is of: its place in the window goes in footage.json. */
	subject?: (page: Page) => Locator;
	/** Where the subject is scrolled to first (left where it is when not given). */
	scroll?: "center" | "nearest";
};

type Box = { x: number; y: number; width: number; height: number };

let parent: Awaited<ReturnType<typeof createTestParent>> | undefined;
let freshParent: Awaited<ReturnType<typeof createTestParent>> | undefined;
let stills: Still[] = [];
/** Each still's subject, as fractions of the window. */
const subjects: Record<string, Box> = {};

/** The page has its heading, nothing is still a skeleton and the fonts are in. */
async function settled(page: Page) {
	await expect(page.locator("h1:visible, [data-slot=page-header]:visible").first()).toBeVisible({
		timeout: 30_000,
	});
	await expect(page.locator("[data-slot=skeleton]:visible:not([data-loading-more] *)")).toHaveCount(
		0,
		{ timeout: 20_000 },
	);
	await page.evaluate(() => document.fonts.ready);
	// Sheets finish their entrance.
	await page.waitForTimeout(600);
}

/** Opens Quick Add and types an amount: on the keypad when there is one (a phone), else by keys. */
async function openQuickAdd(page: Page) {
	const sheet = page.getByRole("dialog", { name: "Quick Add" });
	// The link only opens the sheet once the page is hydrated.
	await expect(async () => {
		if (!(await sheet.isVisible()))
			await page.getByRole("link", { name: "Quick Add" }).first().click({ timeout: 3000 });
		await expect(sheet).toBeVisible({ timeout: 3000 });
	}).toPass({ timeout: 30_000 });
	const keypad = sheet.getByRole("group", { name: "Keypad" });
	if (await keypad.isVisible()) {
		for (const digit of ["4", "7"])
			await keypad.getByRole("button", { name: digit, exact: true }).click();
	} else {
		await page.keyboard.type("47.50");
	}
	await expect(sheet.locator("output").first()).toContainText("$47");
}

/** Opens the upload sheet on an Account's page and chooses a card statement: its lines are listed. */
async function chooseStatement(page: Page) {
	const sheet = page.getByRole("dialog", { name: "Upload a statement" });
	await expect(async () => {
		if (!(await sheet.isVisible()))
			await page.getByRole("button", { name: "Upload statement" }).first().click({ timeout: 3000 });
		await expect(sheet).toBeVisible({ timeout: 3000 });
	}).toPass({ timeout: 30_000 });
	const lines: [what: string, amount: string][] = [
		["DELTA AIR LINES ATLANTA", "412.60"],
		["WHOLEFDS MKT #10234", "86.17"],
		["SHELL OIL 57444612", "48.02"],
		["NETFLIX.COM", "22.99"],
		["TARGET 00021873", "64.38"],
		["CVS/PHARMACY #08412", "17.45"],
	];
	const dates = await page.evaluate(
		(count) =>
			Array.from({ length: count }, (_, i) =>
				new Date(Date.now() - i * 86_400_000).toLocaleDateString("en-US"),
			),
		lines.length,
	);
	const csv = [
		"Transaction Date,Description,Debit,Credit",
		...lines.map(([what, amount], i) => `${dates[i]},${what},${amount},`),
	].join("\n");
	await sheet.getByLabel("Statement file").setInputFiles({
		name: "amex-statement.csv",
		mimeType: "text/csv",
		buffer: Buffer.from(csv),
	});
	await expect(sheet.getByRole("button", { name: /^Import \d+ line/ })).toBeVisible({
		timeout: 30_000,
	});
}

/**
 * Confirms the suggestion on a Review card, so Sort offers to "Always file" that merchant: a
 * Trader Joe's line when one comes up, else the first card with a suggestion.
 */
async function offerRule(page: Page) {
	const stack = page.getByTestId("review-stack");
	const card = stack.getByTestId("review-card").first();
	const confirm = card.getByRole("button", { name: "Confirm" });
	const skip = stack.getByRole("button", { name: "Skip" });
	const turns = (await page.getByTestId("review-card").count()) > 0 ? 12 : 0;
	let found = false;
	for (let turn = 0; turn < turns && !found; turn++) {
		found = (await confirm.isVisible()) && /trader joe/i.test(await card.innerText());
		if (!found) {
			await skip.click({ timeout: 15_000 });
			await page.waitForTimeout(400);
		}
	}
	for (let turn = 0; turn < 12 && !(await confirm.isVisible()); turn++) {
		await skip.click({ timeout: 15_000 });
		await page.waitForTimeout(400);
	}
	await confirm.click({ timeout: 15_000 });
	await expect(page.getByTestId("review-rule-offer")).toContainText(/Always file/, {
		timeout: 15_000,
	});
}

test.beforeAll(async ({ browser }) => {
	if (!enabled) return;
	test.setTimeout(600_000);
	parent = await createTestParent();
	const page = await signedInPage(browser, parent.email, {
		viewport: { width: 1440, height: 900 },
		colorScheme: "light",
	});
	const { householdId, parentId, month, bucketIds, ids } = await seedShotsHousehold(
		page,
		parent.userId,
	);
	await page.context().close();

	const h = q(householdId);
	const m = q(parentId);
	const statements = [
		// The bank is connected and was read two hours ago (the page shots leave it asking to log in).
		`update bank_connections set status = 'ready', notice = null, last_imported_at = ${Date.now() - 2 * 3_600_000} where household_id = ${h};`,
	];
	// Two grocery lines waiting in Review with a suggestion: one for each screen's "Always file" still.
	for (const [cents, day] of [
		[7_312, 3],
		[5_486, 4],
	] as const) {
		const id = ulid();
		statements.push(
			`insert into transactions (id, household_id, source, date, amount_cents, note, merchant, account_id, created_by_member_id) values (${q(id)}, ${h}, 'import', ${q(dayOf(0, day))}, ${cents}, 'TRADER JOE''S #152', 'TRADER JOE''S #152', ${q(ids.sapphire)}, ${m});`,
			`insert into categorizations (transaction_id, household_id, member_id, outcome, method, bucket_id, confidence, merchant) values (${q(id)}, ${h}, ${m}, 'review', 'model', ${q(bucketIds.Groceries ?? "")}, 0.62, 'TRADER JOE''S #152');`,
		);
	}
	await seedSql(statements);

	// The second Household: made, and nothing else, so its wizard opens on Hello.
	freshParent = await createTestParent();
	const freshPage = await signedInPage(browser, freshParent.email, {
		viewport: { width: 1440, height: 900 },
		colorScheme: "light",
	});
	await createHousehold(freshPage, "The Rinks", "Alex");
	await freshPage.context().close();

	const thisMonth = `/month/${month}`;
	stills = [
		{
			name: "setup-hello",
			path: "/setup",
			fresh: true,
			ready: async (page) => {
				await expect(page.getByText("Step 1 of 7").first()).toBeVisible({ timeout: 30_000 });
			},
			subject: (page) => page.locator("[data-slot=intro-video]"),
		},
		{ name: "plan-overview", path: `/plan/${month}` },
		{
			name: "month",
			path: thisMonth,
			subject: (page) => page.getByRole("region", { name: "Free to Spend" }),
		},
		{
			name: "month-bucket",
			path: thisMonth,
			subject: (page) => page.getByRole("listitem", { name: /^Groceries: / }),
			scroll: "center",
		},
		{
			name: "accounts-bank",
			path: "/accounts",
			subject: (page) => page.getByRole("link", { name: /^Chase Checking, / }),
		},
		{ name: "transactions", path: `/transactions/${month}` },
		{ name: "review", path: "/review", subject: (page) => page.getByTestId("review-stack") },
		{
			name: "review-rule",
			path: "/review",
			ready: offerRule,
			subject: (page) => page.getByTestId("review-rule-offer"),
			scroll: "center",
		},
		{
			name: "quick-add",
			path: thisMonth,
			ready: openQuickAdd,
			subject: (page) => page.getByRole("dialog", { name: "Quick Add" }),
		},
		{
			name: "import-statement",
			path: `/accounts/${ids.amex}`,
			ready: chooseStatement,
			subject: (page) => page.getByRole("dialog", { name: "Upload a statement" }),
		},
		{ name: "goals", path: "/goals" },
		{ name: "goal", path: `/goals/${ids.vacation}` },
		{
			name: "explore-afford",
			path: "/explore/afford",
			subject: (page) => page.getByTestId("affordability-verdict"),
			scroll: "nearest",
		},
		{ name: "check-in", path: "/check-in" },
		{
			name: "close-month",
			path: thisMonth,
			// From lg up the prompt is a closed To do row; on a phone it already shows.
			ready: (page) => openToDo(page, "Close"),
			subject: (page) =>
				page
					.locator("button:not([aria-expanded]):visible")
					.filter({ hasText: /^Close [A-Z][a-z]+$/ })
					.last(),
			scroll: "center",
		},
		{
			name: "household-invite",
			path: "/household",
			fresh: true,
			subject: (page) => page.getByLabel("Their email"),
			scroll: "center",
		},
	];
	mkdirSync(OUT, { recursive: true });
});

test.afterAll(async () => {
	await parent?.remove();
	await freshParent?.remove();
	if (enabled && Object.keys(subjects).length > 0)
		writeFileSync(join(OUT, "footage.json"), `${JSON.stringify(subjects, null, "\t")}\n`);
});

for (const screen of screens) {
	test(`video footage, ${screen.name} size`, async ({ browser }) => {
		test.skip(!enabled, "Runs only with VIDEO_FOOTAGE set (see .github/workflows/video.yml)");
		test.setTimeout(900_000);
		if (!parent || !freshParent) throw new Error("No Parents: beforeAll didn't finish");
		const device: BrowserContextOptions = {
			...screen.device,
			colorScheme: "light",
			reducedMotion: "reduce",
		};
		const viewport = device.viewport ?? { width: 1440, height: 900 };
		const main = await signedInPage(browser, parent.email, device);
		const freshPage = await signedInPage(browser, freshParent.email, device);
		const failures: string[] = [];
		const round = (value: number) => Math.round(value * 1000) / 1000;
		for (const still of stills) {
			const page = still.fresh ? freshPage : main;
			const file = `${still.name}-${screen.name}`;
			try {
				await page.goto(still.path);
				await settled(page);
				if (still.ready) {
					await still.ready(page);
					await settled(page);
				}
				const subject = still.subject?.(page);
				if (subject) {
					await expect(subject).toBeVisible({ timeout: 15_000 });
					if (still.scroll) {
						await subject.evaluate(
							(element, block) => element.scrollIntoView({ block, behavior: "instant" }),
							still.scroll,
						);
						await page.waitForTimeout(400);
					}
					const box = await subject.boundingBox();
					if (box)
						subjects[file] = {
							x: round(box.x / viewport.width),
							y: round(box.y / viewport.height),
							width: round(box.width / viewport.width),
							height: round(box.height / viewport.height),
						};
				}
				await page.screenshot({
					path: join(OUT, `${file}.png`),
					animations: "disabled",
					caret: "hide",
					// No toast over the page and no focus ring on whatever was last pressed.
					style:
						"[data-slot=toast] { visibility: hidden !important; } :focus-visible { outline: none !important; --tw-ring-shadow: 0 0 #0000 !important; }",
				});
			} catch (error) {
				failures.push(`${file} (${still.path}): ${String(error).split("\n")[0]}`);
				await page.screenshot({ path: join(OUT, `${file}.FAILED.png`) }).catch(() => {});
			}
		}
		await main.context().close();
		await freshPage.context().close();
		if (failures.length > 0)
			writeFileSync(join(OUT, `failures-${screen.name}.txt`), `${failures.join("\n")}\n`);
		expect(failures, "stills that couldn't be taken").toEqual([]);
	});
}
