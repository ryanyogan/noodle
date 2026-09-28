# Noodle

Household budgeting for a two-parent, two-child US family. Domain language: `CONTEXT.md`. Decisions: `docs/adr/`.

## Layout

| Path | What |
| --- | --- |
| `apps/web` | TanStack Start app on Cloudflare Workers (D1, Clerk) |
| `packages/domain` | Pure money math, no I/O (Vitest, Seam 1) |
| `packages/db` | Drizzle schema, migrations (`drizzle/`), Household-scoped queries |
| `packages/ui`, `ai`, `ingest` | Empty until their tickets |

## Develop

```sh
bun install
clerk link && (cd apps/web && clerk env pull --file .dev.vars)   # or copy .dev.vars.example
(cd apps/web && bun run db:migrate:local && bun run dev)          # http://localhost:5173
```

Checks: `bun run typecheck`, `bun run lint`, `bun run test` (unit), `cd apps/web && bun run e2e` (Playwright against a local Worker + local D1; creates and deletes a throwaway Clerk user per test).

Schema changes: edit `packages/db/src/schema.ts`, then `cd packages/db && bun run db:generate`, then apply with `db:migrate:local` / `db:migrate:remote` in `apps/web`.

## Deploy

The Worker is `noodle` (https://noodle.ryanyogan.workers.dev) with D1 database `noodle`. CI deploys on push to `main` after checks pass.

One-time setup, not automated:

- Worker secrets: `wrangler secret put CLERK_SECRET_KEY` and `wrangler secret put VITE_CLERK_PUBLISHABLE_KEY` (run in `apps/web`). Without them every request returns 500.
- GitHub Actions secrets: `CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` (Clerk dev instance, for E2E), `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` (for deploy).

## Verified versions (2026-09-28)

Checked against npm and package typings when scaffolding: `@tanstack/react-start` 1.168.59, `@tanstack/react-router` 1.170.40, `@clerk/tanstack-react-start` 1.6.1, `@clerk/testing` 2.2.39, `drizzle-orm` 0.45.3 / `drizzle-kit` 0.31.11, `@cloudflare/vite-plugin` 1.62.0 (must match `wrangler` 4.143.0), Vite 8. TypeScript is pinned to 6.0.3 rather than 7 until the native compiler is confirmed to work with drizzle-kit and the router generator. Server functions use `.validator()` (`.inputValidator()` is deprecated).

Still to verify, from the spec: React Compiler, Start's automatic route code-splitting, TanStack Virtual, Smart Placement, D1 read replication, the iOS Wallet Shortcut trigger.
