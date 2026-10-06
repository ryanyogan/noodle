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
	newTestingToken,
	openSafari,
	outDir,
	pickDevice,
	recordVideo,
	redactLogs,
	screenshot,
	signIn,
	sleep,
	ui,
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
	const entry = {
		id,
		title,
		status: "pass",
		problems: [],
		findings: [],
		passed: [],
		measured: null,
		shots: [],
	};
	const must = (ok, what) => (ok ? entry.passed : entry.problems).push(what);
	const shot = (name) => entry.shots.push(screenshot(device, name));
	// Something seen that a person should read (a gesture the simulator would not take, a measured
	// oddity): reported, but it does not fail the run.
	const finding = (what) => entry.findings.push(what);
	try {
		entry.measured = (await run(must, shot, finding)) ?? null;
	} catch (error) {
		entry.problems.push(`stopped: ${error.message}`);
		shot(`${id}-STOPPED`);
	}
	if (entry.problems.length > 0) entry.status = "fail";
	else if (entry.findings.length > 0) entry.status = "finding";
	log(
		`${entry.status.toUpperCase()} ${id}`,
		JSON.stringify([...entry.problems, ...entry.findings]),
	);
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

		const userId = await signIn(driver, email);
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
				must(
					seen.noteValue.toLowerCase() === "costco run",
					`the typed note is kept, exactly (${seen.noteValue})`,
				);
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
				const typing = await driver.type("75", () => document.activeElement.value.includes("75"), {
					keys: true,
				});
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
				const hint = await driver.js(() => document.getElementById("filter-search").enterKeyHint);
				must(keyboard.present, "XCUITest can see the keyboard");
				must(
					keyboard.buttons.some((name) => /search/i.test(name ?? "")),
					`the return key reads Search (buttons: ${keyboard.buttons.join(", ")}; the field's enterkeyhint is "${hint}")`,
				);
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
				must(seen.view.scale === 1, "the page did not zoom when the field took focus");
				must(inView(seen.field, seen.view), "the Search field is above the keyboard");
				must(/costco/i.test(seen.value), "the typed search is kept");
				return { way, typing, keyboard, ...seen };
			},
		);

		await check(
			"06-edge-swipe-back",
			"Back closes Quick Add, by a swipe from the left edge if Safari takes one (row 144)",
			async (must, shot, finding) => {
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
				let back = null;
				if (!closed) {
					// XCUITest's synthetic drags are not taken by Safari as its edge swipe (four kinds
					// tried). Back itself, which the swipe performs, is checked instead; the gesture is
					// left for a real phone.
					await driver.js(() => history.back());
					back = !!(await gone());
					finding(
						"needs a hand: Safari took none of four synthetic left-edge drags, so the swipe itself is unchecked (Back by history.back() closes the sheet)",
					);
				}
				await sleep(1000);
				shot("06b-after-back");
				const after = await driver.url();
				if (closed) must(true, `a swipe from the left edge closed Quick Add (${way})`);
				else
					must(
						back,
						"Back closes Quick Add (by history.back(): Safari did not take a synthetic edge swipe, so the gesture itself is NOT checked)",
					);
				must(/\/month\//.test(after), `the page underneath is still This Month (${after})`);
				must(!/sheet=/.test(after), "the address no longer names the sheet");
				return { swipe: way ?? "not taken by Safari", back, tried, address, after };
			},
		);

		await check(
			"07-search-key-variants",
			"Which kind of search field iOS gives a Search key (an experiment beside the app's field)",
			async (_must, shot, finding) => {
				await open(`/transactions/${month}`, "Transactions");
				const ids = await driver.js(() => {
					const panel = document.createElement("div");
					panel.id = "ios-sim-variants";
					panel.style.cssText =
						"position:fixed;top:0;left:0;right:0;z-index:99999;background:#fff;padding:8px;display:grid;gap:6px";
					const made = [];
					const make = (id, attrs, inForm) => {
						const input = document.createElement("input");
						input.id = id;
						input.placeholder = id;
						input.style.cssText =
							"font-size:16px;height:36px;border:1px solid #888;width:100%;color:#000";
						for (const [name, value] of Object.entries(attrs)) input.setAttribute(name, value);
						if (inForm) {
							const form = document.createElement("form");
							form.action = ".";
							form.setAttribute("role", "search");
							form.addEventListener("submit", (event) => event.preventDefault());
							form.append(input);
							panel.append(form);
						} else panel.append(input);
						made.push(id);
					};
					const all3 = { type: "search", inputmode: "search", enterkeyhint: "search" };
					make("v1-search-inputmode-hint", all3);
					make("v2-search-hint", { type: "search", enterkeyhint: "search" });
					make("v3-search-in-form", { type: "search" }, true);
					make("v4-text-hint", { type: "text", enterkeyhint: "search" });
					make("v5-search-inputmode-hint-in-form", all3, true);
					document.body.append(panel);
					return made;
				});
				const seen = {};
				for (const id of ids) {
					try {
						await driver.tap(id, (id) => document.getElementById(id), {
							args: [id],
							until: (id) => document.activeElement?.id === id,
						});
						await sleep(1300);
						const keyboard = await driver.keyboard(`variant-${id}`);
						seen[id] = {
							returnKey:
								keyboard.buttons.find((name) =>
									/^(go|search|return|done|send|next|join|route)$/i.test(name ?? ""),
								) ?? null,
							buttons: keyboard.buttons,
							keys: keyboard.keys.length,
							hasDot: keyboard.keys.includes("."),
						};
						shot(`07-${id}`);
					} catch (error) {
						seen[id] = { error: error.message };
					}
				}
				await driver.js(() => {
					document.activeElement?.blur();
					document.getElementById("ios-sim-variants")?.remove();
				});
				finding(
					`return key by field: ${Object.entries(seen)
						.map(([id, value]) => `${id} = ${value.returnKey ?? value.error ?? "?"}`)
						.join(", ")}`,
				);
				return seen;
			},
		);

		const keypadKey = (digit) => {
			const pad = all("fieldset", dialog("Quick Add")).find(
				(el) => el.querySelector("legend")?.textContent.trim() === "Keypad",
			);
			return all("button", pad).find((el) => nameOf(el) === digit);
		};
		/** One Transaction of `digit` dollars in Groceries, by Quick Add: it raises the Undo toast. */
		const addWithQuickAdd = async (digit) => {
			await openQuickAdd();
			await driver.tap(`${digit} on Quick Add's keypad`, keypadKey, {
				args: [digit],
				until: (digit) => dialog("Quick Add").querySelector("output").textContent.includes(digit),
			});
			await driver.tap(
				"Groceries, to add it",
				() => byName("button", /^Groceries/, dialog("Quick Add")),
				{ until: () => !dialog("Quick Add"), settle: 6000 },
			);
		};

		await check(
			"08-sheet-swipe-down",
			"A drag down from the grabber closes the Quick Add sheet",
			async (must, shot, finding) => {
				await open(household.url, "This Month");
				await openQuickAdd();
				const place = await driver.calibrate();
				const grabber = await driver.js(() => {
					const el = all("[data-slot=sheet-grabber]")[0];
					if (!el) return null;
					window.__iosSimGrab = [];
					for (const kind of ["pointerdown", "pointermove", "pointerup", "pointercancel"])
						el.addEventListener(kind, (event) =>
							window.__iosSimGrab.push(`${kind}@${Math.round(event.clientY)}`),
						);
					return box(el);
				});
				if (!grabber) throw new Error("no grabber showing on the Quick Add sheet");
				const from = {
					x: Math.round(grabber.x + grabber.width / 2 + place.dx),
					y: Math.round(grabber.y + grabber.height / 2 + place.dy),
				};
				const to = { x: from.x, y: Math.min(from.y + 420, Math.round(place.screen.height - 40)) };
				const gone = () =>
					driver
						.waitFor("Quick Add to close", () => !dialog("Quick Add"), { timeout: 4000 })
						.catch(() => false);
				const drags = [
					["steady-drag", () => driver.drag(from, to, { ms: 600, hold: 80, steps: 10 })],
					["quick-flick", () => driver.drag(from, to, { ms: 180, hold: 0, steps: 3 })],
					[
						"mobile-dragFromToForDuration",
						() =>
							driver.mobile("dragFromToForDuration", {
								duration: 0.3,
								fromX: from.x,
								fromY: from.y,
								toX: to.x,
								toY: to.y,
							}),
					],
				];
				let way = null;
				const tried = [];
				for (const [name, run] of drags) {
					try {
						await run();
						if (await gone()) way = name;
					} catch (error) {
						tried.push(`${name}: ${error.message}`);
						continue;
					}
					tried.push(`${name}: ${way ? "closed" : "still open"}`);
					if (way) break;
					shot(`08-after-${name}`);
				}
				const events = await driver.js(() => (window.__iosSimGrab ?? []).slice(0, 40));
				if (!way) {
					finding(
						`needs a hand: no synthetic drag from the grabber closed the sheet (${tried.join("; ")}; the grabber saw ${events.length} pointer events)`,
					);
					await driver.js(() => history.back());
					await gone();
				} else must(true, `a drag down from the grabber closed Quick Add (${way})`);
				await sleep(800);
				shot("08b-after-sheet-drag");
				const after = await driver.url();
				must(/\/month\//.test(after), `the page underneath is still This Month (${after})`);
				if (way) must(!/sheet=/.test(after), "the address no longer names the sheet");
				return { way, tried, grabber, from, to, place, events, after };
			},
		);

		await check(
			"09-long-scroll",
			"A long month of Transactions scrolls end to end by real flicks",
			async (must, shot, finding) => {
				const rows = 160;
				await driver.goto(`/transactions/${month}`);
				await driver.waitFor("the page", () => document.readyState === "complete");
				await driver.jsAsync(
					async (userId, month, rows) => {
						const household = `(select household_id from members where clerk_user_id = '${userId}' limit 1)`;
						const member = `(select id from members where clerk_user_id = '${userId}' limit 1)`;
						const statements = [];
						for (let i = 1; i <= rows; i++) {
							const n = String(i).padStart(3, "0");
							const day = String(1 + (i % 5)).padStart(2, "0");
							statements.push(
								`insert into transactions (id, household_id, source, date, amount_cents, note, created_by_member_id) values ('01J0SS1M000000000000000${n}', ${household}, 'quick-add', '${month}-${day}', ${1000 + i}, 'ios row ${n}', ${member})`,
							);
						}
						const response = await fetch("/api/dev/sql", {
							method: "POST",
							headers: { "content-type": "application/json" },
							body: JSON.stringify({ statements }),
						});
						if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
						return true;
					},
					[userId, month, rows],
				);
				await open(`/transactions/${month}`, "Transactions");
				const state = () =>
					driver.js(() => {
						const candidates = [
							document.scrollingElement,
							...document.querySelectorAll(
								"main, [class*=overflow-y-auto], [class*=overflow-auto]",
							),
						];
						let best = candidates[0];
						for (const el of candidates)
							if (el.scrollHeight - el.clientHeight > best.scrollHeight - best.clientHeight)
								best = el;
						const bar = all('nav[aria-label="Main"]')[0];
						return {
							scroller: best === document.scrollingElement ? "page" : best.tagName,
							top: Math.round(best.scrollTop),
							range: Math.round(best.scrollHeight - best.clientHeight),
							seeded: (document.body.innerText.match(/ios row \d{3}/g) ?? []).length,
							scrollWidth: document.documentElement.scrollWidth,
							view: viewport(),
							tabBarBottom: bar ? box(bar).bottom : null,
						};
					});
				const start = await state();
				shot("09a-long-month-top");
				const { width, height } = await driver.screen();
				const x = Math.round(width / 2);
				const flick = (fromY, toY) =>
					driver.drag(
						{ x, y: Math.round(height * fromY) },
						{ x, y: Math.round(height * toY) },
						{ ms: 160, hold: 0, steps: 2 },
					);
				const tops = [start.top];
				let now = start;
				let flicksDown = 0;
				for (; flicksDown < 40 && now.range - now.top > 2; flicksDown++) {
					await flick(0.6, 0.22);
					await sleep(1100);
					now = await state();
					tops.push(now.top);
					if (flicksDown === 2) shot("09b-long-month-middle");
				}
				const end = now;
				shot("09c-long-month-end");
				let flicksUp = 0;
				for (; flicksUp < 40 && now.top > 2; flicksUp++) {
					await flick(0.3, 0.68);
					await sleep(1100);
					now = await state();
				}
				shot("09d-long-month-back-at-top");
				must(
					start.range > start.view.innerHeight * 3,
					`the list is long (${start.range}px to scroll)`,
				);
				must(end.range - end.top <= 2, `flicks reached the end (${end.top} of ${end.range})`);
				must(now.top <= 2, `flicks came back to the top (${now.top})`);
				must(
					end.scrollWidth <= end.view.innerWidth,
					"nothing is wider than the screen at the end of the list",
				);
				if (end.tabBarBottom !== null)
					must(
						Math.abs(end.tabBarBottom - end.view.innerHeight) <= 1,
						`the tab bar is still at the foot of the page at the end (${end.tabBarBottom} of ${end.view.innerHeight})`,
					);
				if (end.seeded < rows)
					finding(
						`${end.seeded} of the ${rows} seeded rows are in the page at the end of the list`,
					);
				return { start, end, back: now, flicksDown, flicksUp, tops };
			},
		);

		await check(
			"10-toast-countdown",
			"A toast that was pressed still counts down, and so does the next one (#121)",
			async (must, shot, finding) => {
				await open(household.url, "This Month");
				const place = await driver.calibrate();
				const count = () =>
					driver
						.js(
							() => all("[data-sonner-toast]").filter((el) => el.dataset.removed !== "true").length,
						)
						.catch(() => -1);
				const appear = () =>
					driver
						.waitFor("a toast", () => all("[data-sonner-toast]").length > 0, { timeout: 8000 })
						.then(() => Date.now());
				/** Milliseconds from `since` until no toast is left, touching nothing; null past `cap`. */
				const life = async (since, cap) => {
					while (Date.now() - since < cap) {
						if ((await count()) === 0) return Date.now() - since;
						await sleep(250);
					}
					return null;
				};
				await addWithQuickAdd("1");
				const first = await appear().catch(() => null);
				if (first === null) {
					shot("10-no-toast");
					finding(
						"not checked: adding by Quick Add raised no toast within 8 s, and no other way of raising one is scripted",
					);
					return { place };
				}
				await sleep(600);
				shot("10a-toast");
				const text = await driver.js(() => all("[data-sonner-toast]")[0]?.innerText ?? null);
				const untouched = await life(first, 25_000);

				await addWithQuickAdd("2");
				const second = await appear();
				await sleep(700);
				const point = await driver.js(() => {
					const toaster = document.querySelector("[data-sonner-toaster]");
					window.__iosSimToast = [];
					const began = Date.now();
					for (const kind of ["pointerdown", "pointerup", "mouseenter", "mouseleave", "mousemove"])
						toaster?.addEventListener(kind, () =>
							window.__iosSimToast.push(`${kind}+${Date.now() - began}`),
						);
					const el = all("[data-sonner-toast]")[0];
					const r = el.getBoundingClientRect();
					for (const part of [0.2, 0.35, 0.5, 0.1, 0.65]) {
						const x = r.x + r.width * part;
						const y = r.y + r.height / 2;
						const hit = document.elementFromPoint(x, y);
						if (hit && el.contains(hit) && !hit.closest("button, a")) return { x, y };
					}
					return null;
				});
				if (!point) throw new Error("no part of the toast is free of buttons to press");
				await driver.mobile("tap", {
					x: Math.round(point.x + place.dx),
					y: Math.round(point.y + place.dy),
				});
				await sleep(500);
				shot("10b-toast-just-pressed");
				const pressed = await life(second, 30_000);
				const afterPress = await driver.js(() => ({
					events: (window.__iosSimToast ?? []).slice(0, 30),
					expanded: all("[data-sonner-toast]").map((el) => el.dataset.expanded),
					left: all("[data-sonner-toast]").length,
				}));
				shot("10c-toast-30s-after-press");

				// The next toast, raised by taps elsewhere (the tab bar, the sheet), then left alone.
				await addWithQuickAdd("3");
				const third = await appear();
				const next = await life(third, 30_000);
				shot("10d-next-toast-done");
				must(
					untouched !== null && untouched < 16_000,
					`an untouched Undo toast goes on its own (${untouched} ms)`,
				);
				// Fixed in the app (issue 52): a touch no longer leaves Sonner's hover pause on.
				must(
					pressed !== null && pressed < 20_000,
					pressed === null
						? `a toast pressed once goes on its own (still showing 30 s later with nothing else touched; untouched it went in ${untouched} ms)`
						: `a toast pressed once still goes on its own (${pressed} ms)`,
				);
				must(
					next !== null && next < 20_000,
					`the next toast goes on its own (${next === null ? "still showing 30 s later" : `${next} ms`})`,
				);
				return { text, untouched, pressed, next, afterPress, point, place };
			},
		);

		await check(
			"11-largest-text",
			"The largest accessibility text size: what reaches Safari, and nothing wider than the screen",
			async (must, shot, finding) => {
				const sizes = () =>
					driver.js(() => {
						const probe = document.createElement("p");
						probe.style.font = "-apple-system-body";
						probe.textContent = "x";
						document.body.append(probe);
						const appleBody = getComputedStyle(probe).fontSize;
						probe.remove();
						const header = all("[data-slot=page-header]")[0];
						return {
							appleBody,
							html: getComputedStyle(document.documentElement).fontSize,
							body: getComputedStyle(document.body).fontSize,
							header: header
								? getComputedStyle(header.querySelector("h1") ?? header).fontSize
								: null,
							textSizeAdjust: getComputedStyle(document.documentElement).webkitTextSizeAdjust,
							scrollWidth: document.documentElement.scrollWidth,
							innerWidth: window.innerWidth,
						};
					});
				const openAny = async (path) => {
					await driver.goto(path);
					await driver.waitFor("a page header", () => all("[data-slot=page-header]").length > 0, {
						timeout: 40_000,
					});
					await driver.waitFor(
						"the page to finish loading",
						() => document.readyState === "complete",
					);
					await sleep(2000);
				};
				await openAny(household.url);
				const before = await sizes();
				const was = ui(device, "content_size");
				const set = ui(device, "content_size", "accessibility-extra-extra-extra-large");
				await sleep(2500);
				const pages = {};
				try {
					for (const [name, path] of [
						["this-month", household.url],
						["transactions", `/transactions/${month}`],
						["accounts", "/accounts"],
						["plan", `/plan/${month}`],
						["goals", "/goals"],
					]) {
						try {
							await openAny(path);
							const seen = await sizes();
							pages[name] = seen;
							shot(`11-largest-text-${name}`);
							must(
								seen.scrollWidth <= seen.innerWidth,
								`${name}: nothing is wider than the screen (${seen.scrollWidth} of ${seen.innerWidth})`,
							);
						} catch (error) {
							pages[name] = { error: error.message };
							must(false, `${name}: ${error.message}`);
						}
					}
				} finally {
					ui(device, "content_size", was && /^[a-z-]+$/.test(was) ? was : "large");
				}
				const after = pages["this-month"] ?? {};
				must(set !== null, "simctl set the largest accessibility text size");
				if (after.appleBody === before.appleBody)
					finding(
						`the simulator's text size did not reach Safari at all (-apple-system-body stays ${before.appleBody})`,
					);
				else if (after.body === before.body)
					finding(
						`Safari knows the larger size (-apple-system-body ${before.appleBody} -> ${after.appleBody}) but Noodle's text stays ${after.body}: Dynamic Type does not change the pages, so these pictures are at the usual size and 200% text is not checked here`,
					);
				return { was, before, pages };
			},
		);

		await check(
			"12-dark",
			"Dark appearance: This Month, and the sign-up code boxes",
			async (must, shot, finding) => {
				const colours = (selector) =>
					driver.js((selector) => {
						const rgb = (value) => {
							const canvas = document.createElement("canvas");
							canvas.width = canvas.height = 1;
							const ctx = canvas.getContext("2d");
							ctx.fillStyle = "#000";
							ctx.fillStyle = value;
							ctx.fillRect(0, 0, 1, 1);
							return [...ctx.getImageData(0, 0, 1, 1).data];
						};
						const el = selector ? all(selector)[0] : document.body;
						if (!el) return null;
						const style = getComputedStyle(el);
						return {
							dark: window.matchMedia("(prefers-color-scheme: dark)").matches,
							htmlClass: document.documentElement.className,
							background: rgb(style.backgroundColor),
							color: rgb(style.color),
							border: rgb(style.borderTopColor),
							count: selector ? all(selector).length : 1,
						};
					}, selector ?? null);
				ui(device, "appearance", "dark");
				try {
					await sleep(1500);
					await open(household.url, "This Month");
					const page = await colours();
					shot("12a-this-month-dark");
					const light = (c) => (c[0] + c[1] + c[2]) / 3;
					// `simctl ui appearance dark` does not always reach Safari (it did on the iPhone SE
					// and not on the iPhone 16): then nothing dark was drawn, and nothing is judged.
					if (!page.dark) {
						finding(
							"skipped: the simulator's dark appearance did not reach Safari (the page still reports light), so dark is not checked on this simulator; needs a real iPhone or a hand",
						);
						return { page, boxes: null };
					}
					must(page.dark, "Safari reports the dark appearance to the page");
					must(
						light(page.background) < 70,
						`the page's background is dark (rgba ${page.background.join(" ")})`,
					);

					// The code boxes: a sign-up begun through Clerk's own client for a test address that
					// is never verified (so no user is made), then Clerk's page for entering the code.
					let boxes = null;
					try {
						await driver.jsAsync(
							async () => {
								await window.Clerk.signOut();
								return "signed out";
							},
							[],
							{ lost: () => (window.Clerk?.loaded && !window.Clerk.user ? "signed out" : null) },
						);
						await driver.goto("/sign-up");
						await driver.waitFor("Clerk on the sign-up page", () => !!window.Clerk?.loaded, {
							timeout: 60_000,
						});
						const testing = await newTestingToken();
						const status = await driver.jsAsync(
							async (testing, address) => {
								const clerk = window.Clerk;
								const fetchPage = window.fetch.bind(window);
								window.fetch = (input, init) => {
									try {
										const url = new URL(
											typeof input === "string" ? input : (input.url ?? String(input)),
										);
										if (
											url.host === clerk.frontendApi &&
											!url.searchParams.has("__clerk_testing_token")
										) {
											url.searchParams.set("__clerk_testing_token", testing);
											return fetchPage(
												typeof input === "string" || input instanceof URL
													? url.toString()
													: new Request(url.toString(), input),
												init,
											);
										}
									} catch {}
									return fetchPage(input, init);
								};
								const attempt = await clerk.client.signUp.create({
									emailAddress: address,
									password: `Noodle-${crypto.randomUUID()}!`,
								});
								await attempt.prepareEmailAddressVerification({ strategy: "email_code" });
								return attempt.status;
							},
							[testing, `ios-dark-${Date.now()}+clerk_test@example.com`],
						);
						log("sign-up begun:", status);
						await driver.goto("/sign-up/verify-email-address");
						await driver.waitFor("the code boxes", () => all(".cl-otpCodeFieldInput").length > 0, {
							timeout: 30_000,
						});
						await sleep(1500);
						boxes = await colours(".cl-otpCodeFieldInput");
						shot("12b-sign-up-code-boxes-dark");
						must(boxes.count === 6, `six code boxes show (${boxes.count})`);
						must(
							light(boxes.background) < 90,
							`the code boxes are dark (rgba ${boxes.background.join(" ")})`,
						);
						must(
							Math.abs(light(boxes.border) - light(boxes.background)) > 12,
							`the code boxes have an edge that shows (edge ${boxes.border.join(" ")} on ${boxes.background.join(" ")})`,
						);
					} catch (error) {
						shot("12b-sign-up-code-boxes-NOT-REACHED");
						finding(`the sign-up code boxes were not reached: ${error.message}`);
					}
					return { page, boxes };
				} finally {
					ui(device, "appearance", "light");
				}
			},
		);

		await check(
			"13-installed-app",
			"Add to Home Screen, then the installed app's safe areas (an attempt)",
			async (_must, shot, finding) => {
				const steps = [];
				const measured = {};
				try {
					await driver.goto("/sign-in");
					await sleep(2000);
					await driver.nativeClick("accessibility id", "ShareButton");
					steps.push("opened Safari's share sheet");
					await sleep(3000);
					shot("13a-share-sheet");
					const screen = await driver.screen();
					const x = Math.round(screen.width / 2);
					let added = false;
					for (let attempt = 0; attempt < 5 && !added; attempt++) {
						try {
							await driver.nativeClick("-ios predicate string", 'label == "Add to Home Screen"');
							added = true;
						} catch {
							await driver.drag(
								{ x, y: Math.round(screen.height * 0.85) },
								{ x, y: Math.round(screen.height * 0.3) },
								{ ms: 400, hold: 50, steps: 4 },
							);
							await sleep(1200);
						}
					}
					if (!added) throw new Error('no "Add to Home Screen" in the share sheet');
					steps.push("chose Add to Home Screen");
					await sleep(2500);
					shot("13b-add-to-home-screen");
					await driver.nativeClick(
						"-ios predicate string",
						'type == "XCUIElementTypeButton" AND label == "Add"',
					);
					steps.push("pressed Add");
					await sleep(4000);
					shot("13c-home-screen");
					await driver.nativeClick(
						"-ios predicate string",
						'type == "XCUIElementTypeIcon" AND label BEGINSWITH "Noodle"',
					);
					steps.push("opened Noodle from the Home Screen");
					await sleep(8000);
					shot("13d-installed-app");
					measured.contexts = await driver.cmd("GET", "/contexts").catch((error) => error.message);
					try {
						await driver.web(true);
						measured.page = await driver.js(() => {
							const probe = document.createElement("div");
							probe.style.cssText =
								"position:fixed;visibility:hidden;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)";
							document.body.append(probe);
							const style = getComputedStyle(probe);
							const insets = [
								style.paddingTop,
								style.paddingRight,
								style.paddingBottom,
								style.paddingLeft,
							];
							probe.remove();
							return {
								href: location.href,
								standalone: window.matchMedia("(display-mode: standalone)").matches,
								navigatorStandalone: navigator.standalone ?? null,
								insets,
								view: viewport(),
							};
						});
						steps.push(
							`a page answered: standalone ${measured.page.standalone}, safe areas ${measured.page.insets.join(" ")}`,
						);
					} catch (error) {
						steps.push(`no page of the installed app could be read: ${error.message}`);
					}
					finding(`by eye only (see 13d-installed-app.png): ${steps.join("; ")}`);
				} catch (error) {
					shot("13-STOPPED-at");
					finding(
						`needs a hand: ${error.message} (got as far as: ${steps.join("; ") || "nothing"})`,
					);
				}
				return { steps, ...measured };
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
			`| ${entry.title} | ${entry.status} | ${([...entry.problems, ...entry.findings].join("; ") || `${entry.passed.length} asserted`).replaceAll("|", "/").replaceAll("\n", " ")} |`,
	),
	...(crashed ? ["", `Stopped early: ${String(crashed.message).replaceAll("\n", " ")}`] : []),
];
console.log(lines.join("\n"));
if (process.env.GITHUB_STEP_SUMMARY)
	appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join("\n")}\n`);
const failed = results.checks.filter((entry) => entry.status === "fail").length;
process.exit(crashed || failed > 0 || results.checks.length === 0 ? 1 : 0);
