# The Household Agent starts as a plain Durable Object

ADR-0007 makes one Household Agent per Household the real-time hub. For now it is a plain Durable Object (`HouseholdAgent` in `apps/web/src/server/household-agent.ts`) using the WebSocket Hibernation API, not the Cloudflare Agents SDK (`agents`). Its only job today is to accept screens' WebSockets and broadcast change keys, which is a few lines on `DurableObject`; the SDK would add a dependency, its own URL routing, and a client protocol (state sync, RPC frames) that we would have to filter out. It is SQLite-backed, as Agents SDK classes must be, so it can become an `Agent` subclass under the same class name when it takes on schedules, forwarded email, or "Ask".

The Worker authenticates the WebSocket upgrade itself, in the custom server entry (`apps/web/src/server.ts`) before TanStack Start: it checks the request's Origin, verifies the Clerk session cookie, and picks the Household from that Parent's membership, never from the request, so a Parent can only join their own Household's Agent.

## Consequences

- The class is declared with Wrangler's `exports` field (storage `sqlite`), not the legacy `migrations` array; once deployed that way, the Worker can't go back to `migrations`.
- Writes call `notifyHousehold(householdId, changes)` after D1 commits. It awaits the Agent so the broadcast goes out before the writer hears back, and swallows failures: a missed broadcast never fails a write, and a screen catches up on its next read or reconnect.
- Screens ping every 25 seconds (answered by the runtime's auto-response without waking the Agent) to detect sockets phones drop silently, and refetch everything after reconnecting.
