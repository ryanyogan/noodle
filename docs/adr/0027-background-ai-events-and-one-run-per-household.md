# Background AI: events from every write, coalesced into one run per Household

Filing used to run once, at the moment an Import or Quick Add landed (a `waitUntil` after the upload, or a step in the Import Workflow), and "Look again" ran only after a Bucket was added. Other changes that should re-check Review (a Bucket renamed or archived, a Rule added, a new month) did nothing, and each source called the model on its own (#58). Now every write that background AI may care about sends one small event, and each Household's Agent turns a burst of them into one run.

**Events.** `queueAi(event)` in apps/web/src/server/ai-queue.ts sends `{ householdId, kind, memberId?, ids? }` to the Household's Agent over RPC. It holds IDs only, never merchants or amounts, and never fails the write that sent it. The kinds (`AI_EVENT_KINDS` in ai-coalescer.ts) and their sources:

- `imported` (Import IDs): a statement upload (imports.ts) and a bank sync (the Import Workflow's categorize step now just sends this).
- `captured` (Transaction IDs): a Quick Add from Wallet (capture.ts) and a forwarded receipt (receipt-worker.ts).
- `buckets-changed`: a Bucket or Personal Allowance added, renamed or archived (plan.ts).
- `rule-added`: a Rule saved or edited (review.ts).
- `commitment-changed` (Commitment IDs): added, changed or ended (commitments.ts). Nothing to file yet; later steps spot Commitments.
- `filed-by-hand` (Transaction IDs): a Parent filed or corrected a Transaction (afterAssignment). The merchant is still learned at once, as before; the event is the learning signal for later steps.
- `month-started` (the month): sent by the month-close cron for each Household, taken once per month however often the hourly cron sends it.

`memberId` is the Parent who did it. Their Imports and captures are filed in their view only.

**The coalescer.** `AiCoalescer` (ai-coalescer.ts) lives in the `HouseholdAgent` Durable Object and keeps what's held in its storage (`ai:held`), so it survives eviction. The first event starts a window; each later one pushes the run back to the window after it, up to a cap after the first. Defaults (`COALESCE`): 60 s window, 3 minutes once the batch is big (5 or more Imports and captures, as in a bank sync or Setup), never more than 10 minutes after the first event. Under `AI_MODEL=stub` (`STUB_COALESCE`) the same takes about a second, so dev and E2E stay fast. The config is passed to the coalescer, so tests set their own.

**One run at a time.** The run happens on the Agent's alarm, which it shares with Nudges: the alarm runs background AI when it's due, then Nudges, then brings the alarm forward for the next AI run if Nudges set it later. The batch is taken out of storage when its run starts, so events that arrive during a run fold into the next one, and a second alarm can't start a run while one is going (Durable Object alarms don't overlap; the coalescer also guards in memory). Pages learn of the results the usual way: the run calls the Agent's `notify` once, when anything was filed or guessed.

**The run's steps** (ai-run.ts, `runAiBatch`). Phase a has filing only, with the existing pipeline (Rule, then similar merchant, then the model) and ADR-0021's thresholds:

1. Look again at what waits in Review when the batch has a `buckets-changed`, `rule-added` or `month-started` event, for each Parent in turn, each in their own view (`lookAgainAtReview`), so another Parent's Personal Allowance, private Rules and guesses never reach it (ADR-0003). Looked at first, so what's filed next isn't looked at twice.
2. File the batch's new Imports and captures, each for the Parent who brought it in.

Later phases add steps after filing: merchant normalisation (b), Bucket and Commitment suggestions (c), learning, Rule suggestions and Insights refresh (d). Choosing a model per task (a small one for normalising merchants, a stronger one for suggesting Buckets) is left to those phases; filing keeps `categorize-model.ts`'s model.

**Retries.** A run that throws (the database failing; the model or Vectorize failing only sends what they'd have filed to Review) is held again and retried after 1, then 2 minutes (half a second apart in the stub). After 3 tries it's dropped with a warning; what wasn't filed stays unfiled or in Review, where "Look again" still works. It never files into a wrong Bucket. Logs give counts per method and the error's name only: never merchants (ADR-0021), and never a failed query's message, which can carry a statement line.

**What stayed.** Setup still categorizes its first history in the Setup Workflow, because the wizard shows that step and drafts the Plan after it. "Look again" in Review still runs at once, for the Parent who tapped it.

**Why not a Queue and a Workflow.** The issue sketched a Queue feeding a `HouseholdAiWorkflow`. The Agent already exists per Household, already has an alarm and durable storage, and already announces changes, so it debounces and serialises runs without new infrastructure or production setup. Filing a burst fits well inside an alarm's time limit. If later steps grow long (backfilling merchant names, say), the run can start a Workflow from the alarm; nothing needs creating in production for phase a.

**Consequences.** New Transactions from any source are filed within about a minute without a page open (about a second in E2E), and renaming or archiving a Bucket or adding a Rule re-checks the affected Review rows. A 50-event burst is one run (ai-coalescer.test.ts). Bucket renames, new Rules and Personal Allowance privacy in the run are covered in ai-run.test.ts.
