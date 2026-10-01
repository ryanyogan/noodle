# Plain words for beginners: seven terms renamed, the rest explained where they appear

The Parents are new to budgeting (#47). Going through the app as they would, the desktop review found terms that mean nothing to a beginner, or mean something else to them, explained only in scattered hints or not at all. "Baseline" was the worst: the app meant "your normal monthly take-home pay", but nothing on Plan › Income said so in its name.

Our rule: **rename a term whose word misleads or means nothing to a beginner; keep a term that reads plainly or names something the app does, and explain it where it first appears.** CONTEXT.md is renamed first and stays the source of truth. Each old word is kept there under `_Avoid_`, so it doesn't creep back.

## Renamed

| Was | Now | Why |
|---|---|---|
| Baseline | **Take-home pay** | The CFPB's own words for net income: "Net income, which is also called take-home pay". "Baseline" is statistics jargon. |
| Earmark (noun), earmarked | **Set aside** ("Emergency fund has $5,000 set aside") | A plain verb phrase. YNAB's targets say "Set aside another…". "Earmark" is rare outside government budgets. |
| Unclaimed | **Not set aside** | It is the opposite of Set aside, so it reads as one pair. "Unclaimed" sounds like lost property. |
| Fresh-start Bucket | **Resets monthly** | It says what happens. YNAB's "Fresh Start" means resetting the whole plan, which misleads anyone coming from YNAB. |
| Rolling Bucket | **Carries over** | Copilot and Monarch describe rollovers as carrying the leftover into the next month. "Rolling" alone reads as "rolling average". |
| Windfall | **Extra income** | The CFPB calls a biweekly month's third paycheck "extra". A third paycheck isn't a windfall. |
| Lever | **Change** (in a Scenario) | Explore already said "Your changes". "Lever" is a metaphor from management books. A Scenario's Change is a different thing from a Plan change, which is real. |
| Lever preset | **Change preset** | Follows Change. |
| Cushion | **Projected balance** | The CFPB uses "cushion" for emergency savings, a different thing. Ours is a projection that starts at $0. |

Inconsistencies fixed along the way: "Not Yet" is now "Not yet" everywhere (Ask, Can we afford it?). "Fresh start" (no hyphen, Plan history) is gone. "On Pace" and "Ahead of Pace" are now lower case.

## Kept, and explained in place

Free to Spend, Bucket, Commitment, Sweep, Cover, Pace, Closing a month ("Close September"), Lumpy month and Match keep their names. Each is a word the app needs (Bucket, Commitment), a plain verb (Cover, Sweep, Match), or already reads well (Free to Spend, Lumpy month). Goal, Personal Allowance, Pending and Perk Source are explained the same way.

- **Help popover** (`apps/web/src/components/term-help.tsx`): a small "?" beside the term where it first appears opens one sentence and a "More in the Glossary" link. It's a shadcn Popover, not a Tooltip, so it opens by tap and by keyboard too, stays open until dismissed, and closes on Esc with focus back on the "?" (WCAG 1.4.13, 2.1.1). It sits beside a heading, never inside it, so the heading's name stays the term. `SectionHeader` has a `help` slot for this.
- **Glossary page** (`/glossary`): every term, A to Z, with each renamed term's old word ("Used to be called 'Baseline'"), so a Parent who learned the old words can find the new ones. It's linked from every popover and from the Household page. One list in `apps/web/src/glossary.ts` feeds both.
- Where the help appears first: Free to Spend on This Month and the Plan; Bucket and Pace above This Month's Buckets (with a line explaining the bar and the Pace line); Cover beside "A little over" and the Plan's Covers step; Take-home pay on Plan › Income and the Plan; Commitment and Lumpy month on Plan › Commitments and the year; Personal Allowance on Plan › Buckets; Set aside on Accounts and Goals; Sweep and Extra income on the Check-in and Goal pages; Closing a month on "Close September"; Match in a Transaction's match section; Projected balance in Explore; Perk Source on Perks.

## Considered

- **Keep every term and only explain it.** Rejected for the seven above: a popover can't fix a word that means something else (Cushion, Fresh-start) or nothing (Baseline, Lever). Each first meeting would cost a tap.
- **Rename everything to what peers use**, for example "Spending category" for Bucket, "Bills" for Commitment, "Left to budget" for Free to Spend. Rejected: Bucket and Commitment are fine once introduced, and "Bill" also means a one-off invoice. "Left to budget" assumes zero-based budgeting, which ADR-0001 rejects.
- Alternatives for each rename: "Usual pay", "Monthly income" and "Expected income" for Baseline ("Expected income" also suggests a forecast). "Allocation" (Monarch) and "Saved" for Earmark (but money is "saved" in a Bucket too). "Available for goals" (Monarch) for Unclaimed, which clashes with a Bucket's "Available". Keeping "Rolling" (Monarch and Copilot say "rollover"). Keeping "Windfall" with a hint. "Running balance" or "Money left over" for Cushion.
- **A Tooltip or a first-use hint instead of a Popover.** A Tooltip doesn't open by touch and vanishes on hover-out. A first-use hint is gone the second time a Parent wonders. The Glossary covers "where was that explained?".

## Code names

Code follows CONTEXT.md where the rename was mechanical. Types, functions, variables, classes and files were renamed with the TypeScript language service, which moves every reference with the declaration: `windfalls.ts` became `extra-income.ts`, `levers.ts` `changes.ts`, `lever-presets.ts` `change-presets.ts` and `describe-levers.ts` `describe-changes.ts`. In identifiers, Baseline became `takeHomePay`, Earmark `setAside`, Unclaimed `notSetAside`, Windfall `extraIncome`, Cushion `projectedBalance`, Rolling `carriesOver` and Fresh-start `resetsMonthly`. Lever became `change` in functions and variables. Its types became `ScenarioChange*` (`ScenarioChange`, `ScenarioChangeKind`, …), because a bare `Change` is ambiguous next to `PlanChange`. Server functions were renamed too (`setTakeHomePay`, `setCarriesOver`, `decideExtraIncome`, `undoExtraIncome`), so a client from before the deploy fails on those calls until it reloads.

These keep the old word, on purpose:

| Kept | Where | Why |
|---|---|---|
| Tables `baselines`, `bucket_rolling` (column `rolling`), `earmark_claims`, and their indexes; `moves.kind` value `"windfall"`; `nudge_settings.windfalls`; `scenarios.levers` | D1, `packages/db/src/schema.ts`, `packages/db/drizzle/` | No data migration just for wording. |
| Drizzle table objects `baselines`, `bucketRolling`, `earmarkClaims` | `schema.ts` and their imports | They mirror the tables. |
| Stored JSON and values: a Scenario's Changes (the `levers` array, the kind `"baseline"`), the Plan change log (kind `"baseline"`, `rolling` in `before`/`after`), the plan draft's decision key `"baseline"` and `baselineCents` | D1 JSON | Saved Scenarios and history must still read. |
| Change presets: kind `baseline` and the `?lever=` search parameter | URLs in Insights, Ask answers, bookmarks | Links already handed out keep working. |
| Nudge kind and tag `"windfall"`, the Durable Object storage prefix `nudges:windfall:`, the Check-in card kind `"windfalls"`, the month-close Move id part `:windfall:` | Push payloads, Durable Object storage, stable ids | Stored or already on devices. |
| Object property names: `baseline`, `rolling`, `rollingFrom`, `earmarked`, `earmarks`, `unclaimed`, `windfall`, `windfallLeft`, `windfallGoalId`, `cushion`, `startingCushion`, `lever`, `levers`, `noBaseline`, `baselineSetIn`, `fromEarmarks`, and component props such as `lever` | Domain types, server responses, React props | Many are the shapes above, or are filled straight from rows and JSON. Renaming them is not mechanical (spread rows, JSON, zod schemas), and a slip compiles but loses data. A later refactor can rename them shape by shape. |

## Remaining hits

After the renames, a case-insensitive whole-word search for the old terms across `apps/`, `packages/` and `docs/` still finds:

- The names in the table above: D1 tables and columns, migrations and Drizzle snapshots, stored values, preset kinds, Nudge kinds and property names.
- History: ADRs 0001, 0002 (its file name too), 0004, 0009, 0012 and 0014 record decisions in the words of their time. `docs/reviews/desktop.md` quotes the app's copy as the audit found it.
- On purpose: each renamed term's "Used to be called …" in `apps/web/src/glossary.ts`, the Glossary E2E spec that checks it, CONTEXT.md's `_Avoid_` lines, and Ask's model prompt, which tells the model never to use the old words.
- Other meanings of the same words: screenshot "baselines" (ADR-0008, `shell.spec.ts`), CSS `items-baseline`, SVG `dominantBaseline`, and `rollingBack` in Cloudflare's generated types.

## Sources

- CFPB, take-home pay and net income: https://files.consumerfinance.gov/f/documents/cfpb_building_block_activities_understanding-taxes-paycheck_guide.pdf
- CFPB, Your Money, Your Goals ("cushion" for savings, the "extra" third paycheck): https://files.consumerfinance.gov/f/documents/cfpb_your-money-your-goals_financial-empowerment_toolkit.pdf
- YNAB glossary ("Fresh Start" resets the whole plan): https://support.ynab.com/en_us/ynab-glossary-a-guide-BJd80SORq.md
- YNAB targets ("Set aside another…"): https://support.ynab.com/en_us/getting-started-with-targets-ryAEP08xC.md
- Monarch Goals ("Available for goals"): https://help.monarch.com/hc/en-us/articles/44373110771860-Introducing-Goals-3-0
- Copilot rollovers: https://help.copilot.money/en/articles/3790828-budget-rollovers
- Goodbudget, Available money ("formerly called Unallocated"): https://goodbudget.com/help/budgeting-with-goodbudget/what-is-available-money/
- digital.gov plain language: https://digital.gov/guides/plain-language/
- NN/g, plain language for experts: https://www.nngroup.com/articles/plain-language-experts/
- WCAG 2.2, 1.4.13 Content on Hover or Focus and 3.2.6 Consistent Help: https://www.w3.org/TR/WCAG22/
