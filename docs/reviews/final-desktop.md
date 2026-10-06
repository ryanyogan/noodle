# Final desktop pass (issue 73)

The inventory the last comment on issue 73 asks for: every desktop surface, at every desktop width and in dark, each cell marked only from a picture that was opened.

- `—` not looked at · `ok` looked at, nothing wrong · `fixed <sha>` a defect found in that picture and fixed (the picture was retaken) · `open: …` a defect or a decision still to make.
- Dark is judged for layout only until the dark colours are settled.
- Pictures: `e2e/page-shots.spec.ts` (`PAGE_SHOTS_ONLY=<pic>`, `PAGE_SHOTS_WIDTHS=1024,1280,1440,1920,2560`, `PAGE_SHOTS_THEME=dark`); the "pic" in "How to reach it" is the picture's name there. The record of each phase's pictures is kept beside its handoff (`handoffs/phases/<phase>-shots/`).
- "Another agent busy?" says who owned the surface during part 1 (phase 73ao, 2026-10-05); those rows come in part 2.


## Shell

| Surface | How to reach it | Another agent busy? | 1024 | 1280 | 1440 | 1920 | 2560 | dark 1440 | Status / notes |
|---|---|---|---|---|---|---|---|---|---|
| Sidebar, open | any page from 1024 | shell agent | open: at 1024×768 the last link (Household settings) is cut by the Sidebar's foot until it is scrolled | — | ok | — | — | — | seen on every picture below; the shell agent's |
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
| This Month | /month/$month | yes | — | — | — | — | — | — |  |
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
| Plan overview | /plan/$month | yes | — | — | — | — | — | — |  |
| Plan › Buckets table | /plan/$month#buckets | yes | — | — | — | — | — | — |  |
| Add Buckets sheet | Plan › Add Buckets | yes | — | — | — | — | — | — |  |
| New Bucket sheet | Bucket picker › New Bucket | yes | — | — | — | — | — | — |  |
| Bucket in the panel | /plan/$month/buckets/$id | yes | — | — | — | — | — | — |  |
| Restore Bucket sheet | Bucket panel › history | yes | — | — | — | — | — | — |  |
| Plan editing dialog (discard draft) | Plan › edit, leave | yes | — | — | — | — | — | — |  |
| Plan › Year | /plan/$month/year, /plan/year/$year | yes | — | — | — | — | — | — |  |
| Plan › Commitments | /plan/$month/commitments (pic 06) | no | — | — | ok | — | — | — | seen under the open panel (pic 07). Decision: yearly rows say $40/mo in the amount column, so figures don't end on one digit edge |
| Commitment in the panel | /plan/$month/commitments/$id (pic 07) | no | — | — | ok | — | — | — | the floating Ask button covers the last line of the panel's text at the window's bottom right (shell) |
| Commitment sheet (edit) | Commitment panel › Edit | no | — | — | — | — | — | — |  |
| Plan › Commitments, empty | fresh Household (pic 39h) | no | — | — | — | — | — | — |  |
| Plan › Goal funding | /plan/$month/goals (pic 08) | no | — | — | — | — | — | — |  |
| Plan › Goal funding, empty | fresh Household (pic 39i) | no | — | — | — | — | — | — |  |
| Plan › Income | /plan/$month/income (pic 08x) | no | fixed 007ffe4 | — | fixed 007ffe4 | — | — | — | row amounts were regular weight, now semibold like every list. Open (copy): the rail repeats "$11,868 received of $9,400" and says "change it on Plan › Income" on that page |
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
| Accounts list | /accounts (pic 15) | no | — | — | open: cards in a row centre their content, so a card with the "Log in again" line sits its name 5px higher and its balance 5px lower than its neighbour (ListRow card, packages/ui) | — | — | — | pic 16 |
| Accounts, archived open | pic 15a | no | — | — | — | — | — | — |  |
| Account in the panel (credit card) | /accounts/$id (pic 16) | no | — | — | ok | — | — | — | long name wraps to two lines beside More/Close (decided in issue 107). Ask button covers a row's amount (shell). "Perks for this card" names the card twice (Perks agent) |
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
| Reports › Overview | /reports (pic 23) | no | open: money format | — | — | — | — | — | open (decision): amounts in one column mix whole dollars and cents ($14,400 beside $6,656.62), the app-wide formatMoney; see the handoff. Layout, chart, stat row, filters: clean |
| Reports › Big expenses | ?view=big (pic 23b) | no | ok | — | — | — | — | — | bars, both lists and the chart line up; the two cards end 30px apart (content-length, fine) |
| Reports › Merchants | ?view=merchants (pic 23f) | no | — | — | ok | — | — | — | one row ($841.65) has cents, same decision as above |
| Reports › Cash flow | ?view=cash-flow (pic 23a) | no | — | — | — | — | — | — |  |
| Reports › Buckets | ?view=buckets (pic 23c) | no | — | — | open: money format | — | — | — | donut centre says $38,056.66 where the Overview stat says $38,057; rows mix formats |
| Reports › Plan vs actual | ?view=plan (pic 23d) | no | open: money format | — | — | — | — | — | heatmap clean; the over/under chips mix $2,483 and $224.38 |
| Reports › Trends | ?view=trends (pic 23e) | no | — | — | — | — | — | — |  |
| Reports › People | ?view=people (pic 23g) | no | — | — | — | — | — | — |  |
| Reports › Goals | ?view=goals (pic 23h) | no | — | — | — | — | — | — |  |
| Reports › Income | ?view=income (pic 23i) | no | — | — | — | — | — | — |  |
| Reports, drilled into an area (breadcrumb) | a row of Buckets / People | no | — | — | — | — | — | — |  |
| Reports filters (period, pickers) and Filters sheet | header of every view | no | — | — | — | — | — | — |  |
| Reports "as a table" (each chart's figures) | under each chart | no | — | — | — | — | — | — |  |
| Reports, empty | fresh Household (pic 39a) | no | — | — | — | — | — | — |  |

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
