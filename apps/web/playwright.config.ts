import { defineConfig, devices } from "@playwright/test";
import { config } from "dotenv";

// Clerk keys live in .dev.vars (read by wrangler for the Worker); load them for the test runner too.
config({ path: ".dev.vars", quiet: true });

// Matches vite.config.ts: set PORT to run a second checkout's E2E alongside this one.
const port = Number(process.env.PORT ?? 5173);

/**
 * E2E_SERVER=build (CI, and `bun run e2e:build`) serves the Worker already built with
 * `AI_MODEL=stub vite build` through `vite preview`: pages are ready, not compiled on demand, so
 * several workers can share it. Otherwise the tests start (or reuse) the Vite dev server.
 */
const againstBuild = process.env.E2E_SERVER === "build";

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
	// CI also writes every test's time as JSON; the workflow lists the slowest 20 in the job summary.
	reporter: process.env.CI
		? [["github"], ["json", { outputFile: "playwright-report/report.json" }]]
		: "list",
	use: {
		baseURL: `http://localhost:${port}`,
		trace: "retain-on-failure",
	},
	expect: {
		// Absorbs anti-aliasing noise between runs, not a change of layout or of palette (#73).
		// `threshold` is how far one pixel's colour may be off before it counts as different:
		// Playwright's default 0.2 let the whole Soft stone palette pass against Warm paper pictures.
		// `maxDiffPixelRatio` is how many such pixels may differ: 0.2% of the picture.
		toHaveScreenshot: {
			threshold: 0.05,
			maxDiffPixelRatio: 0.002,
			animations: "disabled",
			caret: "hide",
		},
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
		command: `bun run db:migrate:local && bun run ${againstBuild ? "preview" : "dev"}`,
		// Ask answers with its deterministic fake, never the live model (see vite.config.ts).
		env: { AI_MODEL: "stub" },
		url: `http://localhost:${port}`,
		reuseExistingServer: !process.env.CI,
		timeout: 120_000,
	},
});
