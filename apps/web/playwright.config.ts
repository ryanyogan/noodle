import { defineConfig, devices } from "@playwright/test";
import { config } from "dotenv";

// Clerk keys live in .dev.vars (read by wrangler for the Worker); load them for the test runner too.
config({ path: ".dev.vars", quiet: true });

const port = 5173;

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
		url: `http://localhost:${port}`,
		reuseExistingServer: !process.env.CI,
		timeout: 120_000,
	},
});
