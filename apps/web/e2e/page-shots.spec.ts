import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { ulid } from "ulid";
import { createTestParent } from "./parents";
import { seedReportHistory } from "./reports-seed";
import { seedSql } from "./seed-sql";
import {
	createHousehold,
	createPlannedHousehold,
	openMore,
	savedBy,
	signedInPage,
} from "./session";

// Pictures of every page with one realistic Household, for looking at a redesign without a browser
// on the machine: .github/workflows/shots.yml runs this on GitHub and uploads the PNGs. Not a test
// of anything, so the normal E2E run skips it: it runs only with PAGE_SHOTS set.
//
//   PAGE_SHOTS=1                    run it
//   PAGE_SHOTS_WIDTHS=1440,393      only these widths (default: all five)
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
const viewports = VIEWPORTS.filter(({ width }) => wanted.length === 0 || wanted.includes(width));
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
};

let parent: Awaited<ReturnType<typeof createTestParent>> | undefined;
/** The Parent of the new Household that hasn't finished setup. */
let freshParent: Awaited<ReturnType<typeof createTestParent>> | undefined;
let shots: Shot[] = [];
/** What the seeding couldn't do: written beside the pictures so a missing section is explained. */
const seedNotes: string[] = [];

const q = (value: string) => `'${value.replaceAll("'", "''")}'`;

/** A day `monthsAgo` months back, never after today. */
function dayOf(monthsAgo: number, day: number) {
	const now = new Date();
	const date = new Date(Date.UTC(now.getFullYear(), now.getMonth() - monthsAgo, 1));
	const last = monthsAgo === 0 ? now.getDate() : 28;
	return `${date.toISOString().slice(0, 8)}${String(Math.min(day, last)).padStart(2, "0")}`;
}

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

/** A credit card added on Credit card perks, as perks-page.spec.ts does (AI_MODEL=stub reads the page). */
async function addCard(page: Page, name: string, pageUrl: string, fee: string, perks: number) {
	const add = page.getByRole("region", { name: "Add a Perk Source" });
	await add.getByLabel("Name").fill(name);
	await add.getByLabel("Benefits page (optional)").fill(pageUrl);
	await add.getByRole("button", { name: "Add" }).click();
	const card = page.getByRole("article", { name });
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

/**
 * DIAGNOSTIC (74af, to be removed): the page once more with motion NOT reduced, and what its first
 * chart does for three seconds (frames drawn, the chart's width, the line's dashes, the bars),
 * written beside the pictures with a picture of where it ended up.
 */
async function chartNotes(page: Page, shot: Shot, dir: string) {
	await page.emulateMedia({ reducedMotion: "no-preference" });
	try {
		await page.goto(shot.path);
		await expect(page.locator(".recharts-wrapper").first()).toBeVisible({ timeout: 30_000 });
		const notes = await page.evaluate(
			() =>
				new Promise<string[]>((resolve) => {
					const out: string[] = [];
					const start = performance.now();
					let frames = 0;
					const count = () => {
						frames++;
						requestAnimationFrame(count);
					};
					requestAnimationFrame(count);
					const read = () => {
						const wrap = document.querySelector(".recharts-wrapper");
						const line = document.querySelector<SVGPathElement>(".recharts-line-curve");
						const bars = [...document.querySelectorAll(".recharts-bar-rectangle path")];
						out.push(
							[
								`${Math.round(performance.now() - start)}ms`,
								`frames=${frames}`,
								`width=${wrap?.getBoundingClientRect().width ?? "-"}`,
								`dash=${line?.getAttribute("stroke-dasharray") ?? "-"}`,
								`length=${line ? Math.round(line.getTotalLength()) : "-"}`,
								`bars=${bars.length}`,
								`tallest=${Math.round(Math.max(0, ...bars.map((b) => b.getBoundingClientRect().height)))}`,
								document.visibilityState,
								`reduce=${matchMedia("(prefers-reduced-motion: reduce)").matches}`,
							].join(" "),
						);
						if (out.length >= 30) resolve(out);
						else setTimeout(read, 100);
					};
					read();
				}),
		);
		writeFileSync(join(dir, `${shot.name}.chart-notes.txt`), `${notes.join("\n")}\n`);
		await page.screenshot({ path: join(dir, `${shot.name}-moving.png`), animations: "disabled" });
	} catch (error) {
		writeFileSync(join(dir, `${shot.name}.chart-notes.txt`), `${String(error)}\n`);
	} finally {
		await page.emulateMedia({ reducedMotion: "reduce" });
	}
}

/** Tries one part of the seeding; a failure is noted and the rest goes on. */
async function attempt(what: string, run: () => Promise<void>) {
	try {
		await run();
	} catch (error) {
		seedNotes.push(`${what}: ${String(error).split("\n")[0]}`);
	}
}

test.beforeAll(async ({ browser }) => {
	if (!enabled) return;
	test.setTimeout(600_000);
	parent = await createTestParent();
	const page = await signedInPage(browser, parent.email, {
		viewport: { width: 1440, height: 900 },
		colorScheme,
	});

	// Two Parents, two Children, 14 Buckets and 7 Commitments (seedReportHistory adds Mortgage, Car
	// insurance, Internet and Streaming, so those names aren't used here).
	const created = await createPlannedHousehold(page, {
		baseline: "9,400",
		buckets: [
			["Groceries", "1,100"],
			["Eating out", "350"],
			["Kids", "450"],
			["Fun", "300"],
			["Gas", "240"],
			["Household", "200"],
			["Clothing", "150"],
			["Pets", "90"],
			["Health", "120"],
			["Gifts", "100"],
			["Subscriptions", "60"],
			["Travel", "250"],
		],
		commitments: [
			{ name: "Daycare", amountCents: 90_000, cadence: "monthly", dueDay: 5 },
			{ name: "Electricity", amountCents: 14_200, cadence: "monthly", dueDay: 10 },
			{ name: "Gym", amountCents: 4_500, cadence: "monthly", dueDay: 12 },
			{ name: "Water", amountCents: 6_500, cadence: "monthly", dueDay: 15 },
			{ name: "Phones", amountCents: 12_000, cadence: "monthly", dueDay: 20 },
			{ name: "Life insurance", amountCents: 48_000, cadence: "annual", dueDay: 22 },
			{ name: "Amazon Prime", amountCents: 13_900, cadence: "annual", dueDay: 26 },
		],
		children: ["Maya", "Leo"],
		finishSetup: true,
		personalAllowanceCents: 15_000,
		otherParent: { name: "Sam", personalAllowanceCents: 15_000 },
		rules: [
			{ pattern: "Costco", bucket: "Groceries" },
			{ pattern: "Shell", bucket: "Gas" },
			{ pattern: "Chewy", bucket: "Pets" },
		],
	});
	if (!created) throw new Error("The Household wasn't made through /api/dev/household");
	const { householdId, parentId, month, bucketIds, commitmentIds } = created;

	// Six months of spending, income and four more Commitments.
	seedReportHistory(parent.userId, 6);

	const h = q(householdId);
	const m = q(parentId);
	const first = dayOf(5, 1).slice(0, 7);
	const ids = {
		bank: ulid(),
		checking: ulid(),
		sapphire: ulid(),
		amex: ulid(),
		savings: ulid(),
		emergency: ulid(),
		vacation: ulid(),
		car: ulid(),
		college: ulid(),
		roof: ulid(),
		openTransaction: ulid(),
	};
	const bucket = (name: string) => q(bucketIds[name] ?? "");
	const statements: string[] = [
		// A Bank Connection that needs the Parent to log in again, with two of the four Accounts.
		`insert into bank_connections (id, household_id, provider, external_id, institution, credential, status, last_imported_at, notice, created_by_member_id) values (${q(ids.bank)}, ${h}, 'plaid', ${q(`page-shots-${ids.bank}`)}, 'Chase', 'page-shots-not-a-credential', 'reconnect', ${Date.now() - 4 * 86_400_000}, null, ${m});`,
	];
	const accounts: [
		id: string,
		name: string,
		kind: string,
		cents: number,
		bank: boolean,
		mask: string | null,
	][] = [
		[ids.checking, "Chase Checking", "checking", 642_318, true, "4821"],
		[ids.sapphire, "Chase Sapphire Reserve", "credit-card", 184_672, true, "0093"],
		[ids.amex, "Amex Platinum", "credit-card", 96_240, false, null],
		[ids.savings, "Ally Savings", "savings", 2_315_000, false, null],
	];
	for (const [id, name, kind, cents, bank, mask] of accounts) {
		statements.push(
			`insert into accounts (id, household_id, name, kind, bank_connection_id, external_id, mask) values (${q(id)}, ${h}, ${q(name)}, ${q(kind)}, ${bank ? q(ids.bank) : "null"}, ${bank ? q(`acct-${id}`) : "null"}, ${mask ? q(mask) : "null"});`,
			`insert into account_balances (id, household_id, account_id, amount_cents, created_by_member_id) values (${q(ulid())}, ${h}, ${q(id)}, ${cents}, ${m});`,
		);
	}
	// An Account nobody has given a balance yet ("No balance yet").
	statements.push(
		`insert into accounts (id, household_id, name, kind, bank_connection_id, external_id, mask) values (${q(ids.college)}, ${h}, 'College savings', 'savings', null, null, null);`,
	);
	// A Goal with a long History, as goal-side-sticky.spec.ts seeds it: three small fundings a month
	// for 14 months, so the twelve months shown are far taller than the window (#73).
	const longAgo = 14;
	statements.push(
		`insert into goals (id, household_id, account_id, name, target_cents, target_date, from_month) values (${q(ids.roof)}, ${h}, ${q(ids.savings)}, 'New roof', 900000, null, ${q(dayOf(longAgo - 1, 1).slice(0, 7))});`,
		...Array.from(
			{ length: longAgo * 3 },
			(_, i) =>
				`insert into moves (id, household_id, kind, month, amount_cents, created_by_member_id, to_goal_id) values (${q(ulid())}, ${h}, 'goal-funding', ${q(dayOf(Math.floor(i / 3), 1).slice(0, 7))}, ${1_000 + (i % 3) * 500}, ${m}, ${q(ids.roof)});`,
		),
	);
	// Three Goals on the savings Account, funded a little each month.
	const goals: [id: string, name: string, target: number, date: string | null, monthly: number][] =
		[
			[ids.emergency, "Emergency fund", 1_500_000, null, 40_000],
			[ids.vacation, "Hawaii trip", 600_000, dayOf(-9, 15), 30_000],
			[ids.car, "Next car", 1_200_000, dayOf(-26, 1), 25_000],
		];
	for (const [id, name, target, date, monthly] of goals) {
		statements.push(
			`insert into goals (id, household_id, account_id, name, target_cents, target_date, from_month) values (${q(id)}, ${h}, ${q(ids.savings)}, ${q(name)}, ${target}, ${date ? q(date) : "null"}, ${q(first)});`,
		);
		for (let monthsAgo = 5; monthsAgo >= 0; monthsAgo--) {
			statements.push(
				`insert into moves (id, household_id, kind, month, amount_cents, created_by_member_id, to_goal_id) values (${q(ulid())}, ${h}, 'goal-funding', ${q(dayOf(monthsAgo, 1).slice(0, 7))}, ${monthly}, ${m}, ${q(id)});`,
			);
		}
	}
	// Card and bank lines for the Buckets seedReportHistory leaves empty, four months of them.
	const lines: [bucket: string, merchant: string, cents: number, day: number, account: string][] = [
		["Gas", "Shell", 5_840, 4, ids.sapphire],
		["Gas", "Chevron", 6_210, 17, ids.sapphire],
		["Household", "Home Depot", 8_730, 8, ids.amex],
		["Household", "Target", 4_415, 22, ids.sapphire],
		["Clothing", "Old Navy", 6_890, 11, ids.amex],
		["Pets", "Chewy", 5_299, 6, ids.sapphire],
		["Pets", "Vet visit", 3_500, 19, ids.checking],
		["Health", "CVS Pharmacy", 2_860, 13, ids.sapphire],
		["Gifts", "Etsy", 4_200, 24, ids.amex],
		["Subscriptions", "Spotify", 1_699, 2, ids.sapphire],
		["Subscriptions", "NYTimes", 1_700, 9, ids.sapphire],
		["Travel", "Marriott", 21_840, 15, ids.amex],
		["Alex’s Personal Allowance", "Bike shop", 6_400, 7, ids.checking],
		["Sam’s Personal Allowance", "Yarn store", 3_850, 16, ids.checking],
	];
	for (let monthsAgo = 3; monthsAgo >= 0; monthsAgo--) {
		lines.forEach(([name, merchant, cents, day, account], index) => {
			if (!bucketIds[name]) return;
			// Travel only every other month, and amounts that differ a little month to month.
			if (name === "Travel" && monthsAgo % 2 === 1) return;
			const amount = Math.round(cents * (0.85 + ((monthsAgo * 13 + index * 7) % 30) / 100));
			statements.push(
				`insert into transactions (id, household_id, source, date, amount_cents, bucket_id, note, merchant, account_id, created_by_member_id) values (${q(ulid())}, ${h}, 'import', ${q(dayOf(monthsAgo, day))}, ${amount}, ${bucket(name)}, ${q(merchant)}, ${q(merchant)}, ${q(account)}, ${m});`,
			);
		});
	}
	// The Transaction opened on its own page.
	statements.push(
		`insert into transactions (id, household_id, source, date, amount_cents, bucket_id, note, merchant, account_id, created_by_member_id) values (${q(ids.openTransaction)}, ${h}, 'import', ${q(dayOf(0, 3))}, 18462, ${bucket("Groceries")}, 'Whole Foods', 'Whole Foods', ${q(ids.sapphire)}, ${m});`,
	);
	// Six lines waiting in Review: three with a guess, three with none.
	const review: [merchant: string, cents: number, day: number, guess: string | null][] = [
		["AMZN Mktp US*2K4L81", 3_499, 2, "Household"],
		["SQ *BLUE DOOR COFFEE", 1_150, 3, "Eating out"],
		["VENMO PAYMENT 1029", 6_000, 4, null],
		["TST* THE RUSTY ANCHOR", 8_640, 5, "Eating out"],
		["PAYPAL *STEAMGAMES", 2_999, 6, null],
		["CITY OF OAKLAND PARKING", 1_200, 7, null],
	];
	for (const [merchant, cents, day, guess] of review) {
		const id = ulid();
		statements.push(
			`insert into transactions (id, household_id, source, date, amount_cents, note, merchant, account_id, created_by_member_id) values (${q(id)}, ${h}, 'import', ${q(dayOf(0, day))}, ${cents}, ${q(merchant)}, ${q(merchant)}, ${q(ids.sapphire)}, ${m});`,
			`insert into categorizations (transaction_id, household_id, member_id, outcome, method, bucket_id, confidence, merchant) values (${q(id)}, ${h}, ${m}, 'review', ${guess ? "'model'" : "'none'"}, ${guess ? bucket(guess) : "null"}, ${guess ? "0.62" : "null"}, ${q(merchant)});`,
		);
	}
	// Extra income this month, and three Insights.
	statements.push(
		`insert into income (id, household_id, date, amount_cents, note, created_by_member_id) values (${q(ulid())}, ${h}, ${q(dayOf(0, 2))}, 184000, 'Tax refund', ${m});`,
		`insert into insights (id, household_id, kind, title, body, yearly_impact_cents, transaction_ids, commitment_ids, fingerprint) values (${q(ulid())}, ${h}, 'price-increase', 'Phones went up $15', 'It was $105 a month through July and has been $120 since.', 18000, '[]', ${q(JSON.stringify([commitmentIds.Phones].filter(Boolean)))}, ${q(ulid())});`,
		`insert into insights (id, household_id, kind, title, body, yearly_impact_cents, transaction_ids, commitment_ids, fingerprint) values (${q(ulid())}, ${h}, 'duplicate-service', 'Spotify and Amazon Prime may overlap', 'Amazon Prime includes Amazon Music; Spotify is $17 a month on its own.', 20400, '[]', '[]', ${q(ulid())});`,
		`insert into insights (id, household_id, kind, title, body, yearly_impact_cents, transaction_ids, commitment_ids, fingerprint) values (${q(ulid())}, ${h}, 'unused', 'The Gym hasn’t been visited lately', 'Nothing near the gym in three months; it’s $45 a month.', 54000, '[]', ${q(JSON.stringify([commitmentIds.Gym].filter(Boolean)))}, ${q(ulid())});`,
	);
	await seedSql(statements);

	// Two credit cards with their Perks, one of them used.
	await attempt("Credit card perks", async () => {
		await page.goto("/insights/perks");
		const amex = await addCard(page, "Amex Platinum", "https://example.com/premium-card", "695", 4);
		await addCard(page, "Chase Sapphire Reserve", "https://example.com/travel-card", "550", 3);
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
	const fresh: Shot[] = freshParent
		? [
				// Nothing planned: the get-started list on its own, and the way back into the wizard.
				{ name: "30-fresh-this-month-get-started", path: `/month/${month}`, fresh: true },
				// The wizard's first four steps. Each walks on from where the one before left it.
				...["31-setup-step-1", "32-setup-step-2", "33-setup-step-3", "34-setup-step-4"].map(
					(name, index): Shot => ({
						name,
						path: "/setup",
						fresh: true,
						ready: (page) => toSetupStep(page, index + 1),
					}),
				),
			]
		: [];

	const firstBucket = bucketIds.Groceries;
	const firstCommitment = commitmentIds.Electricity;
	shots = [
		{ name: "01-this-month", path: `/month/${month}` },
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
		{ name: "03-plan-overview", path: `/plan/${month}` },
		{ name: "04-plan-buckets", path: `/plan/${month}/buckets` },
		{ name: "05-plan-bucket", path: `/plan/${month}/buckets/${firstBucket}` },
		{ name: "06-plan-commitments", path: `/plan/${month}/commitments` },
		{ name: "07-plan-commitment", path: `/plan/${month}/commitments/${firstCommitment}` },
		{ name: "08-plan-goal-funding", path: `/plan/${month}/goals` },
		{ name: "09-plan-year", path: `/plan/${month}/year` },
		{ name: "10-transactions", path: `/transactions/${month}`, tall: true },
		{
			name: "11-transaction-open",
			path: `/transactions/${month}/${ids.openTransaction}`,
			tall: true,
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
		{ name: "13-review-list", path: "/review?view=list" },
		{ name: "14-rules", path: "/review/rules" },
		{ name: "15-accounts", path: "/accounts" },
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
		{ name: "24-insights", path: "/insights" },
		{ name: "25-credit-card-perks", path: "/insights/perks" },
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
		{ name: "28-glossary", path: "/glossary" },
		{
			name: "29-more-sheet",
			path: "/reports",
			phoneSheet: true,
			ready: async (page) => {
				await openMore(page);
			},
		},
		...fresh,
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
				if (shot.name === "19-explore" || shot.name === "22-scenario")
					await chartNotes(page, shot, dir);
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
		if (failures.length > 0) writeFileSync(join(dir, "failures.txt"), `${failures.join("\n")}\n`);
		expect(failures, "pages that couldn't be pictured").toEqual([]);
		expect(seedNotes, "data that couldn't be seeded").toEqual([]);
	});
}
