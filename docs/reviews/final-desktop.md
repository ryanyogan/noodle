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
| Sidebar, collapsed to the icon rail | Sidebar trigger | shell agent | ok | ok | ok | ok | ok | ok (layout) | 73as: pic 00 added (only by name); its first run failed (00-sidebar-collapsed.FAILED.png, not diagnosed), so NOT looked at. 73au: COMPLETE. Pic 00 (PAGE_SHOTS_ONLY=00) at all six, one contact sheet opened: the icon rail lines up, the page takes the room |
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
| This Month | /month/$month | yes | ok | ok | ok | ok (72%) | ok (70%) | ok | 73aq: To do card on the 20px edge of the cards around it, Income line under its heading, chips under "To look at". Ended months: pics 01f (nothing left), 01g (short), 01h (short carried in), 01i ("How September ended" Household), opened at 1440. Design choice: an ended month's headline is the planned Free to Spend ("$5,000") over "Ended with nothing left": see the handoff 73at: 1280 and dark 1440 opened on contact sheets (reduced); To look at chips opened at 1024 after 44ac9517, on the card's edge. **73bb: complete.** Pic 01 opened as page crops: 1024 and 1440 whole at full size, 1280 lower half at full size, 1920 and 2560 down to Bills at about 70%, dark down to Travel at full size; 01e (scrolled) at all six, reduced. Clean. The 1024 picture has three "To look at" chips and the others four: the Plan health count is read in the browser and had not arrived (01e at 1024 has all four). Ended months 01f, 01g, 01h, 01i opened at 1024 and 1440 at full size and at 1280, 1920, 2560 and dark reduced (30–50%): clean apart from owner decisions 1 and 4. Seen, not fixed: an ended month still says "Income is $1,599 behind where it usually is by now" (01g, 01i), and its Bucket bars keep the "today" tick at their right end; the Ask button (shell) sits over the rail's right 7px at 1024 and 1280 (over "Add income" in 01d at 1280). |
| This Month, To do row open | To do › a row | yes | fixed 73bb | fixed 73bb | fixed 73bb | fixed 73bb | fixed 73bb | fixed 73bb | pic 02. At 1024 the open row's status is cut with an ellipsis beside the "?" ("…Free to Spend to de…"): open 73at: an open row's status takes a second line instead of an ellipsis; retaken and opened at 1024. **73bb: complete.** Opened at full size at all six (rail crops). Three defects, fixed and retaken at all six: an open row's tint stopped 33px short of the card's right edge, beside the "?"; its chevron stood 32px left of the closed rows' chevrons; "Close September" ended 4px left of the selects above it. The row's button now runs the card's width with the "?" just before the chevron. At 1024 "Subscriptions" broke as "Subscripti/ons" beside its select: the select is 160px from 1024 to 1279. |
| This Month, get started (fresh Household) | /month/$month (pic 30) | yes | ok (reduced) | — | fixed 139b3032 | — | — | — | pic 30: "Add  an Account" had a hole after "Add" (two flex children): one label now; retaken, opened |
| Extra income card, menu and "Send the Extra income" sheet | This Month | yes | fixed 73bb | fixed 73bb | fixed 73bb | fixed 73bb | ok | fixed 73bb | pic 01b opened; 01c (the sheet) taken, NOT opened; the menu not pictured 73at: pic 01c (the sheet) opened at 1440, clean; new pic 01k (an Income line's menu) opened in dark 1440 (reduced). **73bb: complete.** 01b opened at all six (rail crops, 80%), the sheet 01c at all six at 85%, the menu 01k at 1024, 1280, 1440, 1920 and dark (my 2560 crop missed it). The open row had the same short tint and shifted chevron as Close month: fixed, retaken at all six. The sentence under the row started 4px left of the row's name and the buttons since the phone pass (f5060e4c): back on their edge from sm, retaken at 1024 and 1440. The menu covers "Add income" when the line is at the foot of the window (it opens upward): left. |
| Close month | This Month › To do | yes | fixed 73bb | ok | fixed 73bb | ok | ok | ok | pic 01d opened at 1440 (Bucket leftovers, the Extra income row, Close September) **73bb: complete.** 01d opened at all six (rail crops, 80%); the button's 4px and the open row's tint fixed (see the row above), retaken at 1024 and 1440. |
| Cover a Bucket sheet | This Month › an over Bucket | yes | ok | ok | ok | ok | ok | ok | 73at: new pic 01l. A place to Cover from was cut ("Free to Sp…") beside what it has left: from lg the amount sits under the name; retaken and opened at 1024. 1440 taken, not opened. **73av: complete.** The sheet opened at full size at all five widths and in dark: every tile, "Free to Spend" included, shows its whole name with what's left under it; the sheet is the same size and centred at every width. |
| Free to Spend card | This Month, Plan | yes | ok | ok (reduced) | ok | ok (reduced) | ok (reduced) | ok | carried over positive (01), negative (01h) and its month list, opened at 1440 **73bb: complete.** Seen in 01, 01f–01i at all six (scales in the This Month row): figure, sentence, month list, split bar and key line up at every width. |
| Month's plan | /month/$month/plan | yes | ok | ok (50%) | ok | ok (68%) | ok (35%) | ok (60%) | 73at: new pic 01j taken at 1024, 1280, 1440, dark 1440; NOT opened. 73av: pic 01j opened at 1440 at full size (down to the Personal Allowances heading): Allowance, Spent and Left end on one line with their headings and the Total row; clean. Other widths retaken, not opened. **73bb: complete.** 01j opened whole at 1024 at full size and at the other sizes at the scales in the cells: columns end on their headings and Total at every width. Seen, not fixed (shared layout): at 1024 and 1280 "What changed" drops under the Plan as a card of the rail's width (about 330px) with the rest of the row empty. |

## Plan

| Surface | How to reach it | Another agent busy? | 1024 | 1280 | 1440 | 1920 | 2560 | dark 1440 | Status / notes |
|---|---|---|---|---|---|---|---|---|---|
| Plan overview | /plan/$month | yes | ok | ok | ok | ok | ok | ok (layout) | 73ar: pics 03, 03b (Things to check open with its three links, What changed "Show all"). 2560 taken, not opened. Things to check's first warning differs between runs (Hawaii trip / Next car): order not looked into. 73as: 1024 and 2560 opened. Things to check now has one order on every load (ba015993: urgency, then the Goal due soonest / the Bucket furthest over, then name; unit test); 03b retaken at 1440, 1920, 2560, 1440 opened. 73au: COMPLETE. Retaken at all six on one build; contact sheets of the top and the second screen opened (cells reduced) |
| Plan › Buckets table | /plan/$month#buckets | yes | ok | ok | ok | ok | ok | ok (layout) | 73ar: two groups seeded in page-shots (Food, Family and home). Subtotals and Total end on the rows' right edge in Allowance, Spent and Left at 1280, 1440, 1920, dark; the subtotal's Spent was darker than the column: now muted. 1024 and 2560 taken, not opened. Decision kept: exact cents ("$2,064" beside "$106.77"). 73as: 1024 (Pace and End of month give way, subtotals on the rows’ edge) and 2560 opened. 73au: COMPLETE (the same sheets, pic 03) |
| Bucket sheet, More open (Group, colour, Move up/down, Archive) | Buckets table › pencil › More (pic 04a2, 04a4) | yes | ok | ok | ok | ok | ok | ok (layout) | 73ar: one left edge, one primary (Save); centred in the window. 73au: COMPLETE (pic 04a2, sheet opened) |
| Group rename sheet | Buckets table › a group's Rename (pic 04d) | yes | ok | ok | ok | ok | ok | ok (layout) | 73ar: new picture. 73au: COMPLETE (pic 04d) |
| Add Buckets sheet | Plan › Add Buckets | yes | fixed 05afcc46 | fixed 05afcc46 | fixed 05afcc46 | fixed 05afcc46 | fixed 05afcc46 | fixed 05afcc46 (layout) | 73as: the help line read "carries over (?) , keeping": the comma stood a space from its word; reworded so nothing follows the "?" (pic 04e at 1440 before and after). With every starter already in the Plan the sheet still says "Tick the ones you want" over an empty list: copy, open. 73au: COMPLETE. With every starter in the Plan it now says "Every starter Bucket is already in your Plan. Add your own and set what it gets a month." (pic 04e at all six) |
| New Bucket sheet | Bucket picker › New Bucket | yes | — | — | — | — | — | — |  |
| Bucket in the panel | /plan/$month/buckets/$id | yes | ok (drawer) | ok (drawer) | ok | ok | ok | ok (layout) | 73ar: "Spent" and "Even spending by today" figures sat 16px apart when the label wrapped; now on one line (pics 05w). The foot strip clears the Ask button. 1920, 2560, dark taken, not opened. Judgement: its header button is outlined "Edit Bucket" while a Commitment's and Goal's is a plain "Edit". 73au: COMPLETE (pic 05w at all six) |
| Restore Bucket sheet | Bucket panel › history | yes | — | — | — | — | — | — |  |
| Plan editing dialog (discard draft) | Plan › edit, leave | yes | — | — | — | — | — | — |  |
| Plan › Year | /plan/$month/year, /plan/year/$year | yes | open: October row tall | open: October row tall | ok | ok | ok | ok (layout) | 73ar: pic 09 at 1440: planned over actual, Carried over, months below zero in red, the yearly total; all columns end on one edge. Other widths taken, not opened. 73as: at 1024 October’s row was four lines tall ("This month" and "Lumpy" each on its own line); a wider Month column was tried and taken out again: it still left three lines and pushed "Take-home pay" to three. Needs a design choice (Decision 6). 1920 opened. 73au: all six opened (pic 09); 1280 has the tall October row too (three lines). Decision 6 |
| Plan › Commitments | /plan/$month/commitments (pic 06) | no | fixed 05afcc46 | fixed 05afcc46 | ok | ok | ok | ok (layout) | amount column holds the figure alone; a yearly one says "A month’s share of $480 yearly" on its meta line (two lines beside the rail at 1440 and 1024). $11.58 keeps its cents: Plan figures are exact. 73as: 1920 opened: Paid and "Due Oct 1" share one right edge. 73au: COMPLETE. At 1024 and 1280 the list beside the rail had no room for the paid column, so "Paid" showed nowhere; it is now on the row’s second line there (from 640px; phones unchanged). Pic 06 retaken at all six |
| Commitment in the panel | /plan/$month/commitments/$id (pic 07) | no | ok (drawer) | ok (drawer) | ok | ok | ok | ok (layout) | 73ar: retaken at every width with the foot strip (pic 07b); 1440 and 1024 opened. 73au: COMPLETE (pic 07b at all six) |
| Commitment sheet (edit) | Commitment panel › Edit | no | ok | ok | ok | ok | ok | ok (layout) | 73as: pic 07c added (Amount, Name, How often, Next due, Pays down, From October on / Just October, History, End); 1440 opened, 1920 and 2560 taken. 73au: COMPLETE. The 1024 and 1280 pictures had been of the drawer, not the sheet (the shot took the drawer for the dialog): shot fixed, pic 07c retaken at all six |
| Plan › Commitments, empty | fresh Household (pic 39h) | no | — | — | — | — | — | — |  |
| Plan › Goal funding | /plan/$month/goals (pic 08) | no | ok | ok | ok | ok | ok | ok (layout) | 73ar: the dot between "funded this month" and "set aside" had no room before it and two spaces after; now the shared MetaParts dot (f3092b8b). Retaken, NOT opened. The seeded Household has no "Funded" / "Paid off" row: seed one. 73as: retake opened at 1440: the dot has even room. Still no "Funded" / "Paid off" row seeded. 73au: COMPLETE (pic 08 at all six). Still no "Funded" / "Paid off" row seeded |
| Plan › Goal funding, empty | fresh Household (pic 39i) | no | — | — | — | — | — | — |  |
| Plan › Income | /plan/$month/income (pic 08x) | no | ok | ok | ok | ok | ok | ok (layout) | rail no longer repeats the received line or its bar; its help says "here, with Edit take-home pay". 1024 not retaken after this. 73as: 1024 opened (73ar picture). 73au: COMPLETE (pic 08x at all six) |
| Income came in lower | small Household (pic 06a) | no | — | — | — | — | — | — |  |
| "Take-home pay" sheet | Income › Edit take-home pay (pic 06b) | no | ok | ok | ok | ok | ok | ok (layout) | 73au: COMPLETE (pic 06b at all six) |
| Income: money from the other Parent, Between us | pics 40, 41 | no | — | — | — | — | — | — |  |
| Income row actions menu | Income › "Actions for …" | no | ok | ok | ok | ok | ok | ok (layout) | 73as: pic 08y added; menu opens under its button, inside the card. 73au: COMPLETE (pic 08y at all six) |
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
| Reports › Overview | /reports (pic 23) | no | ok | ok (reduced) | ok | — | ok (centred: measured) | ok (reduced) | 73aq: at 2560 the cards span 545–2262 beside a 248px Sidebar, centre 1403.5 of 1404: centred, the "115px" of part 2 was not real (same on This Month). 1280, 1920, dark taken, NOT opened 73at: 1280 and dark 1440 opened on contact sheets (reduced), clean. 73av: 1024 opened at full size, clean. |
| Reports › Big expenses | ?view=big (pic 23b) | no | ok | fixed 73av | fixed 73av | ok | ok | ok | 1280, 1920, 2560 taken, not opened; dark not taken 73at: 1280 and dark 1440 opened on contact sheets (reduced), clean. 73at: from 1024 to 1279 the two cards stack, so "Commitments, by the year" as a table shows all five columns (its fifth, "A year", was under the card's edge at 1024 after 44ac9517); retaken and opened at 1024. **73av: complete.** All six opened at full size on the 73av build (1024 the list view; every width and dark with both tables open). Found at 1280: the Commitments table's fifth column ("This period") went under the card's edge in the two-fifths card; the two cards now stack up to 1439 and sit side by side from 1440; retaken and opened at 1280. Found at every width: "the biggest 13 one-offs over $250" over a table of 27 rows down to $184.62; the table now lists the same one-offs as the list; opened at all six. "This period" is $0 for most Commitments because the pictured Household has no Transactions filed to them (the figure is what was filed to the Commitment in the period): the seed, not the code. 73ay: the 1440 retake made after the breakpoint change opened (45%): the two cards side by side, three fifths and two fifths, clean. |
| Reports › Merchants | ?view=merchants (pic 23f) | no | fixed 73ay | ok | ok | ok | ok | ok | 1280, 1920, 2560 taken, not opened; dark not taken 73at: 1280 and dark 1440 opened on contact sheets (reduced), clean. **73ay: complete.** All six opened on the 73av build. Found at 1024: "By spending" started 19px lower than "By visits" (its description takes two lines); from lg the two headings share one row, so both cards start on one line; retaken at all six, opened at 1024 (whole top), 1280 and 2560 (the heading and first rows). Sizes opened by 73ay: 1024 at 100%, 1280 at 75–80%, 1920 at 55–70%, 2560 at 55–65%, dark 1440 at 60–75%, light 1440 at 45–50% (same window as dark); page region only, pictures in handoffs `73ay-shots/look/`. |
| Reports › Cash flow | ?view=cash-flow (pic 23a) | no | — | — | ok | — | — | ok (reduced) | 73at: pic 23a opened at 1440 (light, and dark reduced), clean. |
| Reports › Buckets | ?view=buckets (pic 23c) | no | ok | ok (reduced) | fixed 99cccec2 | ok (top 700px, reduced) | — | ok (reduced) | 1280, 2560 taken, not opened; dark not taken 73at: 1280 and dark 1440 opened on contact sheets (reduced), clean. 73av: 1024 opened at full size (top 1560px), clean. |
| Reports › Plan vs actual | ?view=plan (pic 23d) | no | ok | ok (reduced) | fixed 99cccec2 | — | — | ok (reduced) | heatmap clean at 1024 (reduced); the "money format" note at 1024 was the chips, whole dollars since 99cccec2 73at: 1280 and dark 1440 opened on contact sheets (reduced), clean. 73av: 1024 opened at full size (top 1560px), clean. |
| Reports › Trends | ?view=trends (pic 23e) | no | fixed 73ay | ok | ok | fixed 73ay | fixed 73ay | ok | 73aq: "Every day" now fills its card from lg (weeks up to 48px wide), read-out and key on one line; retaken and opened at 1440, reduced at 1024. The read-out keeps cents by design 73at: 1280 and dark 1440 opened on contact sheets (reduced), clean. **73ay: complete.** All six opened. Found at 1024: "Every day" was 25px wider than its card, so its first week (May 1–3) sat under the weekday names and "May" stood over them; weeks may narrow to 20px from lg and a month name no longer adds a column past the last week: the half year fits. Found at 1920 and 2560: the weekday names stood 180–240px left of the grid (an auto column took the spare width); the grid now starts beside them. Retaken at all six; "Every day" opened at 1024, 1280, 1920, 2560 and dark. Left as is: with weeks capped at 48px a half year ends at about 80% of the card at 1920 and 72% at 2560. Sizes opened by 73ay: 1024 at 100%, 1280 at 75–80%, 1920 at 55–70%, 2560 at 55–65%, dark 1440 at 60–75%, light 1440 at 45–50% (same window as dark); page region only, pictures in handoffs `73ay-shots/look/`. |
| Reports › People | ?view=people (pic 23g) | no | fixed 73ay | ok | ok | ok | ok | ok | 73aq: footnote in whole dollars ("$4,834 this month, $20,484 this year"); e2e/children.spec.ts follows 73at: 1280 and dark 1440 opened on contact sheets (reduced), clean. **73ay: complete.** All six opened. Found at 1024: "Spending for each person" started 19px lower than "What each Child costs" (two-line description): same heading row as Merchants; retaken at all six, opened at 1024, 1280, 2560. Sizes opened by 73ay: 1024 at 100%, 1280 at 75–80%, 1920 at 55–70%, 2560 at 55–65%, dark 1440 at 60–75%, light 1440 at 45–50% (same window as dark); page region only, pictures in handoffs `73ay-shots/look/`. |
| Reports › Goals | ?view=goals (pic 23h) | no | ok | ok | ok | ok | ok | ok | 73aq: whole percents from 1% ("7%"); the status lines of a row of cards sit on one line with or without a badge; retaken and opened 73at: 1280 and dark 1440 opened on contact sheets (reduced), clean. **73ay: complete.** All six opened, nothing to fix. Seen, not fixed: the Goals (lines, key and cards) come in a different order in each pictured Household (Hawaii trip first at 1024, Emergency fund first at 1280, Next car first at 2560), so the order is not by name, target or amount: check the query's order. Sizes opened by 73ay: 1024 at 100%, 1280 at 75–80%, 1920 at 55–70%, 2560 at 55–65%, dark 1440 at 60–75%, light 1440 at 45–50% (same window as dark); page region only, pictures in handoffs `73ay-shots/look/`. |
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
| Check-in | /check-in (pic 26) | no | ok | ok (reduced) | ok | ok (reduced) | ok (reduced) | ok (reduced) | pic 26 opened again at 1440, clean **73bb: complete.** Opened at 1024 and 1440 at full size, the rest at 25–40%. Clean. The 2560 picture has the card without its five Transactions (taken before they arrived; 26a at 2560 has them). |
| Check-in footer | pic 26a | no | ok | ok | ok | ok | ok | ok | 73at: pic 26a opened at 1440, clean. **73bb: complete.** 26a's foot opened at all six at 60%: "Open full page" on the card's edge, "Skip for now" a text button whose words end 16px inside the amounts above (its own padding). |
| Check-in, each step done inline | work through the steps | no | ok | ok (reduced) | ok | ok (reduced) | ok (reduced) | ok (reduced) | 73at: new pics 26b, 26c, 26d (Insights, Sweeps, Extra income, each reached with Skip for now). The "?" of the Sweeps and Extra income cards dropped to a line of its own under a two-line sentence: it follows the last word now; retaken and opened at 1024 (Sweeps). Seen, not fixed (packages/ui StepList): a done step's name starts 8px right of a waiting one's. Steps actually completed inline (a Sweep chosen, Extra income sent) not pictured. 73bb: 26b, 26c, 26d opened at 1024 and 1440 at full size, the rest at 25–40%: clean (a done step's status wraps one word later than a waiting one's, from the 8px of decision 5). Still partly: the steps were reached with Skip for now, none completed inline. |
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

127 rows; 13 looked at in every width and in dark (73au: Sidebar collapsed and twelve Plan rows, from contact sheets in `73au-shots/sheets/`).

## Decisions for the owner (not built)

1. Panel header Edit: a Bucket's is outlined "Edit Bucket", a Commitment's and a Goal's a plain "Edit". Recommend the outlined, named button on all three (73ar pics 05w, 07b).
2. Buckets and Year tables mix "$2,064" and "$106.77" in one column (exact cents). Recommend leaving.
3. Outcome tabs clip at the edge (Scenario panel at 1024 and 1440; Explore's own page at 1024: "Each month" cut, "Goal paths" hidden; the row scrolls). Recommend shorter labels: "Free to Spend", "Balance", "Monthly", "Goals".
4. Compare beside an open Scenario is the stacked list at 1440. Recommend as built.
5. Explore at 1440: the levers column (Commitments, Buckets, Goals, One-offs, Assumptions) runs about 1,600px past the end of the results column. Options: fold Buckets to its first five like Commitments; or keep the results column in view while the levers scroll. Recommend the second.
6. Year table at 1024: October's row is four lines ("October", "This month", "Lumpy", "Actual so far") while the others are two. Options: drop the "This month" badge under 1280 (the row could be tinted instead), or show "Lumpy" as a dot with a tooltip. Recommend dropping "This month" under 1280.
7. (Built in 73au, 05afcc46, on the lead’s say.) Add Buckets with every starter already in the Plan says "Tick the ones you want" above an empty list. Recommend "Add your own" as the description in that case.
8. (Settled in 73au: the app orders by creation time, then id, which is the same on every load; only the pictures’ seed made them in one instant, and it now gives each its own time.) Seeded Goals and Accounts come out in a different order from run to run (made in one instant, ordered by id): a seeding matter, but if two real items share a creation time the same would show. Recommend a name tie-break in those lists' sort.
