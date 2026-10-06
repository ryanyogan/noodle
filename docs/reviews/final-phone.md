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
| Page header (title, one action, tabs row) | every page | ok | — | ok | — | — | ok | — | 74ap: Review's section header (320, 393, dark) and a Rule's item header with Back and pager (320) opened; other pages' headers belong to their rows. CI: `phone-header` |
| More sheet | tab bar › More (pic 29) | fixed d7f2e1f1 | — | fixed fe9df597 | — | — | open: retake | — | 74ap: one column below 400px, every name on one line (320 and 393 opened after the fix; dark 393 was opened BEFORE it, two columns, "Household settings" on two lines). 375 and 430 not opened |
| Term help popover | any "?" beside a heading | ok | — | — | — | — | — | — | pic 12h (Review's "?"), 320 only |
| Toast: plain, with Undo, error, two stacked | save, delete, a failed save | open: three toasts cover the card | — | open: same | — | — | — | — | pic 44 (asked for by name; it files cards). Two Undo toasts and the Rule offer stack to about 230px above the tab bar: at 320 they cover the card's buttons. Decision 6 below; not built |
| "Leave without saving?" dialog | leave an edited form | — | — | — | — | — | — | — |  |
| Intro video dialog | sign-in, sign-up, setup › Watch | ok | — | — | — | — | — | — | from sign-in at 320×568 (throwaway spec, kept as `74ap-shots/zz-look.spec.ts.txt`); pictured at 375 to 430 and dark but not opened |
| Route error screen | a loader that throws | — | — | — | — | — | — | — |  |
| Not-found screen | an unknown address | fixed d7f2e1f1 | — | — | — | — | — | — | pic 38: an unknown address had no frame (the card touched the screen's edges); now the logo, gutter and safe areas. 320 opened after the fix |
| Section loading skeleton | a slow loader | — | — | — | — | — | — | — |  |
| 200% text size | iOS larger text, every page | — | — | — | — | — | — | — | CI: `phone-large-text` (WebKit); it failed once on the Plan's Buckets table |

## Signed out and getting started

| Surface | How to reach it | 320×568 | 375×667 | 393×852 | 430×932 | keyboard | dark 393 | WebKit | Status / notes |
|---|---|---|---|---|---|---|---|---|---|
| Sign in | /sign-in (`auth-shots`) | ok | — | ok | — | — | — | — | 74ap: 320 and 393 opened; 375, 430, dark and keyboard pictured, not opened |
| Sign up | /sign-up (`auth-shots`) | fixed 47321ac8 | ok | ok | ok | ok | ok | — | Clerk card's side padding is 20px below 360px (placeholder in full); "Sign in" sits centred under its question, never beside it. Keyboard = 320×500 with the email field in use. `auth-shots` baselines (393) change only by the intro button from 74an |
| Sign up, verify code | /sign-up/verify-email-address | — | — | — | — | — | — | — |  |
| Invite | /invite/$token | — | — | — | — | — | — | — |  |
| Welcome, Joined | /welcome, /joined | — | — | — | — | — | — | — |  |
| Setup step 1 (Hello) | /setup (pic 31) | ok | — | — | — | — | — | — |  |
| Setup step 2 (income) | /setup (pic 32, 32a) | fixed 47321ac8 | — | — | — | ok | — | — | the label's two lines have normal spacing; keyboard = 393×500 (one line there) |
| Setup steps 3 and 4 | /setup (pic 33, 34) | ok | — | — | — | — | — | — | step 3: the colon after the "?" of Commitments stands apart (" ? :"), wording nit, left |
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
| Sort stack, toolbar | /review (pic 12) | ok | ok | ok | ok | — | ok | — | 74ap: four buttons 44px with 4px gaps at 320, 8px from 375; left as is. A payment card's name is one line at 320 by design (full name behind the pencil). What Sort says: fixed fe9df597 (a long line ran past the gutter after 4ca58018; now cut in its first part, "N left." kept; 393 opened, a line long enough to be cut was NOT pictured). At 320×568 and 375×667 Skip and Undo are below the tab bar until scrolled (the guard is 320×640): decision 7 |
| Card: suggested Bucket | pic 12a | ok | — | ok | — | — | — | — | 320×500 pictured, not opened |
| Card: card payment | pic 12b | ok | — | — | — | — | — | — | followed (12b) and Commitment (12d) at 320 |
| Card: a card Noodle doesn't follow | Review, skip to it | fixed 4ca58018 | ok | ok | — | — | ok | — | pic 12c: at 320 the picker reads "Pick a Bucket…" in full beside "Card payment"; `phone-review-fit` passes. At 375×667 the card is taller than the window (decision 7) |
| Card: Transfer, Refund, Split, between us | pic 42 and others | ok | — | ok | ok | — | — | — | between us (12e) and no suggestion (12f) opened. NOT pictured: a Split, a Refund, the New Bucket step, the match offer |
| Review, all done | Review with nothing left | ok | — | — | — | — | — | — | pic 39l (a new Household: "Nothing to review"). The finish after the last card of a run is not pictured |
| Review list | pic 13 | ok | — | — | — | — | — | — | opened at 320 before the fixes (none touch the list) |
| Edit Transaction sheet | Review list › a row | ok | — | — | ok | ok | ok | — | pics 13a, 13b (Name in use, 320×500: Delete and Save stay in view). For: one choice alone on the second line at 393 and 430 (decision 3) |
| "Make a Rule" sheet | card › Make a Rule | — | — | — | — | — | — | — | no pic yet. The Rule offer under the card ("Always file …?") was opened at 393 (pic 43): ok |
| Rules list, Rule page, "Add a Rule" sheet | pic 14 | ok | — | — | — | ok | — | — | pics 14, 14a, 14b. List rows are two or three lines at 320 as the facts wrap whole (left). Add a Rule at 320×568 and 320×500 opened |

## D. Everything else

| Surface | How to reach it | 320×568 | 375×667 | 393×852 | 430×932 | keyboard | dark 393 | WebKit | Status / notes |
|---|---|---|---|---|---|---|---|---|---|
| Goals list | pic 17 | ok | ok | ok | ok | — | ok | — | 74aq 320; 74ar 375, 393, 430, dark. Nothing to fix (rows are 3 to 4 lines at 320). |
| Goal page, long history | pic 18, 18a, 18b | ok | ok | ok | ok | — | ok | — | 74au: FIXED, under Finish the action is always under its sentence on a phone and "Archive" starts on the sentence's edge (was 10px in at 375 and 393, beside it at 430); seen at 375 and 430 (`74au-shots/y1.png`). At 320 Edit drops under a long title: choice 6. |
| Goal sheets (add, edit, add money, spend, take back, archive confirm) | pic 17a, 18c to 18g | ok | — | ok | part | part | part | — | 74ar: all six at 320 and 393; two at 430 and in dark. 74ax: Edit at 393×500 opened, Save stays in view (`K393.png`); the other five taken at 500 tall (320, 393), not opened. Nothing to fix. |
| Goals, empty | pic 39b | ok | — | — | — | — | — | — |  |
| Accounts list, archived open | pic 15, 15a | ok | ok | ok | ok | — | ok | — | 74ar: FIXED, "No balance yet" is one line from 360px (seen at 393, `74au-shots/r1.png`; two lines at 320 by design); Disconnect's icon is hidden under 360px so it shares Reconnect's line. |
| Account page (credit card, no balance) | pic 16, 16a | ok | ok | ok | ok | — | ok | — | 74ar: FIXED, the button reads "Upload" under 360px, so "Brought in from Chase" is one line (seen at 320, `74au-shots/r1.png`). 375 is the no-balance Account only. |
| Account menu, Rename, Add an Account, Update what's owed, Archive confirm, Stop syncing confirm, Disconnect confirm | pic 15b, 15c, 16b to 16f, 16h | ok | — | ok | — | — | — | — | 74ar: all at 320 and 393, nothing to fix. 74ax: "Stop syncing with Chase" (16h) and "Disconnect Chase" (15c) confirms pictured and opened at 320 and 393, nothing to fix (`74ax-shots/A320.png`, `B393.png`). Taken at 375, 430, dark and 500 tall; not opened. |
| Upload a statement sheet, and with a file chosen | pic 16d, 16g | ok | — | ok | — | — | — | — | 74ax: FIXED, with a file chosen its name was cut to "ch…" beside "Choose another file" and Clear at 320 (`74ax-shots/A320.png`): on a phone the name has the line above the two buttons (seen at 320 and 393, `R2.png`). Taken at 375, 430, dark, 500 tall; not opened. |
| Accounts, empty | pic 39c | ok | — | — | — | — | — | — |  |
| Reports: Overview | pic 23 | ok | ok | ok | ok | — | ok | — | 74aq: BUILT, one Filters button with the Period beside it; Period, Compare with and Group by are in the sheet; chips for what is on. The strip shows the current tab and the faded edge at every size. Still waiting: open from before: three full-width selects and Filters take about 250px at 320 (fold into one Filters sheet). Decision waiting on the Parent: the ten-tab strip or a picker; not built |
| Reports: Cash flow, Big expenses, Buckets, Plan vs actual, Trends, Merchants, People, Goals, Income | pic 23a to 23i | ok | — | part | part | — | part | — | 74aq: all nine opened at 320; 393 Trends only, 430 Cash flow only, dark Trends and Plan vs actual. Fixed: Every day showed a sliver of a hidden week beside the weekday names. Open: Cash flow "Went out $38,056.66" touches the card edge at 320 (goes with whole dollars, agent 73ap); Goals shows "7.0%" beside "13%"; Plan vs actual legend words wrap at 320.  |
| Reports Filters sheet | pic 23j, 23l | ok | — | ok | ok | part | ok | — | 74aq: pic 23j (sheet) and 23k (chips). 74ax: Merchant field in use at 393 light (`E393.png`) and at 393×500 (`K393.png`): the field is in view above Clear all and Apply. 320×500 taken, not opened. |
| Reports, empty | pic 39a | ok | — | — | — | — | — | — | 74au: opened at 320, nothing to fix. |
| Explore | pic 19, 19a | ok | ok | — | part | — | ok | — | 74au: 19 and 19a at 375, 19 at 430 and dark; 74ar 19a at 320. 74ax: 19a in dark (`Dk1.png`). Nothing to fix. The years toggle is still 44px beside 36px tabs: choice 7. 393 light taken, not opened. |
| Explore sheets: line, group, growth | pic 19b, 19d, 19c | ok | — | ok | — | — | — | — | 74ar: growth and group at 320 and 393. 74ax: line at 393 at full size (`E393.png`). Taken at 375, 430, dark, 500 tall; not opened. |
| Can we afford it? (Home, Car, Anything) | pic 20, 20a, 20b | ok | part | ok | part | — | part | — | 74ar: all three at 320 and 393. 74au: Home at 375, 430, dark. Nothing to fix. |
| Scenarios, compare, a Scenario | pic 21, 21a, 22 | ok | ok | part | part | — | part | — | 74au: list and compare at 375, list at 430 and dark. 74ar: compare at 320 and 393. 74ax: compare in dark (`Dk1.png`). Nothing to fix. |
| Explore, Afford: empty | pic 39g, 39k | ok | — | — | — | — | — | — | 74au: both at 320, nothing to fix. |
| Insights, and empty | pic 24, 39d | ok | ok | — | ok | — | ok | — | 74au: nothing to fix. |
| Perks & Benefits, a row open, add sheet | pic 25, 25a, 25b | ok | part | part | part | — | part | — | 74ax: FIXED (the app, not the seed): a linked card added again by name on this page made a second Perk Source for the same Account, so "Chase Sapphire Reserve ··0093" was listed twice; adding it now confirms the card's own Perk Source (`packages/db` `addPerkSource`, unit test). Seen once at 393 (`R2.png`); the page top at 393 (`E393.png`). The picture run seeds with no note left. |
| Check-in and its footer, and empty | pic 26, 26a, 39e | ok | part | — | ok | — | ok | — | 74au: 26, 26a, 39e at 320; 26 at 375. 74ax: 26 and 26a at 430, 26 in dark (`C430.png`, `Dk1.png`). Nothing to fix. 393 light taken, not opened. |
| Household settings, every section | pic 27 | ok | ok | — | ok | — | — | — | 74au: whole page at 320 and 375. 74ax: whole page at 430 (`H430.png`), nothing to fix. Taken at 393 and dark; not opened. CI: strict `household-iphone-*` baselines (Chromium) |
| Household: Nudges choices open | pic 27f | ok | — | — | — | — | — | — | 74ax: pictured (on for this device, choices open) and opened at 320 (`R2.png`), nothing to fix. 393 taken, not opened. |
| Household: Snapshots with history | pic 27g | ok | — | — | — | — | — | — | 74ax: pictured with a snapshot taken and opened at 320 (`R2.png`): a long note is cut with "…" by design. Nothing to fix. 393 taken, not opened. Taking one took over 8 s in the picture Household on a busy machine. |
| Household sheets: Start fresh (both steps), Delete (both steps), your name and colour, Child | pic 27a to 27e, 27h | ok | part | ok | — | ok | — | — | 74ar: FIXED, Start fresh's title sits where Delete Household's does. 74ax: Start fresh step 2 (27e) and the Child sheet (27h) pictured, opened at 320 and 393 (`A320.png`, `B393.png`); all four Danger zone steps at 320×500 and both second steps at 393×500 (`K320.png`, `K393.png`): the field and the footer stay in view, the list scrolls. Nothing to fix. Invite: the picture Household has two Parents, so the invite form is not shown; no pic. |
| Ask, and empty | pic 24x, 24y, 39f | ok | ok | — | ok | — | — | — | 74au: nothing to fix. 74ax: 430 (`C430.png`). Keyboard height: step 24y is written but its picture never came out (the run ran out of time before it); not looked at. |
| Glossary | pic 28 | ok | ok | — | ok | — | part | — | 74au: first two screens at 320 and 375. 74ax: first screen at 430 and in dark (`C430.png`, `Dk1.png`). Nothing to fix. |
| Transactions list, three months | pic 10, 10a, 10h | ok | — | ok | — | — | ok | — | 74au: the new page (open in place, Months). 10a at 320, 393, dark; the long list at 393; three months with its chip and month heading at 320. Nothing to fix. |
| Transactions: Filters sheet (Months is in it), Sort | pic 10e, 10f | ok | — | ok | — | ok | ok | — | 74au: sheet at 320, 393, dark and 500 tall (320 and 393; it scrolls above its footer); Sort's list at 320. Nothing to fix. |
| Transactions: selection bar, File in…, Delete sheet | pic 10b, 10c, 10g | ok | ok | ok | — | ok | ok | — | 74au: FIXED three. Under 360px Cancel, File in… and Delete wrapped raggedly under the count: they now share a line of their own equally. The Delete sheet's "Delete 3 Transactions" was cut off at 320 (half the footer): Cancel is as wide as its word and Delete has the rest, no icon under 360px. File in…'s picker is narrower on a phone so the bar isn't a line taller while a Bucket is picked (375 and 393). Seen: `74au-shots/t320.png` before, `u320.png`, `w1.png` after. |
| Transaction page, editor, Split, old-month sentence | pic 11, 11a, 11b | ok | — | ok | — | part | part | — | 74au: FIXED, in a Split's card at 320 "Everyone" was cut to "Everyo…" (`v320.png` before, `w1.png` after). The "had no Buckets" sentence and "It can't be split" seen in the sheet at 320 and 393 (`y1.png`). Keyboard: name field at 393, Split at 320. Dark: the page only. A Receipt: no pic yet (none seeded). |

## Decisions for the Parent (not built)

1. Free to Spend card: BUILT in 74ao (two-column list).
2. Bills: BUILT in 74ao (from 375).
3. Quick Add's For picker: BUILT in 74ao (three equal columns).
4. Personal Allowance names on two lines at 320: leave as is.
10. Plan's Buckets on a phone: rows are two or three lines depending on the figures ("$1,100 allowance · $1,184.62 spent" does not fit beside a pencil at 375 to 393). Recommend one short line under the name at every phone width, "$1,184.62 of $1,100 spent" (`74ao-shots/sheets/c1.png`). Not built.
5. Reports: ten tabs or a picker on phones (from issue 115; not looked at here).
6. Item pages at 320: the header action (Edit, Rename, More) drops under a long title but stays beside a short one. Recommend always under the title below 360px (`74aq-shots/320/18-goal.png` against `18a-goal-long-history.png`).
7. Explore: the years toggle (44px, outlined) beside tab strips (36px on a track). Recommend drawing it as the same tab strip (`74aq-shots/320/19-explore.png`).
8. Explore and Scenario Charts tabs now scroll; at 393 the fourth tab (Goal paths) is wholly off the edge with only the fade to say so. Alternative: a select above the chart (`74aq-shots/sheets/v1.png`).
9. Reports on a phone: the Period shows as plain text beside Filters, not as a chip. Alternative: make it a tappable chip that opens the sheet (`74aq-shots/320/23-reports.png`).
11. Toasts on phones: show one at a time so two Undo toasts and a Rule offer never cover the card above the tab bar (`74ap-shots/320/44-review-list-two-toasts.png`). Recommended: one visible toast below 1024px.
12. Review on short phones (320×568, 375×667): Skip and Undo need a scroll under the taller cards. Recommended: choose the compact card layout by window height (under about 700px), not only by width (`74ap-shots/375/12c-review-card-payment-not-followed.png`).
13. What Sort says is cut in its first part on phones and keeps "N left."; the cut words cannot be read afterwards (a screen reader hears all). Recommended: leave.
14. Sheet headers: the close X is centred on the whole header, so beside a three-line description it sits under the title's line (Perks' add sheet, Delete Transactions; `74au-shots/b2.png`, `u320.png`). Recommended: top-align it with the title in `packages/ui` `sheet.tsx` for every sheet, phone and desktop, in a phase that can redraw the desktop pictures. Not built.
