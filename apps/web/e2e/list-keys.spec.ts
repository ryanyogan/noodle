import { expect, type Locator, type Page, test } from "@playwright/test";
import { ulid } from "ulid";
import { createTestParent } from "./parents";
import { seedSql } from "./seed-sql";
import {
	chooseKind,
	createPlannedHousehold,
	reloadUntil,
	signedInPage,
	uploadStatement,
} from "./session";

// The pages that are mostly lists (Transactions, Review, Rules, the Plan's pages, the Log,
// Accounts), each opened with several rows in it, some of them alike. Nothing here asserts on a
// key: `noDuplicateKeys` in session.ts fails the test when React says two children of one list
// were given the same key. React only says it in a development build, so this spec is the heart
// of CI's e2e-dev job (issue 142), which runs against the Vite dev server; against the built
// Worker it only checks that the pages open.

let parent: Awaited<ReturnType<typeof createTestParent>>;

test.beforeEach(async () => {
	parent = await createTestParent();
});

test.afterEach(async () => {
	await parent?.remove();
});

const q = (value: string) => `'${value.replaceAll("'", "''")}'`;

/** Opens `url` and waits until `shows` is there and the page has stopped fetching. */
async function open(page: Page, url: string, shows: Locator) {
	await page.goto(url);
	await expect(shows.first()).toBeVisible({ timeout: 30_000 });
	await page.waitForLoadState("networkidle");
}

test("the pages that are mostly lists draw every row under a key of its own", async ({
	browser,
}) => {
	test.setTimeout(300_000);
	const page = await signedInPage(browser, parent.email);
	await page.setViewportSize({ width: 1440, height: 900 });
	const made = await createPlannedHousehold(page, {
		baseline: "6,000",
		buckets: [
			["Groceries", "900"],
			["Gas", "200"],
			["Kids", "300"],
			["Fun", "250"],
		],
		commitments: [
			{ name: "Rent", amountCents: 180000, cadence: "monthly", dueDay: 1 },
			{ name: "Phone", amountCents: 8000, cadence: "monthly", dueDay: 15 },
			{ name: "Car insurance", amountCents: 60000, cadence: "annual", dueDay: 20 },
		],
	});
	if (!made) throw new Error("The Household wasn't made directly");
	const { month, bucketIds } = made;

	// Where this job is asked to guard keys, the app must be the development build: the only one
	// in which React says anything. Without this the job would pass by saying nothing.
	if (process.env.E2E_DUPLICATE_KEYS === "required") {
		expect(process.env.E2E_SERVER, "e2e-dev must run against the dev server").not.toBe("build");
		expect(
			await page.evaluate(
				() =>
					document.querySelector('script[src*="/@vite/client"]') !== null ||
					performance.getEntriesByType("resource").some((r) => r.name.includes("/@vite/client")),
			),
			"the page is not served by the Vite dev server, so React would never warn of a duplicate key",
		).toBe(true);
	}

	// Quick Adds, written straight in: several in each Bucket, and two pairs that are the same
	// purchase twice (same day, amount and note), the rows most likely to be keyed alike.
	const household = `(select household_id from members where clerk_user_id = ${q(parent.userId)})`;
	const member = `(select id from members where clerk_user_id = ${q(parent.userId)})`;
	const lines: [bucket: string, cents: number, note: string][] = [
		["Groceries", 8420, "Weekly shop"],
		["Groceries", 8420, "Weekly shop"],
		["Groceries", 1250, "Milk run"],
		["Gas", 4100, "Fill up"],
		["Gas", 4100, "Fill up"],
		["Kids", 2500, "School trip"],
		["Fun", 1800, "Cinema"],
		["Fun", 3200, "Pizza night"],
	];
	await seedSql([
		...lines.map(
			([bucket, cents, note]) =>
				`insert into transactions (id, household_id, source, date, amount_cents, note, bucket_id, created_by_member_id) values (${q(ulid())}, ${household}, 'quick-add', ${q(`${month}-01`)}, ${cents}, ${q(note)}, ${q(bucketIds[bucket] ?? "")}, ${member});`,
		),
		`insert into rules (id, household_id, pattern, bucket_id, created_by_member_id) values (${q(ulid())}, ${household}, 'costco', ${q(bucketIds.Groceries ?? "")}, ${member});`,
		`insert into rules (id, household_id, pattern, bucket_id, created_by_member_id) values (${q(ulid())}, ${household}, 'shell oil', ${q(bucketIds.Gas ?? "")}, ${member});`,
	]);

	// A card with a statement: an Account with Transactions of its own, and lines for Review,
	// two of them the same purchase twice.
	await uploadStatement(
		page,
		[
			["TRADER JOES #552", "61.20"],
			["TRADER JOES #552", "61.20"],
			["ACME WIDGETS LLC", "19.99"],
			["CORNER BAKERY 0091", "12.40"],
		],
		true,
	);

	// A second and a third Account, so Accounts is a list too.
	for (const [name, kind] of [
		["Everyday Checking", "checking"],
		["Ally savings", "savings"],
	] as const) {
		await page.goto("/accounts");
		await expect(async () => {
			if (!(await page.getByLabel("Name").isVisible()))
				await page.getByRole("button", { name: "Add Account" }).click({ timeout: 2_000 });
			await expect(page.getByLabel("Name")).toBeVisible({ timeout: 1_000 });
		}).toPass();
		await page.getByLabel("Name").fill(name);
		await chooseKind(page, kind);
		await page.getByLabel("Balance now").fill("2,500");
		await page.getByRole("button", { name: "Add Account" }).last().click();
		await expect(page.getByRole("link", { name: new RegExp(`^${name}, `) })).toBeVisible();
	}

	// Review, once the background run has looked at what came in.
	await reloadUntil(
		page,
		"/review",
		async () => {
			await expect(page.getByTestId("review-card").first()).toBeVisible({ timeout: 3_000 });
		},
		60_000,
	);
	await page.waitForLoadState("networkidle");
	await open(page, "/review/rules", page.getByText("costco"));

	// Transactions: every row of the month, then narrowed by a search and back.
	const search = page.getByLabel("Search notes and merchants");
	await open(page, `/transactions/${month}`, page.getByText("Weekly shop"));
	await expect(search).toBeEnabled({ timeout: 30_000 });
	await search.fill("fill up");
	await expect(page.getByText("Weekly shop")).toHaveCount(0);
	await search.fill("");
	await expect(page.getByText("Weekly shop").first()).toBeVisible();

	// The Plan's pages.
	await open(
		page,
		`/plan/${month}`,
		page.getByRole("button", { name: "Edit Groceries", exact: true }),
	);
	await open(page, `/plan/${month}/commitments`, page.getByText("Car insurance"));
	await open(page, `/plan/${month}/income`, page.getByRole("region", { name: "Income" }));
	await open(page, `/plan/${month}/goals`, page.locator("[data-slot=page-header]:visible"));

	// The Log: the Plan as it was made, the Rules, and what was brought in.
	await open(
		page,
		"/household#log",
		page.getByRole("table", { name: "Log" }).locator("[data-slot=data-table-row]"),
	);

	// Accounts, and the card's own page with its Transactions.
	await open(page, "/accounts", page.getByRole("link", { name: /^Visa, / }));
	await page.getByRole("link", { name: /^Visa, / }).click();
	await expect(page.locator("[data-slot=detail-title]:visible")).toContainText("Visa");
	await page.waitForLoadState("networkidle");

	// This Month, which lists the Buckets and what is coming up.
	await open(page, `/month/${month}`, page.locator("[data-slot=page-header]:visible"));
	await page.context().close();
});
