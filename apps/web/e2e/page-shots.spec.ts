import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { ulid } from "ulid";
import { createTestParent } from "./parents";
import { seedSql } from "./seed-sql";
import { choose, createHousehold, openMore, savedBy, signedInPage } from "./session";
import { q, seedBetweenUs, seedIncomeHousehold, seedShotsHousehold } from "./shots-household";

// Pictures of every page with one realistic Household, for looking at a redesign without a browser
// on the machine: .github/workflows/shots.yml runs this on GitHub and uploads the PNGs. Not a test
// of anything, so the normal E2E run skips it: it runs only with PAGE_SHOTS set.
//
//   PAGE_SHOTS=1                    run it
//   PAGE_SHOTS_WIDTHS=1440,393      only these widths (default: all five; 2560 only when asked for)
//   PAGE_SHOTS_THEME=dark           the dark theme (default: light)
//
// Each PNG is the full page, at test-results/page-shots/<width>/<name>.png. A page that fails is
// noted in <width>/failures.txt and the rest still get their picture.
//
// A second Household, just made and with setup not finished, is there only for the pictures marked
// `fresh`: This Month's get-started list and the first steps of the setup wizard (#73).

const VIEWPORTS = [
	{ width: 1024, height: 768 },
	{ width: 1440, height: 900 },
	{ width: 1920, height: 1080 },
	{ width: 393, height: 852 },
	{ width: 320, height: 640 },
];
const wanted = (process.env.PAGE_SHOTS_WIDTHS ?? "")
	.split(",")
	.map((width) => Number(width.trim()))
	.filter(Boolean);
// Pictured only when asked for by width: the widest desktop window, where the page stops growing (#73).
// And the widest phone, where a row that only just fits the others has room to go wrong.
// And a common laptop, between the steps the others stand on.
const ON_REQUEST = [
	{ width: 1280, height: 800 },
	{ width: 2560, height: 1440 },
	{ width: 430, height: 932 },
];
const viewports = [
	...VIEWPORTS.filter(({ width }) => wanted.length === 0 || wanted.includes(width)),
	...ON_REQUEST.filter(({ width }) => wanted.includes(width)),
];
const colorScheme = process.env.PAGE_SHOTS_THEME === "dark" ? "dark" : "light";
const OUT = join("test-results", "page-shots");

const enabled = !!process.env.PAGE_SHOTS;

// One worker, in order, and no second try: the Household is made once, in beforeAll.
test.describe.configure({ mode: "default", retries: 0 });

type Shot = {
	name: string;
	path: string;
	ready?: (page: Page) => Promise<void>;
	/** Only at phone widths, and only what's in the window (a sheet over the page). */
	phoneSheet?: boolean;
	/** Only at phone widths, the whole page: what only a phone shows (a folded group opened). */
	phone?: boolean;
	/**
	 * The page draws only the rows in the window (Transactions): the window is made as tall as the
	 * page for the picture, or the rows below the fold come out as an empty card.
	 */
	tall?: boolean;
	/** Pictured as the second Parent, whose Household is new and hasn't finished setup. */
	fresh?: boolean;
	/**
	 * Scrolled this far down first, and only what's in the window: what stays put while a long page
	 * scrolls (a Goal's side column beside its History).
	 */
	scrolledTo?: number;
	/** Only what's in the window, at every width: what a Parent sees without scrolling. */
	window?: boolean;
	/** Pictured as the third Parent, whose small Household is there for what Income brings up. */
	small?: boolean;
};

let parent: Awaited<ReturnType<typeof createTestParent>> | undefined;
/** The Parent of the new Household that hasn't finished setup. */
let freshParent: Awaited<ReturnType<typeof createTestParent>> | undefined;
/** The Parent of the small Household for the Income and Cover pictures (#86, #87). */
let smallParent: Awaited<ReturnType<typeof createTestParent>> | undefined;
let shots: Shot[] = [];
/** What the seeding couldn't do: written beside the pictures so a missing section is explained. */
const seedNotes: string[] = [];

/** The page has its heading, nothing is still a skeleton and the fonts are in. */
async function settled(page: Page) {
	await expect(page.locator("h1:visible, [data-slot=page-header]:visible").first()).toBeVisible({
		timeout: 30_000,
	});
	// A long list's "loading more" row stays a skeleton until it's scrolled to: not waited for.
	await expect(page.locator("[data-slot=skeleton]:visible:not([data-loading-more] *)")).toHaveCount(
		0,
		{ timeout: 20_000 },
	);
	await page.evaluate(() => document.fonts.ready);
	// Charts and sheets finish their entrance.
	await page.waitForTimeout(600);
}

/** A credit card added on Perks & Benefits, as perks-page.spec.ts does (AI_MODEL=stub reads the page). */
async function addCard(page: Page, name: string, pageUrl: string, fee: string, perks: number) {
	await page.getByRole("button", { name: "Add a card or membership" }).click();
	const sheet = page.getByRole("dialog", { name: "Add a card or membership" });
	await sheet.getByLabel("Card or membership").fill(name);
	await sheet.getByRole("button", { name: "I have a link to its benefits page" }).click();
	await sheet.getByLabel("Benefits page (optional)").fill(pageUrl);
	await sheet.getByRole("button", { name: "Add and read its perks" }).click();
	await expect(sheet).toBeHidden({ timeout: 30_000 });
	const card = page.getByRole("article", { name });
	// One Perk Source is open at a time: open this one's row.
	const row = card.locator("h3").getByRole("button");
	await expect(row).toBeEnabled();
	if ((await row.getAttribute("aria-expanded")) !== "true") await row.click();
	await expect(card.getByRole("list", { name: `${name} Perks` }).getByRole("listitem")).toHaveCount(
		perks,
		{ timeout: 30_000 },
	);
	await card.getByLabel("Annual fee").fill(fee);
	await card.getByRole("button", { name: "Save fee" }).click();
	await expect(card).toContainText(`annual fee $${fee}`);
	return card;
}

/**
 * Walks the setup wizard forward to step `wanted`, as setup-shots.spec.ts does: by hand, $6,000
 * take-home pay, later steps skipped. A wizard already at or past that step is left where it is
 * (a second width in the same run finds it where the first one left it).
 */
async function toSetupStep(page: Page, wanted: number) {
	const label = page.getByText(/Step \d of 7/).first();
	await expect(label).toBeVisible({ timeout: 30_000 });
	const proceed = page.getByRole("button", { name: "Continue", exact: true });
	for (let turn = 1; turn < wanted; turn++) {
		const at = Number((await label.innerText()).match(/Step (\d)/)?.[1] ?? wanted);
		if (at >= wanted) return;
		if (at === 1) {
			// The choice only counts once the page is hydrated.
			await expect(async () => {
				await page.getByRole("radio", { name: /by hand/ }).click();
				await expect(proceed).toBeEnabled({ timeout: 1000 });
			}).toPass({ timeout: 20_000 });
		}
		if (at === 2)
			await page.getByRole("textbox", { name: /What lands in your account/ }).fill("6,000");
		const saved = savedBy(page, "saveSetup");
		if (at <= 2) await proceed.click({ timeout: 15_000 });
		else await page.getByRole("button", { name: "Skip" }).click({ timeout: 15_000 });
		await saved;
		await expect(page.getByText(`Step ${at + 1} of 7`)).toBeVisible({ timeout: 15_000 });
	}
}

/** Opens one line of Explore's outline: on a phone its editor comes up in a sheet. */
async function openLine(page: Page, title: string) {
	const sheet = page.getByRole("dialog", { name: title });
	// The row only answers once the page is hydrated.
	await expect(async () => {
		// On a phone a long group is folded once the page is hydrated: its lines are behind
		// "Show all N …", so every group is opened first (nothing to press from 640 up).
		for (const all of await page.getByRole("button", { name: /^Show all \d+ / }).all())
			await all.click({ timeout: 2000 });
		if (!(await sheet.isVisible()))
			await page.getByRole("button", { name: `Edit ${title}` }).click({ timeout: 2000 });
		await expect(sheet).toBeVisible({ timeout: 2000 });
	}).toPass({ timeout: 20_000 });
	return sheet;
}

/** Presses `button` until `shown` is there: a button only answers once the page is hydrated. */
async function pressFor(button: Locator, shown: Locator) {
	await expect(async () => {
		if (!(await shown.isVisible())) await button.click({ timeout: 2000 });
		await expect(shown).toBeVisible({ timeout: 2000 });
	}).toPass({ timeout: 20_000 });
}

/** Transactions in Select mode with its first three rows picked: the selection's bar is up. */
async function selectThree(page: Page) {
	const bar = page.getByRole("region", { name: "Selecting Transactions" });
	await pressFor(page.locator("button:visible", { hasText: /^Select$/ }).first(), bar);
	const rows = page.getByRole("list", { name: /^Transactions in / }).getByRole("button");
	for (let row = 0; row < 3; row++) await rows.nth(row).click({ timeout: 15_000 });
	return bar;
}

/** Tries one part of the seeding; a failure is noted and the rest goes on. */
async function attempt(what: string, run: () => Promise<void>) {
	try {
		await run();
	} catch (error) {
		seedNotes.push(`${what}: ${String(error).split("\n")[0]}`);
	}
}

/** Opens one of the Danger zone's confirming sheets and leaves it open: nothing is confirmed. */
async function openDangerSheet(page: Page, action: "Start fresh" | "Delete Household") {
	const zone = page.getByRole("region", { name: "Danger zone" });
	await zone.getByRole("button", { name: action }).click();
	const sheet = page.getByRole("dialog", { name: `${action}?` });
	await expect(sheet).toBeVisible({ timeout: 15_000 });
	await expect(sheet.getByRole("list", { name: "What will be cleared" })).toBeVisible({
		timeout: 15_000,
	});
}

/**
 * Opens one To do on This Month: from lg its own row, on a phone the folded strip (every To do is
 * then on the page).
 */
async function openToDoRow(page: Page, label: string) {
	const toDo = page.getByRole("region", { name: "To do" });
	// By the start of the row's name: "Close September" also says "… and Extra income to decide".
	const strip =
		(page.viewportSize()?.width ?? 0) >= 1024
			? toDo
					.getByRole("button", { name: new RegExp(`^${label}`) })
					.and(page.locator("[aria-expanded]"))
			: toDo.locator("button[aria-expanded]:visible");
	// The strip only answers once the page is hydrated.
	await expect(async () => {
		if ((await strip.first().getAttribute("aria-expanded")) !== "true")
			await strip.first().click({ timeout: 2000 });
		await expect(strip.first()).toHaveAttribute("aria-expanded", "true", { timeout: 2000 });
	}).toPass({ timeout: 20_000 });
}

test.beforeAll(async ({ browser }) => {
	if (!enabled) return;
	test.setTimeout(600_000);
	parent = await createTestParent();
	const page = await signedInPage(browser, parent.email, {
		viewport: { width: 1440, height: 900 },
		colorScheme,
	});

	const { householdId, parentId, month, bucketIds, commitmentIds, ids } = await seedShotsHousehold(
		page,
		parent.userId,
	);
	// Money between the two Parents: a deposit from Sam among the Income, and a line sent to Sam.
	let sentToSam = "";
	await attempt("Money between the two Parents", async () => {
		sentToSam = await seedBetweenUs(householdId, parentId, ids.checking);
	});
	/** Plan › Income with the Zelle from Sam counted as Income (`marked` false) or between us. */
	const zelleFromSam = async (page: Page, marked: boolean) => {
		const region = page.locator('section[aria-label="Between us"]:visible').first();
		const hint = page.getByText("From the other Parent? It’s between us").first();
		if (marked) {
			await expect(async () => {
				if (!(await region.isVisible())) {
					await page
						.getByRole("button", { name: "Actions for $1,500 of income" })
						.first()
						.click({ timeout: 2000 });
					await page
						.getByRole("menuitem", { name: "It’s between us · not Income" })
						.click({ timeout: 2000 });
				}
				await expect(region).toBeVisible({ timeout: 5000 });
			}).toPass({ timeout: 30_000 });
			// The toast has gone before the picture: it would sit over the rows on a phone.
			await expect(page.getByRole("status").filter({ hasText: "is between you" })).toHaveCount(0, {
				timeout: 20_000,
			});
		} else {
			await expect(async () => {
				if (await region.isVisible())
					await region
						.getByRole("button", { name: "Count $1,500 as Income" })
						.click({ timeout: 2000 });
				await expect(hint).toBeVisible({ timeout: 5000 });
			}).toPass({ timeout: 30_000 });
		}
		const shown = marked ? region : hint;
		await shown.evaluate((node) => node.scrollIntoView({ block: "center" }));
	};

	// Two more payments waiting in Review, beside the Amex one (a card Noodle follows): one to a
	// card kept by hand that a Commitment pays down, and one to a card that isn't in Noodle at all.
	await attempt("Review's card payments", async () => {
		const h = q(householdId);
		const m = q(parentId);
		const discover = q(ulid());
		const paying = q(ulid());
		const statements = [
			`insert into accounts (id, household_id, name, kind, bank_connection_id, external_id, mask) values (${discover}, ${h}, 'Discover it', 'credit-card', null, null, null);`,
			`insert into account_balances (id, household_id, account_id, amount_cents, created_by_member_id) values (${q(ulid())}, ${h}, ${discover}, 312000, ${m});`,
			`insert into commitments (id, household_id, name, from_month, account_id) values (${paying}, ${h}, 'Discover payment', ${q(month)}, ${discover});`,
			`insert into commitment_terms (household_id, commitment_id, month, amount_cents, cadence, due_date) values (${h}, ${paying}, ${q(month)}, 60000, 'monthly', ${q(`${month}-01`)});`,
		];
		for (const [line, cents] of [
			["DISCOVER E-PAYMENT 7731 WEB", 25_000],
			["CITI CARD ONLINE PAYMENT", 18_000],
		] as const) {
			const id = q(ulid());
			statements.push(
				`insert into transactions (id, household_id, source, date, amount_cents, note, merchant, account_id, created_by_member_id) values (${id}, ${h}, 'import', ${q(`${month}-01`)}, ${cents}, ${q(line)}, ${q(line)}, ${q(ids.checking)}, ${m});`,
				`insert into categorizations (transaction_id, household_id, member_id, outcome, method, bucket_id, confidence, merchant) values (${id}, ${h}, ${m}, 'review', 'none', null, null, ${q(line)});`,
			);
		}
		await seedSql(statements);
	});

	// Two credit cards with their Perks, one of them used.
	await attempt("Perks & Benefits", async () => {
		await page.goto("/insights/perks");
		const amex = await addCard(page, "Amex Platinum", "https://example.com/premium-card", "695", 4);
		await addCard(page, "Chase Sapphire Reserve", "https://example.com/travel-card", "550", 3);
		await amex.locator("h3").getByRole("button").click();
		const uber = amex.getByRole("listitem", { name: "Uber Cash" });
		await uber.getByRole("button", { name: "Mark Uber Cash used" }).click();
		await uber.getByLabel("Note (optional)").fill("Rides to the airport");
		await uber.getByRole("button", { name: "Save" }).click();
		await expect(uber).toContainText("Rides to the airport");
	});

	// A saved Scenario: a raise to $10,200 a month.
	let scenarioPath: string | null = null;
	await attempt("Scenario", async () => {
		await page.goto("/explore?lever=baseline:1020000");
		await expect(page.getByRole("region", { name: "Your changes" })).toContainText("Income", {
			timeout: 30_000,
		});
		await page.getByLabel("Name", { exact: true }).fill("Sam’s raise");
		await page.getByRole("button", { name: "Save Scenario" }).click();
		await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Sam’s raise");
		await page.goto("/explore/scenarios");
		const link = page.getByRole("link", { name: "Sam’s raise", exact: true }).first();
		await expect(link).toBeVisible({ timeout: 20_000 });
		scenarioPath = await link.getAttribute("href");
	});
	// A second one to compare it with: a pay cut to $8,800 a month (#74).
	await attempt("A second Scenario", async () => {
		await page.goto("/explore?lever=baseline:880000");
		await expect(page.getByRole("region", { name: "Your changes" })).toContainText("Income", {
			timeout: 30_000,
		});
		await page.getByLabel("Name", { exact: true }).fill("Pay cut");
		await page.getByRole("button", { name: "Save Scenario" }).click();
		await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Pay cut");
		await page.goto("/explore/scenarios");
		await expect(page.getByRole("link", { name: "Pay cut", exact: true }).first()).toBeVisible({
			timeout: 20_000,
		});
	});
	await page.context().close();

	// The second Household: made, and nothing else. Its Parent hasn't been through the setup wizard.
	await attempt("A Household that hasn't finished setup", async () => {
		freshParent = await createTestParent();
		const freshPage = await signedInPage(browser, freshParent.email, {
			viewport: { width: 1440, height: 900 },
			colorScheme,
		});
		await createHousehold(freshPage, "The Parkers", "Jo");
		await freshPage.context().close();
	});
	// The third Household: small, with a Cover, a month to close and Income that each picture sets.
	let small: Shot[] = [];
	await attempt("A small Household for the Income pictures", async () => {
		smallParent = await createTestParent();
		const smallPage = await signedInPage(browser, smallParent.email, {
			viewport: { width: 1440, height: 900 },
			colorScheme,
		});
		const seeded = await seedIncomeHousehold(smallPage);
		await smallPage.context().close();
		const thisMonth = `/month/${seeded.month}`;
		/** This month's Income becomes `cents`, and the page is loaded again to show it. */
		const withIncome = async (page: Page, cents: number) => {
			await seeded.setIncome(cents);
			await page.reload();
			await settled(page);
		};
		const extraIncome = async (page: Page) => {
			await withIncome(page, 620_000);
			await openToDoRow(page, "Extra income");
			await expect(page.getByRole("button", { name: "Add $1,200 to Free to Spend" })).toBeVisible({
				timeout: 15_000,
			});
		};
		const cameInLower = async (page: Page) => {
			await withIncome(page, 440_000);
			await expect(page.getByRole("button", { name: "Lower take-home pay to $4,400" })).toBeVisible(
				{
					timeout: 15_000,
				},
			);
		};
		small = [
			// $1,200 above take-home pay: the Extra income prompt, its To do open (#86).
			{ name: "01b-extra-income", path: thisMonth, small: true, ready: extraIncome },
			{
				// "Choose where": the sheet, Free to Spend first. What's in the window.
				name: "01c-extra-income-choose-where",
				path: thisMonth,
				small: true,
				window: true,
				ready: async (page) => {
					await extraIncome(page);
					await page.locator("button:visible", { hasText: "Choose where" }).first().click();
					await expect(page.getByRole("dialog")).toBeVisible({ timeout: 15_000 });
				},
			},
			{
				// Last month waiting to be closed, its Extra income left in the account (#86).
				name: "01d-close-month",
				path: thisMonth,
				small: true,
				ready: async (page) => {
					await openToDoRow(page, "Close");
					await choose(page, "Where the Extra income goes", "Leave it in the account");
				},
			},
			// A Bucket's page with a Cover into it, and the Bucket the money came from (#87).
			{
				name: "04b-bucket-covers",
				path: `/plan/${seeded.month}/buckets/${seeded.bucketIds.Hockey}`,
				small: true,
			},
			{
				name: "04c-bucket-covers-source",
				path: `/plan/${seeded.month}/buckets/${seeded.bucketIds.Groceries}`,
				small: true,
			},
			{
				// $600 less than take-home pay has come in: Plan › Income's quiet step (#86).
				name: "06a-income-came-in-lower",
				path: `/plan/${seeded.month}/income`,
				small: true,
				ready: cameInLower,
			},
			{
				// The Edit sheet, with its sentence about pay that varies. What's in the window.
				name: "06b-income-edit-take-home-pay",
				path: `/plan/${seeded.month}/income`,
				small: true,
				window: true,
				ready: async (page) => {
					await cameInLower(page);
					await page.getByRole("button", { name: "Edit take-home pay" }).click();
					await expect(page.getByRole("dialog")).toBeVisible({ timeout: 15_000 });
				},
			},
			{
				// Groceries planned far above take-home pay: Plan's overview for an over-planned month.
				// Last of this Household's pictures: the Plan stays that way.
				name: "03a-plan-overview-over-planned",
				path: `/plan/${seeded.month}`,
				small: true,
				ready: async (page) => {
					await seedSql([
						`update bucket_allowances set amount_cents = 480000 where bucket_id = ${q(seeded.bucketIds.Groceries ?? "")};`,
					]);
					await page.reload();
					await settled(page);
				},
			},
		];
	});

	const fresh: Shot[] = freshParent
		? [
				// Nothing planned: the get-started list on its own, and the way back into the wizard.
				{ name: "30-fresh-this-month-get-started", path: `/month/${month}`, fresh: true },
				// The wizard's first four steps. Each walks on from where the one before left it.
				// 32a is the income step again, only the window: its intro above the sticky bar (#86).
				...(
					[
						["31-setup-step-1", 1],
						["32-setup-step-2", 2],
						["32a-setup-step-2-window", 2],
						["33-setup-step-3", 3],
						["34-setup-step-4", 4],
					] as const
				).map(
					([name, step]): Shot => ({
						name,
						path: "/setup",
						fresh: true,
						window: name.endsWith("-window"),
						ready: (page) => toSetupStep(page, step),
					}),
				),
			]
		: [];

	const firstBucket = bucketIds.Groceries;
	const firstCommitment = commitmentIds.Electricity;
	shots = [
		{ name: "01-this-month", path: `/month/${month}` },
		// Part-way down on a computer: where the round Ask Noodle button sits over the page.
		{ name: "01e-this-month-scrolled", path: `/month/${month}`, scrolledTo: 500 },
		{
			name: "02-this-month-to-do-open",
			path: `/month/${month}`,
			// From lg up each To do prompt is a closed row: open the first. On a phone the strip itself
			// opens. Only the buttons on screen: the phone's strip is in the page (hidden) at lg too,
			// and a click on it would wait until the test ran out.
			ready: async (page) => {
				const row = page
					.getByRole("region", { name: "To do" })
					.locator("button[aria-expanded]:visible");
				if ((await row.count()) === 0) return;
				if ((await row.first().getAttribute("aria-expanded")) !== "true")
					await row.first().click({ timeout: 15_000 });
			},
		},
		// The Plan's first page, whole: the take-home split, the Buckets table under it, Personal
		// Allowances and what changed. Then what the window shows of it on arriving.
		{ name: "03-plan-overview", path: `/plan/${month}` },
		{ name: "03w-plan-overview-window", path: `/plan/${month}`, window: true },
		{
			// A Bucket's sheet, opened from its row: Allowance, from when, Name. What's in the window.
			name: "04a-bucket-sheet",
			path: `/plan/${month}#buckets`,
			window: true,
			ready: async (page) => {
				await pressFor(
					page.getByRole("button", { name: "Edit Groceries", exact: true }),
					page.getByRole("dialog", { name: "Groceries", exact: true }),
				);
			},
		},
		...[
			// A little more than now: the sheet says what Free to Spend would be, and the split
			// behind it follows.
			{ name: "04a3-bucket-sheet-changed", typed: "1,000" },
			// Far more than there is: both say the month is over-planned.
			{ name: "04a4-bucket-sheet-over", typed: "9,000" },
		].map(({ name, typed }) => ({
			name,
			path: `/plan/${month}`,
			window: true,
			ready: async (page: Page) => {
				const sheet = page.getByRole("dialog", { name: "Groceries", exact: true });
				await pressFor(page.getByRole("button", { name: "Edit Groceries", exact: true }), sheet);
				await sheet.getByRole("textbox", { name: "Allowance", exact: true }).fill(typed);
				await expect(sheet.locator("[data-slot=free-to-spend-after]")).toBeVisible({
					timeout: 15_000,
				});
			},
		})),
		{
			// The same sheet scrolled to its end: More (colour, carries over, moving it, archiving it).
			name: "04a2-bucket-sheet-more",
			path: `/plan/${month}#buckets`,
			window: true,
			ready: async (page) => {
				const sheet = page.getByRole("dialog", { name: "Groceries", exact: true });
				await pressFor(page.getByRole("button", { name: "Edit Groceries", exact: true }), sheet);
				await sheet
					.getByRole("button", { name: /Archive/ })
					.first()
					.scrollIntoViewIfNeeded({ timeout: 15_000 });
			},
		},
		// The Buckets on that page as the window shows them, and a Bucket picked from the table: in its panel beside
		// the table, a drawer over it on a smaller window, a page on a phone.
		{ name: "04w-plan-buckets-window", path: `/plan/${month}#buckets`, window: true },
		{
			name: "05w-plan-bucket-window",
			path: `/plan/${month}/buckets/${firstBucket}`,
			window: true,
		},
		{ name: "05-plan-bucket", path: `/plan/${month}/buckets/${firstBucket}` },
		{ name: "06-plan-commitments", path: `/plan/${month}/commitments` },
		{ name: "07-plan-commitment", path: `/plan/${month}/commitments/${firstCommitment}` },
		// The same Commitment as the window shows it: on a computer, in its panel over the list.
		{
			name: "07b-plan-commitment-window",
			path: `/plan/${month}/commitments/${firstCommitment}`,
			window: true,
		},
		{ name: "08-plan-goal-funding", path: `/plan/${month}/goals` },
		{ name: "09-plan-year", path: `/plan/${month}/year` },
		{ name: "10-transactions", path: `/transactions/${month}`, tall: true },
		// The top of the list as a Parent arrives: search, Filters, Sort and Select above the rows.
		{ name: "10a-transactions-window", path: `/transactions/${month}`, window: true },
		{
			name: "10b-transactions-select",
			path: `/transactions/${month}`,
			window: true,
			ready: async (page) => {
				await selectThree(page);
			},
		},
		{
			// Delete in the selection's bar: the confirming sheet, open and not confirmed.
			name: "10c-transactions-delete-sheet",
			path: `/transactions/${month}`,
			window: true,
			ready: async (page) => {
				const bar = await selectThree(page);
				await bar.getByRole("button", { name: "Delete" }).click({ timeout: 15_000 });
				await expect(page.getByRole("dialog", { name: /^Delete \d+ Transactions\?$/ })).toBeVisible(
					{
						timeout: 15_000,
					},
				);
			},
		},
		// Part-way down a long page on a computer: where the round Ask Noodle button sits over it.
		{ name: "10d-transactions-scrolled", path: `/transactions/${month}`, scrolledTo: 600 },
		{
			name: "11-transaction-open",
			path: `/transactions/${month}/${ids.openTransaction}`,
			tall: true,
		},
		{
			// The editor with a name of the Parent's own typed in, not saved. What's in the window.
			name: "11a-transaction-name",
			path: `/transactions/${month}/${ids.openTransaction}`,
			window: true,
			ready: async (page) => {
				await page
					.getByLabel("Name", { exact: true })
					.first()
					.fill("Weekly shop", { timeout: 15_000 });
			},
		},
		{ name: "12-review-cards", path: "/review" },
		{
			// One by one, with a card on top that has a suggestion, so Confirm shows: what's on screen
			// without scrolling (#74). Skipping only sends a card to the back.
			name: "12a-review-card-suggested",
			path: "/review",
			window: true,
			ready: async (page) => {
				const stack = page.getByTestId("review-stack");
				const confirm = stack.getByTestId("review-card").getByRole("button", { name: "Confirm" });
				for (let skipped = 0; skipped < 6; skipped++) {
					if (await confirm.isVisible()) break;
					await stack.getByRole("button", { name: "Skip" }).click({ timeout: 15_000 });
					await page.waitForTimeout(400);
				}
				await expect(confirm).toBeVisible();
				// Pressing Skip scrolls the page to it: back to the top, so the picture is what a Parent
				// sees on arriving, and whether Skip and Undo clear the bottom bar there.
				await page.evaluate(() => window.scrollTo(0, 0));
			},
		},
		{
			// One by one, with a likely card payment on top: its long button has the first row with
			// Edit and the picker the row under them, and the card stays inside the screen.
			name: "12b-review-card-payment",
			path: "/review",
			ready: async (page) => {
				const stack = page.getByTestId("review-stack");
				const mark = stack
					.getByTestId("review-card")
					.getByRole("button", { name: "It’s a card payment" });
				for (let skipped = 0; skipped < 8; skipped++) {
					if (await mark.isVisible()) break;
					await stack.getByRole("button", { name: "Skip" }).click({ timeout: 15_000 });
					await page.waitForTimeout(400);
				}
				await expect(mark).toBeVisible();
				await page.evaluate(() => window.scrollTo(0, 0));
			},
		},
		// One by one, what's in the window, with each of the other two payments on top: one to a card
		// Noodle doesn't follow (the tallest card: does Skip still clear the bottom bar?), and one a
		// Commitment pays down.
		...(
			[
				["12c-review-card-payment-not-followed", "not-followed", "link", "Make it a Commitment"],
				["12d-review-card-payment-commitment", "commitment", "button", "Confirm"],
			] as const
		).map(
			([name, kind, role, action]): Shot => ({
				name,
				path: "/review",
				window: true,
				ready: async (page) => {
					const stack = page.getByTestId("review-stack");
					const first = stack
						.locator(`[data-testid=review-card][data-payment=${kind}]`)
						.getByRole(role, { name: action });
					for (let skipped = 0; skipped < 10; skipped++) {
						if (await first.isVisible()) break;
						await stack.getByRole("button", { name: "Skip" }).click({ timeout: 15_000 });
						await page.waitForTimeout(400);
					}
					await expect(first).toBeVisible();
					await page.evaluate(() => window.scrollTo(0, 0));
				},
			}),
		),
		{ name: "13-review-list", path: "/review?view=list" },
		{ name: "14-rules", path: "/review/rules" },
		{ name: "15-accounts", path: "/accounts" },
		{
			name: "15a-accounts-archived-open",
			path: "/accounts",
			ready: async (page) => {
				await pressFor(
					page.getByRole("button", { name: /^Archived/ }),
					page.getByRole("list", { name: "Archived Accounts" }),
				);
			},
		},
		{ name: "16-account-credit-card", path: `/accounts/${ids.sapphire}` },
		{ name: "16a-account-no-balance", path: `/accounts/${ids.college}` },
		{ name: "17-goals", path: "/goals" },
		{ name: "18-goal", path: `/goals/${ids.vacation}` },
		// A long History: the whole page, then the window after scrolling 700px, where the side column
		// (progress and actions) should still be in view on a wide screen (#73).
		{ name: "18a-goal-long-history", path: `/goals/${ids.roof}` },
		{ name: "18b-goal-long-history-scrolled", path: `/goals/${ids.roof}`, scrolledTo: 700 },
		{ name: "19-explore", path: "/explore" },
		// A Scenario not saved yet, with one change: the outline, Your changes and the outcomes (#74).
		{ name: "19a-explore-with-a-change", path: "/explore?lever=baseline:1020000" },
		{
			// A Commitment's editor, in its sheet on a phone: the amount slider above its money field (#74).
			name: "19b-explore-line-open",
			path: "/explore",
			phoneSheet: true,
			ready: async (page) => {
				await openLine(page, "Electricity");
			},
		},
		{
			// A folded group opened on a phone: every Commitment under its summary, and "Show fewer" (#74).
			name: "19d-explore-group-open",
			path: "/explore",
			phone: true,
			ready: async (page) => {
				const fewer = page.getByRole("button", { name: "Show fewer Commitments" });
				// The group only folds, and its button only answers, once the page is hydrated.
				await expect(async () => {
					if (!(await fewer.isVisible()))
						await page
							.getByRole("button", { name: /^Show all \d+ Commitments$/ })
							.click({ timeout: 2000 });
					await expect(fewer).toBeVisible({ timeout: 2000 });
				}).toPass({ timeout: 20_000 });
			},
		},
		{
			// Raises and inflation switched on in its sheet: the two % fields, one to a row (#74).
			name: "19c-explore-growth-open",
			path: "/explore",
			phoneSheet: true,
			ready: async (page) => {
				const sheet = await openLine(page, "Raises & inflation");
				const on = sheet.getByRole("switch", { name: "Model raises and inflation" });
				if ((await on.getAttribute("aria-checked")) !== "true") await on.click({ timeout: 15_000 });
				await expect(sheet.getByLabel("Income, % a year")).toBeVisible({ timeout: 15_000 });
			},
		},
		{ name: "20-can-we-afford-it", path: "/explore/afford" },
		{
			// The Car Check: cash, loan and lease side by side, with its Commitments open (#74).
			name: "20a-afford-car",
			path: "/explore/afford?kind=car",
			ready: async (page) => {
				const edit = page.getByRole("button", { name: "Edit Commitments" });
				if ((await edit.count()) > 0) await edit.first().click({ timeout: 15_000 });
			},
		},
		{ name: "20b-afford-anything", path: "/explore/afford?kind=anything" },
		{ name: "21-scenarios", path: "/explore/scenarios" },
		{
			// Both Scenarios ticked: Compare, side by side with the Plan (#74).
			name: "21a-scenarios-compare",
			path: "/explore/scenarios",
			ready: async (page) => {
				for (const name of ["Sam’s raise", "Pay cut"]) {
					const tick = page.getByRole("checkbox", { name: `Compare “${name}”` });
					await expect(async () => {
						if (!(await tick.isChecked())) await tick.click();
						await expect(tick).toBeChecked({ timeout: 2000 });
					}).toPass({ timeout: 20_000 });
				}
				await expect(page.getByRole("link", { name: "Compare 2 selected" })).toBeVisible({
					timeout: 15_000,
				});
			},
		},
		...(scenarioPath ? [{ name: "22-scenario", path: scenarioPath }] : []),
		{ name: "23-reports", path: "/reports" },
		{ name: "23a-reports-cash-flow", path: "/reports?view=cash-flow" },
		// The other eight Reports views, in the tab row's order (#73).
		{ name: "23b-reports-big-expenses", path: "/reports?view=big" },
		{ name: "23c-reports-buckets", path: "/reports?view=buckets" },
		{ name: "23d-reports-plan-vs-actual", path: "/reports?view=plan" },
		{ name: "23e-reports-trends", path: "/reports?view=trends" },
		{ name: "23f-reports-merchants", path: "/reports?view=merchants" },
		{ name: "23g-reports-people", path: "/reports?view=people" },
		{ name: "23h-reports-goals", path: "/reports?view=goals" },
		{ name: "23i-reports-income", path: "/reports?view=income" },
		{ name: "24-insights", path: "/insights" },
		{ name: "25-credit-card-perks", path: "/insights/perks" },
		{
			name: "25a-perks-row-open",
			path: "/insights/perks",
			ready: async (page) => {
				const row = page
					.getByRole("article", { name: "Amex Platinum" })
					.locator("h3")
					.getByRole("button");
				await expect(async () => {
					if ((await row.getAttribute("aria-expanded")) !== "true")
						await row.click({ timeout: 2000 });
					await expect(row).toHaveAttribute("aria-expanded", "true", { timeout: 2000 });
				}).toPass({ timeout: 20_000 });
			},
		},
		{
			name: "25b-perks-add-sheet",
			path: "/insights/perks",
			window: true,
			ready: async (page) => {
				await pressFor(
					page.getByRole("button", { name: "Add a card or membership" }),
					page.getByRole("dialog", { name: "Add a card or membership" }),
				);
			},
		},
		{ name: "26-check-in", path: "/check-in" },
		{
			// The card's footer ("Open full page", "Skip for now"), scrolled clear of a phone's bottom
			// bar: only what's in the window (#74).
			name: "26a-check-in-footer",
			path: "/check-in",
			window: true,
			ready: async (page) => {
				const skip = page
					.getByRole("main")
					.getByRole("button", { name: /^Skip (for now|and finish)$/ });
				await expect(skip.first()).toBeVisible({ timeout: 15_000 });
				await skip.first().evaluate((button) => button.scrollIntoView({ block: "center" }));
				await page.waitForTimeout(400);
			},
		},
		{ name: "27-household-settings", path: "/household" },
		{
			// The Start fresh sheet, open and not confirmed: what it says about snapshots, files and
			// a prepared download (#78). What's in the window: the sheet is over the page.
			name: "27a-start-fresh-sheet",
			path: "/household",
			window: true,
			ready: (page) => openDangerSheet(page, "Start fresh"),
		},
		{
			// The Delete Household sheet's first step, open and not confirmed (#78).
			name: "27b-delete-household-sheet",
			path: "/household",
			window: true,
			ready: (page) => openDangerSheet(page, "Delete Household"),
		},
		{
			// The Parent's own name and colour, in its sheet. What's in the window.
			name: "27c-your-name-and-colour",
			path: "/household",
			window: true,
			ready: async (page) => {
				await pressFor(
					page.getByRole("button", { name: "Edit your name and colour" }),
					page.getByRole("dialog", { name: "Your name and colour" }),
				);
			},
		},
		{ name: "28-glossary", path: "/glossary" },
		{
			name: "29-more-sheet",
			path: "/reports",
			phoneSheet: true,
			ready: async (page) => {
				await openMore(page);
			},
		},
		...small,
		...fresh,
		// Money between the two Parents, last: marking it changes the month's Income for good.
		{
			// The deposit from Sam among the Income, with the line under it that says what it may be.
			name: "40-income-from-the-other-parent",
			path: `/plan/${month}/income`,
			window: true,
			ready: (page) => zelleFromSam(page, false),
		},
		{
			// Marked: out of the Income total and listed under "Between us" with "Count as Income".
			name: "41-income-between-us",
			path: `/plan/${month}/income`,
			window: true,
			ready: (page) => zelleFromSam(page, true),
		},
		{
			// Money sent to Sam, in no Bucket: "Mark as Transfer" and "It’s between us" side by side.
			name: "42-transaction-between-us",
			path: `/transactions/${month}/${sentToSam}`,
			window: true,
			ready: async (page) => {
				const button = page.getByRole("button", { name: "It’s between us" }).first();
				await expect(button).toBeVisible({ timeout: 15_000 });
				await button.evaluate((node) => node.scrollIntoView({ block: "center" }));
			},
		},
	];
	mkdirSync(OUT, { recursive: true });
	writeFileSync(
		join(OUT, "seed-notes.txt"),
		seedNotes.length > 0 ? `${seedNotes.join("\n")}\n` : "Everything was seeded.\n",
	);
});

test.afterAll(async () => {
	await parent?.remove();
	await freshParent?.remove();
	await smallParent?.remove();
});

for (const viewport of viewports) {
	test(`page shots at ${viewport.width}x${viewport.height}`, async ({ browser }) => {
		test.skip(!enabled, "Runs only with PAGE_SHOTS set (see .github/workflows/shots.yml)");
		test.setTimeout(900_000);
		if (!parent) throw new Error("No Parent: beforeAll didn't finish");
		const phone = viewport.width < 1024;
		const device: Parameters<typeof signedInPage>[2] = {
			viewport,
			colorScheme,
			// Charts and cards are pictured as they end up, not part-way through their entrance: with
			// less motion asked for, nothing animates in (the charts' useAnimation, src/motion.ts).
			reducedMotion: "reduce",
			isMobile: phone,
			hasTouch: phone,
			deviceScaleFactor: phone ? 2 : 1,
		};
		const main = await signedInPage(browser, parent.email, device);
		// Signed in only when there is something to picture as the second Parent.
		let freshPage: Page | undefined;
		let smallPage: Page | undefined;
		const dir = join(OUT, String(viewport.width));
		mkdirSync(dir, { recursive: true });
		const failures: string[] = [];
		for (const shot of shots) {
			if ((shot.phoneSheet || shot.phone) && !phone) continue;
			let page = main;
			try {
				if (shot.fresh) {
					if (!freshParent) throw new Error("No second Household");
					freshPage ??= await signedInPage(browser, freshParent.email, device);
					page = freshPage;
				}
				if (shot.small) {
					if (!smallParent) throw new Error("No small Household");
					smallPage ??= await signedInPage(browser, smallParent.email, device);
					page = smallPage;
				}
				await page.goto(shot.path);
				await settled(page);
				if (shot.ready) {
					await shot.ready(page);
					await settled(page);
				}
				if (shot.tall) {
					// To the end and back first, as a Parent would scroll: rows that only draw near the
					// screen have then all had their turn.
					for (let pages = 0; pages < 10; pages++) {
						await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
						await page.waitForTimeout(600);
						if ((await page.locator("[data-loading-more]").count()) === 0) break;
					}
					await page.evaluate(() => window.scrollTo(0, 0));
					await page.waitForTimeout(400);
					const height = await page.evaluate(() => document.documentElement.scrollHeight);
					await page.setViewportSize({ width: viewport.width, height: Math.min(height, 12_000) });
					await page.waitForTimeout(500);
				}
				if (shot.scrolledTo) {
					await page.evaluate((y) => window.scrollTo(0, y), shot.scrolledTo);
					await page.waitForTimeout(400);
				}
				await page.screenshot({
					path: join(dir, `${shot.name}.png`),
					fullPage: !shot.phoneSheet && !shot.scrolledTo && !shot.window,
					animations: "disabled",
				});
				if (shot.tall) await page.setViewportSize(viewport);
			} catch (error) {
				failures.push(`${shot.name} (${shot.path}): ${String(error).split("\n")[0]}`);
				// What it looked like when it gave up, if the page is still there.
				await page
					.screenshot({ path: join(dir, `${shot.name}.FAILED.png`), fullPage: true })
					.catch(() => {});
			}
		}
		await main.context().close();
		await freshPage?.context().close();
		await smallPage?.context().close();
		if (failures.length > 0) writeFileSync(join(dir, "failures.txt"), `${failures.join("\n")}\n`);
		expect(failures, "pages that couldn't be pictured").toEqual([]);
		expect(seedNotes, "data that couldn't be seeded").toEqual([]);
	});
}
