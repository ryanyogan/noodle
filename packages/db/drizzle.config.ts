import { defineConfig } from "drizzle-kit";

// Only `generate` is used; migrations are applied with `wrangler d1 migrations apply`.
export default defineConfig({
	schema: "./src/schema.ts",
	out: "./drizzle",
	dialect: "sqlite",
});
