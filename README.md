# Noodle

Household budgeting for a two-parent, two-child US family. Domain language: `CONTEXT.md`. Decisions: `docs/adr/`.

## Layout

| Path | What |
| --- | --- |
| `apps/web` | TanStack Start app on Cloudflare Workers (D1, Clerk) |
| `packages/domain` | Pure money math, no I/O (Vitest, Seam 1) |
| `packages/db` | Drizzle schema, migrations (`drizzle/`), Household-scoped queries |
| `packages/ui` | Design tokens (`src/styles/globals.css`), Geist, restyled shadcn primitives and shared components (ADR-0008) |
| `packages/ai`, `ingest` | Empty until their tickets |

## Develop

```sh
bun install
clerk link && (cd apps/web && clerk env pull --file .dev.vars)   # or copy .dev.vars.example
(cd apps/web && bun run db:migrate:local && bun run dev)          # http://localhost:5173
```

Seed data: `cd apps/web && bun run seed <fresh|starter|busy>` replaces the local D1 with a just-created Household, one two weeks in, or eight months of heavy use, and prints the Parent logins. It never touches remote D1. See `docs/seed-data.md` for what each scenario holds and how to sign in.

Checks: `bun run typecheck`, `bun run lint`, `bun run test` (unit), `cd apps/web && bun run e2e` (Playwright against a local Worker + local D1; creates and deletes a throwaway Clerk user per test). The E2E suite includes screenshot tests of the app shell; after an intentional visual change, run `bun run e2e --update-snapshots` and review the new images before committing.

UI components: add shadcn components with `bunx shadcn@4.21.0 add <name> -c packages/ui`, then restyle them to the tokens. The CLI once resolved the `#lib/utils` alias to an npm package called `cn`, so check the imports it writes.

Schema changes: edit `packages/db/src/schema.ts`, then `cd packages/db && bun run db:generate`, then apply with `db:migrate:local` / `db:migrate:remote` in `apps/web`.

## Deploy

The Worker is `noodle` (https://noodle.yogan.dev, also at https://noodle.ryanyogan.workers.dev) with D1 database `noodle`. CI deploys on push to `main` after checks pass.

One-time setup, not automated:

- Worker secrets: `wrangler secret put CLERK_SECRET_KEY` and `wrangler secret put VITE_CLERK_PUBLISHABLE_KEY` (run in `apps/web`). Without them every request returns 500.
- Bank Connections (Plaid, ADR-0017): `wrangler secret put` `PLAID_CLIENT_ID`, `PLAID_SECRET` and `BANK_CONNECTION_KEY` (`openssl rand -base64 32`). `PLAID_ENV` in `wrangler.jsonc` is `"sandbox"`, and `PLAID_SECRET` is the Sandbox secret. To move to Plaid's Trial plan (production), set `PLAID_ENV` to `"production"` and replace `PLAID_SECRET` with the production secret. Without the three secrets the Accounts page says Plaid isn't set up. Local development and E2E use Sandbox or the fake Plaid.
- GitHub Actions secrets: `VITE_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` (Clerk dev instance, for E2E; `gh secret set -f apps/web/.dev.vars` sets both), `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` (for deploy).

## Verified versions (2026-09-28)

Checked against npm and package typings when scaffolding: `@tanstack/react-start` 1.168.59, `@tanstack/react-router` 1.170.40, `@clerk/tanstack-react-start` 1.6.1, `@clerk/testing` 2.2.39, `drizzle-orm` 0.45.3 / `drizzle-kit` 0.31.11, `@cloudflare/vite-plugin` 1.62.0 (must match `wrangler` 4.143.0), Vite 8, Tailwind CSS 4.3.3 (`@tailwindcss/vite`), shadcn 4.21.0 (`radix-nova` style). TypeScript is pinned to 6.0.3 rather than 7 until the native compiler is confirmed to work with drizzle-kit and the router generator. Server functions use `.validator()` (`.inputValidator()` is deprecated).

Still to verify, from the spec: React Compiler, Start's automatic route code-splitting, TanStack Virtual, Smart Placement, D1 read replication, the iOS Wallet Shortcut trigger.
