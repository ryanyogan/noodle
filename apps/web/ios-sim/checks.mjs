// Issue 52's "real iPhone" checks, as near as a machine gets: Noodle in Mobile Safari inside an
// iOS Simulator, with the real software keyboard, real safe areas and real gestures. Run by
// .github/workflows/ios-sim.yml on a macOS runner, against the Worker built and served on that
// runner with a local D1 (never production). On a Mac: start `bun run preview` in apps/web and
// `npm run appium` here, then `node checks.mjs`.
//
// Each check asserts what can be measured and saves a picture of the whole simulator screen (so
// the keyboard and the home indicator show) for what can only be judged by eye. Everything lands
// in IOS_SIM_OUT (default ./out): NN-name.png, walk.mp4, results.json, logs/source-*.xml (what
// XCUITest saw when a keyboard was read).
//
// IOS_SIM_DEVICE names the simulator ("iPhone 16", "iPhone SE (3rd generation)").

import { appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	baseURL,
	boot,
	log,
	openSafari,
	outDir,
	pickDevice,
	recordVideo,
	redactLogs,
	screenshot,
	signIn,
	sleep,
} from "./lib.mjs";

const wanted = process.env.IOS_SIM_DEVICE ?? "iPhone 16";
const slug = wanted.toLowerCase().replace(/[^a-z0-9]+/g, "");
// A pooled test Parent of its own, in the shape E2E's pool uses (e2e/parents.ts): kept across runs.
const email = `e2e-pool-ios${slug}-w0-p0+clerk_test@example.com`;

const results = { device: null, userAgent: null, checks: [] };
let device;
let driver;

/**
 * One check. `run` gets `must(ok, what)` for the things that can be asserted (all are tried; any
 * that fail make the check fail) and returns what it measured. A check that throws fails too, with
 * a picture of where it stopped.
 */
async function check(id, title, run) {
	log(`--- ${id}: ${title}`);
	const entry = { id, title, status: "pass", problems: [], passed: [], measured: null, shots: [] };
	const must = (ok, what) => (ok ? entry.passed : entry.problems).push(what);
	const shot = (name) => entry.shots.push(screenshot(device, name));
	try {
		entry.measured = (await run(must, shot)) ?? null;
	} catch (error) {
		entry.problems.push(`stopped: ${error.message}`);
		shot(`${id}-STOPPED`);
	}
	if (entry.problems.length > 0) entry.status = "fail";
	log(`${entry.status.toUpperCase()} ${id}`, JSON.stringify(entry.problems));
	results.checks.push(entry);
}

/** Whether `rect` is wholly inside what the keyboard leaves visible (the visual viewport). */
const inView = (rect, view) =>
	!!rect && rect.y >= view.offsetTop - 1 && rect.bottom <= view.offsetTop + view.height + 1;

/** The page is loaded and React has had time to take it over (a tap before then is lost). */
async function open(path, title) {
	await driver.goto(path);
	await driver.waitFor(
		`the ${title} header`,
		(text) => all("[data-slot=page-header]").some((el) => el.textContent.includes(text)),
		{ args: [title], timeout: 40_000 },
	);
	await driver.waitFor("the page to finish loading", () => document.readyState === "complete");
	await sleep(2500);
}

const quickAddLink = () => byName('nav[aria-label="Main"] a', "Quick Add");
const quickAddOpen = () => !!dialog("Quick Add");
const noteField = () => byName("input", "Note", dialog("Quick Add"));

async function openQuickAdd() {
	const way = await driver.tap("Quick Add in the tab bar", quickAddLink, { until: quickAddOpen });
	// The sheet slides up.
	await sleep(1200);
	return way;
}

async function main() {
	device = pickDevice(wanted);
	results.device = device;
	log("device", JSON.stringify(device));
	boot(device);
	let stopVideo = async () => {};
	try {
		driver = await openSafari(device, `${baseURL}/sign-in`);
		// Started once Safari is up: a recording begun before Appium opened the Simulator window
		// came out a fifteenth of a second long.
		stopVideo = recordVideo(device, "walk");
		results.userAgent = await driver.js(() => navigator.userAgent);
		log(results.userAgent);
		screenshot(device, "00-sign-in");

		await signIn(driver, email);
		// A Household with a Plan, made in one request to the dev-only route E2E uses.
		await driver.goto("/welcome");
		await driver.waitFor("the page after signing in", () => document.readyState === "complete");
		log(
			"at",
			await driver.url(),
			"cookies:",
			await driver.js(() => document.cookie.split(";").map((part) => part.split("=")[0].trim())),
		);
		const household = await driver.jsAsync(async () => {
			const response = await fetch("/api/dev/household", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					householdName: "The Rinks",
					parentName: "Alex",
					finishSetup: true,
					timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
					plan: {
						takeHomePayCents: 500000,
						buckets: [
							{ name: "Groceries", allowanceCents: 120000 },
							{ name: "Gas", allowanceCents: 20000 },
							{ name: "Dining out", allowanceCents: 30000 },
						],
					},
				}),
			});
			if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
			return response.json();
		});
		log("household", JSON.stringify(household));
		const month = household.month;

		await check(
			"01-this-month",
			"This Month loads signed in, portrait, not zoomed",
			async (must, shot) => {
				await open(household.url, "This Month");
				const seen = await driver.js(() => ({
					view: viewport(),
					scrollWidth: document.documentElement.scrollWidth,
					tabs: all('nav[aria-label="Main"] a').map((el) => nameOf(el)),
				}));
				must(seen.view.scale === 1, "the page is not zoomed (visualViewport.scale is 1)");
				must(seen.scrollWidth <= seen.view.innerWidth, "nothing is wider than the screen");
				must(seen.tabs.length >= 4, "the phone's tab bar is showing");
				shot("01-this-month");
				return seen;
			},
		);

		await check("02-safe-areas", "The tab bar and the safe areas in Safari", async (must, shot) => {
			await open(household.url, "This Month");
			const seen = await driver.js(() => {
				const probe = document.createElement("div");
				probe.style.cssText =
					"position:fixed;visibility:hidden;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)";
				document.body.append(probe);
				const style = getComputedStyle(probe);
				const insets = {
					top: style.paddingTop,
					right: style.paddingRight,
					bottom: style.paddingBottom,
					left: style.paddingLeft,
				};
				probe.remove();
				// The Sidebar is a "Main" navigation too, hidden on a phone: the one showing is the tab bar.
				const bar = all('nav[aria-label="Main"]')[0];
				return {
					insets,
					tabBar: box(bar),
					tabBarPaddingBottom: getComputedStyle(bar).paddingBottom,
					view: viewport(),
					standalone: window.matchMedia("(display-mode: standalone)").matches,
				};
			});
			must(
				Math.abs(seen.tabBar.bottom - seen.view.innerHeight) <= 1,
				"the tab bar ends at the bottom of the page Safari shows",
			);
			must(
				Number.parseFloat(seen.tabBarPaddingBottom) >= Number.parseFloat(seen.insets.bottom) + 5,
				"the tab bar keeps its padding plus the bottom safe area",
			);
			// By eye: the tab bar is clear of Safari's bar and the home indicator.
			shot("02-tab-bar-safe-area");
			return seen;
		});

		await check(
			"03-quick-add-keyboard",
			"Quick Add: amount on the keypad, note on the real keyboard, sheet above the keyboard",
			async (must, shot) => {
				await open(household.url, "This Month");
				const ways = { open: await openQuickAdd() };
				const before = await driver.js(() => viewport());
				for (const digit of ["4", "2"]) {
					await driver.tap(
						`${digit} on Quick Add's keypad`,
						(digit) => {
							const pad = all("fieldset", dialog("Quick Add")).find(
								(el) => el.querySelector("legend")?.textContent.trim() === "Keypad",
							);
							return all("button", pad).find((el) => nameOf(el) === digit);
						},
						{
							args: [digit],
							until: (digit) =>
								dialog("Quick Add").querySelector("output").textContent.includes(digit),
						},
					);
				}
				shot("03a-quick-add-keypad");
				ways.note = await driver.tap("the Note field", noteField, {
					until: () => document.activeElement?.getAttribute("aria-label") === "Note",
				});
				await sleep(1500);
				const keyboard = await driver.keyboard("quick-add-note");
				ways.typing = await driver.type("costco run", () =>
					/costco run/i.test(byName("input", "Note", dialog("Quick Add")).value),
				);
				await sleep(500);
				const seen = await driver.js(() => {
					const sheet = dialog("Quick Add");
					const bucket = byName("button", /^Groceries/, sheet);
					return {
						view: viewport(),
						sheet: box(sheet),
						note: box(byName("input", "Note", sheet)),
						noteValue: byName("input", "Note", sheet).value,
						bucket: bucket ? box(bucket) : null,
						amount: sheet.querySelector("output").textContent,
						keyboardInset: document.documentElement.style.getPropertyValue("--keyboard-inset"),
					};
				});
				shot("03b-quick-add-note-keyboard");
				must(
					keyboard.present || before.height - seen.view.height > 150,
					"the software keyboard is up",
				);
				if (keyboard.present)
					must(
						keyboard.buttons.some((name) => /done/i.test(name ?? "")),
						`the keyboard's return key reads Done (buttons: ${keyboard.buttons.join(", ")})`,
					);
				must(seen.view.scale === 1, "the page did not zoom when the field took focus");
				must(inView(seen.note, seen.view), "the Note field is above the keyboard");
				must(inView(seen.bucket, seen.view), "the Groceries button is wholly above the keyboard");
				must(inView(seen.sheet, seen.view), "the whole sheet is above the keyboard");
				must(/costco run/i.test(seen.noteValue), "the typed note is kept");
				must(seen.amount.trim() === "$42", "the amount is still $42");

				await driver.tap(
					"Groceries, to add it",
					() => byName("button", /^Groceries/, dialog("Quick Add")),
					{ until: () => !dialog("Quick Add"), settle: 6000 },
				);
				await sleep(1500);
				shot("03c-after-adding");
				return { ways, before, keyboard, ...seen };
			},
		);

		await check(
			"04-decimal-pad",
			"A money field brings up the decimal pad and stays above it",
			async (must, shot) => {
				await open(`/plan/${month}`, "Plan");
				const field = () => all('input[inputmode="decimal"]').find((el) => !el.disabled);
				if (!(await driver.js(`function () { return !!(${field})(); }`))) {
					// The Plan shows its amounts as text until a Bucket is opened for editing.
					await driver.tap("Edit Groceries", () => byName("button", "Edit Groceries"), {
						until: `function () { return !!(${field})(); }`,
						settle: 6000,
					});
					await sleep(1200);
				}
				const before = await driver.js(() => viewport());
				const way = await driver.tap("the money field", field, {
					until: () => document.activeElement?.getAttribute("inputmode") === "decimal",
				});
				await sleep(1500);
				const keyboard = await driver.keyboard("decimal-pad");
				const typing = await driver.type("75", () => document.activeElement.value.includes("75"));
				const seen = await driver.js(() => ({
					view: viewport(),
					field: box(document.activeElement),
					label: nameOf(document.activeElement) || document.activeElement.id,
					value: document.activeElement.value,
				}));
				shot("04-decimal-pad");
				must(
					keyboard.present || before.height - seen.view.height > 150,
					"the software keyboard is up",
				);
				if (keyboard.present) {
					must(
						keyboard.keys.includes("5"),
						`the keyboard has digit keys (${keyboard.keys.join(" ")})`,
					);
					must(
						!keyboard.keys.some((name) => /^[a-z]$/i.test(name ?? "")),
						"the keyboard has no letter keys: it is the decimal pad",
					);
				}
				must(seen.view.scale === 1, "the page did not zoom when the field took focus");
				must(inView(seen.field, seen.view), "the field is above the keyboard");
				must(seen.value.includes("75"), "the typed amount is kept");
				return { way, typing, before, keyboard, ...seen };
			},
		);

		await check(
			"05-transactions-search",
			"Transactions search: the keyboard's return key reads Search",
			async (must, shot) => {
				await open(`/transactions/${month}`, "Transactions");
				const search = () => all("#filter-search").find((el) => !el.disabled);
				const way = await driver.tap("the Search field", search, {
					until: () => document.activeElement?.id === "filter-search",
				});
				await sleep(1500);
				const keyboard = await driver.keyboard("transactions-search");
				shot("05a-search-keyboard");
				const typing = await driver.type("costco", () =>
					/costco/i.test(document.getElementById("filter-search").value),
				);
				await sleep(800);
				const seen = await driver.js(() => ({
					view: viewport(),
					field: box(document.getElementById("filter-search")),
					value: document.getElementById("filter-search").value,
					enterKeyHint: document.getElementById("filter-search").enterKeyHint,
					type: document.getElementById("filter-search").type,
				}));
				shot("05b-search-typed");
				must(keyboard.present, "XCUITest can see the keyboard");
				must(
					keyboard.buttons.some((name) => /search/i.test(name ?? "")),
					`the return key reads Search (buttons: ${keyboard.buttons.join(", ")})`,
				);
				must(seen.view.scale === 1, "the page did not zoom when the field took focus");
				must(inView(seen.field, seen.view), "the Search field is above the keyboard");
				must(/costco/i.test(seen.value), "the typed search is kept");
				return { way, typing, keyboard, ...seen };
			},
		);

		await check(
			"06-edge-swipe-back",
			"A swipe from the left edge (Safari's Back) closes Quick Add (row 144)",
			async (must, shot) => {
				await open(household.url, "This Month");
				await openQuickAdd();
				const address = await driver.url();
				shot("06a-quick-add-open");
				const screen = await driver.screen();
				const y = Math.round(screen.height * 0.45);
				const far = Math.round(screen.width * 0.9);
				const gone = () =>
					driver
						.waitFor("Quick Add to close", () => !dialog("Quick Add"), { timeout: 5000 })
						.catch(() => false);
				// Safari takes a drag from the very edge as Back; which synthetic drag it accepts is
				// found by trying them in turn (the one that worked is recorded).
				const drags = [
					["quick-flick", () => driver.drag({ x: 0, y }, { x: far, y }, { ms: 200, hold: 0 })],
					[
						"steady-drag",
						() => driver.drag({ x: 0, y }, { x: far, y }, { ms: 900, hold: 150, steps: 12 }),
					],
					[
						"from-5pt",
						() => driver.drag({ x: 5, y }, { x: far, y }, { ms: 500, hold: 100, steps: 8 }),
					],
					[
						"mobile-dragFromToForDuration",
						() =>
							driver.mobile("dragFromToForDuration", {
								duration: 0.5,
								fromX: 0,
								fromY: y,
								toX: far,
								toY: y,
							}),
					],
				];
				let closed = false;
				let way = null;
				const tried = [];
				for (const [name, run] of drags) {
					try {
						await run();
						closed = await gone();
					} catch (error) {
						tried.push(`${name}: ${error.message}`);
						continue;
					}
					tried.push(`${name}: ${closed ? "closed" : "still open"}`);
					if (closed) {
						way = name;
						break;
					}
					shot(`06-after-${name}`);
				}
				await sleep(1000);
				shot("06b-after-edge-swipe");
				const after = await driver.url();
				must(!!closed, "Quick Add closed");
				must(/\/month\//.test(after), `the page underneath is still This Month (${after})`);
				return { way, tried, address, after };
			},
		);
	} finally {
		await sleep(1000);
		await stopVideo();
		await driver?.quit();
		await sleep(1000);
		redactLogs();
	}
}

let crashed = null;
try {
	await main();
} catch (error) {
	crashed = error;
	console.error(error);
	if (device) screenshot(device, "99-crashed");
}
results.crashed = crashed ? String(crashed.stack ?? crashed) : null;
writeFileSync(join(outDir, "results.json"), `${JSON.stringify(results, null, "\t")}\n`);

const lines = [
	`### iOS Simulator: ${results.device?.name ?? wanted}, iOS ${results.device?.ios ?? "?"}`,
	"",
	"| Check | Result | Notes |",
	"|---|---|---|",
	...results.checks.map(
		(entry) =>
			`| ${entry.title} | ${entry.status} | ${(entry.problems.join("; ") || `${entry.passed.length} asserted`).replaceAll("|", "/").replaceAll("\n", " ")} |`,
	),
	...(crashed ? ["", `Stopped early: ${String(crashed.message).replaceAll("\n", " ")}`] : []),
];
console.log(lines.join("\n"));
if (process.env.GITHUB_STEP_SUMMARY)
	appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join("\n")}\n`);
const failed = results.checks.filter((entry) => entry.status === "fail").length;
process.exit(crashed || failed > 0 || results.checks.length === 0 ? 1 : 0);
