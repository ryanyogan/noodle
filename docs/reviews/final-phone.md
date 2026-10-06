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
| Free to Spend card with a carried-over amount | pic 01 | ok | ok | ok | ok | — | ok | — | decision: "Each month carried over: May $2,054 Jun $3,002 …" wraps where it falls (three ragged lines at 320). Recommend a two-column list of month and amount |
| "Why it's lower" note card | pic 01 | ok | ok | ok | ok | — | ok | — |  |
| To do, folded | pic 01 | ok | ok | ok | ok | — | ok | — | the preview is cut with "…"; the full text is one tap away |
| To do, open (Close <Month>, Extra income, rows) | pic 02 | — | — | — | — | — | — | — | pictured at all four sizes, NOT opened |
| Buckets list (Over, Ahead, Cover link) | pic 01 | ok | ok | ok | ok | — | ok | — | rows are the same height; figures share a right edge |
| Personal Allowances | pic 01 | ok | ok | ok | ok | — | ok | — | decision: "Alex's Personal Allowance" takes two lines at 320 (one from 375). It wraps whole, nothing is cut. Recommend leaving it |
| Bills, This month tab | pic 01 | ok | ok | ok | ok | — | ok | — | open (1px): "Record payment" starts 1px right of the "Due" line above it. Decision: a row with a pays-down note is four lines; recommend "Due Oct 1 · pays down Discover it" on one line from 375 |
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
| Cover a Bucket sheet | pic 04c | open: the picture shows the Bucket's page, not the sheet | — | — | — | — | — | — | the picture step did not open the sheet on a phone; fix the step first |
| Bucket page after a Cover | pic 04b | ok | — | ok | — | — | — | — | "Edit Bucket" sits under the title at 320 and beside it at 393 (decided in ui1) |
| Month's plan | /month/$month/plan | — | — | — | — | — | — | — | no pic yet |
| Quick Add, at rest | tab bar › + (pic 35) | ok (at 640 tall) | — | ok | — | ok (500) | — | — | CI: `quick-add-many` (strict 393 baseline), `phone-keyboard` (WebKit and iPhone SE) |
| Quick Add, with an amount | pic 35a | ok (at 640 tall) | — | — | — | ok (320×500) | — | — | at 500 tall one row of Buckets shows above the keypad; the rest scroll (decided in 110d) |
| Quick Add, More Buckets | pic 35b | ok (at 640 tall) | — | ok | — | — | — | — | search field, sections, amounts right-aligned |
| Quick Add, For picker | pic 35c | ok (at 640 tall) | — | ok | — | ok (320×500, 393×500) | — | — | decision: five choices fall 3 + 2 at 320 and 4 + 1 at 393 ("Sam" alone on the second line). Recommend equal columns (3 per line on phones) |
| Quick Add, the real keyboard up (note field) | focus "Where or what?" | — | — | — | — | — | — | — | CI: `phone-keyboard` |
| Quick Add, camera and voice capture | the two icon buttons | — | — | — | — | — | — | — |  |
| Quick Add toast | after adding | — | — | — | — | — | — | — |  |

## B. Plan

| Surface | How to reach it | 320×568 | 375×667 | 393×852 | 430×932 | keyboard | dark 393 | WebKit | Status / notes |
|---|---|---|---|---|---|---|---|---|---|
| Plan overview with grouped Buckets | /plan/$month (pic 03) | — | — | — | — | — | — | — | open from before: a group's subtotal ends about 8px right of the rows' figures; 200% text (`phone-large-text`) |
| Things to check, folded and open | pic 03 | — | — | — | — | — | — | — |  |
| Buckets table: drag handle | pic 03 | — | — | — | — | — | — | — | the handle is 36px wide by decision: recorded exception to 44px |
| Plan over-planned | pic 03a | — | — | — | — | — | — | — |  |
| Bucket sheet | pic 04a | — | — | — | — | — | — | — | CI: `sheet-phone`, `phone-keyboard` |
| Bucket sheet: changed, over, More (Group field) | pic 04a3, 04a4, 04a2 | — | — | — | — | — | — | — |  |
| Bucket sheet: delete confirm | Bucket sheet › Delete | — | — | — | — | — | — | — | no pic yet |
| Rename a group sheet | group row › Rename | — | — | — | — | — | — | — | no pic yet |
| Add Buckets sheet, New Bucket sheet | Plan › Add Buckets | — | — | — | — | — | — | — | no pic yet |
| Bucket page | /plan/$month/buckets/$id (pic 05) | — | — | — | — | — | — | — | CI: `phone-header` (item page) |
| Restore Bucket sheet | Bucket page › history | — | — | — | — | — | — | — | no pic yet |
| Plan › Commitments | pic 06 | — | — | — | — | — | — | — |  |
| Commitment page | pic 07 | — | — | — | — | — | — | — |  |
| Commitment sheet (add, edit) | Commitment page › Edit | — | — | — | — | — | — | — | no pic yet |
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

1. Free to Spend card: the "Each month carried over" line as a small two-column list instead of a wrapped sentence (`74an-shots/320/01-this-month.png`).
2. Bills: put the pays-down note on the "Due" line so the row is three lines, not four (`74an-shots/393/01-this-month.png`).
3. Quick Add's For picker: equal columns so no choice is left alone on a line (`74an-shots/393/35c-quick-add-for.png`).
4. Personal Allowance names on two lines at 320: leave as is.
5. Reports: ten tabs or a picker on phones (from issue 115; not looked at here).
6. Toasts on phones: show one at a time so two Undo toasts and a Rule offer never cover the card above the tab bar (`74ap-shots/320/44-review-list-two-toasts.png`). Recommended: one visible toast below 1024px.
7. Review on short phones (320×568, 375×667): Skip and Undo need a scroll under the taller cards. Recommended: choose the compact card layout by window height (under about 700px), not only by width (`74ap-shots/375/12c-review-card-payment-not-followed.png`).
8. What Sort says is cut in its first part on phones and keeps "N left."; the cut words cannot be read afterwards (a screen reader hears all). Recommended: leave.
