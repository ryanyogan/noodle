import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { defineConfig } from "vite";

// AI_MODEL=stub runs Ask and categorization on deterministic fakes instead of Workers AI and
// Vectorize (E2E runs set it). Those are the Worker's only remote bindings, so the dev server then
// needs no Cloudflare account at all. Production builds never set it.
const aiStub = process.env.AI_MODEL === "stub";

// DEV_TLS_CERT and DEV_TLS_KEY (PEM file paths) serve the dev server over https. The WebKit E2E
// projects need it: Playwright's WebKit on Linux treats http://localhost as insecure and drops the
// Secure cookies Clerk's dev instance sets (`__client_uat`), so sign-in never completes there.
const tls =
	process.env.DEV_TLS_CERT && process.env.DEV_TLS_KEY
		? { cert: readFileSync(process.env.DEV_TLS_CERT), key: readFileSync(process.env.DEV_TLS_KEY) }
		: undefined;

export default defineConfig({
	// PORT lets several checkouts (git worktrees) run the app and its E2E side by side.
	server: { port: Number(process.env.PORT ?? 5173), strictPort: true, https: tls },
	define: { __AI_STUB__: JSON.stringify(aiStub) },
	plugins: [
		cloudflare({
			viteEnvironment: { name: "ssr" },
			remoteBindings: !aiStub,
			// Every dev server wants the Workers inspector on 9229; a checkout on its own PORT
			// (a parallel worktree) goes without it so it can start alongside the others.
			inspectorPort: process.env.PORT ? false : undefined,
		}),
		tanstackStart(),
		react(),
		tailwindcss(),
	],
});
