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
| Page header (title, one action, tabs row) | every page | ok | ok | ok | ok | ok | ok | — | 74ap: Review's section header (320, 393, dark) and a Rule's item header with Back and pager (320). 74at: both at 375 and 430, a Rule's header in dark, Review's at 320×500. A long title is NOT pictured (the step that wrote one over the Rule's title did not take). CI: `phone-header` |
| More sheet | tab bar › More (pic 29) | fixed d7f2e1f1 | ok | fixed fe9df597 | ok | ok | ok | — | one column below 400px, two from 400px (430 opened: every name on one line). 74at: 375, 430, 320×500 and dark 393 opened on the final code. At 375×667 and 320×500 the sheet fills the window and the last rows (Household settings, Glossary, Sign out) are reached by scrolling it |
| Term help popover | any "?" beside a heading | ok | ok | — | ok | ok | ok | — | pic 12h (Review's "?"). 74at: 375, 430, 320×500 and dark opened; the popover stays inside the gutter |
| Toast: plain, with Undo, error, two stacked | save, delete, a failed save | open: three toasts cover the card | — | open: same | — | — | — | — | pic 44 (asked for by name; it files cards). Two Undo toasts and the Rule offer stack to about 230px above the tab bar: at 320 they cover the card's buttons. Decision 6 below; not built |
| "Leave without saving?" dialog | leave an edited form | — | — | — | — | — | — | — | 74at: tried (Accounts › Add Account, a name typed, Back): the question did not come up in the picture run, so NOT pictured and the step was taken out. CI: `sheet-leave`, `phone-pwa` cover it |
| Intro video dialog | sign-in, sign-up, setup › Watch | ok | ok | ok | ok | — | ok | — | from sign-in (throwaway spec, `74ap-shots/zz-look.spec.ts.txt`). 74at opened 375, 393, 430 and dark: the dialog keeps its gutter, the close button is in reach; the video's first frame is light in dark too |
| Route error screen | a loader that throws | — | — | — | — | — | — | — | 74at: tried by failing every server-function request and then pressing a tab: the page came from what was already loaded, so NOT pictured (step taken out). Needs a loader made to throw |
| Not-found screen | an unknown address | fixed d7f2e1f1 | ok | — | ok | ok | ok | — | pic 38: the logo, gutter and safe areas. 74at: 375, 430, 320×500 and dark 393 opened |
| Section loading skeleton | a slow loader | — | — | — | — | — | — | — | 74at: tried by holding server-function requests for 5 s: the page showed at once from what was loaded, so NOT pictured (step taken out) |
| 200% text size | iOS larger text, every page | open: Review's card and Rules rows break | — | open: same | — | — | open: same | — | pics 12p, 14d (`html{font-size:200%}`, as `phone-large-text` does). Review: the toolbar's last button runs off the right edge, the card's name is cut to "AME X…" and its reason breaks inside words ("Card paym ent", at 320 one letter a line); Rules: a row's facts are squeezed to a few letters; the tab bar's labels touch at 320. Not fixed (decision 9). CI: `phone-large-text` (WebKit) passes: it measures sideways scroll only |

## Signed out and getting started

| Surface | How to reach it | 320×568 | 375×667 | 393×852 | 430×932 | keyboard | dark 393 | WebKit | Status / notes |
|---|---|---|---|---|---|---|---|---|---|
| Sign in | /sign-in (`auth-shots`) | ok | ok | ok | ok | ok | ok | — | 74at opened 375, 430, dark and keyboard (320×500, 393×500) from 74ap's pictures. Clerk's Continue button measures the same box as the fields (240px at 320, 273px at 393); the 1px it looks wider is Clerk's own 1px ring, left |
| Sign up | /sign-up (`auth-shots`) | fixed 47321ac8 | ok | ok | ok | ok | ok | — | Clerk card's side padding is 20px below 360px (placeholder in full); "Sign in" sits centred under its question. Keyboard = 320×500 and 393×500 with the email field in use. 74at: the four `auth-shots` sign-up baselines redrawn from CI run 37400401920 (the intro button, on desktop too); each actual and diff opened |
| Sign up, verify code | /sign-up/verify-email-address | fixed 8170de00 | — | fixed 8170de00 | — | ok | fixed 8170de00 | — | the six code boxes had Clerk's own hairline: hardly seen in light, not at all in dark. Below 640px they now have our Input's edge and fill. Retaken and opened at 320, 393, dark and 320×500; 430 opened before the fix only. Desktop keeps Clerk's hairline (decision 10) |
| Invite | /invite/$token | ok | — | ok | — | — | ok | — | only "This invite link doesn't work" (an unknown token), signed out. A real invite is NOT pictured |
| Welcome, Joined | /welcome, /joined | ok | — | — | — | — | — | — | pic 52 (Joined, "Here's your Household") at 320: ok. 393 to 430 pictured, not opened. /welcome sends a Parent with a Household to This Month, so Welcome is NOT pictured |
| Setup step 1 (Hello) | /setup (pic 31) | ok | ok | — | ok | — | ok | — |  |
| Setup step 2 (income) | /setup (pic 32, 32a) | fixed 47321ac8 | ok | — | ok | ok | ok | — | the label's two lines have normal spacing; keyboard = 393×500 (one line) and 320×500 |
| Setup steps 3 and 4 | /setup (pic 33, 34) | fixed 02d82843 | ok | — | ok | — | ok | — | step 3 read "Commitments ? : money…": the sentence now ends before its "?" (320 retaken and opened; 375, 430 and dark were opened before the change) |
| Setup steps 5 to 7 | /setup, continue (pic 35s, 36s, 37s) | ok | — | — | — | — | — | — | One Goal, Invite the other Parent, You're set up: all three at 320. 375 to 430 pictured, not opened |
| Bank return | /bank/return (pic 50) | ok | — | — | — | — | — | — | "That bank isn't connected yet" only (no bank flow was begun). 375 to 430 pictured, not opened |

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
| Card: suggested Bucket | pic 12a | ok | ok | ok | ok | ok | ok | — | 320×500: Confirm and the picker in view, Skip under the tab bar (decision 7) |
| Card: card payment | pic 12b | ok | ok | — | ok | — | ok | — | followed (12b) and Commitment (12d) |
| Card: a card Noodle doesn't follow | Review, skip to it | fixed 4ca58018 | ok | ok | ok | ok | ok | — | pic 12c: at 320 the picker reads "Pick a Bucket…" in full beside "Card payment"; `phone-review-fit` passes. At 375×667 the card is taller than the window (decision 7) |
| Card: Transfer, Refund, Split, between us | pic 42, 12e, 12f, 12j, 12l, 12n | ok | ok | ok | ok | ok | ok | — | between us (12e) and no suggestion (12f) at every size. 74at: the Split sheet (12j: 320, dark), the New Bucket step (12l: 320, 320×500, dark) and the match offer ("Is this your Quick Add …?", seen in 12n at 320) opened: ok. A Refund (money in) card is NOT pictured: the picture Household has none in Review |
| Review, all done | Review with nothing left | ok | ok | — | ok | — | ok | — | pic 39l ("Nothing to review"). 74at: the finish after the last card (pic 46, by name, 320): "All sorted", Undo and See Transactions; Sort's line is cut as meant ("Filed DISCOVER E-PAYMENT 773… All sorted."); the Rule offer under it is covered by the toast (decision 6) |
| Review list | pic 13 | ok | ok | — | ok | — | ok | — |  |
| Edit Transaction sheet | Review list › a row | ok | ok | — | ok | ok | ok | — | pics 13a, 13b (Name in use, 320×500: Delete and Save stay in view). For: one choice alone on the second line from 375 (decision 3) |
| "Make a Rule" sheet | card › Make a Rule (pic 12k) | ok | — | — | — | ok | ok | — | 74at: 320, 320×500 and dark opened: the button stays in view, For wraps 3 + 2. The Rule offer under the card (pic 43) at 393: ok |
| Rules list, Rule page, "Add a Rule" sheet | pic 14 | ok | ok | — | ok | ok | ok | — | pics 14, 14a, 14b. List rows are two or three lines at 320 and 375 as the facts wrap whole (left) |

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
9. Text at 200% in Review and Rules (`74at-shots/new320-393/393/12p-review-large-text.png`, `…/320/14d-rules-large-text.png`): the Sort card and a Rule's row break inside words and the toolbar's last button leaves the screen. Recommended: at large text stack the card's reason under its icon and let the toolbar wrap; part of the compact-card work in decision 7.
10. The sign-up code boxes have our Input's edge below 640px only (`74at-shots/auth2/393/verify.png`); on desktop they keep Clerk's faint hairline. Recommended: the same edge at every width (desktop sweep, issue 73).
