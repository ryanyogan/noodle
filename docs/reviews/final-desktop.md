# Final desktop pass (issue 73)

The inventory the last comment on issue 73 asks for: every desktop surface, at every desktop width and in dark, each cell marked only from a picture that was opened.

- `—` not looked at · `ok` looked at, nothing wrong · `fixed <sha>` a defect found in that picture and fixed (the picture was retaken) · `open: …` a defect or a decision still to make.
- Dark is judged for layout only until the dark colours are settled.
- Pictures: `e2e/page-shots.spec.ts` (`PAGE_SHOTS_ONLY=<pic>`, `PAGE_SHOTS_WIDTHS=1024,1280,1440,1920,2560`, `PAGE_SHOTS_THEME=dark`); the "pic" in "How to reach it" is the picture's name there. The record of each phase's pictures is kept beside its handoff (`handoffs/phases/<phase>-shots/`).
- "Another agent busy?" says who owned the surface during part 1 (phase 73ao, 2026-10-05); those rows come in part 2.


## Shell

| Surface | How to reach it | Another agent busy? | 1024 | 1280 | 1440 | 1920 | 2560 | dark 1440 | Status / notes |
|---|---|---|---|---|---|---|---|---|---|
| Sidebar, open | any page from 1024 | shell agent | fixed f3092b8b | — | ok | — | — | — | part 3 (73ar): at a window under 800px tall the groups sit 8px apart and their labels are 24px, so Household settings is whole 50px above the foot at 1024×768 (pic 03w at 1024, opened). Other widths seen on every picture |
| Sidebar, collapsed to the icon rail | Sidebar trigger | shell agent | — | — | open: picture failed | — | — | — | 73as: pic 00 added (only by name); its first run failed (00-sidebar-collapsed.FAILED.png, not diagnosed), so NOT looked at |
| Household menu (Sidebar foot) | click the Household name | shell agent | — | — | — | — | — | — |  |
| Term help popover | any "?" beside a heading | shared (packages/ui) | — | — | — | — | — | — |  |
| Toast: plain, with Undo, error, sticky | save, delete, a failed save | shared (packages/ui) | — | — | — | — | — | — |  |
| "Leave without saving?" dialog | leave an edited form | no | — | — | — | — | — | — |  |
| Intro video dialog | This Month get-started, "Watch" | no | — | — | — | — | — | — |  |
| Route error screen | a loader that throws | no | — | — | — | — | — | — |  |
| Not-found screen | an unknown address | no | — | — | — | — | — | — |  |
| Section loading skeleton | slow loader on any section | no | — | — | — | — | — | — |  |

## Signed out and getting started

| Surface | How to reach it | Another agent busy? | 1024 | 1280 | 1440 | 1920 | 2560 | dark 1440 | Status / notes |
|---|---|---|---|---|---|---|---|---|---|
| Landing / redirect | / | no | — | — | — | — | — | — |  |
| Sign in | /sign-in | no | — | — | — | — | — | — |  |
| Sign up | /sign-up | no | — | — | — | — | — | — |  |
| Invite | /invite/$token | no | — | — | — | — | — | — |  |
| Welcome | /welcome | no | — | — | — | — | — | — |  |
| Joined | /joined | no | — | — | — | — | — | — |  |
| Setup wizard step 1 | /setup (pic 31) | no | — | — | — | — | — | — |  |
| Setup wizard step 2 (income) | /setup (pic 32, 32a) | no | — | — | — | — | — | — |  |
| Setup wizard step 3 | /setup (pic 33) | no | — | — | — | — | — | — |  |
| Setup wizard step 4 | /setup (pic 34) | no | — | — | — | — | — | — |  |
| Setup wizard steps 5 to 7 | /setup, continue | no | — | — | — | — | — | — |  |
| Bank return | /bank/return | no | — | — | — | — | — | — |  |

## This Month (another agent)

| Surface | How to reach it | Another agent busy? | 1024 | 1280 | 1440 | 1920 | 2560 | dark 1440 | Status / notes |
|---|---|---|---|---|---|---|---|---|---|
| This Month | /month/$month | yes | — | — | ok | — | — | — | pic 01 at 1440: Buckets, Free to Spend with a carried-over amount, To do with Close September, Bills, Income. "Ended with $0, carried over" reworded in 526a6722 (not pictured: needs a month that ended on $0) |
| This Month, To do row open | To do › a row | yes | — | — | — | — | — | — |  |
| This Month, get started (fresh Household) | /month/$month (pic 30) | yes | — | — | — | — | — | — |  |
| Extra income card, menu and "Send the Extra income" sheet | This Month | yes | — | — | — | — | — | — |  |
| Close month | This Month › To do | yes | — | — | — | — | — | — |  |
| Cover a Bucket sheet | This Month › an over Bucket | yes | — | — | — | — | — | — |  |
| Free to Spend card | This Month, Plan | yes | — | — | — | — | — | — |  |
| Month's plan | /month/$month/plan | yes | — | — | — | — | — | — |  |

## Plan

| Surface | How to reach it | Another agent busy? | 1024 | 1280 | 1440 | 1920 | 2560 | dark 1440 | Status / notes |
|---|---|---|---|---|---|---|---|---|---|
| Plan overview | /plan/$month | yes | ok | ok | ok | ok (reduced) | ok (reduced) | ok (layout) | 73ar: pics 03, 03b (Things to check open with its three links, What changed "Show all"). 2560 taken, not opened. Things to check's first warning differs between runs (Hawaii trip / Next car): order not looked into. 73as: 1024 and 2560 opened. Things to check now has one order on every load (ba015993: urgency, then the Goal due soonest / the Bucket furthest over, then name; unit test); 03b retaken at 1440, 1920, 2560, 1440 opened |
| Plan › Buckets table | /plan/$month#buckets | yes | ok | ok | fixed f3092b8b | ok (reduced) | ok (reduced) | ok (layout) | 73ar: two groups seeded in page-shots (Food, Family and home). Subtotals and Total end on the rows' right edge in Allowance, Spent and Left at 1280, 1440, 1920, dark; the subtotal's Spent was darker than the column: now muted. 1024 and 2560 taken, not opened. Decision kept: exact cents ("$2,064" beside "$106.77"). 73as: 1024 (Pace and End of month give way, subtotals on the rows’ edge) and 2560 opened |
| Bucket sheet, More open (Group, colour, Move up/down, Archive) | Buckets table › pencil › More (pic 04a2, 04a4) | yes | — | — | ok (reduced) | — | — | — | 73ar: one left edge, one primary (Save); centred in the window |
| Group rename sheet | Buckets table › a group's Rename (pic 04d) | yes | — | — | ok (reduced) | — | — | — | 73ar: new picture |
| Add Buckets sheet | Plan › Add Buckets | yes | — | — | fixed ba015993 | — | — | — | 73as: the help line read "carries over (?) , keeping": the comma stood a space from its word; reworded so nothing follows the "?" (pic 04e at 1440 before and after). With every starter already in the Plan the sheet still says "Tick the ones you want" over an empty list: copy, open |
| New Bucket sheet | Bucket picker › New Bucket | yes | — | — | — | — | — | — |  |
| Bucket in the panel | /plan/$month/buckets/$id | yes | ok (drawer) | fixed f3092b8b (drawer) | fixed f3092b8b | — | — | — | 73ar: "Spent" and "Even spending by today" figures sat 16px apart when the label wrapped; now on one line (pics 05w). The foot strip clears the Ask button. 1920, 2560, dark taken, not opened. Judgement: its header button is outlined "Edit Bucket" while a Commitment's and Goal's is a plain "Edit" |
| Restore Bucket sheet | Bucket panel › history | yes | — | — | — | — | — | — |  |
| Plan editing dialog (discard draft) | Plan › edit, leave | yes | — | — | — | — | — | — |  |
| Plan › Year | /plan/$month/year, /plan/year/$year | yes | open: October row tall | — | ok | ok | — | — | 73ar: pic 09 at 1440: planned over actual, Carried over, months below zero in red, the yearly total; all columns end on one edge. Other widths taken, not opened. 73as: at 1024 October’s row was four lines tall ("This month" and "Lumpy" each on its own line); a wider Month column was tried and taken out again: it still left three lines and pushed "Take-home pay" to three. Needs a design choice (Decision 6). 1920 opened |
| Plan › Commitments | /plan/$month/commitments (pic 06) | no | fixed 526a6722 | — | fixed 526a6722 | ok | — | ok (layout) | amount column holds the figure alone; a yearly one says "A month’s share of $480 yearly" on its meta line (two lines beside the rail at 1440 and 1024). $11.58 keeps its cents: Plan figures are exact. 73as: 1920 opened: Paid and "Due Oct 1" share one right edge |
| Commitment in the panel | /plan/$month/commitments/$id (pic 07) | no | ok (drawer) | — | ok | — | — | — | 73ar: retaken at every width with the foot strip (pic 07b); 1440 and 1024 opened |
| Commitment sheet (edit) | Commitment panel › Edit | no | — | — | ok | — | — | — | 73as: pic 07c added (Amount, Name, How often, Next due, Pays down, From October on / Just October, History, End); 1440 opened, 1920 and 2560 taken |
| Plan › Commitments, empty | fresh Household (pic 39h) | no | — | — | — | — | — | — |  |
| Plan › Goal funding | /plan/$month/goals (pic 08) | no | — | — | ok | — | — | — | 73ar: the dot between "funded this month" and "set aside" had no room before it and two spaces after; now the shared MetaParts dot (f3092b8b). Retaken, NOT opened. The seeded Household has no "Funded" / "Paid off" row: seed one. 73as: retake opened at 1440: the dot has even room. Still no "Funded" / "Paid off" row seeded |
| Plan › Goal funding, empty | fresh Household (pic 39i) | no | — | — | — | — | — | — |  |
| Plan › Income | /plan/$month/income (pic 08x) | no | ok | — | fixed 526a6722 | — | — | — | rail no longer repeats the received line or its bar; its help says "here, with Edit take-home pay". 1024 not retaken after this. 73as: 1024 opened (73ar picture) |
| Income came in lower | small Household (pic 06a) | no | — | — | — | — | — | — |  |
| "Take-home pay" sheet | Income › Edit take-home pay (pic 06b) | no | — | — | — | — | — | — |  |
| Income: money from the other Parent, Between us | pics 40, 41 | no | — | — | — | — | — | — |  |
| Income row actions menu | Income › "Actions for …" | no | — | — | ok | — | — | — | 73as: pic 08y added; menu opens under its button, inside the card |
| Plan › Income, empty | fresh Household (pic 39j) | no | — | — | — | — | — | — |  |

## Transactions (another agent)

| Surface | How to reach it | Another agent busy? | 1024 | 1280 | 1440 | 1920 | 2560 | dark 1440 | Status / notes |
|---|---|---|---|---|---|---|---|---|---|
| Transactions table | /transactions/$month | yes | — | — | — | — | — | — |  |
| Transactions Filters sheet | Transactions › Filters | yes | — | — | — | — | — | — |  |
| Selection bar and Delete sheet | select rows | yes | — | — | — | — | — | — |  |
| Transaction in the panel, editor, Split, receipt | /transactions/$month/$id | yes | — | — | — | — | — | — |  |
| Quick Add popover and capture | Sidebar › Quick Add | yes | — | — | — | — | — | — |  |
| Upload a statement sheet | Accounts or Transactions › Upload | yes | — | — | — | — | — | — |  |

## Review (another agent)

| Surface | How to reach it | Another agent busy? | 1024 | 1280 | 1440 | 1920 | 2560 | dark 1440 | Status / notes |
|---|---|---|---|---|---|---|---|---|---|
| Review cards | /review | yes | — | — | — | — | — | — |  |
| Review list | /review?view=list | yes | — | — | — | — | — | — |  |
| "Make a Rule" sheet | Review card › Make a Rule | yes | — | — | — | — | — | — |  |
| Rules list | /review/rules | yes | — | — | — | — | — | — |  |
| Rule in the panel | /review/rules/$ruleId | yes | — | — | — | — | — | — |  |
| "Add a Rule" sheet | Rules › Add a Rule | yes | — | — | — | — | — | — |  |

## Accounts

| Surface | How to reach it | Another agent busy? | 1024 | 1280 | 1440 | 1920 | 2560 | dark 1440 | Status / notes |
|---|---|---|---|---|---|---|---|---|---|
| Accounts list | /accounts (pic 15) | no | — | — | fixed 836a1ade | — | ok (reduced) | — | cards start at the top, balance on the bottom line (pic 16, under the panel). 73as: a bank connection’s icon was centred on its four lines while every Account card’s icon sits by the name; now by the name from 640px too (ba015993). Card order differs between runs (seeded in one instant) |
| Accounts, archived open | pic 15a | no | — | — | — | — | — | — |  |
| Account in the panel (credit card) | /accounts/$id (pic 16) | no | — | — | fixed f3092b8b | — | — | — | 73ar: "Perks for this card" said "5 Perks · Chase Sapphire Reserve" under the card's own heading; now "5 Perks" (another source's name is still shown). Pic 16 opened at 1440, with the foot strip in place |
| Account in the panel (no balance) | pic 16a | no | — | — | — | — | — | — |  |
| Account actions menu | Account panel › More | no | — | — | — | — | — | — |  |
| Rename Account sheet | Account menu › Rename | no | — | — | — | — | — | — |  |
| "Add an Account" sheet | Accounts › Add an Account | no | — | — | — | — | — | — |  |
| Bank connection sheets (history length, which do you have, already connected) | Accounts › Connect a bank | no | — | — | — | — | — | — |  |
| Accounts, empty | fresh Household (pic 39c) | no | — | — | — | — | — | — |  |

## Goals

| Surface | How to reach it | Another agent busy? | 1024 | 1280 | 1440 | 1920 | 2560 | dark 1440 | Status / notes |
|---|---|---|---|---|---|---|---|---|---|
| Goals list | /goals (pic 17) | no | — | — | ok | — | — | — | pic 18, under the panel. "$398.15 a month" beside "$450 a month": the money decision. 73as: 1440 opened again with the panel closed (pic 17): ok |
| Goal in the panel | /goals/$id (pic 18) | no | — | — | fixed 7f7440e | — | — | — | History: the row with Undo pushed its amount off the right edge the others share; retaken and clean. 73as: pic 18 opened at 1440: month heads and rows share the right edge |
| Goal with a long history | pic 18a, 18b | no | — | — | — | — | — | — |  |
| Payoff Goal in the panel | /goals/$id of a payoff Goal | no | — | — | — | — | — | — |  |
| Edit Goal sheet / Edit payoff Goal sheet | Goal panel › Edit | no | — | — | — | — | — | — |  |
| New Goal sheet | Goals › New Goal | no | — | — | — | — | — | — |  |
| Goal's Account | /goals/accounts/$accountId | no | — | — | — | — | — | — |  |
| Goals, empty | fresh Household (pic 39b) | no | — | — | — | — | — | — |  |

## Explore

| Surface | How to reach it | Another agent busy? | 1024 | 1280 | 1440 | 1920 | 2560 | dark 1440 | Status / notes |
|---|---|---|---|---|---|---|---|---|---|
| Explore | /explore (pic 19) | no | open: tabs clip | — | fixed ba015993 | — | ok (reduced) | — | 73as: in "How it plays out" and "Goals reached" the last row had no rule above it (the shared table body drops the last row’s border); ruled now (ba015993). At 1024 the Outcome tabs clip "Each month" and hide "Goal paths" (the row scrolls): Decision 3. At 1440 the left column ends about 1,600px above the levers: Decision 5 |
| Explore with a change | pic 19a | no | — | — | — | — | — | — |  |
| Explore, a line's sheet | pic 19b | no | — | — | — | — | — | — |  |
| Explore, a group open | pic 19d | no | — | — | — | — | — | — |  |
| Explore, raises and inflation sheet | pic 19c | no | — | — | — | — | — | — |  |
| "Apply to the Plan" dialog | Explore › Apply | no | — | — | — | — | — | — |  |
| Explore, empty | fresh Household (pic 39g) | no | — | — | — | — | — | — |  |
| Can we afford it? (house) | /explore/afford (pic 20) | no | — | — | ok | — | — | — | 73as: pic 20 opened at 1440 |
| Can we afford it? (car) | pic 20a | no | — | — | — | — | — | — |  |
| Can we afford it? (anything) | pic 20b | no | — | — | — | — | — | — |  |
| Can we afford it?, empty | fresh Household (pic 39k) | no | — | — | — | — | — | — |  |
| Scenarios list, compare | /explore/scenarios | yes | ok (drawer) | — | ok | ok | fixed f66b016c | — | 73ar: with a Scenario open the panel covered Compare's value columns. Compare now keeps to the room left of the panel and, when that is under 448px, lists each number's values (the phone form); its charts stack under 768px (pics 21a, 22a). At 2560 the first fix still left "Pay cut" under the panel (opened); the wide-page correction is committed but NOT pictured. The Outcome tab row in the panel clips "Goal paths" at 1024 and 1440 (it scrolls). 73as: 22a retaken after f66b016c at 1440, 1920, 2560 and opened: "Pay cut" is whole beside the panel at 1920 and 2560; the stacked list at 1440. The compare table’s last row is ruled too (ba015993) |
| Scenario, Rename and Delete dialogs | /explore/scenarios/$id | yes | — | — | — | — | — | — |  |

## Reports

| Surface | How to reach it | Another agent busy? | 1024 | 1280 | 1440 | 1920 | 2560 | dark 1440 | Status / notes |
|---|---|---|---|---|---|---|---|---|---|
| Reports › Overview | /reports (pic 23) | no | fixed 99cccec2 | — | fixed 99cccec2 | — | ok (opened at reduced size) | — | part 2 (73ap): lists, chips and the donut are whole dollars; cents stay in the tables and CSV. At 2560 the page sits about 115px left of the middle of the room beside the Sidebar: open, not measured in the DOM |
| Reports › Big expenses | ?view=big (pic 23b) | no | ok | — | ok | — | — | — | bars, both lists and the chart line up; the two cards end 30px apart (content-length, fine) |
| Reports › Merchants | ?view=merchants (pic 23f) | no | — | — | fixed 99cccec2 | — | — | — | one row ($841.65) has cents, same decision as above |
| Reports › Cash flow | ?view=cash-flow (pic 23a) | no | — | — | ok | — | — | — |  |
| Reports › Buckets | ?view=buckets (pic 23c) | no | — | — | fixed 99cccec2 | ok (top 700px, reduced) | — | — | donut centre now $38,057 as the Overview stat; one format down the list |
| Reports › Plan vs actual | ?view=plan (pic 23d) | no | open: money format | — | fixed 99cccec2 | — | — | — | heatmap clean; chips whole dollars |
| Reports › Trends | ?view=trends (pic 23e) | no | — | — | ok | — | — | — | "Every day" read-out keeps cents (Oct 5: $4,990.29), an exact read-out by design; the heatmap fills the left 60% of its card: decision in the handoff |
| Reports › People | ?view=people (pic 23g) | no | — | — | ok | — | — | — | footnote "Spending For Everyone counts once … $4,834.22 this month" (child-costs.tsx) keeps cents: a sentence, not a column |
| Reports › Goals | ?view=goals (pic 23h) | no | — | — | ok | — | — | — | "7.0%" beside "16%" and "30%" in the cards: two-figure percentages, decision in the handoff |
| Reports › Income | ?view=income (pic 23i) | no | — | — | ok | — | — | — |  |
| Reports, drilled into an area (breadcrumb) | a row of Buckets / People | no | — | — | — | — | — | — |  |
| Reports filters (period, pickers) and Filters sheet | header of every view | no | — | — | — | — | — | — |  |
| Reports "as a table" (each chart's figures) | under each chart | no | — | — | — | — | — | — |  |
| Reports, empty | fresh Household (pic 39a) | no | — | — | ok | — | — | — |  |

## Insights, Check-in, Ask

| Surface | How to reach it | Another agent busy? | 1024 | 1280 | 1440 | 1920 | 2560 | dark 1440 | Status / notes |
|---|---|---|---|---|---|---|---|---|---|
| Insights | /insights (pic 24) | no | — | — | — | — | — | — |  |
| Insights, empty | fresh Household (pic 39d) | no | — | — | — | — | — | — |  |
| Perks, its row open, "Add a card or membership" sheets | /insights/perks | yes | — | — | — | — | — | — |  |
| Check-in | /check-in (pic 26) | no | — | — | ok | — | — | — |  |
| Check-in footer | pic 26a | no | — | — | — | — | — | — |  |
| Check-in, each step done inline | work through the steps | no | — | — | — | — | — | — |  |
| Check-in, empty | fresh Household (pic 39e) | no | — | — | — | — | — | — |  |
| Ask | /ask (pic 24x) | no | — | — | — | — | — | — |  |
| Ask with an answer, and its error | ask a question | no | — | — | — | — | — | — |  |
| Ask, empty | fresh Household (pic 39f) | no | — | — | — | — | — | — |  |

## Household settings

| Surface | How to reach it | Another agent busy? | 1024 | 1280 | 1440 | 1920 | 2560 | dark 1440 | Status / notes |
|---|---|---|---|---|---|---|---|---|---|
| Household settings, whole page | /household (pic 27) | no | — | — | ok | — | — | — | two columns start on one line; Danger zone spans both |
| "Your name and colour" sheet | pic 27c | no | — | — | — | — | — | — |  |
| Child sheet | Children › a Child | no | — | — | — | — | — | — |  |
| Invite the other Parent, "Cancel the invite?" dialog | Parents | no | — | — | — | — | — | — |  |
| Check-in, nudge, receipt settings | sections of /household | no | — | — | — | — | — | — |  |
| "Set up tap to capture" sheet | Capture › Set up | no | — | — | — | — | — | — |  |
| Snapshots, "Restore this snapshot?" sheet | Snapshots | no | — | — | — | — | — | — |  |
| Download your data | Data | no | — | — | — | — | — | — |  |
| Start fresh sheet | Danger zone (pic 27a) | no | — | — | — | — | — | — |  |
| Delete Household sheet | Danger zone (pic 27b) | no | — | — | — | — | — | — |  |
| Glossary | /glossary | no | — | — | — | — | — | — |  |

127 rows; 0 looked at in every width and in dark.

## Decisions for the owner (not built)

1. Panel header Edit: a Bucket's is outlined "Edit Bucket", a Commitment's and a Goal's a plain "Edit". Recommend the outlined, named button on all three (73ar pics 05w, 07b).
2. Buckets and Year tables mix "$2,064" and "$106.77" in one column (exact cents). Recommend leaving.
3. Outcome tabs clip at the edge (Scenario panel at 1024 and 1440; Explore's own page at 1024: "Each month" cut, "Goal paths" hidden; the row scrolls). Recommend shorter labels: "Free to Spend", "Balance", "Monthly", "Goals".
4. Compare beside an open Scenario is the stacked list at 1440. Recommend as built.
5. Explore at 1440: the levers column (Commitments, Buckets, Goals, One-offs, Assumptions) runs about 1,600px past the end of the results column. Options: fold Buckets to its first five like Commitments; or keep the results column in view while the levers scroll. Recommend the second.
6. Year table at 1024: October's row is four lines ("October", "This month", "Lumpy", "Actual so far") while the others are two. Options: drop the "This month" badge under 1280 (the row could be tinted instead), or show "Lumpy" as a dot with a tooltip. Recommend dropping "This month" under 1280.
7. Add Buckets with every starter already in the Plan says "Tick the ones you want" above an empty list. Recommend "Add your own" as the description in that case.
8. Seeded Goals and Accounts come out in a different order from run to run (made in one instant, ordered by id): a seeding matter, but if two real items share a creation time the same would show. Recommend a name tie-break in those lists' sort.
