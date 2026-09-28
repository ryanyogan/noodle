import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
	// PORT lets several checkouts (git worktrees) run the app and its E2E side by side.
	server: { port: Number(process.env.PORT ?? 5173), strictPort: true },
	plugins: [
		cloudflare({ viteEnvironment: { name: "ssr" } }),
		tanstackStart(),
		react(),
		tailwindcss(),
	],
});
