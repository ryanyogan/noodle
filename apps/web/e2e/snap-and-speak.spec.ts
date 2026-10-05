import { deflateSync } from "node:zlib";
import { expect, type Page, test } from "@playwright/test";
import { createTestParent } from "./parents";
import { seedSql } from "./seed-sql";
import { createPlannedHousehold, signedInPage } from "./session";

// Snap and speak in Quick Add: a photo of a paper Receipt, or a phrase said or typed, is read by
// the deterministic fake models into the amount, a suggested Bucket and a note, for the Parent to
// check and save. The fake Receipt model reads the text a PNG carries in a "Receipt" text chunk.

let parent: Awaited<ReturnType<typeof createTestParent>>;

test.beforeEach(async () => {
	parent = await createTestParent();
});

test.afterEach(async () => {
	await parent?.remove();
});

const plan = {
	baseline: "5,000",
	buckets: [
		["Groceries", "800"],
		["Eating out", "300"],
		["Hockey", "400"],
	] as [string, string][],
};

const sheet = (page: Page) => page.getByRole("dialog", { name: "Quick Add" });
const picks = (page: Page) => sheet(page).getByRole("listbox", { name: "Add to" });
const list = (page: Page) =>
	page.getByRole("grid", { name: /^Transactions in / }).locator("[data-slot=data-table-body]");
const editSheet = (page: Page) =>
	page
		.locator("[role=dialog], [data-slot=transaction-detail]")
		.filter({ has: page.getByRole("heading", { name: "Edit Transaction" }) });

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
	let c = n;
	for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
	return c >>> 0;
});

function crc32(bytes: Buffer) {
	let c = 0xffffffff;
	for (const byte of bytes) c = (CRC_TABLE[(c ^ byte) & 0xff] as number) ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer) {
	const length = Buffer.alloc(4);
	length.writeUInt32BE(data.length);
	const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(body));
	return Buffer.concat([length, body, crc]);
}

/** A 1×1 white PNG carrying a Receipt's text, as a phone photo of it stands in for E2E. */
function receiptPhoto(text: string) {
	const header = Buffer.alloc(13);
	header.writeUInt32BE(1, 0);
	header.writeUInt32BE(1, 4);
	header.set([8, 2, 0, 0, 0], 8);
	return Buffer.concat([
		Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
		chunk("IHDR", header),
		chunk("tEXt", Buffer.from(`Receipt\0${text}`, "latin1")),
		chunk("IDAT", deflateSync(Buffer.from([0, 255, 255, 255]))),
		chunk("IEND", Buffer.alloc(0)),
	]);
}

test("a snapped Receipt fills in Quick Add and is attached to what's saved", async ({
	browser,
}) => {
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, plan);
	const transactions = page.url().replace(/\/month\/(\d{4}-\d{2}).*$/, "/transactions/$1");

	await page.getByRole("link", { name: "Quick Add" }).click();
	await expect(sheet(page).getByRole("button", { name: "Snap receipt" })).toBeEnabled();
	await sheet(page)
		.getByLabel("Receipt photo")
		.setInputFiles({
			name: "receipt.png",
			mimeType: "image/png",
			buffer: receiptPhoto(["Corner Market", "MILK 4.29", "BREAD 3.50", "TOTAL 7.79"].join("\n")),
		});
	await expect(sheet(page).getByRole("status", { name: "Amount" })).toHaveText("$7.79");
	await expect(sheet(page)).toContainText("Receipt from Corner Market, dated");
	await expect(sheet(page)).toContainText("Check it, then tap a Bucket to add it");
	await expect(sheet(page).getByLabel("Note")).toHaveValue("Corner Market");
	const first = picks(page).getByRole("option").first();
	await expect(first).toContainText("Groceries");
	await expect(first).toContainText("Suggested");

	await first.click();
	await expect(sheet(page)).toBeHidden();
	await expect(page.getByRole("status").filter({ hasText: "added to" })).toHaveText(
		"$7.79 added to Groceries",
	);

	await page.goto(transactions);
	const row = list(page).getByRole("button", { name: /^Corner Market, \$7\.79/ });
	await expect(async () => {
		await row.click();
		await expect(editSheet(page)).toBeVisible({ timeout: 1_000 });
	}).toPass({ timeout: 10_000 });
	await expect(editSheet(page).getByRole("region", { name: "Receipt" })).toContainText(
		"Corner Market",
	);
	await page.context().close();
});

const q = (value: string) => `'${value.replaceAll("'", "''")}'`;

/** Moves the Household's Plan (its take-home pay, Buckets and allowances) back to start in `month`. */
async function planFrom(clerkUserId: string, month: string) {
	const household = `(select household_id from members where clerk_user_id = ${q(clerkUserId)})`;
	const statements = [
		`update baselines set month = ${q(month)} where household_id = ${household};`,
		`update buckets set from_month = ${q(month)} where household_id = ${household};`,
		`update bucket_allowances set month = ${q(month)} where household_id = ${household};`,
	];
	await seedSql(statements);
}

/** The last day of last month, in the browser's (and so the Household's) time zone. */
function lastMonthsLastDay() {
	const day = new Date();
	day.setDate(0);
	const pad = (n: number) => String(n).padStart(2, "0");
	return {
		day: `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`,
		name: day.toLocaleDateString("en-US", { month: "long" }),
	};
}

test("a Receipt dated last month is added to last month's Plan, or today when it had none", async ({
	browser,
}) => {
	// Planning the month and seeding take most of the default budget.
	test.slow();
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, plan);
	const thisMonth = page.url().replace(/^.*\/month\/(\d{4}-\d{2}).*$/, "$1");
	const lastMonth = lastMonthsLastDay();
	const snap = async (total: string) => {
		await page.getByRole("link", { name: "Quick Add" }).click();
		await expect(sheet(page).getByRole("button", { name: "Snap receipt" })).toBeEnabled();
		await sheet(page)
			.getByLabel("Receipt photo")
			.setInputFiles({
				name: "receipt.png",
				mimeType: "image/png",
				buffer: receiptPhoto(
					["Corner Market", lastMonth.day, `MILK ${total}`, `TOTAL ${total}`].join("\n"),
				),
			});
		await expect(sheet(page).getByRole("status", { name: "Amount" })).toHaveText(`$${total}`);
	};
	const savedIn = async (month: string, row: RegExp) => {
		await page.goto(`/transactions/${month}`);
		await expect(list(page).getByRole("button", { name: row })).toBeVisible();
	};

	// Last month had no Plan, so it's dated today, in this month's.
	await snap("4.29");
	await expect(sheet(page)).toContainText(`${lastMonth.name} has no Plan, so it’s added today`);
	await picks(page).getByRole("option").first().click();
	await expect(page.getByRole("status").filter({ hasText: "added to" })).toHaveText(
		"$4.29 added to Groceries",
	);
	await savedIn(thisMonth, /^Corner Market, \$4\.29/);

	// With a Plan last month, it's offered last month's Buckets and saved there.
	await planFrom(parent.userId, lastMonth.day.slice(0, 7));
	await page.reload();
	await snap("6.10");
	await expect(sheet(page)).toContainText(`, so it’s added to ${lastMonth.name}`);
	const first = picks(page).getByRole("option").first();
	await expect(first).toContainText("Groceries");
	// Last month's Groceries, not this month's ($795.71 left).
	await expect(first).toContainText("$800 left · Suggested");
	await first.click();
	await expect(page.getByRole("status").filter({ hasText: "added to" })).toHaveText(
		"$6.10 added to Groceries",
	);
	await savedIn(lastMonth.day.slice(0, 7), /^Corner Market, \$6\.10/);
	await page.context().close();
});

test("a phrase typed where there's no speech recognition fills in Quick Add", async ({
	browser,
}) => {
	const page = await signedInPage(browser, parent.email);
	await page.addInitScript(() => {
		const speech = window as unknown as Record<string, unknown>;
		delete speech.SpeechRecognition;
		delete speech.webkitSpeechRecognition;
	});
	await createPlannedHousehold(page, plan);

	await page.getByRole("link", { name: "Quick Add" }).click();
	await expect(sheet(page).getByRole("button", { name: "Say it" })).toBeEnabled();
	await sheet(page).getByRole("button", { name: "Say it" }).click();
	const said = sheet(page).getByLabel("What you spent");
	await expect(said).toBeFocused();
	await expect(sheet(page).getByRole("button", { name: "Listen" })).toHaveCount(0);
	await said.fill("twelve fifty on a burrito");
	await sheet(page).getByRole("button", { name: "Fill in" }).click();

	await expect(sheet(page).getByRole("status", { name: "Amount" })).toHaveText("$12.50");
	await expect(sheet(page).getByLabel("Note")).toHaveValue("a burrito");
	const first = picks(page).getByRole("option").first();
	await expect(first).toContainText("Eating out");
	await expect(first).toContainText("Suggested");
	await first.click();
	await expect(page.getByRole("status").filter({ hasText: "added to" })).toHaveText(
		"$12.50 added to Eating out",
	);
	await page.context().close();
});

test("a phrase said aloud fills in Quick Add", async ({ browser }) => {
	const page = await signedInPage(browser, parent.email);
	// The browser's speech recognition, hearing the Parent say one phrase.
	await page.addInitScript(() => {
		class FakeRecognition {
			lang = "";
			interimResults = false;
			continuous = false;
			onresult: ((event: unknown) => void) | null = null;
			onerror: ((event: unknown) => void) | null = null;
			onend: (() => void) | null = null;
			start() {
				const result = (transcript: string, isFinal: boolean) =>
					Object.assign([{ transcript }], { isFinal });
				setTimeout(() => this.onresult?.({ results: [result("forty on", false)] }), 50);
				setTimeout(() => {
					this.onresult?.({ results: [result("forty on pizza after hockey", true)] });
					this.onend?.();
				}, 150);
			}
			stop() {}
			abort() {}
		}
		const speech = window as unknown as Record<string, unknown>;
		speech.SpeechRecognition = FakeRecognition;
		speech.webkitSpeechRecognition = FakeRecognition;
	});
	await createPlannedHousehold(page, plan);

	await page.getByRole("link", { name: "Quick Add" }).click();
	await expect(sheet(page).getByRole("button", { name: "Say it" })).toBeEnabled();
	await sheet(page).getByRole("button", { name: "Say it" }).click();

	await expect(sheet(page).getByRole("status", { name: "Amount" })).toHaveText("$40");
	await expect(sheet(page).getByLabel("Note")).toHaveValue("pizza after hockey");
	const first = picks(page).getByRole("option").first();
	await expect(first).toContainText("Eating out");
	await expect(first).toContainText("Suggested");
	await first.click();
	await expect(page.getByRole("status").filter({ hasText: "added to" })).toHaveText(
		"$40 added to Eating out",
	);
	await page.context().close();
});
