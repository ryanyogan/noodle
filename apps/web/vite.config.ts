import { readdirSync } from "node:fs";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { isDocsPath } from "./src/docs-path";

// AI_MODEL=stub runs Ask and categorization on deterministic fakes instead of Workers AI and
// Vectorize (E2E runs set it). Those are the Worker's only remote bindings, so the dev server then
// needs no Cloudflare account at all. Production builds never set it.
const aiStub = process.env.AI_MODEL === "stub";

// Names this build (issue 140): the same in the Worker and in the page's own script, so an open
// page can tell that a newer one was deployed (src/build-id.ts). The commit where CI builds and
// deploys; anywhere else the moment the build (or the dev server) started.
const buildId = process.env.GITHUB_SHA?.slice(0, 12) ?? `local-${Date.now().toString(36)}`;

// The Docs (issue 126) are built ahead of time: a build renders /docs and each article once and
// writes the HTML beside the client's files (docs.html, docs/<slug>.html), which the Worker's
// static assets answer with before any code runs. To render them the build starts the built Worker
// locally for a moment (TanStack Start sets TSS_PRERENDERING); it then needs no Cloudflare account
// (the remote bindings stay off: the Docs use none), no Clerk keys (start.ts) and no inspector port.
const prerendering = process.env.TSS_PRERENDERING === "true";
const docsPages = [
	"/docs",
	...readdirSync(new URL("./src/docs/articles", import.meta.url))
		.filter((file) => file.endsWith(".md"))
		.map((file) => `/docs/${file.slice(0, -3)}`),
].map((path) => ({ path }));

export default defineConfig({
	// PORT lets several checkouts (git worktrees) run the app and its E2E side by side.
	server: { port: Number(process.env.PORT ?? 5173), strictPort: true },
	// `vite preview` serves the built Worker locally; CI's E2E runs against it (E2E_SERVER=build).
	// While a build renders the Docs it listens on 127.0.0.1, where the build then asks for them:
	// "localhost" was IPv6 alone in CI's Playwright image, and the build's requests were refused.
	preview: {
		port: Number(process.env.PORT ?? 5173),
		strictPort: true,
		host: prerendering ? "127.0.0.1" : undefined,
	},
	define: { __AI_STUB__: JSON.stringify(aiStub), __BUILD_ID__: JSON.stringify(buildId) },
	plugins: [
		cloudflare({
			viteEnvironment: { name: "ssr" },
			remoteBindings: !aiStub && !prerendering,
			// Every dev server wants the Workers inspector on 9229; a checkout on its own PORT
			// (a parallel worktree) goes without it so it can start alongside the others.
			inspectorPort: process.env.PORT || prerendering ? false : undefined,
		}),
		tanstackStart({
			pages: docsPages,
			prerender: {
				enabled: true,
				// Only the Docs, and only the pages listed: nothing found by following links, nothing of
				// the app. A page that fails to render fails the build.
				filter: (page) => isDocsPath(page.path),
				autoStaticPathsDiscovery: false,
				crawlLinks: false,
				failOnError: true,
				// docs/<slug>.html, not docs/<slug>/index.html: the address has no trailing slash.
				autoSubfolderIndex: false,
			},
			// A build's server function ids are hashes; E2E finds calls by the function's name
			// (e2e/session.ts serverFn), as the dev server's ids allow. So the test build (AI_MODEL=stub)
			// names them the same way; production keeps the hashes.
			serverFns: aiStub
				? {
						generateFunctionId: ({ filename, functionName }) =>
							Buffer.from(JSON.stringify({ file: filename, export: functionName })).toString(
								"base64url",
							),
					}
				: undefined,
		}),
		react(),
		tailwindcss(),
	],
});
