import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Unit tests for the app's pure modules; the Worker and UI are covered by Playwright E2E.
export default defineConfig({
	resolve: {
		// Server functions are only defined, never run, when a test imports the queries using them.
		alias: {
			"cloudflare:workers": fileURLToPath(
				new URL("./src/test/cloudflare-workers.ts", import.meta.url),
			),
		},
	},
	test: { include: ["src/**/*.test.ts"] },
});
