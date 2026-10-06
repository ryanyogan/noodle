import { expect, type Page, test } from "@playwright/test";
import { createTestParent } from "./parents";
import { createPlannedHousehold, pickQuickAddBucket, savedBy, signedInPage } from "./session";

// Guards the Plan's Bucket rows on a phone with the longest things a Household writes in them
// (issue 120): a long name, a name that is one unbroken word, and figures in the thousands with
// cents. Under each name there is one line, "$1,184.62 of $1,100 spent": whole, on one line, never
// under the row's pencil and never cut; the name is what gives way. The group's subtotal and the
// total have the same line.

// The Household's month (docs/seed-data.md: America/Chicago).
const month = new Intl.DateTimeFormat("en-CA", {
	timeZone: "America/Chicago",
	year: "numeric",
	month: "2-digit",
}).format(new Date());

const longName = "Groceries and household supplies";
const oneWord = "Supercalifragilisticexpialidocious";

let parent: Awaited<ReturnType<typeof createTestParent>>;

test.beforeEach(async () => {
	parent = await createTestParent();
});

test.afterEach(async () => {
	await parent?.remove();
});

async function spend(page: Page, amount: string, bucket: string) {
	await page.getByRole("link", { name: "Quick Add" }).first().click();
	const quickAdd = page.getByRole("dialog", { name: "Quick Add" });
	await expect(quickAdd).toBeVisible();
	await page.keyboard.type(amount);
	// Saved: the write the pick sends has come back.
	const saved = page.waitForResponse(
		(response) => response.url().includes("/_serverFn/") && response.request().method() === "POST",
	);
	await pickQuickAddBucket(quickAdd, bucket);
	await expect(quickAdd).toBeHidden();
	await saved;
}

async function putInGroup(page: Page, name: string, group: string) {
	await page.getByRole("button", { name: `Edit ${name}`, exact: true }).click();
	const sheet = page.getByRole("dialog", { name, exact: true });
	await sheet.getByLabel("Group", { exact: true }).fill(group);
	const saved = savedBy(page, "updateBucket");
	await sheet.getByRole("button", { name: "Save", exact: true }).click();
	await saved;
	await expect(sheet).toHaveCount(0);
}

/** Every "X of Y spent" line on the page that is wrong, and how: none when all are whole. */
const wrongLines = (page: Page) =>
	page.evaluate(() => {
		const wrong: string[] = [];
		const lines = [...document.querySelectorAll<HTMLElement>("[data-summary=phone]")].filter(
			(line) => line.getClientRects().length > 0,
		);
		for (const line of lines) {
			const text = (line.textContent ?? "").replace(/\s+/g, " ").trim();
			const box = line.getBoundingClientRect();
			// One line: every part of it starts at the same height (a browser gives a box per part).
			const tops = [...line.getClientRects()].map((part) => part.top);
			if (Math.max(...tops) - Math.min(...tops) > 4) wrong.push(`${text}: on two lines`);
			if (box.right > document.documentElement.clientWidth + 0.5 || box.left < 0)
				wrong.push(`${text}: past the window's edge`);
			// Cut: a box over it that hides what runs past it ends before the line does.
			const row = line.closest<HTMLElement>("tr, [role=row]");
			for (let over = line.parentElement; over && over !== row?.parentElement; ) {
				const cut = getComputedStyle(over).overflowX !== "visible";
				const edge = over.getBoundingClientRect();
				if (cut && (box.right > edge.right + 0.5 || box.left < edge.left - 0.5))
					wrong.push(`${text}: cut by ${over.tagName.toLowerCase()}.${over.className}`);
				over = over.parentElement;
			}
			// Under the pencil: the line and the pencil a Parent sees (the drawing, not the wider
			// room around it a thumb gets) share some of the row. At 320 the line needs the row's
			// whole width, so it passes below the pencil, which sits beside the name.
			const edit = row?.querySelector("[data-bucket-edit] svg")?.getBoundingClientRect();
			if (
				edit &&
				box.right > edit.left + 0.5 &&
				box.left < edit.right - 0.5 &&
				box.bottom > edit.top + 0.5 &&
				box.top < edit.bottom - 0.5
			)
				wrong.push(`${text}: under the pencil by ${Math.round(box.right - edit.left)}px`);
		}
		return { lines: lines.length, wrong };
	});

test("on a phone a Bucket's line with long figures and a long name is whole, on one line and clear of the pencil", async ({
	browser,
}) => {
	test.setTimeout(120_000);
	const page = await signedInPage(browser, parent.email, {
		viewport: { width: 1280, height: 900 },
	});
	await createPlannedHousehold(page, {
		baseline: "20,000",
		buckets: [
			[longName, "1,100"],
			[oneWord, "10,000"],
			["Gas", "250"],
			["Fun", "300"],
		],
	});
	await spend(page, "1184.62", longName);
	await spend(page, "12345.67", oneWord);
	await spend(page, "222.77", "Gas");
	await page.goto(`/plan/${month}#buckets`);
	await expect(page.getByRole("button", { name: "Edit Gas", exact: true })).toBeEnabled();
	await putInGroup(page, longName, "Everyday essentials for the house");
	await putInGroup(page, "Gas", "Everyday essentials for the house");
	for (const width of [320, 375, 430]) {
		await page.setViewportSize({ width, height: 800 });
		await page.goto(`/plan/${month}#buckets`);
		await expect(page.getByRole("button", { name: "Edit Gas", exact: true })).toBeEnabled();
		const grid = page.getByRole("grid", { name: "Buckets", exact: true });
		const line = grid.locator("[data-summary=phone]");
		await expect(line.filter({ hasText: "$1,184.62 of $1,100 spent" })).toBeVisible();
		await expect(line.filter({ hasText: "$12,345.67 of $10,000 spent" })).toBeVisible();
		// The group's subtotal and the total.
		await expect(line.filter({ hasText: "$1,407.39 of $1,350 spent" })).toBeVisible();
		await expect(line.filter({ hasText: "$13,753.06 of $11,650 spent" })).toBeVisible();
		const measured = await wrongLines(page);
		expect.soft(measured.wrong, `every line is whole at ${width}`).toEqual([]);
		expect.soft(measured.lines, `the lines at ${width}`).toBeGreaterThanOrEqual(6);
		expect
			.soft(
				await page.evaluate(() => document.documentElement.scrollWidth),
				`nothing scrolls sideways at ${width}`,
			)
			.toBeLessThanOrEqual(width);
	}
});

test("on a phone under 375px a line with a figure of $100,000 or more drops its cents and is whole", async ({
	browser,
}) => {
	test.setTimeout(120_000);
	const page = await signedInPage(browser, parent.email, {
		viewport: { width: 1280, height: 900 },
	});
	await createPlannedHousehold(page, {
		baseline: "400,000",
		buckets: [
			["Renovation", "100,000"],
			["Tuition and boarding fees", "100,000.50"],
			["Gas", "250"],
		],
	});
	// Quick Add takes five digits before the point: two of them make a six-figure spend.
	await spend(page, "99999.99", "Renovation");
	await spend(page, "23456.79", "Renovation");
	await spend(page, "99999.99", "Tuition and boarding fees");
	await spend(page, "23456.79", "Tuition and boarding fees");
	await spend(page, "222.77", "Gas");
	const lines = {
		320: [
			"$123,457 of $100,000 spent",
			"$123,457 of $100,001 spent",
			// Under $100,000 the cents stay, at every width.
			"$222.77 of $250 spent",
			"$247,136 of $200,251 spent",
		],
		374: [
			"$123,457 of $100,000 spent",
			"$123,457 of $100,001 spent",
			"$222.77 of $250 spent",
			"$247,136 of $200,251 spent",
		],
		375: [
			"$123,456.78 of $100,000 spent",
			"$123,456.78 of $100,000.50 spent",
			"$222.77 of $250 spent",
			"$247,136.33 of $200,250.50 spent",
		],
	};
	for (const [at, said] of Object.entries(lines)) {
		const width = Number(at);
		await page.setViewportSize({ width, height: 800 });
		await page.goto(`/plan/${month}#buckets`);
		await expect(page.getByRole("button", { name: "Edit Gas", exact: true })).toBeEnabled();
		const line = page
			.getByRole("grid", { name: "Buckets", exact: true })
			.locator("[data-summary=phone]");
		// What is drawn: the figure's other form is in the page too, not shown.
		await expect(line).toHaveText(said, { useInnerText: true });
		const measured = await wrongLines(page);
		expect.soft(measured.wrong, `every line is whole at ${width}`).toEqual([]);
		expect
			.soft(
				await page.evaluate(() => document.documentElement.scrollWidth),
				`nothing scrolls sideways at ${width}`,
			)
			.toBeLessThanOrEqual(width);
	}
});
