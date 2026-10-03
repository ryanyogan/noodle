import { expect, type Locator, type Page, test } from "@playwright/test";
import { createTestParent } from "./parents";
import { seedReportHistory } from "./reports-seed";
import {
	accountKindLabel,
	choose,
	clientRendered,
	createHousehold,
	createPlannedHousehold,
	signedInPage,
} from "./session";

// Key information above the fold (#65): on the busy household (a Plan, 8 months of history, an
// Account, a Goal, the closing week's Close the last month, Get started part done), each main
// page's key information starts inside the first screen at 393x852 and 1440x900, and This Month's
// Free to Spend at 375x667. docs/reviews/above-the-fold.md is the table this prints. FOLD_OUT=dir
// also saves a shot of each screen.
const OUT = process.env.FOLD_OUT;
const month = new Intl.DateTimeFormat("en-CA", {
	timeZone: "America/Chicago",
	year: "numeric",
	month: "2-digit",
}).format(new Date());

let parent: Awaited<ReturnType<typeof createTestParent>>;
test.beforeEach(async () => {
	parent = await createTestParent();
});
test.afterEach(async () => {
	await parent?.remove();
});

async function busy(page: Page) {
	await createPlannedHousehold(page, {
		baseline: "6200",
		buckets: [
			["Groceries", "800"],
			["Eating out", "300"],
			["Kids", "400"],
			["Fun", "250"],
		],
	});
	seedReportHistory(parent.userId, 8);
	await page.goto("/accounts");
	await page.getByLabel("Name").fill("Joint Savings");
	await choose(page, "Kind", accountKindLabel("savings"));
	await page.getByLabel("Balance now").fill("8,000");
	await page.getByRole("button", { name: "Add Account" }).click();
	await expect(page.getByRole("link", { name: /^Joint Savings, / })).toBeVisible();
	await page.goto("/goals");
	await page.getByRole("button", { name: "Add Goal" }).click();
	const addGoal = page.getByRole("dialog", { name: "Add a Goal" });
	await addGoal.getByLabel("Name").fill("Trip");
	await addGoal.getByLabel("Target", { exact: true }).fill("3,000");
	await addGoal.getByRole("button", { name: "Add Goal" }).click();
	await expect(addGoal).toBeHidden();
}

type Probe = [label: string, locator: (page: Page) => Locator, optional?: boolean];
const visible = (l: Locator) => l.filter({ visible: true }).first();
const pages: [name: string, path: string, probes: Probe[]][] = [
	[
		"This Month",
		"/month",
		[
			["Free to Spend", (p) => p.getByRole("region", { name: "Free to Spend" })],
			["first Bucket", (p) => p.getByRole("listitem", { name: /^Groceries: / })],
		],
	],
	[
		"Plan",
		`/plan/${month}`,
		[
			["Free to Spend", (p) => visible(p.getByText("Free to Spend", { exact: true }))],
			["Plan health", (p) => visible(p.getByText("Things to check", { exact: true })), true],
		],
	],
	["Goals", "/goals", [["first Goal", (p) => p.getByRole("link", { name: /^Trip, / })]]],
	[
		"Accounts",
		"/accounts",
		[["first Account", (p) => p.getByRole("link", { name: /^Joint Savings, / })]],
	],
	[
		"Transactions",
		"/transactions",
		[
			["month total", (p) => visible(p.getByTestId("month-total"))],
			["first Transaction", (p) => visible(p.locator("[data-slot=list-row]"))],
		],
	],
];

/** Each page's key information, its y, and that it starts inside the first screen. */
async function measure(page: Page, size: string, fold: number, lines: string[]) {
	for (const [name, path, probes] of pages) {
		await page.goto(path);
		await expect(page.locator("[data-slot=page-header]:visible").first()).toBeVisible(
			clientRendered,
		);
		await page.waitForTimeout(500);
		if (OUT) await page.screenshot({ path: `${OUT}/${size}-${name}.png` });
		for (const [label, locate, optional] of probes) {
			const box = await locate(page)
				.boundingBox({ timeout: optional ? 3000 : 10_000 })
				.catch(() => null);
			lines.push(`| ${size} | ${name} | ${label} | ${box ? Math.round(box.y) : "none"} |`);
			if (!optional) expect(box, `${name}: ${label} at ${size}`).not.toBeNull();
			if (box) expect(box.y, `${name}: ${label} at ${size}`).toBeLessThan(fold);
		}
	}
}

const phone = { deviceScaleFactor: 1, isMobile: true, hasTouch: true } as const;

test("key information starts above the fold", async ({ browser }) => {
	test.setTimeout(300_000);
	const lines: string[] = [];
	const desk = await signedInPage(browser, parent.email, {
		viewport: { width: 1440, height: 900 },
		deviceScaleFactor: 1,
	});
	await busy(desk);
	await measure(desk, "1440x900", 900, lines);
	const p393 = await signedInPage(browser, parent.email, {
		...phone,
		viewport: { width: 393, height: 852 },
	});
	await measure(p393, "393x852", 852, lines);
	// The To do strip, closed, names what's in it.
	await p393.goto("/month");
	const todo = p393.getByRole("button", { name: /^To do/ });
	await expect(todo).toBeEnabled(clientRendered);
	await expect(todo).toContainText("Get started");
	lines.push(`393x852 To do, closed: ${(await todo.innerText()).replace(/\s+/g, " ")}`);
	if (OUT) {
		await p393.screenshot({ path: `${OUT}/393x852-This Month, To do closed.png` });
		await todo.click();
		await p393.screenshot({ path: `${OUT}/393x852-This Month, To do open.png`, fullPage: true });
	}
	const p375 = await signedInPage(browser, parent.email, {
		...phone,
		viewport: { width: 375, height: 667 },
	});
	await p375.goto("/month");
	const free = p375.getByRole("region", { name: "Free to Spend" });
	await expect(free).toBeVisible(clientRendered);
	if (OUT) await p375.screenshot({ path: `${OUT}/375x667-This Month.png` });
	const box = await free.boundingBox();
	lines.push(`| 375x667 | This Month | Free to Spend | ${box ? Math.round(box.y) : "none"} |`);
	expect(box?.y ?? Number.POSITIVE_INFINITY).toBeLessThan(667);
	console.log(`FOLD\n${lines.join("\n")}`);
});

test("a starter household's Get started starts above the fold", async ({ browser }) => {
	// Just made, no Plan yet: there is no Free to Spend, so Get started is the page's key information.
	for (const [width, height] of [
		[393, 852],
		[375, 667],
	] as const) {
		const page = await signedInPage(browser, parent.email, {
			...phone,
			viewport: { width, height },
		});
		if (width === 393) await createHousehold(page, "The Rinks", "Alex");
		await page.goto("/month");
		const free = page.getByRole("region", { name: "Get started" });
		await expect(free).toBeVisible(clientRendered);
		const box = await free.boundingBox();
		console.log(
			`FOLD | ${width}x${height} | This Month (starter) | Get started | ${box ? Math.round(box.y) : "none"} |`,
		);
		expect(box?.y ?? Number.POSITIVE_INFINITY).toBeLessThan(height);
		await page.context().close();
	}
});
