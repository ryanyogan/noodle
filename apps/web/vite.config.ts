import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
	// PORT lets several checkouts (git worktrees) run the app and its E2E side by side.
	server: { port: Number(process.env.PORT ?? 5173), strictPort: true },
	plugins: [
		cloudflare({
			viteEnvironment: { name: "ssr" },
			// Every dev server wants the Workers inspector on 9229; a checkout on its own PORT
			// (a parallel worktree) goes without it so it can start alongside the others.
			inspectorPort: process.env.PORT ? false : undefined,
		}),
		tanstackStart(),
		react(),
		tailwindcss(),
	],
});
