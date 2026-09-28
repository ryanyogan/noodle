# Cloudflare as the only runtime platform

The app runs entirely on Cloudflare: TanStack Start on Workers, D1 for data, R2 for statement files, Queues and Workflows for Imports and nightly Insight generation, Cron Triggers for schedules, and AI Gateway in front of all model calls. Auth is Clerk and bank data is Plaid (later); nothing else is self-hosted. Chosen for a single deploy target, low cost at household scale, and SSR close to the user; the trade-off is D1's SQLite constraints (see ADR-0004).
