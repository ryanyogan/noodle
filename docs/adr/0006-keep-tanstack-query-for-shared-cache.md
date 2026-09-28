# Keep TanStack Query alongside router loaders

TanStack Router's built-in loader cache was considered on its own and rejected. Its documented limits — no shared cache between routes, only coarse invalidation, and no cache-level optimistic updates — clash with how this app works. One Quick Add must immediately update the Bucket meter, Free to Spend, the month list, and the Child totals, which may be on different routes or on the screen underneath an open sheet. Loaders therefore only *prefetch* into a per-request QueryClient (`ensureQueryData` for critical data, un-awaited `prefetchQuery` for streamed data), components read with `useSuspenseQuery`, and mutations apply optimistic edits to the Query cache and roll back on error. `@tanstack/react-router-ssr-query` handles SSR dehydration and streaming.

## Consequences

- Optimistic cache edits reuse the same `packages/domain` functions as the server, so the optimistic number equals the confirmed one.
- Records get their IDs on the client (ULIDs) and double as idempotency keys, so a retried or double-tapped Quick Add creates one Transaction.
- React's `useOptimistic` is used only for state local to one component, never for data another screen shows.
