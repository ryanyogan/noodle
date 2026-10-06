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
| Free to Spend card with a carried-over amount | pic 01 | fixed 0456f81d | — | fixed 0456f81d | ok | — | ok | — | was a sentence that wrapped where it fell; now a two-column list (month, amount right-aligned) under "Each month carried over:" below 640px. Retaken and opened at 320 and 393 (`74ao-shots/sheets/c2.png`); 375 and 430 pictured, not opened; dark not retaken 74as: opened at 430 and in dark at 393 after the fix (`74as-shots/sheets/d1.png`). |
| "Why it's lower" note card | pic 01 | ok | ok | ok | ok | — | ok | — |  |
| To do, folded | pic 01 | ok | ok | ok | ok | — | ok | — | the preview is cut with "…"; the full text is one tap away |
| To do, open (Close <Month>, Extra income, rows) | pic 02 | ok | ok | fixed f5060e4c | ok | — | ok | — | the "September has ended…" text, the "Add $… to Free to Spend" button and the Between us line started 4px right of their headings: now on the same edge below 640px. Opened at 320 (74ao picture, before) and 393 (after, `74as-shots/sheets/c4.png`); 375 and 430 pictured by 74ao, not opened 74av: opened at the sizes marked. |
| Buckets list (Over, Ahead, Cover link) | pic 01 | ok | ok | ok | ok | — | ok | — | rows are the same height; figures share a right edge |
| Personal Allowances | pic 01 | ok | ok | ok | ok | — | ok | — | decision: "Alex's Personal Allowance" takes two lines at 320 (one from 375). It wraps whole, nothing is cut. Recommend leaving it |
| Bills, This month tab | pic 01 | fixed f5060e4c | ok | fixed 3c46ce88 | ok | — | ok | — | "Record payment" started 1px right of the "Due" line: fixed. From 375 the pays-down note ends the Due line ("Due Oct 1 · Pays down Discover it"), so the row is three lines; at 320 it keeps its own line (four). Retaken and opened at 320 and 393; 375 and 430 pictured, not opened 74as: at 320 the pays-down note came after "Record payment"; now Due, Pays down, Record payment (`c4.png`). 74av: opened at the sizes marked. |
| Bills, Coming up tab | Bills › Coming up | fixed 74av | ok | fixed 74av | — | — | ok | — | pic 49 (new step). "See all 11" sits 8px in from the card edge (a text button's padding): left 74av: "See all 11" now starts on the cards' edge below 640px (`74av-shots/sheets/t2c.png`). |
| Bills, "Not this month" opened | pic 01, the fold | ok | ok | ok | — | — | ok | — | pic 49a (new step) 74av: opened at the sizes marked. |
| Record payment form in a Bills row | Bills › Record payment | fixed f5060e4c | fixed 74av | ok | — | ok (320×500, 393×500) | ok | — | pic 49b (new step). At 320 Cancel fell alone under the field and Record: below 360px the field takes the line and Record, Cancel share the next (`d1.png`, `d2.png`) 74av: at 375 Cancel still fell alone: the field takes the line below 393px (`e1.png`). |
| Income list and "Add income" | pic 01 | fixed ab53b7ce | fixed ab53b7ce | fixed ab53b7ce | fixed ab53b7ce | — | fixed ab53b7ce | — | the "$11,868 received of …" line started 4px right of the heading and the cards; at 320 it broke "take-/home pay". Retaken and opened at 320 only; the same class change at the other sizes |
| Income row actions menu | Income › "…" | ok | ok | ok | — | — | ok | — | pic 49c (new step) 74av: opened at the sizes marked. |
| Add income sheet | Income › Add income | ok | ok | ok | — | ok (320×500, 393×500) | ok | — | pic 49d (new step): Add income stays in view at 500 tall 74av: opened at the sizes marked. |
| This Month, scrolled (sticky header) | pic 01e | ok | ok | ok | — | — | — | — | the header scrolls away with the page (not sticky); nothing overlaps |
| Get started (fresh Household) | pic 30 | fixed ab53b7ce | fixed f5060e4c | fixed f5060e4c | fixed f5060e4c | — | ok | — | at 320 "Set your take-home…" and "Add Buckets for everyday…" were cut after two lines with no way to read the rest: now "Set take-home pay" · "Set up" and "Add Buckets" · "Add" below 360px (read out in full). Retaken and opened. 375 to 430 pictured, not opened 74as: from 360px the buttons read "Set up  the Plan", "Add  Buckets", "Add  an Account" with a double space (the Button's gap between two children), which also wrapped the titles at 393 and is what turned `shell.spec.ts` month-iphone red: one child now, and the old baselines pass again. 375–430 opened before (74ao pictures), 393 and 320 after (`c1.png`). 74av: opened at the sizes marked. |
| Extra income card | pic 01b | — | ok | ok | — | — | ok | — | opened at 393 (74ao picture); 320 pictured, not opened 74av: opened at the sizes marked. |
| "Send the Extra income" sheet | pic 01c | ok | ok | ok | — | — | ok | — | header, To, Amount, hint and Send all in view; CI: `sheet-phone`, `phone-keyboard` 74av: opened at the sizes marked. |
| Close <Month> | pic 01d | — | ok | ok | — | — | ok | — | opened at 393 (74ao picture); 320 pictured, not opened 74av: opened at the sizes marked. |
| Cover a Bucket sheet | pic 04c | ok | ok | ok | — | ok (320×500, 393×500) | ok | — | pic 48 (new step; 04c is the source Bucket's page, not the sheet). Opened at 320×568 and 393×568: header, Amount, hint, "Cover from" rows; the list scrolls. Amount field: keyboard height not pictured 74av: opened at the sizes marked. |
| Bucket page after a Cover | pic 04b | ok | ok | ok | — | — | — | — | CI: `phone-header` (item page). At 320 "Transactions in October" takes two lines beside its link and a long row is cut with "…" (meant) 74av: opened at the sizes marked. |
| Month's plan | /month/$month/plan | ok | — | ok | — | — | — | — | pic 49e (new step): the address opens the Plan overview, so this is the row "Plan overview" below, not a surface of its own |
| Quick Add, at rest | tab bar › + (pic 35) | ok (at 640 tall) | ok | ok | — | ok (500) | ok | — | CI: `quick-add-many` (strict 393 baseline), `phone-keyboard` (WebKit and iPhone SE) 74av: opened at the sizes marked. |
| Quick Add, with an amount | pic 35a | ok (at 640 tall) | ok | — | — | ok (320×500) | ok | — | at 500 tall one row of Buckets shows above the keypad; the rest scroll (decided in 110d) 74av: opened at the sizes marked. |
| Quick Add, More Buckets | pic 35b | ok (at 640 tall) | ok | ok | — | — | ok | — | search field, sections, amounts right-aligned 74av: opened at the sizes marked. |
| Quick Add, For picker | pic 35c | fixed 70d9192a | ok | fixed 70d9192a | — | ok (320×500, 393×500, before the fix) | ok | — | five choices fell 4 + 1 at 393: now three equal columns on phones (3 + 2). Shared `ForPicker`: the Transaction sheet and the Rule form get the same on phones (not pictured). Retaken and opened at 320 and 393 74av: opened at the sizes marked. |
| Quick Add, the real keyboard up (note field) | focus "Where or what?" | — | — | — | — | — | — | — | CI: `phone-keyboard` |
| Quick Add, camera and voice capture | the two icon buttons | — | — | — | — | — | — | — |  |
| Quick Add toast | after adding | ok | ok | ok | — | — | ok | — | 74av: pic 55 (new step; it saves $24): one line, centred, clear of the tab bar (`t2c.png`). |

## B. Plan

| Surface | How to reach it | 320×568 | 375×667 | 393×852 | 430×932 | keyboard | dark 393 | WebKit | Status / notes |
|---|---|---|---|---|---|---|---|---|---|
| Plan overview with grouped Buckets | /plan/$month (pic 03) | ok | fixed 1e534492 | fixed 1e534492 | fixed 1e534492 | — | ok | — | pic 43 (new step: puts Gas and Household in "Home"). A group's subtotal ended 8px right of the rows' figures, Total and a row with no pencil 44px right: all on one edge now. "spent" alone on a line: the line now wraps between its parts. At 375 "Subscriptio/ns" broke inside the word: the figure goes under the name below 22rem of table (375 and down). Retaken and opened at all four widths (`74ao-shots/sheets/c1.png`, `d1.png` for 375 after the last fix): at 375 every row is two lines. open: 200% text not checked; decision 6 below 74as: dark at 393 opened (ungrouped, `d1.png`). 74av: 200% text (pic 54, `html{font-size:200%}`): a Bucket's name stood one letter a line; under a 16rem table the tile now goes and names read, still breaking inside a long word in Chromium (`t1a.png` before, `t2a.png` after). open: the handle's track (shared DataTable) would have to go for whole words. |
| Things to check, folded and open | pic 03 | ok | ok | fixed f5060e4c | ok | — | ok | — | pic 46 (new step). Rows wrap whole, chevrons share an edge. open (minor): the heading keeps the first warning as its preview while the list under it is open; the order of the first two warnings differed between widths in one run (data, not layout) 74as: open, the first warning is no longer repeated under the heading on a phone (`c5.png`, 393). 74av: opened at the sizes marked. |
| Buckets table: drag handle | pic 03 | ok | ok | ok | ok | — | — | — | the handle is 36px wide by decision: recorded exception to 44px |
| Plan over-planned | pic 03a | fixed 74av | ok | fixed 74av | — | — | — | — | opened at 320 (74ao picture) and 393 (retake). open (minor, with decision 6): at 393 a row's under-name line can end in a lone "·" where it wraps; at 320 "$84.62 over of / $1,100" wraps inside the phrase 74av: no line ends in a lone "·" (a part that starts a line hides its dot) and "$84.62 over / of $1,100" wraps between its parts (`t1b.png`, `t2b.png`). |
| Bucket sheet | pic 04a | ok | ok | ok | — | ok (320×500, 393×500) | ok | — | CI: `sheet-phone`, `phone-keyboard`. Opened at 568 tall 74av: opened at the sizes marked. |
| Bucket sheet: changed, over, More (Group field) | pic 04a3, 04a4, 04a2 | ok | ok | ok | — | — | ok | — | pic 43b, 04a3, 04a4, 04a2 all opened at 320 and 393 74av: opened at the sizes marked. |
| Bucket sheet: delete confirm | Bucket sheet › Delete | ok (Archive confirm) | ok | ok (Archive confirm) | — | ok (320×500, 393×500) | ok | — | pic 44: every seeded Bucket has spending, so Delete is not offered and the step pictures the Archive confirm (same sheet shape). Delete confirm itself: no picture 74av: pic 52 (new step) is the real Delete confirm, on a seeded Bucket nothing was spent from (`k1.png`, `w375-rest.png`). |
| Rename a group sheet | group row › Rename | ok | ok | ok | — | — | ok | — | pic 43a (new step), at 568 tall: field, hint, Cancel and Save in view. Keyboard height not pictured 74av: keyboard height asked for, not pictured. |
| Add Buckets sheet, New Bucket sheet | Plan › Add Buckets | fixed f5060e4c | ok | fixed f5060e4c | — | ok (320×500, 393×500) | ok | — | pic 45; pic 50 (new step) has a row of the Parent's own typed in ("Add your own" adds a row in this sheet: there is no separate New Bucket sheet). The "?" now stays with "over" and the comma follows it closely (`c1.png`, `d2.png`). At 320 a long name scrolls inside its field 74av: opened at the sizes marked. |
| Bucket page | /plan/$month/buckets/$id (pic 05) | — | ok | — | — | — | ok | — | CI: `phone-header` (item page) 74av: opened at 375 and dark 393 only (`b1-375.png`, `dark1.png`). |
| Restore Bucket sheet | Bucket page › history | — | ok | ok | — | ok (320×500, 393×500) | ok | — | no pic yet 74av: pic 53 (the archived Bucket's page) and 53a (the sheet), new steps on a seeded archived Bucket; 320 seen at 500 tall only. |
| Plan › Commitments | pic 06 | ok | ok | fixed f5060e4c | — | — | ok | — | the "Across a year…" and "Paying off a card…" notes and the empty-state line started 4px right of the cards: fixed below 640px (`c5.png`). 320 opened in the 74ao picture, before 74av: opened at the sizes marked. |
| Commitment page | pic 07 | open: "Edit" (a ghost button) sits 10px in from the title it wraps under; the Bucket page's is outlined and lines up | ok | ok | — | — | ok | — | 74av: opened at the sizes marked. |
| Commitment sheet (add, edit) | Commitment page › Edit | ok | ok | ok | — | ok (320×500, 393×500) | ok | — | pic 47 (new step), edit only, at 568 tall: Save stays in view over the scrolling fields. Add: no picture Add is a form in the page on a phone, not a sheet: pic 51 (new step), opened at 393. 74av: opened at the sizes marked. |
| Plan › Goal funding | pic 08 | fixed f5060e4c | ok | fixed f5060e4c | fixed f5060e4c | — | ok | — | a row's line ended in a lone "·" where it wrapped: on a phone each part has its own line, so every row is the same height; the summary line and "All Goals…" link start on the cards' edge (`c4.png`, `d1.png` at 430, `d2.png` dark) 74av: opened at the sizes marked. |
| Plan › Income | pic 08x | ok | ok | ok | — | — | ok | — | opened at 320 and 393 (74ao pictures) 74av: at 375 "From Sam? It’s between us" ends with "us" alone on a third line: left. |
| "Take-home pay" sheet, Income came in lower | pic 06b, 06a | ok | ok | ok | — | ok (320×500, 393×500) | ok | — | opened at 568 tall: Save in view 74av: opened at the sizes marked. |
| Income from the other Parent, Between us | pic 40, 41 | — | ok | — | — | ok (41 only) | ok (41 only) | — | 74av: pic 41 opened at 375, dark 393 and 500 tall. Pic 40's step looked for words the page no longer says; its locator is changed but NOT run again, so 40 was seen only in the failed step's picture at 375. |
| Plan › Year | pic 09 | ok | ok | ok | — | — | ok | — | October's "This month" and "Lumpy" badges go under the name (one line at 393, two at 320): reads fine 74av: opened at the sizes marked. |
| Plan: empty Commitments, Goal funding, Income | pic 39h, 39i, 39j | — | ok | ok | — | — | ok | — | 320 pictured, not opened 74av: opened at the sizes marked. |

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
| Goals list | pic 17 | — | — | — | — | — | — | — |  |
| Goal page, long history | pic 18, 18a, 18b | — | — | — | — | — | — | — |  |
| Goal sheets (add, edit, fund, withdraw) | Goals, Goal page | — | — | — | — | — | — | — | no pic yet |
| Goals, empty | pic 39b | — | — | — | — | — | — | — |  |
| Accounts list, archived open | pic 15, 15a | — | — | — | — | — | — | — |  |
| Account page (credit card, no balance) | pic 16, 16a | — | — | — | — | — | — | — |  |
| Account menu, Rename, Add an Account, bank sheets | Accounts | — | — | — | — | — | — | — | no pic yet |
| Upload a statement sheet | Accounts or Transactions | — | — | — | — | — | — | — | no pic yet |
| Accounts, empty | pic 39c | — | — | — | — | — | — | — |  |
| Reports: Overview | pic 23 | — | — | — | — | — | — | — | open from before: three full-width selects and Filters take about 250px at 320 (fold into one Filters sheet). Decision waiting on the Parent: the ten-tab strip or a picker; not built |
| Reports: Cash flow, Big expenses, Buckets, Plan vs actual, Trends, Merchants, People, Goals, Income | pic 23a to 23i | — | — | — | — | — | — | — |  |
| Reports Filters sheet | Reports › Filters | — | — | — | — | — | — | — | no pic yet |
| Reports, empty | pic 39a | — | — | — | — | — | — | — |  |
| Explore | pic 19, 19a | — | — | — | — | — | — | — | open from before: 44px buttons beside 36px tabs; two-line 12px chart tabs |
| Explore sheets: line, group, growth | pic 19b, 19d, 19c | — | — | — | — | — | — | — |  |
| Can we afford it? (Car, Anything) | pic 20, 20a, 20b | — | — | — | — | — | — | — |  |
| Scenarios, compare, a Scenario | pic 21, 21a, 22 | — | — | — | — | — | — | — |  |
| Explore, Afford: empty | pic 39g, 39k | — | — | — | — | — | — | — |  |
| Insights | pic 24 | — | — | — | — | — | — | — |  |
| Perks & Benefits, a row open, add sheet | pic 25, 25a, 25b | — | — | — | — | — | — | — | the picture Household's Perks seeding fails ("data that couldn't be seeded"), so pic 25 has no cards |
| Check-in and its footer | pic 26, 26a | — | — | — | — | — | — | — |  |
| Household settings, every section | pic 27 | — | — | — | — | — | — | — | CI: strict `household-iphone-*` baselines (Chromium) |
| Household: Nudges choices open | Household › Nudges | — | — | — | — | — | — | — | never opened in any phase; no pic yet |
| Household: Snapshots with history | Household › Snapshots | — | — | — | — | — | — | — |  |
| Household sheets: Start fresh, Delete, your name and colour, Child, invite | pic 27a, 27b, 27c | — | — | — | — | — | — | — |  |
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
