# Workers AI through AI Gateway, with tools that do the math, for Ask

Ask calls Workers AI through the Worker's `AI` binding, routed through AI Gateway id `default` (Cloudflare creates it on the first request; a named gateway needs dashboard scope the deploy token doesn't have). That keeps every model call on the one platform (ADR-0005) with no model vendor, API key or second bill. Every request sets `collectLog: false`: gateway logs are visible to anyone on the Cloudflare account, and must never hold a Parent's questions about their own Personal Allowance (ADR-0003). Models are chosen per job in `packages/ai/src/models.ts` (`AI_MODELS`), never inline.

Models never compute money. Ask offers the model six tools (month overview, spending, Goals, Affordability Check, and a Scenario of a Bucket allowance or of a Commitment ended or changed); each computes exact figures with `@noodle/domain` from reads made for the asking Parent as the Viewer, so the other Parent's Personal Allowance reaches the model only as totals, and imported Transactions count once assigned (unassigned ones are only mentioned). The model picks tools and phrases what they return; the page shows the tools' figures under the answer as they are, with links to the screens that hold them; a Scenario tool's link is a Lever preset built in code, so "Try in Explore" opens exactly the change the tool projected. This lets Ask use a cheap, fast model and still be exact; the trade-off is that questions the tools can't express get "I can't see that" rather than a clever guess.

Ask is a stateless streaming server function (an async-generator `createServerFn`), not a method on the Household Agent as ADR-0007 first said: one Parent's question needs no fan-out, no socket and no schedule, and the page keeps this visit's turns and sends the last few back for follow-ups. It moves to the Agent if Ask ever keeps history or runs on a schedule. E2E and unit tests run a deterministic fake model (`ASK_MODEL=stub`), so CI needs no Cloudflare account.

## Model per job

| Job | Model | Why |
| --- | --- | --- |
| `chat`: Ask, Check-in phrasing | `@cf/zai-org/glm-5.3-flash` | Fast function calling, cheap, cached input ($0.15/$0.50 per M) |
| `classify`: categorization, Receipt line items (text and photos) | `@cf/google/gemma-4-26b-a4b-it` | High volume, short JSON; MoE with 4B active ($0.10/$0.30 per M) |
| `reason`: Insights, Perk research, Plan drafting | `@cf/openai/gpt-oss-120b` | Nightly or one-off, latency doesn't matter; strongest reasoning at mid price ($0.35/$0.75 per M) |
| `embed`: merchant similarity (Vectorize) | `@cf/qwen/qwen3-embedding-0.6b` | $0.012 per M |
| `speech`: Snap and speak, voice | `@cf/openai/whisper-large-v3-turbo` | Voice capture |
| `vision`: Snap and speak, receipt photos | `@cf/meta/llama-4-scout-17b-16e-instruct` | Vision with function calling |

Frontier-priced models (glm-5.3, kimi-k2.x, deepseek-v4-pro) aren't used: with the math in tools, the extra reasoning buys little for a household budget and costs several times as much per answer.
