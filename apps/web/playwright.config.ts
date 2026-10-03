import { defineConfig, devices } from "@playwright/test";
import { config } from "dotenv";

// Clerk keys live in .dev.vars (read by wrangler for the Worker); load them for the test runner too.
config({ path: ".dev.vars", quiet: true });

// Matches vite.config.ts: set PORT to run a second checkout's E2E alongside this one.
const port = Number(process.env.PORT ?? 5173);

/**
 * Phone tests: every test in a phone-*.spec.ts or sheet-phone.spec.ts file, and any other test
 * tagged `@phone` (`test("…", { tag: "@phone" }, …)`). Playwright matches `grep` against the
 * project name, file name, describe and test titles, and tags joined by spaces.
 */
const phoneTests = /\b(phone-[\w-]+|sheet-phone)\.spec\.ts|@phone\b/;

export default defineConfig({
	testDir: "./e2e",
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 1 : 0,
	// A CI runner is several times slower than a laptop; specs with two Parents ran past 30 s there.
	timeout: process.env.CI ? 60_000 : 30_000,
	reporter: process.env.CI ? "github" : "list",
	use: {
		baseURL: `http://localhost:${port}`,
		trace: "retain-on-failure",
	},
	expect: {
		// Absorbs anti-aliasing differences between machines, not layout changes.
		toHaveScreenshot: { maxDiffPixelRatio: 0.01, animations: "disabled", caret: "hide" },
	},
	projects: [
		{ name: "setup", testMatch: /global\.setup\.ts/ },
		{
			name: "chromium",
			use: { ...devices["Desktop Chrome"] },
			dependencies: ["setup"],
			grepInvert: phoneTests,
		},
		// The phone tests run on both engines: Chromium with iPhone 15 metrics, and WebKit (the
		// engine inside Mobile Safari) with Playwright's iPhone descriptors. Tests that open their
		// own context with `browser.newContext({ ...phone })` get this project's browser too.
		{
			name: "chromium-mobile",
			use: { ...devices["iPhone 15"], defaultBrowserType: "chromium" },
			dependencies: ["setup"],
			grep: phoneTests,
		},
		{
			name: "webkit-iphone",
			use: { ...devices["iPhone 15"] },
			dependencies: ["setup"],
			grep: phoneTests,
		},
		// The smallest iPhone still sold second-hand: only the checks that depend on screen size.
		{
			name: "webkit-iphone-se",
			use: { ...devices["iPhone SE"] },
			dependencies: ["setup"],
			grep: /\bphone-(keyboard|no-zoom)\.spec\.ts/,
		},
	],
	webServer: {
		command: "bun run db:migrate:local && bun run dev",
		// Ask answers with its deterministic fake, never the live model (see vite.config.ts).
		env: { AI_MODEL: "stub" },
		url: `http://localhost:${port}`,
		reuseExistingServer: !process.env.CI,
		timeout: 120_000,
	},
});
