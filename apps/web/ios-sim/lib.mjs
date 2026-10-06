// Helpers for walking Noodle in Mobile Safari inside an iOS Simulator (issue 52): choosing and
// booting the simulator, a small WebDriver client for Appium's XCUITest driver, real taps and real
// typing, and signing a test Parent in the way E2E does (a Clerk sign-in token for a pooled user
// of the development instance). No dependencies: Appium is spoken to over plain HTTP.
//
// Two contexts matter. The web context runs JavaScript in the page (find, measure). The native
// context sees what XCUITest sees: the keyboard and its keys, Safari's own bars. Taps and typing
// always go through the native side, so the real software keyboard comes up and is typed on.

import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import { join } from "node:path";

export const outDir = process.env.IOS_SIM_OUT ?? "out";
export const baseURL = process.env.BASE_URL ?? "http://localhost:5173";
const appiumURL = new URL(process.env.APPIUM_URL ?? "http://127.0.0.1:4723");

mkdirSync(join(outDir, "logs"), { recursive: true });

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export const log = (...parts) => console.log(new Date().toISOString().slice(11, 19), ...parts);

// ---------------------------------------------------------------------------------------------
// The simulator

export function simctl(...args) {
	return execFileSync("xcrun", ["simctl", ...args], {
		encoding: "utf8",
		maxBuffer: 64 * 1024 * 1024,
	});
}

const versionOf = (runtime) =>
	(runtime.match(/iOS-(\d+)-(\d+)/) ?? []).slice(1).map(Number).concat(0, 0).slice(0, 2);
const newer = (a, b) => a[0] - b[0] || a[1] - b[1];

/**
 * The simulator named `wanted` on the newest iOS runtime the selected Xcode can build for (a newer
 * runtime may be installed for another Xcode, and WebDriverAgent could not be built for it). When
 * the runtime has no such device it is created; failing that, the first iPhone 16 or 15.
 */
export function pickDevice(wanted) {
	const sdk = execFileSync("xcrun", ["--sdk", "iphonesimulator", "--show-sdk-version"], {
		encoding: "utf8",
	})
		.trim()
		.split(".")
		.map(Number);
	const { devices } = JSON.parse(simctl("list", "devices", "available", "-j"));
	const runtimes = Object.keys(devices)
		.filter((runtime) => /SimRuntime\.iOS-/.test(runtime))
		.filter((runtime) => newer(versionOf(runtime), [sdk[0], sdk[1] ?? 0]) <= 0)
		.sort((a, b) => newer(versionOf(b), versionOf(a)));
	log("SDK", sdk.join("."), "runtimes that fit:", runtimes.join(", ") || "none");
	const found = (name) => {
		for (const runtime of runtimes) {
			const device = devices[runtime].find((candidate) => candidate.name === name);
			if (device) return { name, udid: device.udid, runtime, ios: versionOf(runtime).join(".") };
		}
	};
	const exact = found(wanted);
	if (exact) return exact;
	const runtime = runtimes[0];
	if (runtime) {
		try {
			const { devicetypes } = JSON.parse(simctl("list", "devicetypes", "-j"));
			const type = devicetypes.find((candidate) => candidate.name === wanted);
			if (type) {
				const udid = simctl("create", wanted, type.identifier, runtime).trim();
				log("created", wanted, udid);
				return { name: wanted, udid, runtime, ios: versionOf(runtime).join(".") };
			}
		} catch (error) {
			log("could not create", wanted, String(error));
		}
	}
	for (const name of ["iPhone 16", "iPhone 15", "iPhone 16 Pro", "iPhone 15 Pro"]) {
		const other = found(name);
		if (other) {
			log(`no "${wanted}" simulator: using ${name}`);
			return other;
		}
	}
	throw new Error(`No iPhone simulator found for "${wanted}"`);
}

/** Boots the simulator with no hardware keyboard, so the software keyboard shows. */
export function boot(device) {
	const quiet = (run) => {
		try {
			run();
		} catch (error) {
			log("ignored:", String(error).split("\n")[0]);
		}
	};
	quiet(() =>
		execFileSync("defaults", [
			"write",
			"com.apple.iphonesimulator",
			"ConnectHardwareKeyboard",
			"-bool",
			"false",
		]),
	);
	quiet(() => simctl("boot", device.udid));
	simctl("bootstatus", device.udid, "-b");
	// The first keyboard of a new simulator otherwise opens with a "slide to type" introduction.
	for (const domain of ["com.apple.keyboard.preferences", "com.apple.Preferences"]) {
		quiet(() =>
			simctl(
				"spawn",
				device.udid,
				"defaults",
				"write",
				domain,
				"DidShowContinuousPathIntroduction",
				"-bool",
				"true",
			),
		);
	}
}

/** A picture of the whole simulator screen: status bar, Safari's bars, keyboard, home indicator. */
export function screenshot(device, name) {
	const file = join(outDir, `${name}.png`);
	try {
		simctl("io", device.udid, "screenshot", "--type=png", file);
		log("shot", file);
	} catch (error) {
		log("screenshot failed", name, String(error).split("\n")[0]);
	}
	return `${name}.png`;
}

/** Records the simulator's screen until the returned function is called. */
export function recordVideo(device, name) {
	const file = join(outDir, `${name}.mp4`);
	const child = spawn(
		"xcrun",
		["simctl", "io", device.udid, "recordVideo", "--codec=h264", "--force", file],
		{ stdio: "inherit" },
	);
	return () =>
		new Promise((resolve) => {
			if (child.exitCode !== null) return resolve();
			child.once("exit", resolve);
			// Ctrl-C is how simctl is told to finish the file.
			child.kill("SIGINT");
			setTimeout(resolve, 20_000);
		});
}

// ---------------------------------------------------------------------------------------------
// WebDriver, over plain HTTP (no timeout: the first session builds WebDriverAgent for minutes)

function request(method, path, body) {
	const data = body === undefined ? undefined : JSON.stringify(body);
	return new Promise((resolve, reject) => {
		const req = http.request(
			{
				method,
				host: appiumURL.hostname,
				port: appiumURL.port,
				path,
				headers: data
					? { "content-type": "application/json", "content-length": Buffer.byteLength(data) }
					: {},
			},
			(res) => {
				let text = "";
				res.setEncoding("utf8");
				res.on("data", (chunk) => {
					text += chunk;
				});
				res.on("end", () => {
					let value;
					try {
						value = JSON.parse(text).value;
					} catch {
						return reject(new Error(`${method} ${path}: ${res.statusCode} ${text.slice(0, 300)}`));
					}
					if (value && typeof value === "object" && value.error) {
						return reject(
							new Error(
								`${method} ${path}: ${value.error}: ${String(value.message).slice(0, 600)}`,
							),
						);
					}
					resolve(value);
				});
			},
		);
		req.on("error", reject);
		if (data) req.write(data);
		req.end();
	});
}

const ELEMENT = "element-6066-11e4-a52e-4f735466cecf";

// Runs in the page before every script: small finders shared by the checks. A page function given
// to `js` may use these names freely.
const PRELUDE = `
const visible = (el) => { if (!el) return false; const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
const all = (selector, root) => [...(root || document).querySelectorAll(selector)].filter(visible);
const spoken = (el) => { const copy = el.cloneNode(true); for (const hidden of copy.querySelectorAll('[aria-hidden="true"]')) hidden.remove(); return copy.textContent || ""; };
const nameOf = (el) => (el.getAttribute("aria-label") || (el.getAttribute("aria-labelledby") || "").split(" ").map((id) => (document.getElementById(id) || {}).textContent || "").join(" ") || spoken(el)).trim();
const dialog = (name) => all("[role=dialog]").find((el) => nameOf(el) === name || nameOf(el).startsWith(name));
const byName = (selector, name, root) => all(selector, root).find((el) => (name instanceof RegExp ? name.test(nameOf(el)) : nameOf(el) === name));
const box = (el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, bottom: r.bottom }; };
const viewport = () => { const v = window.visualViewport; return { scale: v.scale, width: v.width, height: v.height, offsetTop: v.offsetTop, offsetLeft: v.offsetLeft, innerHeight: window.innerHeight, innerWidth: window.innerWidth, scrollY: window.scrollY }; };
`;

/** Opens Safari in the simulator through Appium and returns the driver the checks use. */
export async function openSafari(device, initialUrl) {
	log("starting the Safari session (the first one builds WebDriverAgent: several minutes)");
	const created = await request("POST", "/session", {
		capabilities: {
			alwaysMatch: {
				platformName: "iOS",
				browserName: "Safari",
				"appium:automationName": "XCUITest",
				"appium:udid": device.udid,
				"appium:deviceName": device.name,
				"appium:platformVersion": device.ios,
				"appium:connectHardwareKeyboard": false,
				"appium:safariInitialUrl": initialUrl,
				"appium:wdaLaunchTimeout": 900_000,
				"appium:wdaConnectionTimeout": 900_000,
				"appium:webviewConnectTimeout": 120_000,
				"appium:newCommandTimeout": 900,
				"appium:showXcodeLog": true,
			},
			firstMatch: [{}],
		},
	});
	const id = created.sessionId;
	log("session", id);
	const cmd = (method, path, body) => request(method, `/session/${id}${path}`, body);
	let context = null;

	const driver = {
		cmd,
		/** Switches to the page (the newest web view). */
		async web(force = false) {
			if (context === "web" && !force) return;
			for (let attempt = 0; attempt < 60; attempt++) {
				const names = await cmd("GET", "/contexts");
				const view = names.filter((name) => String(name).startsWith("WEBVIEW")).pop();
				if (view) {
					await cmd("POST", "/context", { name: view });
					context = "web";
					return;
				}
				await sleep(1000);
			}
			throw new Error("Safari's web view never appeared among Appium's contexts");
		},
		/** Switches to what XCUITest sees: Safari's bars, the keyboard. */
		async native() {
			if (context === "native") return;
			await cmd("POST", "/context", { name: "NATIVE_APP" });
			context = "native";
		},
		/** Runs `fn` in the page with `args`; it may use the PRELUDE's finders. */
		async js(fn, ...args) {
			const script = `${PRELUDE}\nreturn (${fn}).apply(null, arguments);`;
			await driver.web();
			try {
				return await cmd("POST", "/execute/sync", { script, args });
			} catch (error) {
				// A full page load can leave the old web view behind: find the page again, once.
				if (!/no such window|context|not connected|Inspector|target/i.test(String(error)))
					throw error;
				await sleep(1000);
				await driver.web(true);
				return cmd("POST", "/execute/sync", { script, args });
			}
		},
		/**
		 * Runs an async `fn` in the page and waits for what it resolves to. If the page is replaced
		 * meanwhile (a full load), `lost` is polled instead and its first truthy value returned.
		 */
		async jsAsync(fn, args = [], { timeout = 60_000, lost } = {}) {
			await driver.js(
				`function () { window.__iosSim = null; const args = arguments; Promise.resolve().then(() => (${fn}).apply(null, args)).then((value) => { window.__iosSim = { value: value === undefined ? null : value }; }, (error) => { window.__iosSim = { error: (error && error.errors ? JSON.stringify(error.errors) : "") + " " + String(error) }; }); }`,
				...args,
			);
			const end = Date.now() + timeout;
			while (Date.now() < end) {
				await sleep(500);
				const state = await driver
					.js(() => (window.__iosSim === undefined ? "lost" : window.__iosSim))
					.catch(() => null);
				if (state === "lost") {
					const value = lost ? await driver.js(lost).catch(() => null) : null;
					if (value) return value;
				} else if (state?.error) throw new Error(`in the page: ${state.error}`);
				else if (state) return state.value;
			}
			throw new Error(`The page did not answer within ${timeout} ms: ${String(fn).slice(0, 120)}`);
		},
		/** Polls `fn` in the page until it returns something truthy, which is returned. */
		async waitFor(what, fn, { timeout = 20_000, args = [] } = {}) {
			const end = Date.now() + timeout;
			let last;
			while (Date.now() < end) {
				try {
					const value = await driver.js(fn, ...args);
					if (value) return value;
				} catch (error) {
					last = error;
				}
				await sleep(400);
			}
			throw new Error(`Waited ${timeout} ms for: ${what}${last ? ` (${last.message})` : ""}`);
		},
		/** A full page load. */
		async goto(path) {
			await driver.web();
			await cmd("POST", "/url", { url: path.startsWith("http") ? path : baseURL + path });
			await sleep(1500);
			await driver.web(true);
		},
		url: () => driver.js(() => location.href),
		/** A `mobile:` command of the XCUITest driver (works from either context). */
		mobile: (name, params = {}) =>
			cmd("POST", "/execute/sync", { script: `mobile: ${name}`, args: [params] }),
		/** XCUITest's view of the screen as XML, kept in the logs under `label`. */
		async source(label) {
			await driver.native();
			const xml = await cmd("GET", "/source");
			if (label) writeFileSync(join(outDir, "logs", `source-${label}.xml`), String(xml));
			return String(xml);
		},
		/** The screen in points, as XCUITest reports it. */
		async screen() {
			await driver.native();
			return cmd("GET", "/window/rect");
		},
		/**
		 * A real tap on the element `find` returns in the page. `until` (a page function) says the
		 * tap did its work; each way of tapping is tried until it does:
		 * 1. Appium's own native tap on the web element (it works out where the page sits on screen);
		 * 2. a tap at the element's centre, placed by the web view's frame as XCUITest reports it;
		 * 3. the same, placed by the height Safari's bars leave above the page.
		 * Returns which one worked, for the record.
		 */
		async tap(what, find, { until, args = [], settle = 3000 } = {}) {
			const mark = async () => {
				const target = await driver.waitFor(
					`${what} to be on the page`,
					`function () { const el = (${find}).apply(null, arguments); if (!el) return null; for (const old of document.querySelectorAll("[data-ios-sim]")) old.removeAttribute("data-ios-sim"); el.setAttribute("data-ios-sim", "target"); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, view: viewport() }; }`,
					{ args },
				);
				return target;
			};
			const worked = async () => {
				if (!until) return true;
				const end = Date.now() + settle;
				while (Date.now() < end) {
					if (await driver.js(until, ...args).catch(() => false)) return true;
					await sleep(300);
				}
				return false;
			};
			const ways = [
				[
					"appium-native-web-tap",
					async () => {
						await mark();
						await cmd("POST", "/appium/settings", { settings: { nativeWebTap: true } });
						const found = await cmd("POST", "/element", {
							using: "css selector",
							value: '[data-ios-sim="target"]',
						});
						await cmd("POST", `/element/${found[ELEMENT]}/click`, {});
					},
				],
				[
					"tap-at-web-view-frame",
					async () => {
						const target = await mark();
						const xml = await driver.source();
						const frame = xml.match(/<XCUIElementTypeWebView[^>]*?\sy="(-?\d+)"/);
						const top = frame ? Number(frame[1]) : 0;
						await driver.mobile("tap", {
							x: Math.round(target.x - target.view.offsetLeft),
							y: Math.round(target.y - target.view.offsetTop + top),
						});
					},
				],
				[
					"tap-below-safari-bars",
					async () => {
						const target = await mark();
						const screen = await driver.screen();
						// Safari's address bar is at the bottom (iOS 15 on): above the page is the status bar.
						const top = screen.height >= 800 ? 59 : 20;
						await driver.mobile("tap", {
							x: Math.round(target.x - target.view.offsetLeft),
							y: Math.round(target.y - target.view.offsetTop + top),
						});
					},
				],
			];
			const errors = [];
			for (const [name, run] of ways) {
				try {
					await run();
					if (await worked()) {
						log(`tapped ${what} (${name})`);
						return name;
					}
					errors.push(`${name}: no effect`);
				} catch (error) {
					errors.push(`${name}: ${error.message}`);
				}
			}
			throw new Error(`Could not tap ${what}: ${errors.join("; ")}`);
		},
		/**
		 * What XCUITest sees of the software keyboard: whether it is up, its frame, and its keys and
		 * buttons by name (the return key is a button named for what it does: "Search", "Done").
		 */
		async keyboard(label) {
			let xml = await driver.source(label);
			const part = () => xml.match(/<XCUIElementTypeKeyboard\b[\s\S]*?<\/XCUIElementTypeKeyboard>/);
			let found = part();
			// A new simulator's first keyboard may still open on the "slide to type" introduction.
			if (found && /name="Continue"/.test(found[0])) {
				try {
					const button = await cmd("POST", "/element", {
						using: "accessibility id",
						value: "Continue",
					});
					await cmd("POST", `/element/${button[ELEMENT]}/click`, {});
					await sleep(1000);
					xml = await driver.source(label);
					found = part();
				} catch (error) {
					log("could not dismiss the keyboard introduction:", error.message);
				}
			}
			if (!found) return { present: false, keys: [], buttons: [] };
			const attr = (tag, name) => (tag.match(new RegExp(`\\s${name}="([^"]*)"`)) ?? [])[1];
			const items = [...found[0].matchAll(/<XCUIElementType(Key|Button)\b[^>]*>/g)].map(
				([tag, type]) => ({ type, name: attr(tag, "name"), label: attr(tag, "label") }),
			);
			const open = found[0].match(/<XCUIElementTypeKeyboard\b[^>]*>/)[0];
			return {
				present: true,
				frame: {
					y: Number(attr(open, "y")),
					height: Number(attr(open, "height")),
				},
				keys: items.filter((item) => item.type === "Key").map((item) => item.name ?? item.label),
				buttons: items
					.filter((item) => item.type === "Button")
					.map((item) => item.name ?? item.label),
			};
		},
		/**
		 * Types `text` into whatever has focus, through the simulator's keyboard (never by setting
		 * the field's value from the page). `typed` (a page function) says the text arrived; the
		 * ways of typing are tried in turn until it does. Returns which one worked.
		 */
		async type(text, typed, { args = [], keys = false } = {}) {
			const arrived = async () => {
				const end = Date.now() + 4000;
				while (Date.now() < end) {
					if (await driver.js(typed, ...args).catch(() => false)) return true;
					await sleep(300);
				}
				return false;
			};
			const ways = [
				[
					"keyboard-keys",
					async () => {
						// Key by key on the keyboard's own keys, as a thumb would (lower case and digits).
						await driver.native();
						for (const char of text) {
							const name = char === " " ? "space" : char;
							const find = () =>
								cmd("POST", "/element", {
									using: "-ios class chain",
									value: `**/XCUIElementTypeKeyboard/**/XCUIElementTypeKey[\`name == "${name}"\`]`,
								});
							// After a capital the keyboard redraws its keys in lower case: look again.
							const key = await find()
								.catch(() => sleep(500).then(find))
								.catch(() => sleep(1000).then(find));
							await cmd("POST", `/element/${key[ELEMENT]}/click`, {});
						}
					},
				],
				["mobile-keys", () => driver.mobile("keys", { keys: [...text] })],
				[
					"w3c-key-actions",
					async () => {
						await driver.native();
						await cmd("POST", "/actions", {
							actions: [
								{
									type: "key",
									id: "keyboard",
									actions: [...text].flatMap((value) => [
										{ type: "keyDown", value },
										{ type: "keyUp", value },
									]),
								},
							],
						});
					},
				],
			];
			// Tapping key by key suits the decimal pad (`keys`). On the letter keyboard taps were lost as
			// it changed case after a capital, so there XCUITest types the text through the keyboard.
			if (!keys) ways.push(ways.shift());
			const errors = [];
			for (const [name, run] of ways) {
				try {
					await run();
					if (await arrived()) {
						log(`typed "${text}" (${name})`);
						return name;
					}
					errors.push(`${name}: the text did not arrive`);
				} catch (error) {
					errors.push(`${name}: ${error.message}`);
				}
			}
			throw new Error(`Could not type "${text}": ${errors.join("; ")}`);
		},
		/** A finger dragged across the screen, in points, by XCUITest (a real gesture to Safari). */
		async drag(from, to, { ms = 350, hold = 60, steps = 1 } = {}) {
			await driver.native();
			await cmd("POST", "/actions", {
				actions: [
					{
						type: "pointer",
						id: "finger",
						parameters: { pointerType: "touch" },
						actions: [
							{ type: "pointerMove", duration: 0, x: from.x, y: from.y },
							{ type: "pointerDown", button: 0 },
							{ type: "pause", duration: hold },
							...Array.from({ length: steps }, (_, step) => ({
								type: "pointerMove",
								duration: Math.round(ms / steps),
								x: Math.round(from.x + ((to.x - from.x) * (step + 1)) / steps),
								y: Math.round(from.y + ((to.y - from.y) * (step + 1)) / steps),
							})),
							{ type: "pointerUp", button: 0 },
						],
					},
				],
			});
			await cmd("DELETE", "/actions").catch(() => {});
		},
		async quit() {
			await request("DELETE", `/session/${id}`).catch(() => {});
		},
	};
	await driver.web(true);
	return driver;
}

// ---------------------------------------------------------------------------------------------
// Signing in, as E2E does: a pooled test Parent of Clerk's development instance

function devVars() {
	const vars = { ...process.env };
	const file = process.env.DEV_VARS ?? "../.dev.vars";
	if (existsSync(file)) {
		for (const line of readFileSync(file, "utf8").split("\n")) {
			const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
			if (match) vars[match[1]] ??= match[2].trim();
		}
	}
	return vars;
}

// The sign-in ticket (used once, good for two minutes) and Clerk's testing token pass through
// Appium, whose log is uploaded from a public repo: `redactLogs` takes them out of it.
const shortLived = [];

/** Removes this run's short-lived Clerk tokens from the logs before they are uploaded. */
export function redactLogs() {
	const dir = join(outDir, "logs");
	for (const name of readdirSync(dir)) {
		try {
			const text = readFileSync(join(dir, name), "utf8");
			let clean = text;
			for (const secret of shortLived) clean = clean.replaceAll(secret, "[redacted]");
			if (clean !== text) writeFileSync(join(dir, name), clean);
		} catch (error) {
			log("could not redact", name, String(error));
		}
	}
}

async function clerkApi(path, body) {
	const secret = devVars().CLERK_SECRET_KEY;
	if (!secret) throw new Error("CLERK_SECRET_KEY is required (apps/web/.dev.vars)");
	if (!secret.startsWith("sk_test_"))
		throw new Error("Only a Clerk development key (sk_test_…) may be used here");
	for (let attempt = 1; ; attempt++) {
		const response = await fetch(`https://api.clerk.com/v1${path}`, {
			method: body ? "POST" : "GET",
			headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
			body: body ? JSON.stringify(body) : undefined,
		});
		if (response.ok) return response.json();
		if ((response.status === 429 || response.status >= 500) && attempt < 5) {
			await sleep(1000 * 2 ** attempt);
			continue;
		}
		throw new Error(`Clerk ${path}: ${response.status} ${(await response.text()).slice(0, 300)}`);
	}
}

/**
 * Signs the pooled test Parent `email` in on Safari's sign-in page with a Clerk sign-in token (the
 * same ticket `clerk.signIn` of @clerk/testing uses in E2E). The user is looked up and made only
 * when missing, and never deleted, like E2E's pool (e2e/parents.ts).
 */
export async function signIn(driver, email) {
	const users = await clerkApi(`/users?email_address=${encodeURIComponent(email)}`);
	const user =
		users[0] ??
		(await clerkApi("/users", {
			email_address: [email],
			password: `Noodle-${crypto.randomUUID()}!`,
			first_name: "Alex",
			skip_password_checks: true,
		}));
	const { token: ticket } = await clerkApi("/sign_in_tokens", {
		user_id: user.id,
		expires_in_seconds: 120,
	});
	const { token: testing } = await clerkApi("/testing_tokens", {});
	shortLived.push(ticket, testing);
	await driver.waitFor("Clerk to load on the sign-in page", () => !!window.Clerk?.loaded, {
		timeout: 60_000,
	});
	const outcome = await driver.jsAsync(
		async (ticket, testing) => {
			const clerk = window.Clerk;
			// Clerk's bot check is passed with a testing token on each request to its Frontend API,
			// which @clerk/testing adds by intercepting requests; here the page's fetch adds it.
			const fetchPage = window.fetch.bind(window);
			window.fetch = (input, init) => {
				try {
					const url = new URL(typeof input === "string" ? input : (input.url ?? String(input)));
					if (url.host === clerk.frontendApi && !url.searchParams.has("__clerk_testing_token")) {
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
			const attempt = await clerk.client.signIn.create({ strategy: "ticket", ticket });
			await clerk.setActive({ session: attempt.createdSessionId });
			return "signed in";
		},
		[ticket, testing],
		{ lost: () => (window.Clerk?.user ? "signed in (page reloaded)" : null) },
	);
	log(outcome, "as", email);
	return user.id;
}
