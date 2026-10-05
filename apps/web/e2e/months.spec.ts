import { expect, type Page, test } from "@playwright/test";
import { createTestParent } from "./parents";
import { createPlannedHousehold, pickQuickAddBucket, serverFn, signedInPage } from "./session";

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
		["Groceries", "1,200"],
		["Hockey", "400"],
	] as [string, string][],
};

const phone = { viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true };

const heading = (page: Page) => page.getByRole("heading", { level: 1 });
const bucketRow = (page: Page, name: string) =>
	page.getByRole("listitem", { name: new RegExp(`^${name}: `) });

/** The month in the URL, and the months either side of it, as "YYYY-MM". */
function monthsAround(page: Page) {
	const month = new URL(page.url()).pathname.split("/")[2] ?? "";
	const [year = 0, m = 0] = month.split("-").map(Number);
	const at = (offset: number) => {
		const date = new Date(Date.UTC(year, m - 1 + offset, 1));
		return {
			key: date.toISOString().slice(0, 7),
			name: date.toLocaleDateString("en-US", { month: "long", timeZone: "UTC" }),
			year: String(date.getUTCFullYear()),
		};
	};
	return { previous: at(-1), current: at(0), next: at(1) };
}

/** A month's title: its name, and its year when that isn't this year's. */
function title(month: ReturnType<typeof monthsAround>["current"], thisYear: string) {
	return month.year === thisYear ? month.name : `${month.name} ${month.year}`;
}

async function quickAdd(page: Page, amount: string, bucket: string) {
	await page.getByRole("link", { name: "Quick Add" }).click();
	const sheet = page.getByRole("dialog", { name: "Quick Add" });
	await expect(sheet).toBeVisible();
	await page.keyboard.type(amount);
	await pickQuickAddBucket(sheet, bucket);
	await expect(sheet).toBeHidden();
}

/** Sets a Bucket carries over on its page, from This Month, then returns to This Month. */
async function setCarriesOver(page: Page, bucket: string) {
	await page.getByRole("link", { name: bucket, exact: true }).click();
	await expect(page.locator("[data-slot=detail-header]")).toContainText(bucket);
	await page.getByRole("button", { name: "Edit Bucket", exact: true }).click();
	const saved = page.waitForResponse((response) =>
		serverFn("setCarriesOver")(new URL(response.url())),
	);
	await page.getByRole("radio", { name: /^Carries over/ }).check();
	await page.getByRole("button", { name: "Save", exact: true }).click();
	expect((await saved).ok()).toBe(true);
	await expect(page.getByRole("region", { name: /^(Left|Over) this month$/ })).toContainText(
		"Carries over",
	);
	await page
		.getByRole("navigation", { name: "Main" })
		.getByRole("link", { name: "This Month" })
		.click();
	await expect(page.locator("[data-slot=page-header]:visible")).toContainText("This Month");
}

/** Swipes across the page on a touch screen: negative `dx` is leftward. */
async function swipe(page: Page, dx: number) {
	await page.getByRole("heading", { level: 1 }).evaluate((target, dx) => {
		// Playwright's WebKit is the desktop build: its Touch can't be constructed ("Illegal
		// constructor"), though Mobile Safari's can. There the same two events carry plain points,
		// which is all the page reads from them (clientX and clientY).
		const fire = (type: "touchstart" | "touchend", x: number) => {
			const point = { identifier: 1, target, clientX: x, clientY: 400 };
			const touches = type === "touchstart" ? [point] : [];
			let event: Event;
			try {
				const touch = new Touch(point);
				event = new TouchEvent(type, {
					bubbles: true,
					touches: type === "touchstart" ? [touch] : [],
					changedTouches: [touch],
				});
			} catch {
				event = new Event(type, { bubbles: true });
				Object.defineProperty(event, "touches", { value: touches });
				Object.defineProperty(event, "changedTouches", { value: [point] });
			}
			target.dispatchEvent(event);
		};
		fire("touchstart", 200);
		fire("touchend", 200 + dx);
	}, dx);
}

test("months are addressable, and the chevrons move between them", async ({ browser }) => {
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, plan);
	const { previous, current, next } = monthsAround(page);
	await expect(heading(page)).toHaveText(current.name);

	await page.getByRole("link", { name: "Next month" }).click();
	await expect(page).toHaveURL(new RegExp(`/month/${next.key}$`));
	await expect(heading(page)).toHaveText(title(next, current.year));
	// Each month's Plan starts as the one before it.
	await expect(bucketRow(page, "Hockey")).toHaveAccessibleName("Hockey: $400 left of $400");

	await page.getByRole("link", { name: "Previous month" }).click();
	await expect(page).toHaveURL(new RegExp(`/month/${current.key}$`));
	// Nothing was planned before this month, so there's no going back further.
	await expect(page.getByRole("button", { name: "Previous month" })).toBeDisabled();
	await expect(page.getByRole("link", { name: /^Previous month/ })).toHaveCount(0);
	// Though an earlier month is still addressable.
	await page.goto(`/month/${previous.key}`);
	await expect(heading(page)).toHaveText(title(previous, current.year));

	await page.goto(`/month/${next.key}`);
	await expect(heading(page)).toHaveText(title(next, current.year));
});

test("a Bucket that carries over carries what's left into next month; a resets monthly one starts over", async ({
	browser,
}) => {
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, plan);
	await setCarriesOver(page, "Hockey");
	await quickAdd(page, "100", "Hockey");
	await quickAdd(page, "200", "Groceries");
	await expect(bucketRow(page, "Hockey")).toHaveAccessibleName(/^Hockey: \$300 left of \$400/);

	await page.getByRole("link", { name: "Next month" }).click();
	await expect(bucketRow(page, "Hockey")).toHaveAccessibleName("Hockey: $700 left of $700");
	await expect(bucketRow(page, "Hockey")).toContainText("$300 carried over");
	await expect(bucketRow(page, "Groceries")).toHaveAccessibleName(
		"Groceries: $1,200 left of $1,200",
	);

	// Overspending carries too, until it's Covered.
	await page.getByRole("link", { name: "Previous month" }).click();
	await quickAdd(page, "450", "Hockey");
	await page.getByRole("link", { name: "Next month" }).click();
	await expect(bucketRow(page, "Hockey")).toHaveAccessibleName("Hockey: $250 left of $250");
	await expect(bucketRow(page, "Hockey")).toContainText("$150 overspent last month");

	await page.getByRole("link", { name: "Previous month" }).click();
	await page.getByRole("button", { name: "Cover Hockey" }).click();
	const sheet = page.getByRole("dialog", { name: "Cover Hockey" });
	await sheet.getByRole("button", { name: /^Groceries/ }).click();
	await expect(sheet).toBeHidden();
	await page.getByRole("link", { name: "Next month" }).click();
	await expect(bucketRow(page, "Hockey")).toHaveAccessibleName("Hockey: $400 left of $400");
	await expect(bucketRow(page, "Groceries")).toHaveAccessibleName(
		"Groceries: $1,200 left of $1,200",
	);
});

test("a link tapped while the page is still loading goes there", { tag: "@phone" }, async ({
	browser,
}) => {
	const page = await signedInPage(browser, parent.email, phone);
	await createPlannedHousehold(page, plan);
	const { current, next } = monthsAround(page);

	// As soon as the page's HTML is in and before its scripts are: Safari's engine stopped those
	// scripts for the link's page, and the router answered by reloading this one instead.
	await page.goto(page.url(), { waitUntil: "commit" });
	await page.getByRole("link", { name: "Next month" }).click();
	await expect(page).toHaveURL(new RegExp(`/month/${next.key}$`));
	await expect(heading(page)).toHaveText(title(next, current.year));
	await page.context().close();
});

test("swiping on a phone moves between months", { tag: "@phone" }, async ({ browser }) => {
	const page = await signedInPage(browser, parent.email, phone);
	await createPlannedHousehold(page, plan);
	const { current, next } = monthsAround(page);

	await swipe(page, -120);
	await expect(page).toHaveURL(new RegExp(`/month/${next.key}$`));
	await expect(heading(page)).toHaveText(title(next, current.year));

	// A short drag isn't a swipe.
	await swipe(page, 30);
	await expect(page).toHaveURL(new RegExp(`/month/${next.key}$`));

	await swipe(page, 120);
	await expect(page).toHaveURL(new RegExp(`/month/${current.key}$`));
	await expect(heading(page)).toHaveText(current.name);
});
