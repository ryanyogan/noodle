import { expect, type Page, test } from "@playwright/test";
import { measure } from "./overflow";
import { createTestParent } from "./parents";
import { seedReportHistory } from "./reports-seed";
import { clientRendered, createPlannedHousehold, signedInPage } from "./session";

// What the phone sweep (#74) changed, kept: Scenarios compared as a list under each measure, and
// Cash flow's two ranked lists, each at the narrowest phone and at an iPhone's width.

const phone = { deviceScaleFactor: 2, isMobile: true, hasTouch: true } as const;
const widths = [
	[320, 640],
	[393, 852],
] as const;

let parent: Awaited<ReturnType<typeof createTestParent>>;

test.beforeEach(async () => {
	parent = await createTestParent();
});

test.afterEach(async () => {
	await parent?.remove();
});

/** Saves the change a link opened in Explore as a Scenario called `name`. */
async function keepScenario(page: Page, lever: string, name: string) {
	await page.goto(`/explore?lever=${lever}`);
	await expect(page.getByRole("region", { name: "Your changes" })).toContainText(
		"Income",
		clientRendered,
	);
	await page.getByLabel("Name", { exact: true }).fill(name);
	await page.getByRole("button", { name: "Save Scenario" }).click();
	await expect(page.getByLabel("Name", { exact: true })).toHaveValue(name);
}

test("two Scenarios compared on a phone list every value under each measure, the Plan first", async ({
	browser,
}) => {
	test.slow();
	// Kept at desktop width, where scenarios-kept.spec.ts keeps them; then a phone.
	const page = await signedInPage(browser, parent.email, {
		...phone,
		viewport: { width: 1440, height: 900 },
	});
	// $5,000 − $1,200 − $400: $3,400 Free to Spend a month.
	await createPlannedHousehold(page, {
		baseline: "5,000",
		buckets: [
			["Groceries", "1,200"],
			["Hockey", "400"],
		],
	});
	await keepScenario(page, "baseline:600000", "Raise");
	await keepScenario(page, "baseline:450000", "Pay cut");

	for (const [width, height] of widths) {
		const at = `at ${width}x${height}`;
		await page.setViewportSize({ width, height });
		await page.goto("/explore/scenarios");
		for (const name of ["Raise", "Pay cut"]) {
			const tick = page.getByRole("checkbox", { name: `Compare “${name}”` });
			await expect(tick).toBeVisible(clientRendered);
			// A tick before the page has hydrated is lost: ticked again until it holds.
			await expect(async () => {
				if (!(await tick.isChecked())) await tick.click({ timeout: 2_000 });
				await expect(tick).toBeChecked({ timeout: 2_000 });
			}).toPass({ timeout: 20_000 });
		}

		const compare = page.locator("[aria-labelledby=compare]");
		const measures = compare.locator("dl");
		await expect(measures.first()).toBeVisible(clientRendered);
		// The table is for wider screens.
		await expect(compare.getByRole("table", { name: /^Key numbers/ })).toBeHidden();
		const count = await measures.count();
		expect(count, `measures ${at}`).toBeGreaterThanOrEqual(2);

		for (let i = 0; i < count; i++) {
			const list = measures.nth(i);
			const label = list.locator("xpath=preceding-sibling::h3");
			await expect(label, `measure ${i} ${at}`).toBeVisible();
			await expect(label).toHaveText(/\S/);
			// The Plan first, then one line for each Scenario.
			const names = list.locator("dt");
			await expect(names, `measure ${i} ${at}`).toHaveCount(3);
			await expect(names.first()).toHaveText("Plan");
			const edge = await list.boundingBox();
			for (const name of ["Plan", "Raise", "Pay cut"]) {
				const line = list
					.locator(":scope > div")
					.filter({ has: page.locator("dt", { hasText: new RegExp(`^${name}$`) }) });
				const what = `measure ${i}, ${name} ${at}`;
				const value = line.locator("dd");
				await expect(value, what).toBeVisible();
				await expect(value, what).toHaveText(/\S/);
				const nameBox = await line.locator("dt").boundingBox();
				const valueBox = await value.boundingBox();
				if (!edge || !nameBox || !valueBox) throw new Error(`${what}: not laid out`);
				// The value is whole, inside its list and the window, and clear of the name beside it.
				expect(valueBox.x + valueBox.width, what).toBeLessThanOrEqual(edge.x + edge.width + 2);
				expect(valueBox.x + valueBox.width, what).toBeLessThanOrEqual(width);
				expect(nameBox.x, what).toBeGreaterThanOrEqual(edge.x - 2);
				expect(nameBox.x + nameBox.width, what).toBeLessThanOrEqual(valueBox.x + 2);
			}
		}

		// $3,400, $4,400 and $2,900 a month over 2 years.
		// The table has no h3, and a chart's heading has no list beside it.
		const free = compare
			.locator("h3", { hasText: /^Free to Spend/ })
			.locator("xpath=following-sibling::dl");
		const amountFor = (name: string) =>
			free
				.locator(":scope > div")
				.filter({ has: page.locator("dt", { hasText: new RegExp(`^${name}$`) }) })
				.locator("dd");
		await expect(amountFor("Plan"), at).toHaveText(/^\$81,600/);
		await expect(amountFor("Raise"), at).toHaveText(/^\$105,600/);
		await expect(amountFor("Pay cut"), at).toHaveText(/^\$69,600/);

		// Nothing in the Compare card is wider than the card, and nothing in it scrolls sideways.
		await page.evaluate(() => document.fonts.ready);
		const wide = await compare.evaluate((section) => {
			const card = section.querySelector("dl")?.closest("[data-slot=card]") ?? section;
			const edge = card.getBoundingClientRect();
			return [card, ...card.querySelectorAll("*")]
				.filter((el) => {
					// A chart's own marks are drawn inside its <svg>, which is checked as one box.
					if (el.parentElement?.closest("svg")) return false;
					const box = el.getBoundingClientRect();
					if (box.width <= 1 || box.height <= 1) return false;
					const style = getComputedStyle(el);
					if (style.visibility === "hidden") return false;
					const scrolls =
						(style.overflowX === "auto" || style.overflowX === "scroll") &&
						el.scrollWidth > el.clientWidth + 1;
					return scrolls || box.right > edge.right + 2 || box.left < edge.left - 2;
				})
				.slice(0, 5)
				.map((el) => {
					const box = el.getBoundingClientRect();
					const slot = el.getAttribute("data-slot") ?? el.tagName.toLowerCase();
					return `${slot} "${(el.textContent ?? "").trim().slice(0, 40)}" ${Math.round(box.left)}-${Math.round(box.right)} in ${Math.round(edge.left)}-${Math.round(edge.right)}`;
				});
		});
		expect(wide, `wider than the Compare card ${at}`).toEqual([]);
		const found = await measure(page);
		expect(found.sticking, `past the right edge ${at}`).toEqual([]);
		expect(found.scrollWidth, `the page scrolls sideways ${at}`).toBeLessThanOrEqual(found.width);
	}
	await page.context().close();
});

test("Cash flow on a phone lists where money came from and went, each name with its amount", async ({
	browser,
}) => {
	test.slow();
	const page = await signedInPage(browser, parent.email, {
		...phone,
		viewport: { width: 393, height: 852 },
	});
	await createPlannedHousehold(page, {
		baseline: "6200",
		buckets: [
			["Groceries", "800"],
			["Eating out", "300"],
			["Kids", "400"],
			["Fun", "250"],
		],
	});
	// Six months of spending, income and Commitments.
	await seedReportHistory(parent.userId, 6);

	for (const [width, height] of widths) {
		const at = `at ${width}x${height}`;
		await page.setViewportSize({ width, height });
		await page.goto("/reports?view=cash-flow");
		const lists = page.locator("[data-slot=cash-flow-lists]");
		await expect(lists).toBeVisible(clientRendered);
		await page.evaluate(() => document.fonts.ready);

		for (const title of ["Came in from", "Went to"]) {
			const list = lists.getByRole("region", { name: title });
			await expect(list.getByRole("heading", { name: title }), at).toBeVisible();
			// Each row is named "Groceries: $1,234.00" and shows the same name and amount.
			const rows = list.getByRole("button", { name: /^.+: -?\$[\d,]+(\.\d\d)?$/ });
			await expect(rows.first(), `${title} ${at}`).toBeVisible();
			const edge = await list.boundingBox();
			for (const row of await rows.all()) {
				const label = (await row.getAttribute("aria-label")) ?? "";
				const split = label.lastIndexOf(": ");
				const name = label.slice(0, split);
				const amount = label.slice(split + 2);
				const what = `${title}, ${label} ${at}`;
				await expect(row, what).toBeVisible();
				const shownName = row.getByText(name, { exact: true });
				const shownAmount = row.getByText(amount, { exact: true });
				await expect(shownName, what).toBeVisible();
				await expect(shownAmount, what).toBeVisible();
				const nameBox = await shownName.boundingBox();
				const amountBox = await shownAmount.boundingBox();
				if (!edge || !nameBox || !amountBox) throw new Error(`${what}: not laid out`);
				// The amount is whole, inside the list and the window, and clear of its name.
				expect(amountBox.x + amountBox.width, what).toBeLessThanOrEqual(edge.x + edge.width + 2);
				expect(amountBox.x + amountBox.width, what).toBeLessThanOrEqual(width);
				expect(nameBox.x, what).toBeGreaterThanOrEqual(0);
				expect(nameBox.x + nameBox.width, what).toBeLessThanOrEqual(amountBox.x + 2);
			}
		}
		// The seeded Buckets were spent from.
		await expect(
			lists.getByRole("region", { name: "Went to" }).getByRole("button", { name: /^Groceries: / }),
			at,
		).toBeVisible();

		const found = await measure(page);
		expect(found.sticking, `past the right edge ${at}`).toEqual([]);
		expect(found.scrollWidth, `the page scrolls sideways ${at}`).toBeLessThanOrEqual(found.width);
	}
	await page.context().close();
});
