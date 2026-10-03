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

## Merchant names (phase b)

Every background run first names the Household's imported lines (`merchant-run.ts`), then files.
`transactions.merchant` holds the clean name ("Costco" for "COSTCO WHSE #1042 SEATTLE WA"); the
note keeps the raw text, still shown in the Transaction sheet. Quick Adds are never named: their
note is what the Parent typed.

- **Normaliser first.** `cleanMerchant` (`@noodle/domain`, pure, fixture-tested) drops bank wording
  ("POS PURCHASE", "CHECKCARD 0912"), processor prefixes (SQ \*, TST\*, PAYPAL \*, …), everything
  from the first word with a digit or "#" on (store numbers, card digits, dates, references), phone
  numbers, a trailing town and state, and LLC/INC, names well-known chains outright, and fixes case.
  It says whether it is sure; squeezed words ("MRKTPLC"), a leftover "\*" or digits are not.
- **Model only for leftovers.** At most 40 unsure raw lines a run go to the model in one prompt with
  a JSON schema (`AI_MODELS.name`, the same small MoE as classify: cheapest model here already proven
  on schema'd JSON; about $0.10/$0.30 per M tokens, a few hundred tokens a run). Answers that aren't
  names are dropped. If the call fails the normaliser's guess is used, uncached. Under
  `AI_MODEL=stub` the namer returns the normaliser's guess.
- **Cache per Household, not global.** `merchant_names (household_id, raw) → name` keeps only what
  the model settled, so a raw line goes to the model once per Household. Not global because a raw
  line can carry a person's name (a Zelle or Venmo payee) or an address, and a shared table would
  hold one Household's text for another's benefit; deleting a Household deletes its rows. The cost
  of repeats across Households is small and the AI Gateway cache answers identical prompts.
- **Used everywhere a merchant was.** Categorization keys Rules, Vectorize similar-merchant lookups
  and the model prompt by `merchantKey(merchant ?? note)`; a Rule stated for the raw text still
  matches a named line (Rules are checked against both keys, also when a new Rule applies to
  waiting lines). Reports group and show by `coalesce(merchant, note)`, hidden as the note is for
  a Split partly in the other Parent's Personal Allowance. The Transactions list and Review cards
  show the clean name.
- **Plaid.** Bank lines already take Plaid's `merchant_name` as their text when Plaid has one, which
  the normaliser keeps as is. `counterparties` isn't read yet. Plaid Enrich could name statement
  (file) imports too, but it's a paid product priced per transaction, needs a separate Plaid
  contract and sending every line to Plaid, so it isn't used.
- **Backfill.** Each run names up to 500 distinct raw lines, newest first, and asks for another run
  (`backfill-merchants`) while more are left. The nightly Insights cron queues `backfill-merchants`
  for any Household with unnamed imported lines, so old rows are named in the nights after deploy
  with nothing to trigger by hand. Idempotent: only lines with no merchant are written.

## Suggestions (phase c)

Background AI also offers things to add: a **Suggestion** is a new Bucket, a new Commitment, a
Commitment's new amount, or (later) a Rule, with its evidence, that a Parent adds with one tap or
puts away ("Not now").

- **One table.** `suggestions` holds each with its `kind`, `status` (open, accepted, dismissed), the
  terms to add (`payload`), what it rests on (`evidence`: charges, amount, months, Transaction IDs)
  and a short fingerprint of that evidence. `key` says what it's about (the Bucket's name, the
  merchant, the Commitment) with its owner, unique per Household, so finding it again updates the
  same row and a dismissed one is remembered.
- **When.** A step at the end of each run, when the run had imports, a look again (Buckets or Rules
  changed), a Commitment change or a new month. Open ones take the latest evidence; open ones no
  longer found (the lines were filed, the Commitment added by hand) are deleted.
- **Dismiss sticks** unless the evidence changes a lot: the amount moves by 30% or more, or the
  charges double (`changedALot`). Then it reopens. Accepted ones follow the same rule, so a
  Commitment whose charges move again can be flagged again.
- **Suggest Buckets.** Over 90 days, spending in Review or a catch-all Bucket ("Other",
  "Miscellaneous"…) grouped by kind of merchant, or the merchant itself. A group in 3 or more
  months, with no month over 60% of it, 4 or more charges and $40 or more a month becomes a Bucket
  at its monthly average rounded up to $5. Not for a name the Plan has.
- **Spot Commitments (rewritten in #76: real bills only).** A Commitment is a bill, not day-to-day
  spending that repeats. The payee's kind comes from words in its clean name (`billKindOf`):
  housing, loan or auto finance, insurance, utilities, telecom, childcare or education, and
  subscriptions or memberships can be Commitments; eating out, coffee and groceries (the Bucket
  kinds), fuel, general retail and moving money (`isMoneyMovement`) never are; anything else is
  "unknown". Its latest run (up to 6 charges) must keep a cadence that kind bills on: monthly
  (26–35 days) for all, annual (2 charges about a year apart) only for insurance and
  subscriptions, biweekly (12–16 days) only for loans and childcare. The due day is stable: every
  charge within 3 days of the usual day of the month (or a year apart within 4 days). The amount
  is steady: within 10% of the median for fixed bills; utilities and telecom vary with the season,
  so they're judged within 60% and planned at the recent high (of the last 3); an unknown kind
  needs 5%, 4 or more charges and monthly only. 3 or more charges otherwise (2 for annual), the
  latest not overdue by half a period, and a monthly equivalent of at least $25 ($10 for a
  subscription, $100 for an unknown kind). Not for a payee paying a Commitment, nor one near the
  name of a Commitment or Bucket the Plan has ("Verizon" covers "Verizon Wireless": the shorter
  name's words, less noise like Inc, Wireless, .com, lead the longer's). Each comes with a reason
  in plain words ("Verizon, $85 on the 12th, 4 months running"), kept in its payload. Open ones
  that no longer qualify are deleted on the next run like any open one no longer found; added
  Commitments are never touched. A Commitment whose latest 2–3 charges agree and differ from its
  amount by more than 10%: its new amount.
- **Deterministic, no model.** Names come from a short list of merchant kinds ("Pets" for Petco,
  Chewy, a vet) or the merchant's clean name. The same spending always gets the same name, it costs
  nothing, it's tested as it runs in production (AI_MODEL=stub changes nothing), and the Parent can
  rename it afterwards. A model naming step can come later if names prove poor.
- **Privacy (ADR-0003).** Each line carries its owner, the Parent whose Personal Allowance it's in;
  groups never mix owners, so a suggestion resting on a Parent's Personal Allowance has their
  `member_id` and only they read or decide it. Commitment amounts look only at the Household's
  spending. Adding a private one makes a Household Bucket or Commitment: the Parent's choice.
- **Accept** adds it to this month's Plan through the same writes as by hand (`addBucket`,
  `addCommitment`, `updateCommitment` from this month on), so the Plan change is logged, and queues
  `buckets-changed` or `commitment-changed` so Review is looked at again.
- **Where.** A quiet "Suggested" card on This Month, hidden when there are none. Review, the Buckets
  and Commitments pages and Check-in come next.

## Learn and in-context suggestions (phase d1)

- A Parent's hand correction teaches similar-merchant memory by the clean merchant name (merchantKey of `transactions.merchant`), falling back to the categorized key, then the note.
- **Rule suggestions.** "Filed by hand" is an imported line in a Bucket with no categorization row (a Parent settling a line deletes it; one categorization filed keeps it). When one owner's lines for the same clean merchant went into the same Bucket 3 or more times, with a clear favourite and no Rule covering it (the Household's, or that Parent's own), background AI suggests a Rule ("Always put Costco in Groceries? You've done it 4 times."). Filings into a Personal Allowance only ever suggest to its Parent (ADR-0003). It's looked for on every run with a `filed-by-hand` event, beside the other detectors. Add uses the same `saveRule` as Review, so a Rule into the Parent's own Personal Allowance is private, and queues `rule-added`, which looks again at Review. Not now sticks until the count doubles.
- **In context.** One `Suggested` component, filtered by kind: all kinds on This Month, Rules on Review (below the stack), new and changed Commitments on the Commitments page. Household new-Bucket suggestions join the Add Buckets sheet as unticked rows with their amount.
- Card payments and transfers ("Online Payment", "Autopay Payment", "Transfer to Savings") are never Commitment suggestions (by name, `isMoneyMovement`).

### Polish (phase d1b)

- **One Rule offer, not two.** Review keeps its "Always file X in Y?" offer after a single hand pick: it's in the moment, beside the card. Once background AI has its own suggestion for that same merchant and Bucket (after three picks), Review stops offering it after each pick, and the Suggested card below the stack is the one offer, until it's added or put away with Not now. Two offers for one Rule would read as two different things.
- **Edit before adding.** Add on a new Bucket or new Commitment suggestion opens its terms first, filled in (name and amount; schedule and next due for a Commitment), so a Parent can change them before it goes in the Plan. A changed Commitment amount suggestion stays one tap: it's only the amount.
- **The Add Buckets sheet takes the suggestion.** A suggested row (or the starter of the same name, like Pets, which becomes the suggested row) carries its suggestion; adding it marks the suggestion accepted rather than leaving the next run to drop it.
- **Commitments page shows them on this month only**, since adding one writes this month's Plan.

## Eval, budgets, Insights refresh and models per step (phase d2)

**Models per step** (`BACKGROUND_AI_MODELS` in packages/ai/src/models.ts):

| Step | Model | Why |
| --- | --- | --- |
| Naming leftovers | `AI_MODELS.name` (small MoE, gemma-4-26b-a4b) | Short lines in, short names out, at most one prompt a run; the normaliser settles most lines, so this is cheap and rarely called. |
| Filing | `AI_MODELS.classify` (the current one) | High volume, short JSON with a schema; proven on categorization (ADR-0021). A stronger model wasn't better enough on the eval set to pay for. |
| Suggested Bucket names | none (deterministic) | A short merchant-kind list names them; Parents rename. No cost, no surprises. |
| Insights | `AI_MODELS.reason` (the current one) | Few calls, latency doesn't matter, and grouping services and wording Insights needs the most judgement. |

**Eval set.** `ai-eval-set.ts` holds 60 anonymised statement lines (made-up store numbers and towns)
and the Bucket a typical family files each in, with a few Rules and hand-filed merchants.
`ai-eval.ts` runs them through `decideRows` (cleaner, Rule, similar merchant, model) as a run does,
counting right, wrong (filed into another Bucket) and Review. `ai-eval.test.ts` runs it with the stub
(today 35 of 60 right after merchant names, 32 before, 2 wrong) and fails below 55% or above 2
wrong. `bun run eval:ai` (apps/web/scripts/eval-ai.ts) runs the same set against the real models
through the AI Gateway's REST endpoint, before and after merchant names, only when run by hand with
`CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`; CI and the tests never run it. It prints counts
only.

**Daily model budget** (`ai-budget.ts`, `AI_BUDGET`): each Household's Agent counts model calls per
UTC day in its own storage (`ai:budget`), 60 a day by default (a busy day is a few imports, about 6
calls each). Past it, model steps are skipped quietly: filing sends what the model would have guessed
to Review (never a wrong Bucket), naming keeps the normaliser's guess (uncached, so a later run asks
again), Insights keep their facts without the model's grouping or wording. Counts are kept in memory
during a run (filing prompts run in parallel) and saved at its end. Each run logs, per step, model
calls, skips and milliseconds, the day's total, the filing methods (rule, similar, model, none) and
the run's time; never merchants. Tokens aren't logged yet: the model wrappers don't return usage.

**Insights refresh.** A run that filed or sent anything to Review, changed suggestions, looked again
(a Bucket or Rule changed), or saw a hand filing, a Commitment change or a new month marks Insights
stale. It refreshes them in the run (every Parent, within the budget) when stale, at most 3 times a
UTC day and 2 hours apart; otherwise they stay stale for a later run. With no later run, the nightly
job is the backstop, unchanged.

