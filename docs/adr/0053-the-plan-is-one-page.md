# The Plan's first page is the take-home split with the Buckets table under it

Status: accepted (2026-10-05, issue 109, phases 109ab and 109c). Builds on ADR-0047 (detail opens in a panel) and ADR-0051 (the Buckets table).

## Context

The Plan had an Overview tab (where take-home pay goes, things to check, what changed) and a Buckets tab (the table, a card of totals in the rail, a bar stuck to the top saying "Left to plan"). The Parent: "perhaps on the plan page we can merge the overview and buckets? i think we can make a nice ui of this and simplify".

The two pages showed the same figures up to four times. The Buckets' total was in the split, in a line over the list and in the totals card. Free to Spend was in the split's sentence, in its last row, in a card of its own on a phone, and once more under a second name, "Left to plan", which is not a term in `CONTEXT.md`.

## Decision

`/plan/$month` is one page, and its tab is still called Overview. Top to bottom, in one column:

1. **Where take-home pay goes** (`PlanSplit`, `#plan-waterfall`): a sentence, one bar, and the parts. In a card of 36rem or more the parts are cells in a row under the bar; narrower (a phone) they are rows, of which only Free to Spend shows until "Show the parts" opens the rest. One list either way.
2. **Things to check**, when there are any: under the split, beside it from 1920.
3. **Buckets** (`#buckets`): the heading, what the Buckets take in all, and Add Buckets; the table; "Add another Bucket" under it; Suggested.
4. **Personal Allowances** (`#personal-allowances`): a second, short table. It has no handles, and holds their room open where rows are columns, so the figures of the two tables are in one line.

The rail is **What changed** and nothing else: beside the page from 1440, under it below that. A Bucket still opens at `/plan/$month/buckets/$id`, in a panel over the rail from 1440, a drawer from 1024 and a page of its own on a phone; the page under it stays mounted. `/plan/$month/buckets` redirects to `/plan/$month#buckets`.

**One set of figures.**

- The split is the summary; the table is where it is changed. The Buckets heading says the split's own Buckets figure, and the table's last row (Total: Allowance, Spent, Left) adds up the same Buckets.
- While an allowance is typed in a Bucket's sheet, the split is drawn as if it were saved (`withDraftAllowances` in `apps/web/src/plan-split.ts`): the sentence, the bar, the Buckets figure and Free to Spend follow, with no call to the server, and go back when the sheet is put away unsaved. The sheet is modal and the page behind it is dimmed, so the sheet says it too, under the amount: "Free to Spend after this: $2,650", in the over ink with "More is planned than you have this month." below zero.
- The name for what is left is Free to Spend, everywhere on this page.

**What went.**

| Gone | What does its job |
| --- | --- |
| The Buckets tab | The first page. Five tabs: Overview, Income, Commitments, Goal funding, Year |
| The bar stuck over the list, "Left to plan" | The split, and the sheet's "Free to Spend after this" |
| "still to set: <Parent>'s Personal Allowance" in that bar | A line in the Personal Allowances section |
| The rail's card of totals (Take-home pay, Shared Buckets, Personal Allowances, Spent so far, Over, Left in Buckets, a bar) | The first three are parts of the split; Spent and Left are the table's last row; a Bucket that is over says so in its own row |
| The Free to Spend card on a phone | The split's sentence and its Free to Spend row are the first thing on the page |
| "$Y Covered from Free to Spend" beside the Buckets heading | Covers is a part of the split |
| The Buckets heading with nothing under it but a line of explanation, while there are no Buckets | Step 3 of "Set up the Plan" says the same and has the one Add Buckets |
| Step 3's link to another page | It opens the Add Buckets sheet in place |

There is one Add Buckets sheet on the page, and one control named "Add Buckets" at a time: in step 3 while there are no Buckets, beside the Buckets heading once there are. "Add another Bucket" under the table opens the same sheet (a long list on a phone). Until there are Buckets, `#buckets` is step 3, so links to the Plan's Buckets still land on the place that adds them.

Nothing a Parent could do is gone. Commitments, Goal funding, Income and Year keep their tabs.

## Consequences

- The Buckets start on the first screen of a 1280 by 720 window and a 1440 by 900 one (asserted in `apps/web/e2e/plan-area.spec.ts`).
- The split's parts are figures, not links (ADR-0033's "no duplicate links"): the tabs right above open each part.
- While an allowance is typed, the split shows the typed figure and the table's row and last row still show the saved one, until Save. The table is behind the sheet's scrim at that moment.
- The Add Buckets sheet still calls its own running figure "Left to plan". Renaming it is a follow-up.
- `DataTable` has an `indent` prop for the second table's alignment (`packages/ui/COMPONENTS.md`). When the viewer has no Personal Allowance of their own and the other Parent has one, that table has no Edit column, and its Pace and name columns are wider than the Buckets table's by that column; its money columns are then out of line by the same amount. Not fixed here.
- On a phone the Buckets heading has no room for the total beside the button: it shows from 640.
