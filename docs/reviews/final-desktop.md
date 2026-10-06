# Final desktop pass (issue 73)

The inventory the last comment on issue 73 asks for: every desktop surface, at every desktop width and in dark, each cell marked only from a picture that was opened.

- `—` not looked at · `ok` looked at, nothing wrong · `fixed <sha>` a defect found in that picture and fixed (the picture was retaken) · `open: …` a defect or a decision still to make.
- Dark is judged for layout only until the dark colours are settled.
- Pictures: `e2e/page-shots.spec.ts` (`PAGE_SHOTS_ONLY=<pic>`, `PAGE_SHOTS_WIDTHS=1024,1280,1440,1920,2560`, `PAGE_SHOTS_THEME=dark`); the "pic" in "How to reach it" is the picture's name there. The record of each phase's pictures is kept beside its handoff (`handoffs/phases/<phase>-shots/`).
- "Another agent busy?" says who owned the surface during part 1 (phase 73ao, 2026-10-05); those rows come in part 2.


## Shell

| Surface | How to reach it | Another agent busy? | 1024 | 1280 | 1440 | 1920 | 2560 | dark 1440 | Status / notes |
|---|---|---|---|---|---|---|---|---|---|
| Sidebar, open | any page from 1024 | shell agent | open: at 1024×768 the last link (Household settings) is cut by the Sidebar's foot until it is scrolled | — | ok | — | — | — | seen on every picture below; 1024×768 still cuts the last link (opened again in part 2, pic 23 at 1024): NOT fixed |
| Sidebar, collapsed to the icon rail | Sidebar trigger | shell agent | — | — | — | — | — | — |  |
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
| This Month | /month/$month | yes | ok (reduced) | ok (reduced) | fixed 139b3032 | — | ok (centring measured only) | ok (reduced) | 73aq: To do card on the 20px edge of the cards around it, Income line under its heading, chips under "To look at". Ended months: pics 01f (nothing left), 01g (short), 01h (short carried in), 01i ("How September ended" Household), opened at 1440. Design choice: an ended month's headline is the planned Free to Spend ("$5,000") over "Ended with nothing left": see the handoff 73at: 1280 and dark 1440 opened on contact sheets (reduced); To look at chips opened at 1024 after 44ac9517, on the card's edge. |
| This Month, To do row open | To do › a row | yes | fixed 08dbe20a | ok (reduced) | fixed 139b3032 | — | — | ok (reduced) | pic 02. At 1024 the open row's status is cut with an ellipsis beside the "?" ("…Free to Spend to de…"): open 73at: an open row's status takes a second line instead of an ellipsis; retaken and opened at 1024. |
| This Month, get started (fresh Household) | /month/$month (pic 30) | yes | ok (reduced) | — | fixed 139b3032 | — | — | — | pic 30: "Add  an Account" had a hole after "Add" (two flex children): one label now; retaken, opened |
| Extra income card, menu and "Send the Extra income" sheet | This Month | yes | ok (reduced) | ok (reduced) | ok | — | — | — | pic 01b opened; 01c (the sheet) taken, NOT opened; the menu not pictured 73at: pic 01c (the sheet) opened at 1440, clean; new pic 01k (an Income line's menu) opened in dark 1440 (reduced). |
| Close month | This Month › To do | yes | ok (reduced) | ok (reduced) | ok | — | — | ok (reduced) | pic 01d opened at 1440 (Bucket leftovers, the Extra income row, Close September) |
| Cover a Bucket sheet | This Month › an over Bucket | yes | ok | ok | ok | ok | ok | ok | 73at: new pic 01l. A place to Cover from was cut ("Free to Sp…") beside what it has left: from lg the amount sits under the name; retaken and opened at 1024. 1440 taken, not opened. **73av: complete.** The sheet opened at full size at all five widths and in dark: every tile, "Free to Spend" included, shows its whole name with what's left under it; the sheet is the same size and centred at every width. |
| Free to Spend card | This Month, Plan | yes | ok (reduced) | — | ok | — | — | — | carried over positive (01), negative (01h) and its month list, opened at 1440 |
| Month's plan | /month/$month/plan | yes | — | — | ok | — | — | — | 73at: new pic 01j taken at 1024, 1280, 1440, dark 1440; NOT opened. 73av: pic 01j opened at 1440 at full size (down to the Personal Allowances heading): Allowance, Spent and Left end on one line with their headings and the Total row; clean. Other widths retaken, not opened. |

## Plan

| Surface | How to reach it | Another agent busy? | 1024 | 1280 | 1440 | 1920 | 2560 | dark 1440 | Status / notes |
|---|---|---|---|---|---|---|---|---|---|
| Plan overview | /plan/$month | yes | — | — | — | — | — | — |  |
| Plan › Buckets table | /plan/$month#buckets | yes | — | — | — | — | — | — |  |
| Add Buckets sheet | Plan › Add Buckets | yes | — | — | — | — | — | — |  |
| New Bucket sheet | Bucket picker › New Bucket | yes | — | — | — | — | — | — |  |
| Bucket in the panel | /plan/$month/buckets/$id | yes | — | — | — | — | — | — |  |
| Restore Bucket sheet | Bucket panel › history | yes | — | — | — | — | — | — |  |
| Plan editing dialog (discard draft) | Plan › edit, leave | yes | — | — | — | — | — | — |  |
| Plan › Year | /plan/$month/year, /plan/year/$year | yes | — | — | — | — | — | — |  |
| Plan › Commitments | /plan/$month/commitments (pic 06) | no | fixed 526a6722 | — | fixed 526a6722 | — | — | ok (layout) | amount column holds the figure alone; a yearly one says "A month’s share of $480 yearly" on its meta line (two lines beside the rail at 1440 and 1024). $11.58 keeps its cents: Plan figures are exact |
| Commitment in the panel | /plan/$month/commitments/$id (pic 07) | no | — | — | fixed 5277492e | — | — | — | the panel ends in a 64px strip of its own ground under the Ask button (detail-panel.tsx); retaken, pic 07 |
| Commitment sheet (edit) | Commitment panel › Edit | no | — | — | — | — | — | — |  |
| Plan › Commitments, empty | fresh Household (pic 39h) | no | — | — | — | — | — | — |  |
| Plan › Goal funding | /plan/$month/goals (pic 08) | no | — | — | — | — | — | — |  |
| Plan › Goal funding, empty | fresh Household (pic 39i) | no | — | — | — | — | — | — |  |
| Plan › Income | /plan/$month/income (pic 08x) | no | fixed 007ffe4 | — | fixed 526a6722 | — | — | — | rail no longer repeats the received line or its bar; its help says "here, with Edit take-home pay". 1024 not retaken after this |
| Income came in lower | small Household (pic 06a) | no | — | — | — | — | — | — |  |
| "Take-home pay" sheet | Income › Edit take-home pay (pic 06b) | no | — | — | — | — | — | — |  |
| Income: money from the other Parent, Between us | pics 40, 41 | no | — | — | — | — | — | — |  |
| Income row actions menu | Income › "Actions for …" | no | — | — | — | — | — | — |  |
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
| Accounts list | /accounts (pic 15) | no | — | — | fixed 836a1ade | — | — | — | cards start at the top, balance on the bottom line (pic 16, under the panel) |
| Accounts, archived open | pic 15a | no | — | — | — | — | — | — |  |
| Account in the panel (credit card) | /accounts/$id (pic 16) | no | — | — | ok | — | — | — | part 2: the first foot strip sat 64px too high (opened); corrected in 5277492e and retaken, but the retake of pic 16 was NOT opened (pic 07 was) |
| Account in the panel (no balance) | pic 16a | no | — | — | — | — | — | — |  |
| Account actions menu | Account panel › More | no | — | — | — | — | — | — |  |
| Rename Account sheet | Account menu › Rename | no | — | — | — | — | — | — |  |
| "Add an Account" sheet | Accounts › Add an Account | no | — | — | — | — | — | — |  |
| Bank connection sheets (history length, which do you have, already connected) | Accounts › Connect a bank | no | — | — | — | — | — | — |  |
| Accounts, empty | fresh Household (pic 39c) | no | — | — | — | — | — | — |  |

## Goals

| Surface | How to reach it | Another agent busy? | 1024 | 1280 | 1440 | 1920 | 2560 | dark 1440 | Status / notes |
|---|---|---|---|---|---|---|---|---|---|
| Goals list | /goals (pic 17) | no | — | — | ok | — | — | — | pic 18, under the panel. "$398.15 a month" beside "$450 a month": the money decision |
| Goal in the panel | /goals/$id (pic 18) | no | — | — | fixed 7f7440e | — | — | — | History: the row with Undo pushed its amount off the right edge the others share; retaken and clean |
| Goal with a long history | pic 18a, 18b | no | — | — | — | — | — | — |  |
| Payoff Goal in the panel | /goals/$id of a payoff Goal | no | — | — | — | — | — | — |  |
| Edit Goal sheet / Edit payoff Goal sheet | Goal panel › Edit | no | — | — | — | — | — | — |  |
| New Goal sheet | Goals › New Goal | no | — | — | — | — | — | — |  |
| Goal's Account | /goals/accounts/$accountId | no | — | — | — | — | — | — |  |
| Goals, empty | fresh Household (pic 39b) | no | — | — | — | — | — | — |  |

## Explore

| Surface | How to reach it | Another agent busy? | 1024 | 1280 | 1440 | 1920 | 2560 | dark 1440 | Status / notes |
|---|---|---|---|---|---|---|---|---|---|
| Explore | /explore (pic 19) | no | — | — | — | — | — | — |  |
| Explore with a change | pic 19a | no | — | — | — | — | — | — |  |
| Explore, a line's sheet | pic 19b | no | — | — | — | — | — | — |  |
| Explore, a group open | pic 19d | no | — | — | — | — | — | — |  |
| Explore, raises and inflation sheet | pic 19c | no | — | — | — | — | — | — |  |
| "Apply to the Plan" dialog | Explore › Apply | no | — | — | — | — | — | — |  |
| Explore, empty | fresh Household (pic 39g) | no | — | — | — | — | — | — |  |
| Can we afford it? (house) | /explore/afford (pic 20) | no | — | — | — | — | — | — |  |
| Can we afford it? (car) | pic 20a | no | — | — | — | — | — | — |  |
| Can we afford it? (anything) | pic 20b | no | — | — | — | — | — | — |  |
| Can we afford it?, empty | fresh Household (pic 39k) | no | — | — | — | — | — | — |  |
| Scenarios list, compare | /explore/scenarios | yes | — | — | — | — | — | — |  |
| Scenario, Rename and Delete dialogs | /explore/scenarios/$id | yes | — | — | — | — | — | — |  |

## Reports

| Surface | How to reach it | Another agent busy? | 1024 | 1280 | 1440 | 1920 | 2560 | dark 1440 | Status / notes |
|---|---|---|---|---|---|---|---|---|---|
| Reports › Overview | /reports (pic 23) | no | ok | ok (reduced) | ok | — | ok (centred: measured) | ok (reduced) | 73aq: at 2560 the cards span 545–2262 beside a 248px Sidebar, centre 1403.5 of 1404: centred, the "115px" of part 2 was not real (same on This Month). 1280, 1920, dark taken, NOT opened 73at: 1280 and dark 1440 opened on contact sheets (reduced), clean. 73av: 1024 opened at full size, clean. |
| Reports › Big expenses | ?view=big (pic 23b) | no | ok | fixed 73av | fixed 73av | ok | ok | ok | 1280, 1920, 2560 taken, not opened; dark not taken 73at: 1280 and dark 1440 opened on contact sheets (reduced), clean. 73at: from 1024 to 1279 the two cards stack, so "Commitments, by the year" as a table shows all five columns (its fifth, "A year", was under the card's edge at 1024 after 44ac9517); retaken and opened at 1024. **73av: complete.** All six opened at full size on the 73av build (1024 the list view; every width and dark with both tables open). Found at 1280: the Commitments table's fifth column ("This period") went under the card's edge in the two-fifths card; the two cards now stack up to 1439 and sit side by side from 1440; retaken and opened at 1280. Found at every width: "the biggest 13 one-offs over $250" over a table of 27 rows down to $184.62; the table now lists the same one-offs as the list; opened at all six. "This period" is $0 for most Commitments because the pictured Household has no Transactions filed to them (the figure is what was filed to the Commitment in the period): the seed, not the code. |
| Reports › Merchants | ?view=merchants (pic 23f) | no | ok (reduced) | ok (reduced) | fixed 99cccec2 | — | — | ok (reduced) | 1280, 1920, 2560 taken, not opened; dark not taken 73at: 1280 and dark 1440 opened on contact sheets (reduced), clean. |
| Reports › Cash flow | ?view=cash-flow (pic 23a) | no | — | — | ok | — | — | ok (reduced) | 73at: pic 23a opened at 1440 (light, and dark reduced), clean. |
| Reports › Buckets | ?view=buckets (pic 23c) | no | ok | ok (reduced) | fixed 99cccec2 | ok (top 700px, reduced) | — | ok (reduced) | 1280, 2560 taken, not opened; dark not taken 73at: 1280 and dark 1440 opened on contact sheets (reduced), clean. 73av: 1024 opened at full size (top 1560px), clean. |
| Reports › Plan vs actual | ?view=plan (pic 23d) | no | ok | ok (reduced) | fixed 99cccec2 | — | — | ok (reduced) | heatmap clean at 1024 (reduced); the "money format" note at 1024 was the chips, whole dollars since 99cccec2 73at: 1280 and dark 1440 opened on contact sheets (reduced), clean. 73av: 1024 opened at full size (top 1560px), clean. |
| Reports › Trends | ?view=trends (pic 23e) | no | ok (reduced) | ok (reduced) | fixed 401e6ef7 | — | — | ok (reduced) | 73aq: "Every day" now fills its card from lg (weeks up to 48px wide), read-out and key on one line; retaken and opened at 1440, reduced at 1024. The read-out keeps cents by design 73at: 1280 and dark 1440 opened on contact sheets (reduced), clean. |
| Reports › People | ?view=people (pic 23g) | no | ok (reduced) | ok (reduced) | fixed 401e6ef7 | — | — | ok (reduced) | 73aq: footnote in whole dollars ("$4,834 this month, $20,484 this year"); e2e/children.spec.ts follows 73at: 1280 and dark 1440 opened on contact sheets (reduced), clean. |
| Reports › Goals | ?view=goals (pic 23h) | no | ok (reduced) | ok (reduced) | fixed 401e6ef7 | — | — | ok (reduced) | 73aq: whole percents from 1% ("7%"); the status lines of a row of cards sit on one line with or without a badge; retaken and opened 73at: 1280 and dark 1440 opened on contact sheets (reduced), clean. |
| Reports › Income | ?view=income (pic 23i) | no | — | — | ok | — | — | — | 73at: pic 23i opened at 1440, clean; "By source" is a short list in a card as tall as the chart beside it. |
| Reports, drilled into an area (breadcrumb) | a row of Buckets / People | no | ok (reduced) | — | fixed 401e6ef7 | — | — | — | pic 23u (new). The Transactions card had a line over its first row under 20px of nothing: removed, retaken, opened |
| Reports filters (period, pickers) and Filters sheet | header of every view | no | — | — | ok | — | — | ok (reduced) | pics 23v (Period menu), 23w (Filters sheet), new; opened at 1440 only. Compare with / Group by menus and the custom range pickers not pictured 73at: new pics 23x (Compare with menu), 23y (Group by menu), 23z (custom range, From calendar open), 23s (focus ring on Period, pointer over a row): taken at 1024, 1280, 1440, dark 1440; opened in dark 1440 (reduced) only, clean. 73av: pic 23y (Group by menu) opened at 1440 at full size, clean. |
| Reports "as a table" (each chart's figures) | under each chart | no | fixed 08dbe20a | — | fixed 401e6ef7 | — | — | — | pics 23t-* (new, all ten views). Fixed: one money format and one percent format down a column, day keys written as dates, 24px between columns (the shared Table's own). Opened at 1440 for every view (Trends' and Plan vs actual's only the top). Commitments, by the year has five columns and its last went under the card's edge at 1440 and 1024: from lg names now wrap instead (44ac9517); that last change is NOT pictured 73at: a day in a table stays on one line ("Oct 5, 2026" broke in two at 1024); retaken and opened at 1024 (Big expenses). What each Child cost, by Bucket (child-costs.tsx) now has the shared table's padding, header height and row lines: opened once at 1280 from the children spec (top rows only). Seen, not fixed: "Largest Transactions" says "the biggest 13 one-offs over $250" and its table lists 27 rows down to $184.62. 73av: Largest Transactions now lists what its sentence counts (see Big expenses). |
| Reports, empty | fresh Household (pic 39a) | no | — | — | ok | — | — | — | 73at: pic 39a opened at 1440, clean. |

## Insights, Check-in, Ask

| Surface | How to reach it | Another agent busy? | 1024 | 1280 | 1440 | 1920 | 2560 | dark 1440 | Status / notes |
|---|---|---|---|---|---|---|---|---|---|
| Insights | /insights (pic 24) | no | — | — | — | — | — | — |  |
| Insights, empty | fresh Household (pic 39d) | no | — | — | — | — | — | — |  |
| Perks, its row open, "Add a card or membership" sheets | /insights/perks | yes | — | — | — | — | — | — |  |
| Check-in | /check-in (pic 26) | no | ok (reduced) | ok (reduced) | ok | — | — | ok (reduced) | pic 26 opened again at 1440, clean |
| Check-in footer | pic 26a | no | — | — | ok | — | — | — | 73at: pic 26a opened at 1440, clean. |
| Check-in, each step done inline | work through the steps | no | fixed 915f53e4 | — | — | — | — | — | 73at: new pics 26b, 26c, 26d (Insights, Sweeps, Extra income, each reached with Skip for now). The "?" of the Sweeps and Extra income cards dropped to a line of its own under a two-line sentence: it follows the last word now; retaken and opened at 1024 (Sweeps). Seen, not fixed (packages/ui StepList): a done step's name starts 8px right of a waiting one's. Steps actually completed inline (a Sweep chosen, Extra income sent) not pictured. |
| Check-in, empty | fresh Household (pic 39e) | no | fixed 73av | fixed 73av | fixed 73av | fixed 73av | fixed 73av | fixed 73av | 73at: pic 39e opened at 1440; the done card is 480px wide at the left of a wide page. **73av: complete.** The done card now takes the page's column from 1024 (it stopped at 768px, at the left); retaken and opened at full size at all five widths and in dark. |
| Ask | /ask (pic 24x) | no | — | — | — | — | — | — |  |
| Ask with an answer, and its error | ask a question | no | — | — | — | — | — | — |  |
| Ask, empty | fresh Household (pic 39f) | no | — | — | — | — | — | — |  |

## Decisions for the owner (Reports, This Month, Check-in)

Not built; each waits for a yes or no.

1. **Ended month's headline** (pics 01f, 01g). The big figure is the planned Free to Spend ("$5,000") over "Ended with nothing left". Recommended: the headline is what the month ended with; the planned figure stays in the split below.
2. **One format down a table column.** Report tables read "$14,400.00" when a neighbour has cents and "37.8%" when a neighbour is under 10%. Recommended: keep. Still mixed elsewhere: This Month's legends and Bucket rows, and "What each Child cost" ("$64.99" beside "$20").
3. **Big expenses below 1440.** The list and "Commitments, by the year" stack from 1024 to 1439 (73at stacked to 1279; 73av to 1439 because the table's last column was cut at 1280). Alternative: side by side from 1024 with "Cadence" left out of the table.
4. **An ended month with no Buckets** leaves the left column empty beside Free to Spend (01f). Only reachable with rows dated before the first Plan. Recommended: leave.
5. **Check-in step list** (shared `StepList`): a done step's name starts 8px right of a waiting step's. A change there reaches every user of the component.

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
