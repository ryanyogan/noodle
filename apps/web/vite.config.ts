import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// ASK_MODEL=stub answers Ask with a deterministic fake instead of Workers AI (E2E runs set it).
// Workers AI is the Worker's only remote binding, so the dev server then needs no Cloudflare
// account at all. Production builds never set it.
const askStub = process.env.ASK_MODEL === "stub";

export default defineConfig({
	// PORT lets several checkouts (git worktrees) run the app and its E2E side by side.
	server: { port: Number(process.env.PORT ?? 5173), strictPort: true },
	define: { __ASK_STUB__: JSON.stringify(askStub) },
	plugins: [
		cloudflare({
			viteEnvironment: { name: "ssr" },
			remoteBindings: !askStub,
			// Every dev server wants the Workers inspector on 9229; a checkout on its own PORT
			// (a parallel worktree) goes without it so it can start alongside the others.
			inspectorPort: process.env.PORT ? false : undefined,
		}),
		tanstackStart(),
		react(),
		tailwindcss(),
	],
});
