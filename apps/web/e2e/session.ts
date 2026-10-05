import { clerk, setupClerkTestingToken } from "@clerk/testing/playwright";
import {
	type Browser,
	type BrowserContext,
	type BrowserContextOptions,
	expect,
	type Locator,
	type Page,
} from "@playwright/test";
import { clerkRetry } from "./clerk-retry";
import { timed } from "./timing";

/**
 * The budget for the first expect after a full page load (goto, reload) of a route that renders
 * only in the browser (`ssr: "data-only"`: Reports and Explore). Until the dev server has served
 * the page's whole module graph (Recharts included) it is only a skeleton: about 3s on a laptop,
 * 4-6s or more on a 2-vCPU CI runner, past expect's 5s. Arriving by a link from the running app
 * needs none of it, so use it only where the full load is the point or there is no link.
 */
export const clientRendered = { timeout: 20_000 };

/**
 * From lg up, This Month's To do card lists each prompt (Close September, Get started, Extra
 * income...) as a collapsed row; its content shows only once the row is opened. This opens the row
 * whose label starts with `label` when it is closed. On a phone the prompts already show, so it
 * does nothing there.
 */
export async function openToDo(page: Page, label: string) {
	if ((page.viewportSize()?.width ?? 0) < 1024) return;
	const row = page
		.getByRole("region", { name: "To do" })
		.getByRole("button", { name: label })
		.and(page.locator("[aria-expanded]"))
		.first();
	await expect(row).toBeVisible();
	if ((await row.getAttribute("aria-expanded")) !== "true") await row.click();
	await expect(row).toHaveAttribute("aria-expanded", "true");
}

/** What `browser.newContext` takes as `storageState`, when it is not a file. */
export type SavedSession = Exclude<NonNullable<BrowserContextOptions["storageState"]>, string>;

/** A Parent whose session is kept by their worker (the pool in e2e/parents.ts). */
export type SharedSession = {
	/** The session's cookies, fresh enough for a new context in `browser`. */
	session: (browser: Browser) => Promise<SavedSession>;
	/** Told of each context `signedInPage` opens, so it can be closed when the Parent is given back. */
	opened: (context: BrowserContext) => void;
};

// `signedInPage` starts from a shared session's cookies instead of signing in again.
const sharedSessions = new Map<string, SharedSession>();

/** From now on `signedInPage` for `email` starts from `shared.session()` (null: signs in again). */
export function shareSession(email: string, shared: SharedSession | null) {
	if (shared) sharedSessions.set(email, shared);
	else sharedSessions.delete(email);
}

/** A new browser context that keeps Clerk's cookies in every engine. */
export async function openContext(browser: Browser, options: BrowserContextOptions = {}) {
	const context = await browser.newContext(options);
	// Clerk's dev instance writes `__client_uat` with `Domain=localhost`, which Playwright's WebKit
	// rejects, so the Worker saw a session token without it, sent every page to Clerk's handshake
	// (session-token-but-no-client-uat) and no one got in. A host-only cookie on localhost is the
	// same cookie, so in WebKit the attribute is dropped as clerk-js writes it.
	if (browser.browserType().name() === "webkit") {
		await context.addInitScript(() => {
			const cookie = Object.getOwnPropertyDescriptor(Document.prototype, "cookie");
			if (!cookie?.get || !cookie.set) return;
			const { get, set } = cookie;
			Object.defineProperty(Document.prototype, "cookie", {
				configurable: true,
				get() {
					return get.call(this);
				},
				set(value: string) {
					set.call(this, value.replace(/;\s*domain=localhost(?=;|$)/i, ""));
				},
			});
		});
	}
	return context;
}

/** Opens the sign-in page and signs `email` in there. */
export async function signIn(page: Page, email: string) {
	// `/` would redirect here anyway: sign-in is the one page that loads Clerk without signing in.
	await timed("sign-in-page", () => page.goto("/sign-in"));
	await timed("sign-in", () => clerkRetry(() => clerk.signIn({ page, emailAddress: email })));
}

/**
 * A fresh browser context signed in as `email`. A pooled Parent (`createTestParent`) is already
 * signed in by its worker: the context starts from that session, on a blank page.
 */
export async function signedInPage(
	browser: Browser,
	email: string,
	options: BrowserContextOptions = {},
): Promise<Page> {
	const shared = sharedSessions.get(email);
	const storageState = shared
		? await timed("session-state", () => shared.session(browser))
		: undefined;
	const context = await openContext(browser, storageState ? { ...options, storageState } : options);
	shared?.opened(context);
	const page = await context.newPage();
	await setupClerkTestingToken({ page });
	if (!shared) await signIn(page, email);
	return page;
}

/** From the get-started wizard a new Household lands on, leaves it for This Month. */
export async function setUpLater(page: Page) {
	await expect(page).toHaveURL(/\/setup$/);
	await page.getByRole("link", { name: "Set up later" }).click();
	await expect(page).toHaveURL(/\/month\//);
}

/** After joining a Household, leaves "Here's your Household" for This Month. */
export async function enterJoinedHousehold(page: Page) {
	await expect(page).toHaveURL(/\/joined$/);
	await page.getByRole("link", { name: "Go to This Month" }).click();
	await expect(page).toHaveURL(/\/month\//);
}

/** Options for making a test Household. */
export type HouseholdOptions = {
	/**
	 * Through /welcome and the get-started wizard's "Set up later", as a Parent would. Only for specs
	 * about that flow: otherwise the Household is made in one request to /api/dev/household.
	 */
	viaUi?: boolean;
	/** Children, by name, added to the Household (not through the UI). */
	children?: string[];
	/** Marks the get-started wizard finished, so This Month has no "Continue setup". */
	finishSetup?: boolean;
	/** The signed-in Parent's Personal Allowance, in cents (needs a Plan). */
	personalAllowanceCents?: number;
	/** A second Parent who never signs in, with their own Personal Allowance in cents. */
	otherParent?: { name: string; personalAllowanceCents?: number };
	/** Household Rules filing a merchant into a Bucket of the Plan, by name. */
	rules?: { pattern: string; bucket: string }[];
};

type DevPlan = {
	takeHomePayCents: number;
	buckets: { name: string; allowanceCents: number }[];
	commitments?: {
		name: string;
		amountCents: number;
		cadence: "monthly" | "quarterly" | "annual";
		dueDay: number;
	}[];
};

/** "1,200" or "1200.50" in cents. */
export const toCents = (dollars: string) => Math.round(Number(dollars.replace(/[$,]/g, "")) * 100);

/**
 * Makes a Household for the signed-in user through the dev-only /api/dev/household (AI_MODEL=stub),
 * the same rows the UI writes, and opens This Month.
 */
async function createHouseholdDirectly(
	page: Page,
	body: { householdName: string; parentName: string; plan?: DevPlan } & HouseholdOptions,
) {
	const timeZone = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
	const response = await timed("household-make", () =>
		page.request.post("/api/dev/household", {
			data: { ...body, viaUi: undefined, timeZone },
		}),
	);
	expect(response.ok(), await response.text()).toBe(true);
	const created = (await response.json()) as {
		householdId: string;
		parentId: string;
		month: string;
		url: string;
		bucketIds: Record<string, string>;
		commitmentIds: Record<string, string>;
		childIds: Record<string, string>;
	};
	await timed("household-open", async () => {
		await page.goto(created.url);
		await expect(page.locator("[data-slot=page-header]:visible")).toContainText("This Month");
	});
	// The UI path left the page hydrated by clicking through it; a fresh load isn't yet, and a key
	// pressed (Quick Add's "q") or a button clicked before then does nothing.
	await timed("household-idle", () => page.waitForLoadState("networkidle"));
	return created;
}

/**
 * Creates a Household and waits for This Month: in one request by default, or with `viaUi` from
 * /welcome, leaving the get-started wizard.
 */
export async function createHousehold(
	page: Page,
	householdName: string,
	parentName: string,
	options: HouseholdOptions = {},
) {
	if (!options.viaUi) {
		await createHouseholdDirectly(page, { householdName, parentName, ...options });
		return;
	}
	await page.goto("/welcome");
	await page.getByLabel("Household name").fill(householdName);
	await page.getByLabel("Your name").fill(parentName);
	await page.getByRole("button", { name: "Create Household" }).click();
	await setUpLater(page);
	// The URL changes before the page loads; clicking on before then can lose the click.
	await expect(page.locator("[data-slot=page-header]:visible")).toContainText("This Month");
}

/** True for calls to the named server function (its id is base64url JSON naming the export). */
export const serverFn = (name: string) => (url: URL) => {
	const id = url.pathname.split("/_serverFn/")[1];
	return !!id && Buffer.from(id, "base64url").toString().includes(`"${name}_`);
};

/** Waits for the next response from the named server function. */
export const savedBy = (page: Page, name: string) =>
	page.waitForResponse((response) => serverFn(name)(new URL(response.url())));

/** Switches between a month's This Month and its Plan, from either one's overview. */
export async function switchTo(page: Page, view: "Month" | "Plan") {
	// On a computer the Sidebar goes there, by its accessible name, so the collapsed rail
	// (1024-1279px, labels sr-only) works too. On a phone This Month is the tab bar's first tab and
	// the Plan is in More (#74): there is no switch between them.
	const wide = (page.viewportSize()?.width ?? 1280) >= 1024;
	const link = wide
		? page
				.locator("[data-slot=sidebar]")
				.getByRole("link", { name: view === "Month" ? "This Month" : "Plan", exact: true })
		: page
				.getByRole("navigation", { name: "Main" })
				.getByRole("link", { name: "Month", exact: true });
	// While the other one loads, React keeps the page being left in the document, hidden, beside the
	// pending header: look at the one that shows.
	const header = page.locator("[data-slot=page-header]:visible");
	const title = view === "Month" ? "This Month" : "Plan";
	// A click before the page has hydrated is lost (the link does nothing, or a full load is cut
	// short), so wait for it, and click again if the header still hasn't changed.
	await page.waitForLoadState("networkidle");
	await expect(async () => {
		if (wide || view === "Month") await link.click({ timeout: 5_000 });
		else await openFromMore(page, "Plan");
		await expect(header).toContainText(title, { timeout: 5_000 });
	}).toPass({ timeout: 20_000 });
}

/**
 * Creates a Household and plans this month: take-home pay and Buckets with allowances ("1,200"),
 * in order, and any Commitments. Ends on This Month. With `viaUi` it sets up the Plan through the
 * Plan screens and the Add Buckets sheet (no Commitments or Children then).
 */
export async function createPlannedHousehold(
	page: Page,
	{
		baseline,
		buckets,
		commitments,
		...options
	}: {
		baseline: string;
		buckets: [name: string, allowance: string][];
		commitments?: DevPlan["commitments"];
	} & HouseholdOptions,
) {
	if (!options.viaUi) {
		return createHouseholdDirectly(page, {
			householdName: "The Rinks",
			parentName: "Alex",
			...options,
			plan: {
				takeHomePayCents: toCents(baseline),
				buckets: buckets.map(([name, allowance]) => ({ name, allowanceCents: toCents(allowance) })),
				commitments,
			},
		});
	}
	await createHousehold(page, "The Rinks", "Alex", { viaUi: true });
	await page.getByRole("link", { name: "Set up the Plan" }).click();
	await page.getByRole("textbox", { name: "Take-home pay" }).fill(baseline);
	const takeHomePaySaved = savedBy(page, "setTakeHomePay");
	await page.getByRole("button", { name: "Set take-home pay" }).click();
	await takeHomePaySaved;
	await page.getByRole("link", { name: "Add Buckets" }).click();
	await expect(page.locator("nav[aria-label='Plan pages'] [aria-current=page]")).toHaveText(
		"Buckets",
	);
	await addBucketsInSheet(page, buckets);
	await page
		.getByRole("navigation", { name: "Plan pages" })
		.getByRole("link", { name: "Overview" })
		.click();
	await switchTo(page, "Month");
}

/**
 * Adds `buckets` (name, monthly amount) to the Plan from its Buckets page, through the Add Buckets
 * sheet: a starter row when one has the name, otherwise "Add your own". Only these are added.
 */
export async function addBucketsInSheet(page: Page, buckets: [name: string, allowance: string][]) {
	const open = page.getByRole("button", { name: "Add Buckets", exact: true });
	await expect(open).toBeEnabled();
	await page.waitForLoadState("networkidle");
	await open.click();
	const sheet = page.getByRole("dialog", { name: "Add Buckets" });
	await expect(sheet).toBeVisible();
	// Start from nothing ticked: the sheet ticks suggestions and the Parent's Personal Allowance.
	for (const box of await sheet.getByRole("checkbox", { checked: true }).all()) {
		await box.setChecked(false);
	}
	for (const [name, allowance] of buckets) {
		if ((await sheet.getByRole("checkbox", { name, exact: true }).count()) === 0) {
			await sheet.getByRole("button", { name: "Add your own" }).click();
			await sheet.getByRole("textbox", { name: "Name of your own Bucket" }).last().fill(name);
		}
		const amount = sheet.getByRole("textbox", { name: `${name} amount`, exact: true });
		const tick = sheet.getByRole("checkbox", { name: new RegExp(`^(Add )?${name}$`) });
		// Typing ticks the row, but when the sheet already suggests this very amount `fill` changes
		// nothing (no input event), so tick it the way a Parent who keeps the suggestion would.
		await amount.fill(allowance);
		await tick.setChecked(true);
		await expect(amount).toHaveValue(allowance);
	}
	await expect(sheet.getByRole("button", { name: /^Add \d+ Buckets?$/ })).toBeVisible();
	const saved = savedBy(page, "addBuckets");
	await sheet.getByRole("button", { name: /^Add \d+ Buckets?$/ }).click();
	await expect(sheet).toBeHidden();
	for (const [name] of buckets) {
		await expect(page.getByRole("button", { name: `Edit ${name}`, exact: true })).toBeVisible();
	}
	await saved;
}

/**
 * Picks `option` from a shadcn Select or Combobox (a combobox that opens a listbox) named
 * `label`.
 */
export async function choose(scope: Page | Locator, label: string, option: string) {
	const page = "page" in scope ? scope.page() : scope;
	await scope.getByRole("combobox", { name: label, exact: true }).click();
	await page.getByRole("listbox").getByRole("option", { name: option, exact: true }).click();
	await expect(page.getByRole("listbox")).toBeHidden();
}

/**
 * Picks a day (yyyy-mm-dd) in a DatePicker: opens it by its label, sets the calendar's year and
 * month dropdowns, then clicks the day. No typing, as a person would.
 */
export async function pickDate(scope: Page | Locator, label: string, iso: string) {
	const page = "page" in scope ? scope.page() : scope;
	const [year, month] = iso.split("-").map(Number);
	await scope.getByLabel(label, { exact: true }).click();
	const calendar = page.locator('[data-slot="date-picker-content"]');
	await calendar.getByLabel("Choose the Year").selectOption(String(year));
	await calendar.getByLabel("Choose the Month").selectOption(String((month ?? 1) - 1));
	await calendar.locator(`button[data-day="${iso}"]`).click();
	await expect(calendar).toBeHidden();
}

const accountKindLabels: Record<string, string> = {
	checking: "Checking",
	savings: "Savings",
	"credit-card": "Credit card",
	loan: "Loan",
};

/** An Account kind's name in the Kind select ("credit-card" → "Credit card"). */
export const accountKindLabel = (kind: string) => accountKindLabels[kind] ?? kind;

/** Uploads a card statement to the Visa Account, adding the Account first if it's new. */
/**
 * Reloads `url` until `check` passes: the background run files, guesses and names what was just
 * brought in a moment after an import (ADR-0027), longer on CI. `check` should use short timeouts.
 */
export async function reloadUntil(
	page: Page,
	url: string,
	check: () => Promise<void>,
	timeout = 20_000,
) {
	await expect(async () => {
		await page.goto(url);
		await check();
	}).toPass({ timeout });
}

/**
 * Opens Review once the background run has filed or guessed the lines just brought in: it reloads
 * until the stack says `stackText` ("1 of 3") and its top card has its clean merchant name (named
 * in the same run, just before filing), and then until `ready` passes, if given.
 */
export async function waitForReview(
	page: Page,
	reviewUrl: string,
	stackText: string,
	ready?: () => Promise<void>,
) {
	const stack = page.getByTestId("review-stack");
	await reloadUntil(page, reviewUrl, async () => {
		await expect(stack).toContainText(stackText, { timeout: 2_000 });
		await expect(
			stack.getByTestId("review-card").first().getByRole("heading", { level: 3 }),
		).not.toHaveText(/^[^a-z]*$/, { timeout: 2_000 });
		await ready?.();
	});
}

export async function uploadStatement(
	page: Page,
	lines: [what: string, amount: string, date?: string][],
	addAccount = false,
) {
	// On a phone Accounts is in More (#74); on a computer it is in the Sidebar.
	if ((page.viewportSize()?.width ?? 1280) < 1024) await openFromMore(page, "Accounts");
	else await page.getByRole("link", { name: "Accounts", exact: true }).click();
	await expect(page.getByRole("heading", { level: 1 })).toHaveText("Accounts");
	if (addAccount) {
		await page.getByLabel("Name").fill("Visa");
		await choose(page, "Kind", accountKindLabel("credit-card"));
		await page.getByLabel("Owed now").fill("800");
		await page.getByRole("button", { name: "Add Account" }).click();
	}
	await page.getByRole("link", { name: /^Visa, / }).click();
	await expect(page.locator("[data-slot=detail-title]:visible")).toContainText("Visa");

	// Dated today, so the lines land in the month the Plan was made for.
	const today = await page.evaluate(() => new Date().toLocaleDateString("en-US"));
	const csv = [
		"Transaction Date,Description,Debit,Credit",
		...lines.map(([what, amount, date]) => `${date ?? today},${what},${amount},`),
	].join("\n");
	await page.getByRole("button", { name: "Upload statement" }).click();
	const sheet = page.getByRole("dialog", { name: "Upload a statement" });
	await sheet
		.getByLabel("Statement file")
		.setInputFiles({ name: "visa.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
	await sheet.getByRole("button", { name: `Import ${lines.length} line` }).click();
	await expect(sheet).toBeHidden();
}

/**
 * Picks a Bucket in Quick Add by name: its tile when the grid shows it, otherwise
 * More Buckets → Find a Bucket. With an amount typed the pick saves; with none,
 * the Bucket goes first in the grid and nothing is saved (ADR 0031).
 */
export async function pickQuickAddBucket(sheet: Locator, name: string) {
	const startsWith = new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);
	const grid = sheet.getByRole("list", { name: "Add to" });
	const options = sheet.getByRole("listbox", { name: "Add to" }).getByRole("option");
	await expect(grid.getByRole("listitem").or(options).first()).toBeVisible();
	// A computer: Find a Bucket filters the list, and a click adds (or, with no amount, puts it first).
	const find = sheet.getByRole("combobox", { name: "Find a Bucket" });
	if (await find.isVisible()) {
		await find.fill(name);
		// By accessible name: the row's monogram tile is aria-hidden, so the name starts with the Bucket's.
		await sheet
			.getByRole("listbox", { name: "Add to" })
			.getByRole("option", { name: startsWith })
			.first()
			.click();
		return;
	}
	const tile = grid.getByRole("button", { name: startsWith });
	if ((await tile.count()) > 0) {
		await tile.first().click();
		return;
	}
	await sheet.getByRole("button", { name: /^More Buckets/ }).click();
	await sheet.getByRole("searchbox", { name: "Find a Bucket" }).fill(name);
	await sheet.getByRole("button", { name: startsWith }).first().click();
}

/** What the phone's More sheet lists (#74): everything that isn't a tab, in the Sidebar's groups. */
export const moreItems = [
	"Review",
	"Accounts",
	"Plan",
	"Explore",
	"Reports",
	"Insights",
	"Credit card perks",
	"Ask",
	"Check-in",
	"Household settings",
	"Glossary",
] as const;

/** The phone's More sheet, opened from the tab bar's last item. */
export async function openMore(page: Page) {
	const sheet = page.getByRole("dialog", { name: "More" });
	// Pressed again until it opens: a press before hydration only changes the address.
	await expect(async () => {
		if (!(await sheet.isVisible())) {
			await page
				.getByRole("navigation", { name: "Main" })
				.getByRole("link", { name: "More", exact: true })
				.click({ timeout: 2_000 });
		}
		await expect(sheet).toBeVisible({ timeout: 2_000 });
	}).toPass({ timeout: 20_000 });
	return sheet;
}

/** An item of the More sheet: a link, or the Glossary's button. Names start with the item's words (a count or "not done" may follow). */
export function moreItem(sheet: Locator, item: (typeof moreItems)[number]) {
	return sheet.getByRole(item === "Glossary" ? "button" : "link", { name: new RegExp(`^${item}`) });
}

/** On a phone, opens More from the tab bar and chooses `item`. */
export async function openFromMore(page: Page, item: (typeof moreItems)[number]) {
	const sheet = await openMore(page);
	await moreItem(sheet, item).click();
	await expect(sheet).toBeHidden();
}
