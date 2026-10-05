import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// E2E's dev-only routes (/api/dev/…: a Household in one request, SQL, the reset that hands a
// reused test Parent to the next test, #108) must not exist in production. They are reachable
// only where `__AI_STUB__` is true, and that is true only for a build made with AI_MODEL=stub;
// the bundler then drops them (CI's "Production build has no dev-only routes" greps the build).

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const server = read("../server.ts");

describe("dev-only routes", () => {
	it("are each answered only behind __AI_STUB__", () => {
		const imported = [...server.matchAll(/\b(DEV_[A-Z_]+_PATH)\b/g)].map((match) => match[1]);
		const names = [...new Set(imported)];
		expect(names).toContain("DEV_RESET_HOUSEHOLD_PATH");
		expect(names).toContain("DEV_SQL_PATH");
		for (const name of names) {
			const uses = [...server.matchAll(new RegExp(`^.*pathname === ${name}\\b.*$`, "gm"))];
			expect(uses.length, `${name} is routed once`).toBe(1);
			expect(uses[0]?.[0].trim(), name).toMatch(
				new RegExp(`^if \\(__AI_STUB__ && pathname === ${name}\\)`),
			);
		}
		// No dev handler is reachable some other way.
		const handlers = [...server.matchAll(/return (handleDev\w+)\(request\)/g)];
		expect(handlers.length).toBe(names.length);
	});

	it("__AI_STUB__ is true only when the build is made with AI_MODEL=stub", () => {
		const config = read("../../vite.config.ts");
		expect(config).toMatch(/const aiStub = process\.env\.AI_MODEL === "stub";/);
		expect(config).toContain("define: { __AI_STUB__: JSON.stringify(aiStub) }");
		// Production's own variables never set it.
		expect(read("../../wrangler.jsonc")).not.toMatch(/AI_MODEL"?\s*:\s*"stub"/);
	});
});
