import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isDocsPath } from "./docs-path";

describe("isDocsPath", () => {
	it("is true for the Docs' front page and for an article", () => {
		expect(isDocsPath("/docs")).toBe(true);
		expect(isDocsPath("/docs/how-to-budget")).toBe(true);
		expect(isDocsPath("/docs/this-month")).toBe(true);
		expect(isDocsPath("/docs/top10")).toBe(true);
		// One closing slash is the same page: the build asks for the front page as /docs/.
		expect(isDocsPath("/docs/")).toBe(true);
		expect(isDocsPath("/docs/how-to-budget/")).toBe(true);
	});

	it("is true for every article there is", () => {
		const slugs = readdirSync(new URL("./docs/articles", import.meta.url))
			.filter((file) => file.endsWith(".md"))
			.map((file) => file.slice(0, -3));
		expect(slugs.length).toBeGreaterThan(0);
		for (const slug of slugs) expect(isDocsPath(`/docs/${slug}`), slug).toBe(true);
	});

	it.each([
		"/",
		"",
		"/month",
		"/month/2026-10",
		"/docsx",
		"/docs-private",
		"/docs.html",
		"/Docs",
		"/docs//",
		"/docs/how-to-budget//",
		"/docs/How-To",
		"/docs/a/b",
		"/docs/..",
		"/docs/../month/2026-10",
		"/docs/..%2Fmonth",
		"/docs/%2e%2e/month/2026-10",
		"/docs%2Fhow-to-budget",
		"/docs/how-to-budget%2F..%2F..%2Fmonth",
		"/docs/how-to-budget/../../month",
		"/docs/-",
		"/docs/a--b",
		"/docs/a b",
		"/docs/a\\b",
		"/docs/a?x=1",
		"/docs/a#b",
		"/docs\n/month",
		"/docs/a\n",
		"/x/docs",
		"//docs",
		"/_serverFn/docs",
		"/api/docs",
		"https://noodle.yogan.dev/docs",
		"/sign-in",
		"/plan/2026-10",
		"/household",
		"/glossary",
	])("is false for %j", (pathname) => {
		expect(isDocsPath(pathname)).toBe(false);
	});

	it("matches no page of the signed-in app", () => {
		// Every route file under _authed, as the address it answers to (a `$param` filled in).
		const routes = readdirSync(new URL("./routes/_authed", import.meta.url), { recursive: true })
			.map(String)
			.filter((file) => file.endsWith(".tsx"));
		expect(routes.length).toBeGreaterThan(10);
		for (const file of routes) {
			const path = `/${file
				.replace(/\.tsx$/, "")
				.split(/[/.]/)
				.filter((part) => !part.startsWith("_") && part !== "index")
				.map((part) => (part.startsWith("$") ? "docs" : part))
				.join("/")}`;
			expect(isDocsPath(path), path).toBe(false);
		}
	});
});
