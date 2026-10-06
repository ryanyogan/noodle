import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setupClerkTestingToken } from "@clerk/testing/playwright";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { ulid } from "ulid";
import { createTestParent } from "./parents";
import { fakePushManager } from "./push";
import { seedSql } from "./seed-sql";
import {
	choose,
	createHousehold,
	createPlannedHousehold,
	openMore,
	savedBy,
	signedInPage,
} from "./session";
import {
	q,
	seedBetweenUs,
	seedIncomeHousehold,
	seedPayoffGoal,
	seedShotsHousehold,
} from "./shots-household";

// Pictures of every page with one realistic Household, for looking at a redesign without a browser
// on the machine: .github/workflows/shots.yml runs this on GitHub and uploads the PNGs. Not a test
// of anything, so the normal E2E run skips it: it runs only with PAGE_SHOTS set.
//
//   PAGE_SHOTS=1                    run it
//   PAGE_SHOTS_WIDTHS=1440,393      only these widths (default: all five; 2560 only when asked for)
//   PAGE_SHOTS_THEME=dark           the dark theme (default: light)
//   PAGE_SHOTS_ONLY=10,26           only the pictures whose name starts with one of these
//   PAGE_SHOTS_HEIGHT=500          every window this tall: a phone with its keyboard up, or 568 for the
//                                 smallest phone (issue 74)
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
	{ width: 375, height: 667 },
	{ width: 2560, height: 1440 },
	{ width: 430, height: 932 },
];
const height = Number(process.env.PAGE_SHOTS_HEIGHT) || undefined;
const viewports = [
	...VIEWPORTS.filter(({ width }) => wanted.length === 0 || wanted.includes(width)),
	...ON_REQUEST.filter(({ width }) => wanted.includes(width)),
].map((viewport) => (height ? { ...viewport, height } : viewport));
const only = (process.env.PAGE_SHOTS_ONLY ?? "")
	.split(",")
	.map((name) => name.trim())
	.filter(Boolean);
const colorScheme = process.env.PAGE_SHOTS_THEME === "dark" ? "dark" : "light";
const OUT = join("test-results", "page-shots");

const enabled = !!process.env.PAGE_SHOTS;

// One worker, in order, and no second try: the Household is made once, in beforeAll.
test.describe.configure({ mode: "default", retries: 0 });

/** Focus as the keyboard gives it (a ring shows): focus, then Tab away and back. */
async function keyboardFocus(page: Page, target: Locator) {
	await target.focus();
	await page.keyboard.press("Tab");
	await page.keyboard.press("Shift+Tab");
}

type Shot = {
	name: string;
	path: string;
	ready?: (page: Page) => Promise<void>;
	/** Only at phone widths, and only what's in the window (a sheet over the page). */
	phoneSheet?: boolean;
	/** Only at phone widths, the whole page: what only a phone shows (a folded group opened). */
	phone?: boolean;
	/** A phone's sheet picture taken at desktop widths too: what's in the window (issue 73). */
	desk?: boolean;
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
	/** Pictured as the fourth Parent, whose months ended with nothing left and then short. */
	carry?: boolean;
	/** Only from 1024 up: a computer's twin of a picture a phone has under another name (issue 73). */
	desktop?: boolean;
	/** Pictured signed out (sign-in, sign-up): `ready` is its only wait, the page has no heading. */
	signedOut?: boolean;
};

let parent: Awaited<ReturnType<typeof createTestParent>> | undefined;
/** The Parent of the new Household that hasn't finished setup. */
let freshParent: Awaited<ReturnType<typeof createTestParent>> | undefined;
/** The Parent of the small Household for the Income and Cover pictures (#86, #87). */
let smallParent: Awaited<ReturnType<typeof createTestParent>> | undefined;
/** The Parent of the Household whose ended months carried nothing, then a shortfall (issue 73). */
let carryParent: Awaited<ReturnType<typeof createTestParent>> | undefined;
let shots: Shot[] = [];
/** What the seeding couldn't do: written beside the pictures so a missing section is explained. */
const seedNotes: string[] = [];

/** Quick Add opened from the phone's tab bar, then taken as far as the picture needs (issue 74). */
const quickAdd = (step?: "amount" | "more" | "for") => async (page: Page) => {
	const sheet = page.getByRole("dialog", { name: "Quick Add" });
	await pressFor(
		page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Quick Add" }),
		sheet,
	);
	if (!step) return;
	const keypad = sheet.getByRole("group", { name: "Keypad" });
	for (const key of ["2", "4"]) await keypad.getByRole("button", { name: key, exact: true }).tap();
	if (step === "more") await sheet.getByRole("button", { name: /^More Buckets/ }).tap();
	if (step === "for") {
		await sheet.getByRole("button", { name: /^For: / }).tap();
		await expect(sheet.getByRole("radiogroup", { name: "For" })).toBeVisible({ timeout: 15_000 });
	}
};

/** Skips in Review, one by one, until a card of this kind is on top (issue 74). */
async function reviewCardOnTop(page: Page, which: string) {
	const stack = page.getByTestId("review-stack");
	const card = stack.locator(`[data-testid=review-card]${which}`);
	for (let skipped = 0; skipped < 10; skipped++) {
		if (await card.isVisible()) break;
		await stack.getByRole("button", { name: "Skip" }).click({ timeout: 15_000 });
		await page.waitForTimeout(400);
	}
	await expect(card).toBeVisible();
	await page.evaluate(() => window.scrollTo(0, 0));
	return card;
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

/** The row that opens and closes a Perk Source: the first button of its first heading. */
const perkRow = (card: Locator) => card.locator("h3").first().getByRole("button").first();

/** A credit card added on Perks & Benefits, as perks-page.spec.ts does (AI_MODEL=stub reads the page). */
async function addCard(page: Page, name: string, pageUrl: string, fee: string, perks: number) {
	await page.getByRole("button", { name: "Add a card or membership" }).click();
	const sheet = page.getByRole("dialog", { name: "Add a card or membership" });
	await sheet.getByLabel("Card or membership").fill(name);
	await sheet.getByRole("button", { name: "I have a link to its benefits page" }).click();
	await sheet.getByLabel("Benefits page (optional)").fill(pageUrl);
	await sheet.getByRole("button", { name: "Add and read its perks" }).click();
	await expect(sheet).toBeHidden({ timeout: 30_000 });
	// The seed already has a Perk Source of the same name with fewer Perks (the Chase card the
	// Account ··0093 brought): take the one just added, by how many Perks it has.
	const card = page
		.getByRole("article", { name })
		.filter({ hasText: new RegExp(`· ${perks} perks`) });
	// One Perk Source is open at a time: open this one's row.
	// The row may open by itself as the Perks arrive, and an open card has more headings with
	// buttons: take the card's own row, and try again if a click landed on a row that had opened.
	const row = perkRow(card);
	await expect(row).toBeEnabled();
	await expect(async () => {
		if ((await row.getAttribute("aria-expanded")) !== "true") await row.click();
		await expect(
			card.getByRole("list", { name: `${name} Perks` }).getByRole("listitem"),
		).toHaveCount(perks, { timeout: 5_000 });
	}).toPass({ timeout: 45_000 });
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
	let inline = false;
	// The row only answers once the page is hydrated.
	await expect(async () => {
		// On a phone a long group is folded once the page is hydrated: its lines are behind
		// "Show all N …", so every group is opened first (nothing to press from 640 up).
		for (const all of await page.getByRole("button", { name: /^Show all \d+ / }).all())
			await all.click({ timeout: 2000 });
		const edit = page.getByRole("button", { name: `Edit ${title}` });
		// From 640 up the editor opens under its row, not in a sheet.
		if ((await edit.getAttribute("aria-expanded")) !== null) {
			if ((await edit.getAttribute("aria-expanded")) !== "true")
				await edit.click({ timeout: 2000 });
			await expect(edit).toHaveAttribute("aria-expanded", "true", { timeout: 2000 });
			inline = true;
			return;
		}
		if (!(await sheet.isVisible())) await edit.click({ timeout: 2000 });
		await expect(sheet).toBeVisible({ timeout: 2000 });
	}).toPass({ timeout: 20_000 });
	if (inline) {
		await page
			.getByRole("button", { name: `Edit ${title}` })
			.evaluate((node) => node.scrollIntoView({ block: "center" }));
		return page.getByRole("main");
	}
	return sheet;
}

/** Presses `button` until `shown` is there: a button only answers once the page is hydrated. */
async function pressFor(button: Locator, shown: Locator) {
	await expect(async () => {
		if (!(await shown.isVisible())) await button.click({ timeout: 2000 });
		await expect(shown).toBeVisible({ timeout: 2000 });
	}).toPass({ timeout: 20_000 });
}

/**
 * Transactions with its first three rows selected and the selection's bar up: by the checkbox
 * column where the table has one, else (a phone) by the Select button and a tap on each row.
 */
async function selectThree(page: Page) {
	const bar = page.getByRole("region", { name: "Selecting Transactions" });
	const body = page
		.getByRole("grid", { name: /^Transactions in / })
		.locator("[data-slot=data-table-body]");
	const boxes = body.getByRole("checkbox");
	if (await boxes.first().isVisible()) {
		for (let row = 0; row < 3; row++) await boxes.nth(row).click({ timeout: 15_000 });
		return bar;
	}
	await pressFor(page.locator("button:visible", { hasText: /^Select$/ }).first(), bar);
	const rows = body.locator("[data-slot=list-row]").getByRole("button");
	for (let row = 0; row < 3; row++) await rows.nth(row).click({ timeout: 15_000 });
	return bar;
}

/** Tries one part of the seeding; a failure is noted and the rest goes on. */
async function attempt(what: string, run: () => Promise<void>) {
	try {
		await run();
	} catch (error) {
		// The first lines say which locator and what it found instead: one line alone didn't.
		const lines = String(error)
			.split("\n")
			.map((line) => line.trim())
			.filter(Boolean);
		seedNotes.push(`${what}: ${lines.slice(0, 6).join(" | ")}`);
	}
}

/** Opens one of the Danger zone's confirming sheets and leaves it open: nothing is confirmed. */
/**
 * Presses a button on the page until what it opens is there: a sheet, a menu, or (for a confirm
 * drawn in the page) its Cancel button. For the phone pass's pictures of sheets (issue 74).
 */
const opened =
	(button: string | RegExp, confirm = false) =>
	async (page: Page) => {
		// One more than is up already: at 1024 an open item is itself a dialog (a drawer).
		const layers = page.locator("[role=dialog], [role=menu]");
		const before = await layers.count();
		await pressFor(
			page.getByRole("button", { name: button }).first(),
			confirm ? page.getByRole("button", { name: "Cancel" }).first() : layers.nth(before),
		);
		await page.waitForTimeout(400);
	};

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
	// Two groups of Buckets, so the Buckets table has heading rows and subtotals (issue 98).
	await seedSql([
		`update buckets set group_name = 'Food' where household_id = ${q(householdId)} and name in ('Groceries', 'Eating out');`,
		`update buckets set group_name = 'Family and home' where household_id = ${q(householdId)} and name in ('Kids', 'Household', 'Pets');`,
	]);
	// Money between the two Parents: a deposit from Sam among the Income, and a line sent to Sam.
	let sentToSam = "";
	await attempt("Money between the two Parents", async () => {
		sentToSam = await seedBetweenUs(householdId, parentId, ids.checking);
	});
	// Two Buckets for the last phone pass (issue 74): one nothing was ever spent from, which can be
	// deleted, and one archived from this month on, which can be restored.
	const unused = ulid();
	const archivedBucket = ulid();
	await attempt("A Bucket to delete and one to restore", async () => {
		const h = q(householdId);
		const [year, monthOfYear] = month.split("-").map(Number);
		const before = new Date(Date.UTC(year ?? 0, (monthOfYear ?? 1) - 2, 1))
			.toISOString()
			.slice(0, 7);
		await seedSql([
			`insert into buckets (id, household_id, name, color, position, from_month) values (${q(unused)}, ${h}, 'Keepsakes', 5, 90, ${q(month)});`,
			`insert into bucket_allowances (household_id, bucket_id, month, amount_cents) values (${h}, ${q(unused)}, ${q(month)}, 5000);`,
			`insert into buckets (id, household_id, name, color, position, from_month, archived_from_month) values (${q(archivedBucket)}, ${h}, 'Camping', 6, 91, ${q(before)}, ${q(month)});`,
			`insert into bucket_allowances (household_id, bucket_id, month, amount_cents) values (${h}, ${q(archivedBucket)}, ${q(before)}, 15000);`,
		]);
	});
	// A card being paid off, for the final desktop pass (issue 73): a payoff Goal on the Amex.
	let payoffGoal = "";
	await attempt("A payoff Goal on the Amex", async () => {
		payoffGoal = await seedPayoffGoal(householdId, ids.amex, "Pay off Amex Platinum", 96_240);
	});
	/** Plan › Income with the Zelle from Sam counted as Income (`marked` false) or between us. */
	const zelleFromSam = async (page: Page, marked: boolean) => {
		const region = page.locator('section[aria-label="Between us"]:visible').first();
		const hint = page.getByText(/\? It’s between us$/).first();
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
			// The toast has gone before the picture: it would sit over the rows on a phone. It comes
			// only when the server has answered, after the row has already moved, so it is waited
			// for first (it may not come at all when the entry was marked by an earlier width).
			const toast = page.getByRole("status").filter({ hasText: "is between you" });
			await toast.waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
			// Away from it: a toast under the pointer never counts down.
			await page.mouse.move(1, 1);
			await expect(toast).toHaveCount(0, { timeout: 20_000 });
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
		// The fee's save redraws the cards: let it finish, or it empties the note being typed.
		await page.waitForLoadState("networkidle");
		const amexRow = perkRow(amex);
		const uber = amex.getByRole("listitem", { name: "Uber Cash" });
		// Both fees are in before a Perk is marked, and the card opens through its "Worth using
		// now" line, as perks-page.spec.ts does: a row clicked while the cards redraw closed again.
		await expect(page.getByRole("region", { name: /^This year/ })).toContainText("$1,245", {
			timeout: 20_000,
		});
		await page
			.getByRole("list", { name: "Worth using now" })
			.getByRole("listitem", { name: "Uber Cash" })
			.getByRole("button")
			.click();
		await expect(amexRow).toHaveAttribute("aria-expanded", "true");
		await expect(uber).toContainText("$15");
		await uber.getByRole("button", { name: "Mark Uber Cash used" }).click();
		await uber.getByLabel("Note (optional)").fill("Rides to the airport");
		await uber.getByRole("button", { name: "Save" }).click();
		await expect(uber).toContainText("Rides to the airport", { timeout: 15_000 });
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
			{
				// The menu of one Income line ("It's between us", "Remove"): what's in the window.
				name: "01k-income-line-menu",
				path: thisMonth,
				small: true,
				window: true,
				ready: async (page) => {
					const actions = page.locator('button[aria-label^="Actions for"]:visible').first();
					await expect(async () => {
						if ((await page.getByRole("menu").count()) === 0)
							await actions.click({ timeout: 2000 });
						await expect(page.getByRole("menu")).toBeVisible({ timeout: 2000 });
					}).toPass({ timeout: 20_000 });
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

	// The fourth Household: two months back ended with nothing left, last month ended $230 short.
	let carried: Shot[] = [];
	await attempt("A Household whose months ended with nothing left and short", async () => {
		carryParent = await createTestParent();
		const carryPage = await signedInPage(browser, carryParent.email, {
			viewport: { width: 1440, height: 900 },
			colorScheme,
		});
		await createPlannedHousehold(carryPage, {
			baseline: "5,000",
			buckets: [
				["Groceries", "1,200"],
				["Fun", "300"],
			],
		});
		const now = /\/month\/(\d{4}-\d{2})/.exec(carryPage.url())?.[1];
		await carryPage.context().close();
		if (!now) throw new Error("No month in the new Household's address");
		const back = (count: number) => {
			const [year = 0, m = 0] = now.split("-").map(Number);
			return new Date(Date.UTC(year, m - 1 - count, 1)).toISOString().slice(0, 7);
		};
		const userId = q(carryParent.userId);
		const h = `(select household_id from members where clerk_user_id = ${userId})`;
		const m = `(select id from members where clerk_user_id = ${userId})`;
		const ended = (month: string, income: number, spent: number) => [
			`insert into income (id, household_id, date, amount_cents, note, created_by_member_id) values (${q(ulid())}, ${h}, ${q(`${month}-03`)}, ${income * 100}, 'Paycheck', ${m});`,
			`insert into transactions (id, household_id, source, date, amount_cents, note, created_by_member_id) values (${q(ulid())}, ${h}, 'quick-add', ${q(`${month}-12`)}, ${spent * 100}, 'Everything that month', ${m});`,
		];
		await seedSql([
			`insert into baselines (household_id, month, amount_cents) values (${h}, ${q(back(2))}, 500000);`,
			...ended(back(2), 5000, 5000),
			...ended(back(1), 3000, 3230),
		]);
		carried = [
			// An ended month with $0 left: "Ended with nothing left, so nothing was carried over".
			{ name: "01f-ended-month-nothing-left", path: `/month/${back(2)}`, carry: true },
			// An ended month that ended short, and the month after it with the shortfall carried in.
			{ name: "01g-ended-month-short", path: `/month/${back(1)}`, carry: true },
			{ name: "01h-this-month-short-carried-over", path: `/month/${now}`, carry: true },
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
						["35s-setup-step-5", 5],
						["36s-setup-step-6", 6],
						["37s-setup-step-7", 7],
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
	// Last month, where the toast pictures delete a row each: this month's pictures stay as seeded.
	const [year = 0, monthNumber = 1] = month.split("-").map(Number);
	const monthBefore =
		monthNumber === 1 ? `${year - 1}-12` : `${year}-${String(monthNumber - 1).padStart(2, "0")}`;
	shots = [
		{ name: "01-this-month", path: `/month/${month}` },
		// Part-way down on a computer: where the round Ask Noodle button sits over the page.
		{ name: "01e-this-month-scrolled", path: `/month/${month}`, scrolledTo: 500 },
		// Last month on the full Household: "How <Month> ended" and what it carried over.
		{
			name: "01i-ended-month",
			path: `/month/${new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)) - 2, 1)).toISOString().slice(0, 7)}`,
		},
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
		// The Sidebar collapsed to its icon rail. Only when asked for by name (PAGE_SHOTS_ONLY=00): the
		// Sidebar stays collapsed for every picture after it.
		...(only.includes("00")
			? [
					{
						name: "00-sidebar-collapsed",
						path: `/plan/${month}`,
						window: true,
						ready: async (page: Page) => {
							await page.getByRole("button", { name: "Toggle sidebar" }).click();
							// The rail slides shut: wait for it to settle.
							await page.waitForTimeout(500);
							await page.mouse.move(700, 500);
						},
					},
				]
			: []),
		{ name: "03-plan-overview", path: `/plan/${month}` },
		{ name: "03w-plan-overview-window", path: `/plan/${month}`, window: true },
		{
			// Every fold on the Plan's first page opened: "Things to check" and "What changed" (issue 73).
			name: "03b-plan-overview-folds-open",
			path: `/plan/${month}`,
			ready: async (page) => {
				const check = page.getByRole("button", { name: /^Things to check/, expanded: false });
				if (await check.isVisible()) await check.click({ timeout: 5000 });
				for (const all of await page.getByRole("button", { name: /^Show all/ }).all())
					await all.click({ timeout: 5000 }).catch(() => {});
			},
		},
		{
			// A group's Rename sheet, from the group's heading row in the Buckets table (issue 98).
			name: "04d-bucket-group-rename",
			path: `/plan/${month}#buckets`,
			window: true,
			ready: async (page) => {
				await pressFor(
					page.getByRole("button", { name: "Rename the group Food", exact: true }),
					page.getByRole("dialog"),
				);
			},
		},
		{
			name: "04e-add-buckets-sheet",
			path: `/plan/${month}#buckets`,
			window: true,
			ready: async (page) => {
				await pressFor(
					page.getByRole("button", { name: /^Add Buckets/ }).first(),
					page.getByRole("dialog", { name: "Add Buckets" }),
				);
			},
		},
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
		{
			// The Commitment sheet from its panel's Edit: amount, how often, "Pays down".
			name: "07c-commitment-sheet",
			path: `/plan/${month}/commitments/${firstCommitment}`,
			window: true,
			ready: async (page) => {
				await pressFor(
					page
						.getByRole("link", { name: "Edit", exact: true })
						.or(page.getByRole("button", { name: "Edit", exact: true })),
					// Under 1440 the panel is itself a dialog (a drawer): the sheet is the one with the form.
					page.getByRole("dialog").filter({ has: page.getByRole("textbox", { name: "Amount" }) }),
				);
			},
		},
		{ name: "08-plan-goal-funding", path: `/plan/${month}/goals` },
		{
			// An Income row's actions menu, open.
			name: "08y-plan-income-row-menu",
			path: `/plan/${month}/income`,
			window: true,
			ready: async (page) => {
				await pressFor(
					page.getByRole("button", { name: /^Actions for / }).first(),
					page.getByRole("menu"),
				);
			},
		},
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
		// The rest of Transactions as a phone has it (issue 74): the Filters sheet, the orders, and
		// "File in…" opened from the selection's bar.
		{
			name: "10e-transactions-filters-sheet",
			path: `/transactions/${month}`,
			phoneSheet: true,
			ready: opened("Filters"),
		},
		{
			name: "10f-transactions-sort-open",
			path: `/transactions/${month}`,
			phoneSheet: true,
			ready: async (page) => {
				await pressFor(page.getByRole("combobox", { name: "Sort" }), page.getByRole("listbox"));
			},
		},
		{
			name: "10g-transactions-file-in",
			path: `/transactions/${month}`,
			phoneSheet: true,
			ready: async (page) => {
				const bar = await selectThree(page);
				await bar.getByRole("button", { name: "File in…" }).click({ timeout: 15_000 });
				await expect(page.getByPlaceholder(/^(Search or create|Find a Bucket)$/)).toBeVisible({
					timeout: 15_000,
				});
			},
		},
		{
			// Three months in one list, as the sheet's Months leaves it: the chip, and a heading a month.
			name: "10h-transactions-three-months",
			path: `/transactions/${month}?range=3m`,
			phone: true,
			window: true,
		},
		{
			// The editor's Split opened: two parts and what is left.
			name: "11b-transaction-split",
			path: `/transactions/${month}/${ids.openTransaction}`,
			phone: true,
			ready: async (page) => {
				await page
					.getByRole("button", { name: "Split", exact: true })
					.first()
					.click({ timeout: 15_000 });
				await page.waitForTimeout(400);
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
		// 73ax: the table's other states on a computer. A range of months: its headings and total.
		{ name: "10e-transactions-range", path: `/transactions/${month}?range=3m`, tall: true },
		{
			name: "10g-transactions-assigned-picker",
			path: `/transactions/${month}`,
			window: true,
			ready: async (page) => {
				await page.locator("button[data-cell=assigned]").first().click({ timeout: 15_000 });
				await expect(page.getByRole("listbox").first()).toBeVisible({ timeout: 15_000 });
			},
		},
		{
			name: "10h-transactions-name-edit",
			path: `/transactions/${month}`,
			window: true,
			ready: async (page) => {
				await page
					.locator("button[data-cell=name]")
					.first()
					.click({ timeout: 15_000, force: true });
				await expect(page.locator("input[data-cell-editor]")).toBeVisible({ timeout: 15_000 });
			},
		},
		{
			name: "10i-transactions-sort-largest",
			path: `/transactions/${month}?sort=largest`,
			window: true,
		},
		{
			name: "10j-transactions-nothing-matches",
			path: `/transactions/${month}`,
			window: true,
			ready: async (page) => {
				await page.getByLabel("Search notes and merchants").fill("zzzz", { timeout: 15_000 });
				await expect(page.getByText("Nothing matches").first()).toBeVisible({ timeout: 15_000 });
			},
		},
		{
			name: "10k-transactions-account-filter",
			path: `/transactions/${month}`,
			window: true,
			ready: async (page) => {
				await page
					.getByRole("combobox", { name: "Account", exact: true })
					.click({ timeout: 15_000 });
				await expect(page.getByRole("option").first()).toBeVisible({ timeout: 15_000 });
			},
		},
		{ name: "10m-transactions-empty", path: `/transactions/${month}`, fresh: true, window: true },
		{
			// 73ax: the Quick Add dialog over a page on a computer, (the not-found screen has no heading the pictures wait for: not pictured).
			name: "10q-quick-add-dialog",
			path: `/transactions/${month}`,
			window: true,
			ready: async (page) => {
				await pressFor(
					page.getByRole("link", { name: "Quick Add" }).first(),
					page.getByRole("dialog", { name: "Quick Add" }),
				);
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
		// The rest of Review for the final phone pass (issue 74): the other kinds of card on top, the
		// "?" beside the count, what Sort says after a Skip, a phone's safe areas, and the sheets.
		...(
			[
				["12e-review-card-between-us", "[data-between-us]"],
				["12f-review-card-no-suggestion", ":has-text('pick where it goes')"],
			] as const
		).map(
			([name, which]): Shot => ({
				name,
				path: "/review",
				window: true,
				ready: async (page) => {
					await reviewCardOnTop(page, which);
				},
			}),
		),
		{
			name: "12g-review-said-after-skip",
			path: "/review",
			window: true,
			ready: async (page) => {
				const stack = page.getByTestId("review-stack");
				await stack.getByRole("button", { name: "Skip" }).click({ timeout: 15_000 });
				await expect(page.getByTestId("review-said")).toContainText("Skipped");
				await page.evaluate(() => window.scrollTo(0, 0));
			},
		},
		{
			name: "12h-review-term-help",
			path: "/review",
			window: true,
			ready: async (page) => {
				await pressFor(
					page
						.getByTestId("review-stack")
						.getByRole("button", { name: /^What’s / })
						.first(),
					page.getByRole("dialog"),
				);
			},
		},
		{
			// A phone with a notch and a home indicator: the header clears one, the tab bar the other.
			name: "12i-review-safe-areas",
			path: "/review",
			window: true,
			ready: async (page) => {
				await page.addStyleTag({
					content: ":root{--safe-top:47px!important;--safe-bottom:34px!important}",
				});
			},
		},
		{ name: "13-review-list", path: "/review?view=list" },
		{
			name: "13a-review-edit-transaction",
			path: "/review?view=list",
			phoneSheet: true,
			ready: async (page) => {
				await pressFor(
					page.getByRole("button", { name: /^Edit / }).first(),
					page.getByRole("dialog", { name: "Edit Transaction" }),
				);
			},
		},
		{
			// With a field in use, as when the keyboard is up (PAGE_SHOTS_HEIGHT=500).
			name: "13b-review-edit-transaction-typing",
			path: "/review?view=list",
			phoneSheet: true,
			ready: async (page) => {
				const sheet = page.getByRole("dialog", { name: "Edit Transaction" });
				await pressFor(page.getByRole("button", { name: /^Edit / }).first(), sheet);
				await sheet.getByRole("textbox").first().focus();
			},
		},
		{ name: "14-rules", path: "/review/rules" },
		{
			name: "14a-rule-page",
			path: "/review/rules",
			ready: async (page) => {
				await page.locator("a[href*='/review/rules/']").first().click({ timeout: 15_000 });
				await page.waitForURL(/\/review\/rules\/./);
			},
		},
		{
			name: "14b-rule-add",
			path: "/review/rules",
			phoneSheet: true,
			ready: async (page) => {
				await pressFor(
					page.getByRole("button", { name: "Add Rule" }).first(),
					page.getByRole("dialog"),
				);
			},
		},
		{ name: "38-not-found", path: "/no-such-page", window: true },
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
		// The sheets and confirms of Accounts and an Account, as a phone shows them (issue 74).
		{
			name: "15b-accounts-add-sheet",
			path: "/accounts",
			phoneSheet: true,
			desk: true,
			ready: opened("Add Account"),
		},
		{
			name: "16b-account-more-or-rename",
			path: `/accounts/${ids.sapphire}`,
			phoneSheet: true,
			desk: true,
			ready: opened(/^(More actions for|Rename)/),
		},
		{
			name: "16c-account-balance-sheet",
			path: `/accounts/${ids.sapphire}`,
			phoneSheet: true,
			desk: true,
			ready: opened(/^(Update|Add) (balance|what’s owed)/),
		},
		{
			name: "16d-account-upload-statement",
			path: `/accounts/${ids.college}`,
			phoneSheet: true,
			desk: true,
			ready: opened("Upload statement"),
		},
		{
			name: "16g-account-statement-chosen",
			path: `/accounts/${ids.college}`,
			phoneSheet: true,
			ready: async (page) => {
				await opened("Upload statement")(page);
				await page
					.getByRole("dialog", { name: "Upload a statement" })
					.getByLabel("Statement file")
					.setInputFiles(
						join(import.meta.dirname, "../../../packages/domain/fixtures/statements/checking.csv"),
					);
				await page.waitForTimeout(1500);
			},
		},
		{
			name: "16h-account-stop-syncing-confirm",
			path: `/accounts/${ids.sapphire}`,
			phoneSheet: true,
			ready: opened(/^Stop syncing with/, true),
		},
		{
			name: "15c-accounts-disconnect-confirm",
			path: "/accounts",
			phoneSheet: true,
			ready: opened(/^Disconnect /, true),
		},
		{
			name: "16e-account-archive-confirm",
			path: `/accounts/${ids.college}`,
			phoneSheet: true,
			desk: true,
			ready: opened("Archive this Account", true),
		},
		{
			name: "16f-account-rename-sheet",
			path: `/accounts/${ids.college}`,
			phoneSheet: true,
			desk: true,
			ready: opened(/^(More actions for|Rename)/),
		},
		{
			// "Connect a bank": how far back to bring Transactions in, asked before the bank's own
			// window opens (issue 73).
			name: "15c-accounts-connect-a-bank",
			path: "/accounts",
			window: true,
			ready: opened("Connect a bank"),
		},
		{ name: "17-goals", path: "/goals" },
		{ name: "18-goal", path: `/goals/${ids.vacation}` },
		// A long History: the whole page, then the window after scrolling 700px, where the side column
		// (progress and actions) should still be in view on a wide screen (#73).
		{ name: "18a-goal-long-history", path: `/goals/${ids.roof}` },
		{ name: "18b-goal-long-history-scrolled", path: `/goals/${ids.roof}`, scrolledTo: 700 },
		// A Goal's sheets on a phone (issue 74).
		{
			name: "17a-goals-add-sheet",
			path: "/goals",
			phoneSheet: true,
			desk: true,
			ready: opened("Add Goal"),
		},
		{
			// Add Goal opened on paying off a card or loan, as the Plan's pages link to it (issue 73).
			name: "17b-goals-add-payoff",
			path: "/goals?add=payoff",
			window: true,
			ready: async (page) => {
				await expect(page.getByRole("dialog")).toBeVisible({ timeout: 15_000 });
			},
		},
		// The Goals of one Account, on their own page (issue 73).
		{ name: "18h-goals-account", path: `/goals/accounts/${ids.savings}` },
		{
			name: "18c-goal-add-money-sheet",
			path: `/goals/${ids.vacation}`,
			phoneSheet: true,
			desk: true,
			ready: opened("Add money"),
		},
		{
			name: "18d-goal-edit-sheet",
			path: `/goals/${ids.vacation}`,
			phoneSheet: true,
			desk: true,
			ready: opened("Edit"),
		},
		{
			name: "18e-goal-spend-sheet",
			path: `/goals/${ids.vacation}`,
			phoneSheet: true,
			desk: true,
			ready: opened("Spend"),
		},
		{
			name: "18f-goal-take-back-sheet",
			path: `/goals/${ids.vacation}`,
			phoneSheet: true,
			desk: true,
			ready: opened("Take money back"),
		},
		{
			name: "18g-goal-archive-confirm",
			path: `/goals/${ids.vacation}`,
			phoneSheet: true,
			desk: true,
			ready: opened("Archive", true),
		},
		// A card being paid off: its panel, then its Edit sheet (issue 73).
		{ name: "18i-payoff-goal", path: `/goals/${payoffGoal}`, window: true },
		{
			name: "18j-payoff-goal-edit-sheet",
			path: `/goals/${payoffGoal}`,
			phoneSheet: true,
			desk: true,
			ready: opened("Edit"),
		},
		{
			// Back pressed with something typed in a Goal's Edit sheet: leaving the page asks first
			// ("Leave without saving?", issue 73). The Goal is opened from the list, so Back is the
			// app's own step to another page.
			name: "18k-leave-without-saving",
			path: "/goals",
			phoneSheet: true,
			desk: true,
			ready: async (page) => {
				const link = page.getByRole("link", { name: "Hawaii trip" }).first();
				await pressFor(link, page.getByRole("button", { name: "Edit" }).first());
				await page.waitForURL(`**/goals/${ids.vacation}`, { timeout: 15_000 });
				await settled(page);
				await opened("Edit")(page);
				const sheet = page.getByRole("dialog").last();
				await sheet.getByLabel("Name", { exact: true }).fill("Hawaii, all four of us");
				await page.goBack();
				await expect(page.getByRole("alertdialog", { name: "Leave without saving?" })).toBeVisible({
					timeout: 15_000,
				});
				await page.waitForTimeout(400);
			},
		},
		{ name: "19-explore", path: "/explore" },
		// A Scenario not saved yet, with one change: the outline, Your changes and the outcomes (#74).
		{ name: "19a-explore-with-a-change", path: "/explore?lever=baseline:1020000" },
		{
			// A Commitment's editor, in its sheet on a phone: the amount slider above its money field (#74).
			name: "19b-explore-line-open",
			path: "/explore",
			phoneSheet: true,
			desk: true,
			ready: async (page) => {
				await openLine(page, "Electricity");
			},
		},
		{
			// "Apply to Plan" pressed with one change: what would change, asked first (issue 73).
			name: "19e-explore-apply-dialog",
			path: "/explore?lever=baseline:1020000",
			window: true,
			ready: async (page) => {
				await pressFor(
					page.getByRole("button", { name: "Apply to Plan", exact: true }).first(),
					page.getByRole("alertdialog"),
				);
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
			desk: true,
			ready: async (page) => {
				const sheet = await openLine(page, "Raises & inflation");
				const on = sheet.getByRole("switch", { name: "Model raises and inflation" });
				if ((await on.getAttribute("aria-checked")) !== "true") await on.click({ timeout: 15_000 });
				const income = sheet.getByLabel("Income, % a year");
				await expect(income).toBeVisible({ timeout: 15_000 });
				await income.evaluate((node) => node.scrollIntoView({ block: "center" }));
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
		// A saved Scenario's Rename and Delete, each asked in its own dialog (issue 73).
		...(scenarioPath ? [scenarioPath] : []).flatMap((path) =>
			(["Rename", "Delete"] as const).map(
				(action, at): Shot => ({
					name: `22${"bc"[at]}-scenario-${action.toLowerCase()}`,
					path,
					window: true,
					ready: async (page) => {
						await pressFor(
							page.getByRole("button", { name: action, exact: true }).first(),
							page.getByRole("alertdialog"),
						);
					},
				}),
			),
		),
		{
			// A Scenario open while two are compared: Compare keeps to the room left of the panel.
			name: "22a-scenario-open-over-compare",
			path: "/explore/scenarios",
			window: true,
			ready: async (page) => {
				for (const name of ["Sam’s raise", "Pay cut"]) {
					const tick = page.getByRole("checkbox", { name: `Compare “${name}”` });
					await expect(async () => {
						if (!(await tick.isChecked())) await tick.click();
						await expect(tick).toBeChecked({ timeout: 2000 });
					}).toPass({ timeout: 20_000 });
				}
				await page.getByRole("link", { name: "Sam’s raise", exact: true }).first().click();
				await expect(page.getByRole("button", { name: "Rename" })).toBeVisible({ timeout: 15_000 });
			},
		},
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
		// Every chart of every view as its table (issue 73): the toggles beside the headings, pressed.
		...(
			[
				["23", "/reports"],
				["23a", "/reports?view=cash-flow"],
				["23b", "/reports?view=big"],
				["23c", "/reports?view=buckets"],
				["23d", "/reports?view=plan"],
				["23e", "/reports?view=trends"],
				["23f", "/reports?view=merchants"],
				["23g", "/reports?view=people"],
				["23h", "/reports?view=goals"],
				["23i", "/reports?view=income"],
			] as const
		).map(
			([pic, path]): Shot => ({
				name: `23t-reports-tables-${pic}`,
				path,
				ready: async (page) => {
					const toggles = page.getByRole("button", { name: /^Show .* as a table$/ });
					const count = await toggles.count();
					for (let i = 0; i < count; i++) {
						const toggle = toggles.nth(i);
						await expect(async () => {
							if ((await toggle.getAttribute("aria-pressed")) !== "true")
								await toggle.click({ timeout: 2000 });
							await expect(toggle).toHaveAttribute("aria-pressed", "true", { timeout: 2000 });
						}).toPass({ timeout: 20_000 });
					}
				},
			}),
		),
		// Drilled into one Bucket from Reports › Buckets: the breadcrumb and the area's own page.
		{
			name: "23u-reports-drilled-into-a-bucket",
			path: "/reports?view=buckets",
			ready: async (page) => {
				const row = page.getByRole("button", { name: /^Groceries: \$/ }).first();
				await expect(async () => {
					await row.click({ timeout: 2000 });
					await expect(page).toHaveURL(/area=/, { timeout: 2000 });
				}).toPass({ timeout: 20_000 });
			},
		},
		// The Period menu open, and the Filters sheet: only what's in the window.
		{
			name: "23v-reports-period-menu",
			path: "/reports",
			window: true,
			ready: async (page) => {
				const period = page.getByRole("combobox", { name: "Period" });
				await expect(async () => {
					if ((await page.getByRole("listbox").count()) === 0)
						await period.click({ timeout: 2000 });
					await expect(page.getByRole("listbox")).toBeVisible({ timeout: 2000 });
				}).toPass({ timeout: 20_000 });
			},
		},
		{
			name: "23w-reports-filters-sheet",
			path: "/reports",
			window: true,
			ready: async (page) => {
				await pressFor(
					page.getByRole("button", { name: /^Filters/ }),
					page.getByRole("dialog", { name: "Filters" }),
				);
			},
		},
		// On a phone the Period, Compare with and Group by selects are in the Filters sheet, and what
		// is on shows as chips under the button (issue 74).
		{
			name: "23j-reports-filters-sheet",
			path: "/reports?view=trends",
			phoneSheet: true,
			ready: async (page) => {
				await pressFor(
					page.getByRole("button", { name: /^Filters/ }),
					page.getByRole("dialog", { name: "Filters" }),
				);
			},
		},
		// The Compare with and Group by menus open, and a custom range with its From calendar.
		...(
			[
				["23x-reports-compare-menu", "/reports", "Compare with"],
				["23y-reports-group-menu", "/reports?view=trends", "Group by"],
			] as const
		).map(
			([name, path, label]): Shot => ({
				name,
				path,
				window: true,
				ready: async (page) => {
					const select = page.getByRole("combobox", { name: label });
					await expect(async () => {
						if ((await page.getByRole("listbox").count()) === 0)
							await select.click({ timeout: 2000 });
						await expect(page.getByRole("listbox")).toBeVisible({ timeout: 2000 });
					}).toPass({ timeout: 20_000 });
				},
			}),
		),
		{
			name: "23z-reports-custom-range",
			path: "/reports?period=custom",
			window: true,
			ready: async (page) => {
				await pressFor(page.getByRole("button", { name: "From" }), page.getByRole("dialog"));
			},
		},
		// Keyboard focus on a select, a tab and a table toggle of Reports; the pointer over a row.
		{
			name: "23s-reports-focus-and-hover",
			path: "/reports?view=buckets",
			window: true,
			ready: async (page) => {
				await page.getByRole("combobox", { name: "Period" }).focus();
				await page.keyboard.press("Tab");
				await page.keyboard.press("Shift+Tab");
				await page
					.getByRole("button", { name: /^Groceries: \$/ })
					.first()
					.hover();
			},
		},
		// One of each control of Reports in its two other states (issue 73). A picture holds one
		// keyboard focus and one pointer, so: a tab focused and a table toggle under the pointer; the
		// toggle focused and a tab under the pointer; a row focused and a select under the pointer;
		// a chip of the Filters sheet focused and another under the pointer.
		{
			name: "23sa-reports-tab-focus-toggle-hover",
			path: "/reports?view=buckets",
			window: true,
			ready: async (page) => {
				await keyboardFocus(page, page.getByRole("link", { name: "Trends", exact: true }));
				await page
					.getByRole("button", { name: /^Show .* as a table$/ })
					.first()
					.hover();
			},
		},
		{
			name: "23sb-reports-toggle-focus-tab-hover",
			path: "/reports?view=buckets",
			window: true,
			ready: async (page) => {
				await keyboardFocus(
					page,
					page.getByRole("button", { name: /^Show .* as a table$/ }).first(),
				);
				await page.getByRole("link", { name: "Merchants", exact: true }).hover();
			},
		},
		{
			name: "23sc-reports-row-focus-select-hover",
			path: "/reports?view=buckets",
			window: true,
			ready: async (page) => {
				await keyboardFocus(page, page.getByRole("button", { name: /^Kids: \$/ }).first());
				await page.getByRole("combobox", { name: "Compare with" }).hover();
			},
		},
		{
			name: "23sd-reports-chip-focus-and-hover",
			path: "/reports",
			window: true,
			ready: async (page) => {
				const sheet = page.getByRole("dialog", { name: "Filters" });
				await pressFor(page.getByRole("button", { name: /^Filters/ }), sheet);
				await keyboardFocus(page, sheet.locator("button", { hasText: /^Kids$/ }));
				await sheet.locator("button", { hasText: /^Household$/ }).hover();
			},
		},
		{
			// "Cover" on an overspent Bucket's row: the sheet that asks where the money comes from.
			name: "01l-cover-a-bucket-sheet",
			path: `/month/${month}`,
			window: true,
			ready: async (page) => {
				await pressFor(
					page.locator("button:visible", { hasText: /^Cover/ }).first(),
					page.getByRole("dialog"),
				);
			},
		},
		// A month's own Plan page.
		{ name: "01j-month-plan", path: `/month/${month}/plan` },
		{
			name: "23l-reports-filters-typing",
			path: "/reports?view=trends",
			phoneSheet: true,
			ready: async (page) => {
				const sheet = page.getByRole("dialog", { name: "Filters" });
				await pressFor(page.getByRole("button", { name: /^Filters/ }), sheet);
				await sheet.getByRole("textbox").first().focus();
			},
		},
		{
			name: "23k-reports-trends-with-chips",
			path: "/reports?view=trends&period=12m&compare=last-year&group=week&min=50&member=everyone",
			phone: true,
		},
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
		// The Check-in's later steps (Insights, Sweeps, Extra income), each reached with "Skip for now".
		...([1, 2, 3] as const).map(
			(skips): Shot => ({
				name: `26${"bcd"[skips - 1]}-check-in-step-${skips + 1}`,
				path: "/check-in",
				ready: async (page) => {
					const main = page.getByRole("main");
					for (let n = 1; n <= skips; n++) {
						await expect(async () => {
							if ((await main.getByText(`${n} of `, { exact: false }).count()) > 0)
								await main
									.getByRole("button", { name: "Skip for now" })
									.first()
									.click({ timeout: 2000 });
							await expect(main.getByText(new RegExp(`^${n + 1} of \\d`))).toBeVisible({
								timeout: 2000,
							});
						}).toPass({ timeout: 20_000 });
					}
				},
			}),
		),
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
			// Delete Household's second step: the name to type, as a phone shows it (issue 74).
			name: "27d-delete-household-step-2",
			path: "/household",
			phoneSheet: true,
			ready: async (page) => {
				await openDangerSheet(page, "Delete Household");
				const sheet = page.getByRole("dialog", { name: "Delete Household?" });
				await sheet.getByRole("button", { name: "Continue" }).click();
				await sheet.getByRole("textbox").focus();
			},
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
		// What no picture showed before the final phone pass (issue 74): the second step of Start
		// fresh, Nudges with their choices, Snapshots with a history, a Child's sheet, an invite sent.
		{
			name: "27e-start-fresh-step-2",
			path: "/household",
			phoneSheet: true,
			ready: async (page) => {
				await openDangerSheet(page, "Start fresh");
				const sheet = page.getByRole("dialog", { name: "Start fresh?" });
				await sheet.getByRole("button", { name: "Continue" }).click();
				await sheet.getByRole("textbox").focus();
			},
		},
		{
			name: "27f-household-nudges-on",
			path: "/household",
			phoneSheet: true,
			ready: async (page) => {
				await page.context().addInitScript(fakePushManager);
				await page.reload();
				await settled(page);
				const nudges = page.getByRole("region", { name: "Nudges" });
				const on = nudges.getByText("Nudges are on for this device.");
				await expect(async () => {
					if (!(await on.isVisible()))
						await nudges.getByRole("button", { name: "Turn on" }).click({ timeout: 2000 });
					await expect(on).toBeVisible({ timeout: 5000 });
				}).toPass({ timeout: 30_000 });
				const choose = nudges.getByRole("button", { name: "Choose which Nudges you get" });
				if (await choose.isVisible()) await choose.click();
				await nudges.evaluate((node) => node.scrollIntoView({ block: "start" }));
			},
		},
		{
			name: "27g-household-snapshots-history",
			path: "/household",
			phoneSheet: true,
			ready: async (page) => {
				const snapshots = page.getByRole("region", { name: "Snapshots" });
				const rows = snapshots.getByRole("listitem");
				for (const note of ["Before the big shop", "Before we changed the Plan for the holidays"]) {
					if ((await rows.filter({ hasText: note }).count()) > 0) continue;
					await expect(async () => {
						await snapshots.getByLabel("Note").fill(note);
						await snapshots.getByRole("button", { name: "Take a snapshot" }).click();
						await expect(rows.filter({ hasText: note }).first()).toBeVisible({ timeout: 40_000 });
					}).toPass({ timeout: 90_000 });
				}
				const more = snapshots.getByRole("button", { name: /earlier/i });
				if (await more.isVisible()) await more.click();
				await snapshots.evaluate((node) => node.scrollIntoView({ block: "start" }));
			},
		},
		{
			name: "27h-child-sheet",
			path: "/household",
			phoneSheet: true,
			ready: async (page) => {
				await pressFor(
					page
						.getByRole("region", { name: "Children" })
						.getByRole("button", { name: /^Edit / })
						.first(),
					page.getByRole("dialog"),
				);
				await page.getByRole("dialog").getByRole("textbox").first().focus();
			},
		},
		{ name: "28-glossary", path: "/glossary" },
		{ name: "24x-ask", path: "/ask" },
		{
			// Ask with a question typed, as when the keyboard is up (PAGE_SHOTS_HEIGHT=500).
			name: "24y-ask-typing",
			path: "/ask",
			phoneSheet: true,
			ready: async (page) => {
				const ask = page.getByLabel("Ask").first();
				await ask.fill("Can we afford a second car if the payment is $450 a month?");
				await ask.focus();
			},
		},
		{ name: "08x-plan-income", path: `/plan/${month}/income` },
		{ name: "39a-empty-reports", path: "/reports", fresh: true },
		{ name: "39b-empty-goals", path: "/goals", fresh: true },
		{ name: "39c-empty-accounts", path: "/accounts", fresh: true },
		{ name: "39d-empty-insights", path: "/insights", fresh: true },
		{ name: "39e-empty-check-in", path: "/check-in", fresh: true },
		{ name: "39f-empty-ask", path: "/ask", fresh: true },
		{ name: "39g-empty-explore", path: "/explore", fresh: true },
		{ name: "39h-empty-commitments", path: `/plan/${month}/commitments`, fresh: true },
		{ name: "39i-empty-goal-funding", path: `/plan/${month}/goals`, fresh: true },
		{ name: "39j-empty-income", path: `/plan/${month}/income`, fresh: true },
		{ name: "39k-empty-afford", path: "/explore/afford", fresh: true },
		{ name: "39l-empty-review", path: "/review", fresh: true },
		{
			name: "29-more-sheet",
			path: "/reports",
			phoneSheet: true,
			ready: async (page) => {
				await openMore(page);
			},
		},
		// Quick Add as a phone has it: at rest, with an amount, every Bucket, and who it is for.
		{ name: "35-quick-add", path: `/month/${month}`, phoneSheet: true, ready: quickAdd() },
		{
			name: "35a-quick-add-amount",
			path: `/month/${month}`,
			phoneSheet: true,
			ready: quickAdd("amount"),
		},
		{
			name: "35b-quick-add-more-buckets",
			path: `/month/${month}`,
			phoneSheet: true,
			ready: quickAdd("more"),
		},
		{
			name: "35c-quick-add-for",
			path: `/month/${month}`,
			phoneSheet: true,
			ready: quickAdd("for"),
		},
		// The Plan's sheets and states the pictures above don't reach (issue 74), after them: the
		// first puts two Buckets in a group, which stays.
		{
			name: "43-plan-grouped",
			path: `/plan/${month}#buckets`,
			ready: async (page) => {
				for (const name of ["Gas", "Household"]) {
					const edit = page.getByRole("button", { name: `Edit ${name}`, exact: true });
					const sheet = page.getByRole("dialog", { name, exact: true });
					await pressFor(edit, sheet);
					const field = sheet.getByLabel("Group", { exact: true });
					if ((await field.inputValue()) === "Home") {
						await sheet.getByRole("button", { name: "Cancel", exact: true }).click();
					} else {
						await field.fill("Home");
						const saved = savedBy(page, "updateBucket");
						await sheet.getByRole("button", { name: "Save", exact: true }).click();
						await saved;
					}
					await expect(sheet).toHaveCount(0, { timeout: 15_000 });
				}
			},
		},
		{
			name: "43a-group-rename-sheet",
			path: `/plan/${month}#buckets`,
			window: true,
			ready: (page) =>
				pressFor(
					page.getByRole("button", { name: "Rename the group Home" }),
					page.getByRole("dialog", { name: "Home", exact: true }),
				),
		},
		{
			// The Bucket sheet at its Group field, with the groups there are to pick from.
			name: "43b-bucket-sheet-group",
			path: `/plan/${month}#buckets`,
			window: true,
			ready: async (page) => {
				// The address is the last picture's, so its sheet is still up: a fresh page.
				await page.reload();
				await settled(page);
				const sheet = page.getByRole("dialog", { name: "Gas", exact: true });
				await pressFor(page.getByRole("button", { name: "Edit Gas", exact: true }), sheet);
				await sheet
					.getByLabel("Group", { exact: true })
					.evaluate((node) => node.scrollIntoView({ block: "center" }));
			},
		},
		{
			// The Bucket's sheet closed with a change not saved: "Discard changes" is asked (issue 73).
			name: "04a5-bucket-sheet-discard",
			path: `/plan/${month}#buckets`,
			window: true,
			ready: async (page) => {
				const sheet = page.getByRole("dialog", { name: "Groceries", exact: true });
				await pressFor(page.getByRole("button", { name: "Edit Groceries", exact: true }), sheet);
				await sheet.getByRole("textbox", { name: "Allowance", exact: true }).fill("1,000");
				await page.keyboard.press("Escape");
				await expect(page.getByRole("button", { name: "Discard changes" })).toBeVisible({
					timeout: 15_000,
				});
			},
		},
		{
			// A Bucket nothing was ever spent from can be deleted: the question asked first.
			name: "44-bucket-delete-confirm",
			path: `/plan/${month}#buckets`,
			window: true,
			ready: async (page) => {
				// The address is the last picture's, so its sheet is still up: a fresh page.
				await page.reload();
				await settled(page);
				const sheet = page.getByRole("dialog", { name: "Gifts", exact: true });
				await pressFor(page.getByRole("button", { name: "Edit Gifts", exact: true }), sheet);
				const remove = sheet.getByRole("button", { name: "Delete", exact: true });
				const archive = sheet.getByRole("button", { name: "Archive", exact: true });
				await archive.scrollIntoViewIfNeeded({ timeout: 15_000 });
				await ((await remove.count()) > 0 ? remove : archive).click({ timeout: 15_000 });
				await page.waitForTimeout(400);
			},
		},
		{
			name: "45-add-buckets-sheet",
			path: `/plan/${month}#buckets`,
			window: true,
			ready: async (page) => {
				await page.reload();
				await settled(page);
				await pressFor(
					page.getByRole("button", { name: "Add Buckets", exact: true }).first(),
					page.getByRole("dialog", { name: "Add Buckets" }),
				);
			},
		},
		{
			name: "46-things-to-check-open",
			path: `/plan/${month}`,
			phone: true,
			ready: async (page) => {
				const row = page.getByRole("button", { name: /Things to check/ }).first();
				if ((await row.count()) === 0) return;
				await expect(async () => {
					if ((await row.getAttribute("aria-expanded")) !== "true")
						await row.click({ timeout: 2000 });
					await expect(row).toHaveAttribute("aria-expanded", "true", { timeout: 2000 });
				}).toPass({ timeout: 20_000 });
			},
		},
		{
			name: "47-commitment-sheet",
			path: `/plan/${month}/commitments/${firstCommitment}`,
			window: true,
			ready: (page) =>
				pressFor(
					page.getByRole("button", { name: "Edit", exact: true }).first(),
					page.getByRole("dialog").first(),
				),
		},
		{
			// Cover an over-spent Bucket, from This Month's Buckets list.
			name: "48-cover-sheet",
			path: `/month/${month}`,
			window: true,
			ready: (page) =>
				pressFor(
					page.getByRole("button", { name: /^Cover / }).first(),
					page.getByRole("dialog", { name: /^Cover / }),
				),
		},
		// This Month's and the Plan's states with no picture until the last phone pass (issue 74). Each
		// is what the window shows once the thing is brought to its top; nothing is saved.
		...(
			[
				["49-bills-coming-up", `/month/${month}`, { role: "tab", name: /^Coming up/ }],
				[
					"49a-bills-not-this-month",
					`/month/${month}`,
					{ role: "button", name: /^Not this month/ },
				],
				["49b-record-payment", `/month/${month}`, { role: "button", name: "Record payment" }],
				[
					"49c-income-row-menu",
					`/month/${month}`,
					{ role: "button", name: /^Actions for .* of income$/ },
				],
				["49d-add-income-sheet", `/month/${month}`, { role: "button", name: "Add income" }],
				[
					"51-commitment-add",
					`/plan/${month}/commitments`,
					{ role: "textbox", name: "New Commitment" },
				],
			] as const
		).map(
			([name, path, target]): Shot => ({
				name,
				path,
				window: true,
				ready: async (page) => {
					await page.reload();
					await settled(page);
					const control = page.getByRole(target.role, { name: target.name }).first();
					await control.evaluate((el) => {
						window.scrollTo(0, window.scrollY + el.getBoundingClientRect().top - 120);
					});
					await page.waitForTimeout(300);
					// A text field is only brought into view: tapping it would not bring a keyboard up here.
					if (target.role !== "textbox") await control.click({ timeout: 15_000 });
					await page.waitForTimeout(500);
				},
			}),
		),
		{ name: "49e-months-plan", path: `/month/${month}/plan`, phone: true },
		{
			// Add Buckets with a row of the Parent's own ("Add your own") typed in, not saved.
			name: "50-add-buckets-own-row",
			path: `/plan/${month}#buckets`,
			window: true,
			ready: async (page) => {
				await page.reload();
				await settled(page);
				const sheet = page.getByRole("dialog", { name: "Add Buckets" });
				await pressFor(
					page.getByRole("button", { name: "Add Buckets", exact: true }).first(),
					sheet,
				);
				const own = sheet.getByRole("button", { name: "Add your own", exact: true });
				await own.scrollIntoViewIfNeeded({ timeout: 15_000 });
				await own.click({ timeout: 15_000 });
				await page.keyboard.type("Christmas presents");
				await page.waitForTimeout(400);
			},
		},
		{
			// A Bucket nothing was ever spent from: Delete is offered, and asks first.
			name: "52-bucket-delete-confirm",
			path: `/plan/${month}#buckets`,
			window: true,
			ready: async (page) => {
				await page.reload();
				await settled(page);
				const sheet = page.getByRole("dialog", { name: "Keepsakes", exact: true });
				await pressFor(page.getByRole("button", { name: "Edit Keepsakes", exact: true }), sheet);
				const remove = sheet.getByRole("button", { name: "Delete", exact: true });
				await remove.scrollIntoViewIfNeeded({ timeout: 15_000 });
				await remove.click({ timeout: 15_000 });
				await page.waitForTimeout(400);
			},
		},
		{
			name: "53-archived-bucket",
			path: `/plan/${month}/buckets/${archivedBucket}`,
			phone: true,
			desk: true,
		},
		{
			name: "53a-restore-bucket-sheet",
			path: `/plan/${month}/buckets/${archivedBucket}`,
			window: true,
			ready: (page) =>
				pressFor(
					page.getByRole("button", { name: "Restore to the Plan" }).first(),
					page.getByRole("dialog", { name: "Restore Camping" }),
				),
		},
		{
			// Larger text (iOS, 200%): the root's size doubled, so everything set in rem follows.
			name: "54-plan-large-text",
			path: `/plan/${month}`,
			phone: true,
			ready: async (page) => {
				await page.addStyleTag({ content: "html{font-size:200%}" });
				await page.waitForTimeout(400);
			},
		},
		{
			// The toast after a Quick Add, over the page and above the tab bar. It saves $24 in the first Bucket offered.
			name: "55-quick-add-toast",
			path: `/month/${month}`,
			phoneSheet: true,
			ready: async (page) => {
				await quickAdd("amount")(page);
				const sheet = page.getByRole("dialog", { name: "Quick Add" });
				await sheet
					.getByRole("list", { name: "Add to" })
					.getByRole("button")
					.first()
					.tap({ timeout: 15_000 });
				await expect(page.getByRole("status").filter({ hasText: "added to" })).toBeVisible({
					timeout: 15_000,
				});
			},
		},
		...small,
		...carried,
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
		// What was never pictured before the final phone pass (issue 74): Review's sheets, a long line
		// from Sort, text at 200%, the bank's return page and the page a joining Parent lands on.
		{
			name: "12j-review-split",
			path: "/review",
			phoneSheet: true,
			ready: async (page) => {
				const card = await reviewCardOnTop(page, ":has(button:text-is('Split'))");
				await pressFor(card.getByRole("button", { name: "Split" }), page.getByRole("dialog"));
			},
		},
		{
			name: "12k-review-make-a-rule",
			path: "/review",
			phoneSheet: true,
			ready: async (page) => {
				const card = await reviewCardOnTop(page, ":has(button:text-is('Split'))");
				await pressFor(
					card.getByRole("button", { name: "Make a Rule" }),
					page.getByRole("dialog", { name: "Make a Rule" }),
				);
			},
		},
		{
			name: "12l-review-new-bucket",
			path: "/review",
			phoneSheet: true,
			desk: true,
			ready: async (page) => {
				const card = await reviewCardOnTop(page, ":has([role=combobox])");
				await card.getByRole("combobox").first().click({ timeout: 15_000 });
				await page.getByPlaceholder("Find a Bucket").fill("Widgets and wonders");
				await page.getByRole("option", { name: /^Create Bucket/ }).click({ timeout: 15_000 });
				await expect(page.getByRole("dialog", { name: "New Bucket" })).toBeVisible();
			},
		},
		{
			// A payment's name is the statement's own line: long enough that Sort's line is cut.
			name: "12n-review-said-long",
			path: "/review",
			window: true,
			ready: async (page) => {
				await reviewCardOnTop(page, "[data-payment]");
				await page
					.getByTestId("review-stack")
					.getByRole("button", { name: "Skip" })
					.click({ timeout: 15_000 });
				await expect(page.getByTestId("review-said")).toContainText("Skipped");
				await page.evaluate(() => window.scrollTo(0, 0));
			},
		},
		...(
			[
				["12p-review-large-text", "/review"],
				["14d-rules-large-text", "/review/rules"],
			] as const
		).map(
			([name, path]): Shot => ({
				name,
				path,
				phone: true,
				ready: async (page) => {
					await page.addStyleTag({
						content:
							"html { font-size: 200% !important; -webkit-text-size-adjust: 200% !important; }",
					});
				},
			}),
		),
		// A computer's twins of what only a phone had pictured (issue 73, agent 73bc): the sheets and
		// pickers of Transactions, Review and Household settings, the signed-out pages and the toasts.
		// Each is what's in the window. The toasts come last: each deletes a row of last month.
		...(
			[
				{
					name: "d10r-transactions-file-in",
					path: `/transactions/${month}`,
					ready: async (page) => {
						const bar = await selectThree(page);
						await bar.getByRole("button", { name: "File in…" }).click({ timeout: 15_000 });
						await expect(page.getByPlaceholder(/^(Search or create|Find a Bucket)$/)).toBeVisible({
							timeout: 15_000,
						});
					},
				},
				{
					name: "d11c-transaction-split",
					path: `/transactions/${month}/${ids.openTransaction}`,
					ready: async (page) => {
						await page
							.getByRole("button", { name: "Split", exact: true })
							.first()
							.click({ timeout: 15_000 });
						await page.waitForTimeout(400);
					},
				},
				{
					name: "d12q-review-picker",
					path: "/review",
					ready: async (page) => {
						const card = await reviewCardOnTop(page, ":has([role=combobox])");
						await card.getByRole("combobox").first().click({ timeout: 15_000 });
						await expect(page.getByPlaceholder("Find a Bucket")).toBeVisible({ timeout: 15_000 });
					},
				},
				{
					name: "d12j-review-split",
					path: "/review",
					ready: async (page) => {
						const card = await reviewCardOnTop(page, ":has(button:text-is('Split'))");
						await pressFor(card.getByRole("button", { name: "Split" }), page.getByRole("dialog"));
					},
				},
				{
					name: "d12k-review-make-a-rule",
					path: "/review",
					ready: async (page) => {
						const card = await reviewCardOnTop(page, ":has(button:text-is('Split'))");
						await pressFor(
							card.getByRole("button", { name: "Make a Rule" }),
							page.getByRole("dialog", { name: "Make a Rule" }),
						);
					},
				},
				{
					name: "d14b-rule-add",
					path: "/review/rules",
					ready: async (page) => {
						await pressFor(
							page.getByRole("button", { name: "Add Rule" }).first(),
							page.getByRole("dialog"),
						);
					},
				},
				{
					// Layout only: what the second step does is issue 118.
					name: "d27d-delete-household-step-2",
					path: "/household",
					ready: async (page) => {
						await openDangerSheet(page, "Delete Household");
						const sheet = page.getByRole("dialog", { name: "Delete Household?" });
						await sheet.getByRole("button", { name: "Continue" }).click();
						await sheet.getByRole("textbox").focus();
					},
				},
				{
					name: "d27e-start-fresh-step-2",
					path: "/household",
					ready: async (page) => {
						await openDangerSheet(page, "Start fresh");
						const sheet = page.getByRole("dialog", { name: "Start fresh?" });
						const on = sheet.getByRole("button", { name: "Continue" });
						if (await on.isVisible()) await on.click();
						await page.waitForTimeout(400);
					},
				},
				{
					// A snapshot taken, so Snapshots has its history: one more row at each width.
					name: "d27f-snapshots-history",
					path: "/household",
					ready: async (page) => {
						const history = page.getByRole("list", { name: "Snapshot history" });
						await pressFor(page.getByRole("button", { name: "Take a snapshot" }), history);
						await history.evaluate((node) => node.scrollIntoView({ block: "center" }));
					},
				},
				{
					name: "d27g-child-sheet",
					path: "/household",
					ready: async (page) => {
						await pressFor(
							page.getByRole("button", { name: /^(Edit|Rename) Maya/ }).first(),
							page.getByRole("dialog"),
						);
					},
				},
				...(["sign-in", "sign-up"] as const).map(
					(name, index): Shot => ({
						name: `d6${index}-${name}`,
						path: `/${name}`,
						signedOut: true,
						ready: async (page) => {
							await expect(page.locator(".cl-formButtonPrimary")).toBeVisible({ timeout: 30_000 });
							await page.evaluate(() => document.fonts.ready);
							await page.waitForTimeout(600);
						},
					}),
				),
				...([1, 2] as const).map(
					(toasts): Shot => ({
						// One toast with Undo, then two stacked: a row of last month deleted for each.
						name: toasts === 1 ? "d62-toast-undo" : "d63-toasts-two",
						path: `/transactions/${monthBefore}`,
						ready: async (page) => {
							const boxes = page
								.getByRole("grid", { name: /^Transactions in / })
								.locator("[data-slot=data-table-body]")
								.getByRole("checkbox");
							for (let made = 0; made < toasts; made++) {
								await boxes.first().click({ timeout: 15_000 });
								await page
									.getByRole("region", { name: "Selecting Transactions" })
									.getByRole("button", { name: "Delete" })
									.click({ timeout: 15_000 });
								const sheet = page.getByRole("dialog", { name: /^Delete \d+ Transactions?\?$/ });
								await sheet.getByRole("button", { name: /^Delete/ }).click({ timeout: 15_000 });
								await expect(page.locator("[data-sonner-toast]")).toHaveCount(made + 1, {
									timeout: 15_000,
								});
							}
						},
					}),
				),
			] satisfies Shot[]
		).map((shot): Shot => ({ ...shot, desktop: true, window: true })),
		{ name: "50-bank-return", path: "/bank/return", window: true },
		{ name: "52-joined", path: "/joined", window: true },
		{
			// Files every card it can, for the finish after the last one. Asked for by name.
			name: "46-review-finish",
			path: "/review",
			window: true,
			ready: async (page) => {
				const stack = page.getByTestId("review-stack");
				const card = stack.locator("[data-testid=review-card]").first();
				for (let turn = 0; turn < 60; turn++) {
					if (!(await card.isVisible())) break;
					const confirm = card.getByRole("button", { name: "Confirm" });
					const payment = card.getByRole("button", { name: "It’s a card payment" });
					if (await confirm.isVisible()) await confirm.click();
					else if (await payment.isVisible()) await payment.click();
					else if (await card.getByRole("combobox").first().isVisible()) {
						await card.getByRole("combobox").first().click();
						await page.getByRole("option").first().click({ timeout: 15_000 });
					} else await stack.getByRole("button", { name: "Skip" }).click();
					await page.waitForTimeout(700);
				}
				await page.evaluate(() => window.scrollTo(0, 0));
			},
		},
		// These decide cards for good, so they come last and are asked for by name, one width a run.
		{
			// What Sort says after a card is filed, and the Rule it offers after a change of Bucket.
			name: "43-review-said-after-filing",
			path: "/review",
			window: true,
			ready: async (page) => {
				const card = await reviewCardOnTop(page, ":has(button:text-is('Confirm'))");
				await card.getByRole("combobox").click({ timeout: 15_000 });
				await page.getByRole("option").first().click({ timeout: 15_000 });
				await expect(page.getByTestId("review-said")).toContainText(/left\.|All sorted/);
				await page.evaluate(() => window.scrollTo(0, 0));
			},
		},
		{
			// Two toasts, each with Undo, over the list and above the bottom bar.
			name: "44-review-list-two-toasts",
			path: "/review?view=list",
			window: true,
			ready: async (page) => {
				const confirm = page.getByRole("button", { name: "Confirm", exact: true });
				await expect(confirm.first()).toBeVisible({ timeout: 15_000 });
				const before = await confirm.count();
				await confirm.first().click();
				await expect(confirm).toHaveCount(before - 1, { timeout: 15_000 });
				await confirm.first().click();
				await expect(page.locator("[data-sonner-toast]")).toHaveCount(2, { timeout: 15_000 });
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
	await carryParent?.remove();
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
		let carryPage: Page | undefined;
		const dir = join(OUT, String(viewport.width));
		mkdirSync(dir, { recursive: true });
		const failures: string[] = [];
		for (const shot of shots) {
			if ((shot.phoneSheet || shot.phone) && !phone && !shot.desk) continue;
			if (shot.desktop && phone) continue;
			if (only.length > 0 && !only.some((name) => shot.name.startsWith(name))) continue;
			let page = main;
			try {
				if (shot.signedOut) {
					const context = await browser.newContext({ ...device, isMobile: false, hasTouch: false });
					const out = await context.newPage();
					await setupClerkTestingToken({ page: out });
					await out.goto(shot.path);
					await shot.ready?.(out);
					await out.screenshot({ path: join(dir, `${shot.name}.png`), animations: "disabled" });
					await context.close();
					continue;
				}
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
				if (shot.carry) {
					if (!carryParent) throw new Error("No Household with ended months");
					carryPage ??= await signedInPage(browser, carryParent.email, device);
					page = carryPage;
				}
				// Off the page first: the next picture may differ only by its "#…", which loads nothing
				// and would leave the last picture's sheet open.
				await page.goto("about:blank");
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
		await carryPage?.context().close();
		if (failures.length > 0) writeFileSync(join(dir, "failures.txt"), `${failures.join("\n")}\n`);
		expect(failures, "pages that couldn't be pictured").toEqual([]);
		expect(seedNotes, "data that couldn't be seeded").toEqual([]);
	});
}
