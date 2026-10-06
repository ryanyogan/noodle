# Final phone pass (issue 74)

The inventory the last comment on issue 74 asks for: every surface a phone can reach, at every phone size, with the keyboard up, in dark and in WebKit. A cell is marked only from a picture that was opened.

- `—` not looked at · `ok` looked at, nothing wrong · `fixed <sha>` a defect found in that picture and fixed (the picture was retaken and opened) · `open: …` a defect or a decision still to make.
- Sizes: 320×568, 375×667, 393×852, 430×932. "Keyboard" is the same surface in a window about 500px tall. Dark is judged for layout only until the dark colours are settled (issue 116).
- WebKit cannot run on the work machine. The WebKit column stays `—` unless a picture from CI's WebKit jobs was opened; the notes say which `phone-*` spec covers the surface there (a passing spec is not a picture).
- Pictures: `e2e/page-shots.spec.ts` (`PAGE_SHOTS_ONLY=<pic>`, `PAGE_SHOTS_WIDTHS=320,375,393,430`, `PAGE_SHOTS_HEIGHT=568` or `500`, `PAGE_SHOTS_THEME=dark`); "pic" is the picture's name there. A row with no pic has no picture step yet: the next phase adds one.
- The record of each phase's pictures is kept beside its handoff (`handoffs/phases/74an-shots/<size>/`).
- A full-page picture draws the tab bar once, over the first screen: that is the picture, not the page.
- Part 1 (phase 74an, 2026-10-05) looked at section A only. Sections B to D and the shell are part 2.

## Shell

| Surface | How to reach it | 320×568 | 375×667 | 393×852 | 430×932 | keyboard | dark 393 | WebKit | Status / notes |
|---|---|---|---|---|---|---|---|---|---|
| Tab bar (Month, Transactions, Quick Add, Goals, More) | every page | ok | ok | ok | ok | — | ok | — | seen on every picture below (320 at 640 tall). CI: `phone-header`, `phone-crowding`, `phone-pwa` (safe areas) |
| Page header (title, one action, tabs row) | every page | — | — | — | — | — | — | — | only This Month's was looked at (below). CI: `phone-header` |
| More sheet | tab bar › More (pic 29) | — | — | — | — | — | — | — | known: "Perks & Benefits" and "Household settings" take two lines at 320 |
| Term help popover | any "?" beside a heading | — | — | — | — | — | — | — |  |
| Toast: plain, with Undo, error, two stacked | save, delete, a failed save | — | — | — | — | — | — | — | known: two toasts stack close to the tab bar after two Quick Adds |
| "Leave without saving?" dialog | leave an edited form | — | — | — | — | — | — | — |  |
| Intro video dialog | sign-in, sign-up, setup › Watch | — | — | — | — | — | — | — |  |
| Route error screen | a loader that throws | — | — | — | — | — | — | — |  |
| Not-found screen | an unknown address | — | — | — | — | — | — | — |  |
| Section loading skeleton | a slow loader | — | — | — | — | — | — | — |  |
| 200% text size | iOS larger text, every page | — | — | — | — | — | — | — | CI: `phone-large-text` (WebKit); it failed once on the Plan's Buckets table |

## Signed out and getting started

| Surface | How to reach it | 320×568 | 375×667 | 393×852 | 430×932 | keyboard | dark 393 | WebKit | Status / notes |
|---|---|---|---|---|---|---|---|---|---|
| Sign in | /sign-in (`auth-shots`) | — | — | — | — | — | — | — |  |
| Sign up | /sign-up (`auth-shots`) | open: footer splits into two columns, email placeholder cut (Clerk's card) | — | — | — | — | — | — | "Watch the 1-minute intro" added as sign-in has it, NOT yet pictured; the `auth-shots` baselines will change |
| Sign up, verify code | /sign-up/verify-email-address | — | — | — | — | — | — | — |  |
| Invite | /invite/$token | — | — | — | — | — | — | — |  |
| Welcome, Joined | /welcome, /joined | — | — | — | — | — | — | — |  |
| Setup step 1 (Hello) | /setup (pic 31) | — | — | — | — | — | — | — |  |
| Setup step 2 (income) | /setup (pic 32, 32a) | open: the field label wraps with tight line spacing | — | — | — | — | — | — | from phase 110c; not looked at again |
| Setup steps 3 and 4 | /setup (pic 33, 34) | — | — | — | — | — | — | — |  |
| Setup steps 5 to 7 | /setup, continue | — | — | — | — | — | — | — | no pic yet |
| Bank return | /bank/return | — | — | — | — | — | — | — |  |

## A. This Month and Quick Add

| Surface | How to reach it | 320×568 | 375×667 | 393×852 | 430×932 | keyboard | dark 393 | WebKit | Status / notes |
|---|---|---|---|---|---|---|---|---|---|
| This Month: header and month arrows | /month/$month (pic 01) | ok | ok | ok | ok | — | ok | — | CI: `phone-header`, `phone-swipe` |
| Free to Spend card with a carried-over amount | pic 01 | fixed 0456f81d | — | fixed 0456f81d | — | — | ok | — | was a sentence that wrapped where it fell; now a two-column list (month, amount right-aligned) under "Each month carried over:" below 640px. Retaken and opened at 320 and 393 (`74ao-shots/sheets/c2.png`); 375 and 430 pictured, not opened; dark not retaken |
| "Why it's lower" note card | pic 01 | ok | ok | ok | ok | — | ok | — |  |
| To do, folded | pic 01 | ok | ok | ok | ok | — | ok | — | the preview is cut with "…"; the full text is one tap away |
| To do, open (Close <Month>, Extra income, rows) | pic 02 | — | — | — | — | — | — | — | pictured at all four sizes, NOT opened |
| Buckets list (Over, Ahead, Cover link) | pic 01 | ok | ok | ok | ok | — | ok | — | rows are the same height; figures share a right edge |
| Personal Allowances | pic 01 | ok | ok | ok | ok | — | ok | — | decision: "Alex's Personal Allowance" takes two lines at 320 (one from 375). It wraps whole, nothing is cut. Recommend leaving it |
| Bills, This month tab | pic 01 | fixed 3c46ce88 | — | fixed 3c46ce88 | — | — | ok | — | "Record payment" started 1px right of the "Due" line: fixed. From 375 the pays-down note ends the Due line ("Due Oct 1 · Pays down Discover it"), so the row is three lines; at 320 it keeps its own line (four). Retaken and opened at 320 and 393; 375 and 430 pictured, not opened |
| Bills, Coming up tab | Bills › Coming up | — | — | — | — | — | — | — | no pic yet |
| Bills, "Not this month" opened | pic 01, the fold | — | — | — | — | — | — | — | folded only |
| Record payment form in a Bills row | Bills › Record payment | — | — | — | — | — | — | — | no pic yet; has a money field: keyboard column too |
| Income list and "Add income" | pic 01 | fixed ab53b7ce | fixed ab53b7ce | fixed ab53b7ce | fixed ab53b7ce | — | fixed ab53b7ce | — | the "$11,868 received of …" line started 4px right of the heading and the cards; at 320 it broke "take-/home pay". Retaken and opened at 320 only; the same class change at the other sizes |
| Income row actions menu | Income › "…" | — | — | — | — | — | — | — | no pic yet |
| Add income sheet | Income › Add income | — | — | — | — | — | — | — | no pic yet |
| This Month, scrolled (sticky header) | pic 01e | — | — | — | — | — | — | — | pictured, not opened |
| Get started (fresh Household) | pic 30 | fixed ab53b7ce | — | — | — | — | — | — | at 320 "Set your take-home…" and "Add Buckets for everyday…" were cut after two lines with no way to read the rest: now "Set take-home pay" · "Set up" and "Add Buckets" · "Add" below 360px (read out in full). Retaken and opened. 375 to 430 pictured, not opened |
| Extra income card | pic 01b | — | — | — | — | — | — | — | pictured, not opened |
| "Send the Extra income" sheet | pic 01c | ok | — | ok | — | — | — | — | header, To, Amount, hint and Send all in view; CI: `sheet-phone`, `phone-keyboard` |
| Close <Month> | pic 01d | — | — | — | — | — | — | — | pictured, not opened |
| Cover a Bucket sheet | pic 04c | ok | — | ok | — | — | — | — | pic 48 (new step; 04c is the source Bucket's page, not the sheet). Opened at 320×568 and 393×568: header, Amount, hint, "Cover from" rows; the list scrolls. Amount field: keyboard height not pictured |
| Bucket page after a Cover | pic 04b | ok | — | ok | — | — | — | — | "Edit Bucket" sits under the title at 320 and beside it at 393 (decided in ui1) |
| Month's plan | /month/$month/plan | — | — | — | — | — | — | — | no pic yet |
| Quick Add, at rest | tab bar › + (pic 35) | ok (at 640 tall) | — | ok | — | ok (500) | — | — | CI: `quick-add-many` (strict 393 baseline), `phone-keyboard` (WebKit and iPhone SE) |
| Quick Add, with an amount | pic 35a | ok (at 640 tall) | — | — | — | ok (320×500) | — | — | at 500 tall one row of Buckets shows above the keypad; the rest scroll (decided in 110d) |
| Quick Add, More Buckets | pic 35b | ok (at 640 tall) | — | ok | — | — | — | — | search field, sections, amounts right-aligned |
| Quick Add, For picker | pic 35c | fixed 70d9192a | — | fixed 70d9192a | — | ok (320×500, 393×500, before the fix) | — | — | five choices fell 4 + 1 at 393: now three equal columns on phones (3 + 2). Shared `ForPicker`: the Transaction sheet and the Rule form get the same on phones (not pictured). Retaken and opened at 320 and 393 |
| Quick Add, the real keyboard up (note field) | focus "Where or what?" | — | — | — | — | — | — | — | CI: `phone-keyboard` |
| Quick Add, camera and voice capture | the two icon buttons | — | — | — | — | — | — | — |  |
| Quick Add toast | after adding | — | — | — | — | — | — | — |  |

## B. Plan

| Surface | How to reach it | 320×568 | 375×667 | 393×852 | 430×932 | keyboard | dark 393 | WebKit | Status / notes |
|---|---|---|---|---|---|---|---|---|---|
| Plan overview with grouped Buckets | /plan/$month (pic 03) | ok | fixed 1e534492 | fixed 1e534492 | fixed 1e534492 | — | — | — | pic 43 (new step: puts Gas and Household in "Home"). A group's subtotal ended 8px right of the rows' figures, Total and a row with no pencil 44px right: all on one edge now. "spent" alone on a line: the line now wraps between its parts. At 375 "Subscriptio/ns" broke inside the word: the figure goes under the name below 22rem of table (375 and down). Retaken and opened at all four widths (`74ao-shots/sheets/c1.png`, `d1.png` for 375 after the last fix): at 375 every row is two lines. open: 200% text not checked; decision 6 below |
| Things to check, folded and open | pic 03 | ok | ok | ok | ok | — | — | — | pic 46 (new step). Rows wrap whole, chevrons share an edge. open (minor): the heading keeps the first warning as its preview while the list under it is open; the order of the first two warnings differed between widths in one run (data, not layout) |
| Buckets table: drag handle | pic 03 | ok | ok | ok | ok | — | — | — | the handle is 36px wide by decision: recorded exception to 44px |
| Plan over-planned | pic 03a | — | — | — | — | — | — | — |  |
| Bucket sheet | pic 04a | — | — | — | — | — | — | — | CI: `sheet-phone`, `phone-keyboard` |
| Bucket sheet: changed, over, More (Group field) | pic 04a3, 04a4, 04a2 | ok (Group, Move, count) | — | ok (Group, Move, Archive row) | — | — | — | — | pic 43b (new step, at the Group field). 04a3, 04a4, 04a2 pictured, not opened |
| Bucket sheet: delete confirm | Bucket sheet › Delete | ok (Archive confirm) | — | ok (Archive confirm) | — | — | — | — | pic 44: every seeded Bucket has spending, so Delete is not offered and the step pictures the Archive confirm (same sheet shape). Delete confirm itself: no picture |
| Rename a group sheet | group row › Rename | ok | — | ok | — | — | — | — | pic 43a (new step), at 568 tall: field, hint, Cancel and Save in view. Keyboard height not pictured |
| Add Buckets sheet, New Bucket sheet | Plan › Add Buckets | ok | — | ok | — | — | — | — | pic 45 (new step): header, Left to plan, Add your own, footer. open (minor): the "?" in "carries over (?) , keeping" leaves a space before the comma and starts a line at 393. New Bucket sheet: no picture |
| Bucket page | /plan/$month/buckets/$id (pic 05) | — | — | — | — | — | — | — | CI: `phone-header` (item page) |
| Restore Bucket sheet | Bucket page › history | — | — | — | — | — | — | — | no pic yet |
| Plan › Commitments | pic 06 | — | — | — | — | — | — | — |  |
| Commitment page | pic 07 | — | — | — | — | — | — | — |  |
| Commitment sheet (add, edit) | Commitment page › Edit | ok | — | ok | — | — | — | — | pic 47 (new step), edit only, at 568 tall: Save stays in view over the scrolling fields. Add: no picture |
| Plan › Goal funding | pic 08 | — | — | — | — | — | — | — |  |
| Plan › Income | pic 08x | — | — | — | — | — | — | — | pictured at 320 and 393 after the Income-line fix, not opened |
| "Take-home pay" sheet, Income came in lower | pic 06b, 06a | — | — | — | — | — | — | — |  |
| Income from the other Parent, Between us | pic 40, 41 | — | — | — | — | — | — | — |  |
| Plan › Year | pic 09 | — | — | — | — | — | — | — |  |
| Plan: empty Commitments, Goal funding, Income | pic 39h, 39i, 39j | — | — | — | — | — | — | — |  |

## C. Review

| Surface | How to reach it | 320×568 | 375×667 | 393×852 | 430×932 | keyboard | dark 393 | WebKit | Status / notes |
|---|---|---|---|---|---|---|---|---|---|
| Sort stack, toolbar | /review (pic 12) | — | — | — | — | — | — | — | open from before: four icon buttons crowded at 320; the merchant cut beside the amount. CI: `phone-review-fit` |
| Card: suggested Bucket | pic 12a | — | — | — | — | — | — | — |  |
| Card: card payment | pic 12b | — | — | — | — | — | — | — |  |
| Card: a card Noodle doesn't follow | Review, skip to it | — | — | — | — | — | — | — | open from before: the Bucket picker reads "Or pick a Buc…" at 320; stacking it pushed Skip and Undo under the tab bar |
| Card: Transfer, Refund, Split, between us | pic 42 and others | — | — | — | — | — | — | — | not every kind has a pic |
| Review, all done | Review with nothing left | — | — | — | — | — | — | — | no pic yet |
| Review list | pic 13 | — | — | — | — | — | — | — |  |
| Edit Transaction sheet | Review list › a row | — | — | — | — | — | — | — | no pic yet |
| "Make a Rule" sheet | card › Make a Rule | — | — | — | — | — | — | — | no pic yet |
| Rules list, Rule page, "Add a Rule" sheet | pic 14 | — | — | — | — | — | — | — |  |

## D. Everything else

| Surface | How to reach it | 320×568 | 375×667 | 393×852 | 430×932 | keyboard | dark 393 | WebKit | Status / notes |
|---|---|---|---|---|---|---|---|---|---|
| Goals list | pic 17 | ok | — | — | — | — | — | — | 74aq: 320 opened, nothing to fix (rows are 3 to 4 lines at 320).  |
| Goal page, long history | pic 18, 18a, 18b | ok | — | — | — | — | — | — | 74aq: 18 and 18a opened at 320; 18b not. At 320 Edit drops under a long title (Hawaii trip) but sits beside a short one (New roof): choice 6.  |
| Goal sheets (add, edit, fund, withdraw) | Goals, Goal page | — | — | — | — | — | — | — | no pic yet |
| Goals, empty | pic 39b | ok | — | — | — | — | — | — |  |
| Accounts list, archived open | pic 15, 15a | ok | — | — | — | — | — | — | 74aq: open at 320: "No balance yet" breaks into two lines in the row's trailing cell; Disconnect sits 13px right of Reconnect (ghost button padding). Not fixed.  |
| Account page (credit card, no balance) | pic 16, 16a | ok | — | — | — | — | — | — | 74aq: fixed, the Perks row no longer names the card twice ("5 Perks"). Open: "Brought in from Chase" takes two lines beside Upload statement at 320.  |
| Account menu, Rename, Add an Account, bank sheets | Accounts | — | — | — | — | — | — | — | no pic yet |
| Upload a statement sheet | Accounts or Transactions | — | — | — | — | — | — | — | no pic yet |
| Accounts, empty | pic 39c | ok | — | — | — | — | — | — |  |
| Reports: Overview | pic 23 | ok | ok | ok | ok | — | ok | — | 74aq: BUILT, one Filters button with the Period beside it; Period, Compare with and Group by are in the sheet; chips for what is on. The strip shows the current tab and the faded edge at every size. Still waiting: open from before: three full-width selects and Filters take about 250px at 320 (fold into one Filters sheet). Decision waiting on the Parent: the ten-tab strip or a picker; not built |
| Reports: Cash flow, Big expenses, Buckets, Plan vs actual, Trends, Merchants, People, Goals, Income | pic 23a to 23i | ok | — | part | part | — | part | — | 74aq: all nine opened at 320; 393 Trends only, 430 Cash flow only, dark Trends and Plan vs actual. Fixed: Every day showed a sliver of a hidden week beside the weekday names. Open: Cash flow "Went out $38,056.66" touches the card edge at 320 (goes with whole dollars, agent 73ap); Goals shows "7.0%" beside "13%"; Plan vs actual legend words wrap at 320.  |
| Reports Filters sheet | Reports › Filters | ok | — | ok | ok | — | ok | — | 74aq: pic 23j (sheet) and 23k (chips). Keyboard height not pictured (Merchant and At least fields). no pic yet |
| Reports, empty | pic 39a | — | — | — | — | — | — | — |  |
| Explore | pic 19, 19a | part | — | — | — | — | — | — | 74aq: 19 opened at 320 (19a not). Charts tabs are now one line at 14px in a scrolling strip (was two-line 12px). The years toggle is still 44px beside 36px tabs: choice 7. open from before: 44px buttons beside 36px tabs; two-line 12px chart tabs |
| Explore sheets: line, group, growth | pic 19b, 19d, 19c | part | — | — | — | — | — | — | 74aq: 19b opened at 320 only.  |
| Can we afford it? (Car, Anything) | pic 20, 20a, 20b | — | — | — | — | — | — | — |  |
| Scenarios, compare, a Scenario | pic 21, 21a, 22 | part | — | — | — | — | — | — | 74aq: 21 and 22 opened at 320; compare not.  |
| Explore, Afford: empty | pic 39g, 39k | — | — | — | — | — | — | — |  |
| Insights | pic 24 | — | — | — | — | — | — | — |  |
| Perks & Benefits, a row open, add sheet | pic 25, 25a, 25b | — | — | — | — | — | — | — | the picture Household's Perks seeding fails ("data that couldn't be seeded"), so pic 25 has no cards |
| Check-in and its footer | pic 26, 26a | — | — | — | — | — | — | — |  |
| Household settings, every section | pic 27 | ok | — | — | — | — | — | — | 74aq: opened at 320, nothing changed (no baseline change expected). CI: strict `household-iphone-*` baselines (Chromium) |
| Household: Nudges choices open | Household › Nudges | — | — | — | — | — | — | — | never opened in any phase; no pic yet |
| Household: Snapshots with history | Household › Snapshots | — | — | — | — | — | — | — |  |
| Household sheets: Start fresh, Delete, your name and colour, Child, invite | pic 27a, 27b, 27c | part | — | — | — | — | — | — | 74aq: 27a, 27b, 27c opened at 320 (step 1 only, no keyboard). Start fresh's title sits about 6px higher than Delete Household's.  |
| Ask | pic 24x, 39f | — | — | — | — | — | — | — | has a text field: keyboard column too |
| Glossary | pic 28 | — | — | — | — | — | — | — |  |
| Transactions list | pic 10 | — | — | — | — | — | — | — | last, layout only: 99g is changing the range control |
| Transactions: Filters sheet, Sort | Transactions | — | — | — | — | — | — | — |  |
| Transactions: selection bar, Delete sheet | pic 10b, 10c | — | — | — | — | — | — | — | open from before: the bar's buttons probably wrap at 320 |
| Transaction page, editor, Split, receipt | pic 11, 11a | — | — | — | — | — | — | — |  |

## Decisions for the Parent (not built)

1. Free to Spend card: BUILT in 74ao (two-column list).
2. Bills: BUILT in 74ao (from 375).
3. Quick Add's For picker: BUILT in 74ao (three equal columns).
4. Personal Allowance names on two lines at 320: leave as is.
6. Plan's Buckets on a phone: rows are two or three lines depending on the figures ("$1,100 allowance · $1,184.62 spent" does not fit beside a pencil at 375 to 393). Recommend one short line under the name at every phone width, "$1,184.62 of $1,100 spent" (`74ao-shots/sheets/c1.png`). Not built.
5. Reports: ten tabs or a picker on phones (from issue 115; not looked at here).
6. Item pages at 320: the header action (Edit, Rename, More) drops under a long title but stays beside a short one. Recommend always under the title below 360px (`74aq-shots/320/18-goal.png` against `18a-goal-long-history.png`).
7. Explore: the years toggle (44px, outlined) beside tab strips (36px on a track). Recommend drawing it as the same tab strip (`74aq-shots/320/19-explore.png`).
8. Explore and Scenario Charts tabs now scroll; at 393 the fourth tab (Goal paths) is wholly off the edge with only the fade to say so. Alternative: a select above the chart (`74aq-shots/sheets/v1.png`).
9. Reports on a phone: the Period shows as plain text beside Filters, not as a chip. Alternative: make it a tappable chip that opens the sheet (`74aq-shots/320/23-reports.png`).
