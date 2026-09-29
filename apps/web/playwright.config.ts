import { defineConfig, devices } from "@playwright/test";
import { config } from "dotenv";

// Clerk keys live in .dev.vars (read by wrangler for the Worker); load them for the test runner too.
config({ path: ".dev.vars", quiet: true });

// Matches vite.config.ts: set PORT to run a second checkout's E2E alongside this one.
const port = Number(process.env.PORT ?? 5173);

export default defineConfig({
	testDir: "./e2e",
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 1 : 0,
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
		},
	],
	webServer: {
		command: "bun run db:migrate:local && bun run dev",
		// Ask answers with its deterministic fake, never the live model (see vite.config.ts).
		env: { ASK_MODEL: "stub" },
		url: `http://localhost:${port}`,
		reuseExistingServer: !process.env.CI,
		timeout: 120_000,
	},
});
