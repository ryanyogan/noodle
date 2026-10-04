# Mobile sweep (#74)

## 74a: audit and research (2026-10-03, partly done; measured in 74b below)

How it was meant to work: a throwaway spec (`zz-mobile-audit.spec.ts`, not committed) on `chromium-mobile`, with above-the-fold.spec's busy Household (`createPlannedHousehold` with $6,200 take-home pay and four Buckets, 8 months of `seedReportHistory`, Joint Savings, a Trip Goal). It visits 26 phone pages at 393x852 (the tab bar pages, the six Plan pages, Goals, Explore, Afford, Scenarios, four Reports views, Insights, Perks, Review, Rules, Check-in, Household, Glossary, Ask, `/setup`), then the first Bucket, Commitment, Goal, Account and Transaction, then 8 sheets (Quick Add, To do, Add Goal, Filters, Add Bucket, Add Commitment, Upload, Invite), then the main four at 320 and 430. In the browser it measures: duplicate link destinations by region (tab bar, header, tabs, main, sheet); the left edges of headings, cards, rows, sections and tab strips, with neighbouring edges 2 to 11 px apart flagged; the right gutters; every card's padding, radius, border and shadow; elements past the right edge outside a scroller; every scroll container and its scrollbar width; `bg-primary` buttons and whether they sit in the bottom half of the first screen; and targets under 44 px.

What happened:
- Run 1 took full-page shots of every 393 page and the Quick Add sheet, then timed out at 15 minutes in the sheet pass. `waitForLoadState("networkidle")` never settles against the dev server, so each visit waited its full time, and the JSON was only written at the end. **No measurements were saved.**
- Run 2 (networkidle replaced by a fixed wait, JSON written after each sheet) crashed Chromium during sign-in ("Target crashed") with about 6 GB available and another checkout's run on the machine. It was not retried within this phase's budget.
- Looked at: This Month at 393 only. The rest of the 393 shots are in the session scratchpad (`74a/393-*.png`) but were not looked at.

So the per-page table below is the **checklist for 74b**, with the This Month findings filled in from the screenshot. Everything marked "to measure" is open.

### Findings so far (This Month at 393, from the screenshot)

1. **Two left edges.** The Month/Plan switch, "This Month" and "October" start at 18 px; "Free to Spend", the cards, "Buckets", "Bills" and "Income" start at 16 px. A 2 px offset between the header and everything under it. The Bills switch's left edge and "Not this month" (about 22 px) are off by more.
2. **"Plan" twice.** The switch's Plan and "Plan ›" in the Free to Spend card's "Where $6,200 take-home pay goes" both go to the Plan. On a phone the switch is the recorded way to the Plan (73d), so the card's link is the duplicate.
3. **Four icon buttons in the top row.** Reports, Ask (?) and Glossary (?) sit beside the switch; two of them are question-mark icons that look the same. The top row is the hardest-to-reach area of the screen.
4. **Rows carry their own buttons.** Each overspent Bucket row has a full "Cover" button under its bar, so three Over Buckets add three buttons and about 50 px each. The row itself could open the Bucket (where Cover lives), or a single "Cover 3 Buckets" action sits in the Buckets header.
5. **The page is about 2.3 screens** (about 1,950 px at 852): Free to Spend, To do, four Buckets with a legend, Bills with its own switch, Not this month, Income. Income came onto This Month in 73c for the desktop; on a phone it is the fifth block.
6. **Two segmented controls with different styles.** The Month/Plan switch and the Bills "This month / Coming up" switch are both pill segments, but the Bills one sits inside the content with a different height and left edge.
7. **The primary action is in thumb reach.** Quick Add is the centred + in the tab bar, bottom of the screen. Good; keep it the one primary action on This Month and don't add another.
8. **The Buckets legend** (Spent, Left, Today if you spent evenly, Ahead of pace, plus a ? help) is two lines of chrome before the first Bucket.
9. **"Add income"** is an outlined button at the right of the Income heading, the only section with a header button; Buckets and Bills put their action in the rows.
10. **Measurement harness:** `networkidle` must not be used against the dev server; write results incrementally.

## 74b: measured (2026-10-03)

The audit spec ran on `chromium-mobile` (1 worker, no `networkidle`, JSON written after every page) in four chunks: the 26 pages at 393x852; the detail pages; the sheets; This Month, Transactions, Accounts and Plan at 320 and 430 plus a Household email check. The busy Household was the one above. Each page was measured about 1.3 s after `main` appeared. Looked at: the 393 shots of Reports and Household (and This Month in 74a).

Limits, so nothing below claims more than this:
- **Reports** was measured while still a loading skeleton (see finding 1); the loaded Reports views were not measured.
- **Sheets:** the probe's dialog selector (`[role=dialog]:last-of-type`) missed, so it measured the page behind. Only each sheet's box, the page's primary buttons and the scroll containers are sheet findings. To do and Invite are not dialogs (inline); Add Commitment opened no dialog within 5 s; the Account upload had no button named Upload/statement.
- **A Transaction:** the Transactions list had no link matching `/transactions/<month>/<id>`, so no detail page was measured.
- Left edge 17 px is a row's content inside a card's 1 px border, and 33 px is card padding; those are not offsets.

### Measured findings

1. **Reports' loading skeleton widens the page to 512 px.** On all four Reports views the layout viewport measured 512 wide (`innerWidth` and `scrollWidth` 512 at a 393 device width): the phone zooms the page out. The shot shows the skeleton's tab pills and cards running to x=512 and no page header yet. Check the loaded views in 74g; the skeleton itself needs `min-w-0`/the 16 px gutter.
2. **Page title 2 px in.** Every page's header starts at 16 px, but its `h1` starts at 18 px (This Month, Plan, Insights, Glossary, Ask, a Goal and the rest: one element at 18 on every page with a header). Everything else starts at 16 (or 17/33 inside cards). 74c: the title to 16.
3. **Household email overflows its card** (confirmed by measurement with main's markup from ebe8ec0, `min-w-0 truncate`, applied in the page; this branch still has the wrapping markup). With the test Parent's 53-character email the span is 386 px wide, from x=81 to x=467, while the card ends at 377: it is clipped by the card's `overflow-hidden`, and no ellipsis shows because the span itself is as wide as its text (`scrollWidth` = `clientWidth` = 386). The cause is one level up: the meta `div.flex.flex-wrap` (text-[13px]) is a grid item with `min-width: auto`, so it grows to the email (386) inside its 267 px `div.grid.min-w-0`. Fix: `min-w-0` (or `w-full min-w-0`) on that meta div, or `minmax(0,1fr)` on its grid. On this branch (wrapping markup) the span is 270 px wide and fits.
4. **No other horizontal overflow.** Every other page at 393, 320 and 430 measured `scrollWidth` = viewport width and nothing past the right edge outside a scroller.
5. **One scroll container per page.** The only inner scroller on any page is the Plan pages' tab strip (`nav.link-tabs`, x, `scrollbar-width: none`, 0 px bar). The **Add Buckets** sheet has its own vertical scroller (`div.sheet-content`) with `scrollbar-width: auto` and a measured 2 px bar: a visible scrollbar inside a sheet.
6. **Primary actions in the top row.** `bg-primary` buttons at y=16–60 (the page header): Add Account (Accounts, an Account), Add Goal (Goals, a Goal). Mid-screen, top half: Add Buckets (y=284), Add Rule (235), Ask (382), Add money on a Goal (317). Household's Invite is at y=909 (below the first screen) and Get an address / Set up at 2,300+. In thumb reach: Connect a bank (641), Perks' Add (807–851, the band where the fixed tab bar sits; whether it is covered was not checked), the wizard's Continue (796), and the sticky sheet footers: Add Goal and Add Buckets (796–840), Filters' Apply (796–840).
7. **Targets under 44 px.** Every glossary help (?) button is 24x24 (1–4 per page on Month, Plan, Accounts, Buckets, a Goal, Check-in…). Household's four notification switches are 40x24. The wizard's choice buttons are 18x18 (radios 13x13); Add Buckets' tick boxes are 18x18. This Month's card link "Plan" is 42x19 (42x38 at 320). Selects at 1x1 are the hidden native selects behind the custom ones (not targets).
8. **Duplicate destinations** (Skip to content and the section's own tab excluded): This Month's card "Plan" = the Plan switch (also at 320 and 430); on every Plan page the switch's "Plan" and the "Overview" tab both go to the Plan; Commitments' "1 lumpy month ahead" = the Year tab; Year's "October" row = the Plan; Goal funding's "All Goals and their progress" = the tab bar's Goals; Explore, Afford, Scenarios and a Goal have "Back to Goals" in the header = the tab bar's Goals; a Bucket's and a Commitment's "Back to …" = their Plan tab; Review's empty "See Transactions" = the tab bar (an empty state's one action, allowed). With the To do panel open, the Plan is linked four times (switch, "Plan", "6 Plan changes this month", "2 things to check in the Plan") and Invite = the tab bar's Household.
9. **Card styles in use:** radius 16, 1 px `rgb(229,232,237)` border and a shadow everywhere. Padding: 0 (list cards, rows pad themselves), 16 px (form and figure cards: Plan's figure, Accounts, Goals, Explore, Household's seven), 32/16 (empty states: Insights, Perks, Review, Rules), 8 px (Glossary). None uses the 20 px `--card-pad` the cross-cutting rule names, so 74c decides 16 or 20 for phones.
10. **Page lengths** (screens of 852): Glossary 4.6, Household 4.3, Plan › Year 3.4, Transactions 2.9 (2.9 at 320), This Month 2.3 (2.5 at 320, 3.9 with To do open), a Bucket 2.0, a Commitment 1.9, Commitments 1.7, Plan 1.5; the rest about one screen.
11. **Sheets' heights** (box at 393x852): Quick Add 649 px (from y=203), Add Goal 755 (from 97), Filters 415 (from 437), Add Buckets 784 (from 68).
12. **320 and 430** show the same left edges, duplicates and targets as 393; nothing overflows at 320.

### Per page (filled in by 74b where measured)

For each: duplicates; crowding; alignment Δ; overflow and scroll containers; card styles; primary action position; targets under 44 px; proposed phone representation (one key figure, one list, one primary action in thumb reach).

| Page | Measured / seen | Proposed phone representation |
|---|---|---|
| Tab bar | Month, Transactions, + (Quick Add), Goals, Household. Fixed, bottom. | Keep. It and the page header are the only global entry points. |
| Top row (Month/Plan switch, Reports, Ask, Glossary) | Finding 3. | Switch stays (73d's reason). Reports, Ask and Glossary go into one "More" menu button (one icon), or Glossary moves under Household. |
| This Month | Findings 1–9. | Figure: Free to Spend. List: Buckets (rows open the Bucket; one Cover action in the header when any are over). Bills and Income behind a "This month's money" disclosure or Bills only, Income on Plan › Income. Action: Quick Add (tab bar). |
| Transactions | 2.9 screens at 320/393/430; no overflow, no duplicates, no target under 44 px; title 2 px in (finding 2). | Figure: the month total. List: the virtualised list. Action: Quick Add; Filters as a chip row, Review button keeps its count. |
| A Transaction | Not measured (no detail link found by the probe). | Pushed page or full sheet with a sticky Save footer. |
| Accounts / an Account | Add Account is a `bg-primary` button in the header row (y=16–60) on both; Connect a bank at y=641 (763 at 320). 24 px help button. One card at 16 px padding, two at 0. | Figure: net total. List: Accounts. Action: Add Account at the bottom of the list. "Back to Accounts" stays (phone only, per 73e). |
| Plan › Overview | 1.5 screens. Switch "Plan" and the Overview tab both go to the Plan. Tab strip scrolls sideways, no bar. Two 24 px help buttons. Same at 320/430. | Figure: Free to Spend. List: the waterfall rows (no links, 73d). Things to check as rows of the same card. |
| Plan › Income, Commitments, Buckets, Goal funding, Year | Plan/Overview duplicate on each. Commitments: "1 lumpy month ahead" = Year tab. Goal funding: "All Goals and their progress" = tab bar Goals. Year: 3.4 screens, its October row = the Plan. Buckets: Add Buckets at y=284; its sheet has a visible 2 px scrollbar and 18 px tick boxes. | One list each; its add button as the last row of the list, not top right. Year: one row per month. |
| A Bucket / a Commitment | 2.0 / 1.9 screens. "Back to Buckets/Commitments" duplicates the Plan tab (phone-only Back is an allowed exception). | Figure: left this month. List: its Transactions. Action: Edit. Back/Next stay on phones. |
| Goals / a Goal | Add Goal in the header row (y=16–60) on both; a Goal's Add money at y=317. "Back to Goals" = tab bar Goals. Add Goal sheet 755 px with its button at the bottom (796–840). | Figure: total saved. List: Goals. Action: Add Goal (sheet). |
| Explore, Afford, Scenarios | One screen each at this data; "Back to Goals" in the header = tab bar Goals; one element starts at 66 px. | Figure: the outcome sentence. One chart with the segmented control scrolling with an edge fade. Editors as collapsed sections with totals (73f left this open). |
| Reports (Overview, Spending, Trends, Merchants) | Loading skeleton widens the layout to 512 px (finding 1). Loaded views not measured. | One headline figure per view, one chart, one list. Tabs scroll with an edge fade. |
| Insights, Perks | Empty-state cards pad 32/16. Perks' Add at y=807–851. Title 2 px in. | One list of cards; EmptyState padding token. |
| Review, Rules | Review empty here; "See Transactions" = tab bar (allowed). Add Rule at y=235 (top half). | Review: the card stack, Skip/Undo in reach (above-the-fold.spec already checks). |
| Check-in | One screen; one 24 px help button. | One step at a time, Continue in a sticky footer. |
| Household | Looked at. 4.3 screens, 12 cards (7 at 16 px padding, 5 at 0). Invite at y=909, below the first screen. Four notification switches 40x24. Long email clipped past the card (finding 3). | The three groups from the desktop sweep (People, Money, Notifications and data) as list sections; danger zone last. |
| Glossary, Ask | Glossary 4.6 screens, card padding 8 px. Ask's button at y=382 (top half). Both titles 2 px in. | Glossary: search sticky above one list (#66). Ask: composer pinned above the tab bar. |
| Get-started wizard (`/setup`) | No page header; Continue at y=796 (thumb); choice buttons 18x18, radios 13x13. | One question per screen, Continue in a sticky footer. |
| Sheets | Heights in finding 11; Add Buckets' visible scrollbar (finding 5); To do, Invite inline, Add Commitment and Upload not opened. Insides not measured (selector missed). | Content-sized up to 92% (#48), primary action in a sticky footer, no visible scrollbar, one scroll area. |

### What others do (research)

- **Apple HIG / iOS 26:** the tab bar is a floating, inset pill of the primary destinations; Liquid Glass is only for the navigation layer floating above content, never for content itself. Sheets take detents (medium, large) and adapt their look by height. Lay content out on the system layout margins (16 pt on most iPhones, 20 pt on Max/Plus widths). [learnui.design: iOS 26 design guidelines](https://www.learnui.design/blog/ios-design-guidelines-templates.html), [WWDC25: Build a UIKit app with the new design](https://developer.apple.com/videos/play/wwdc2025/284/), [createwithswift: Liquid Glass hierarchy](https://www.createwithswift.com/liquid-glass-redefining-design-through-hierarchy-harmony-and-consistency/)
- **Material 3, compact (< 600 dp):** a navigation bar at the bottom, 16 dp screen margins; a bottom sheet sits above the navigation bar, which hides when the sheet expands. List-detail goes one pane at a time. [m3.material.io: applying layout](https://m3.material.io/foundations/layout/applying-layout), [material-components-android: BottomNavigation](https://github.com/material-components/material-components-android/blob/master/docs/components/BottomNavigation.md), [developer.android.com: window size classes](https://developer.android.com/develop/ui/compose/layouts/adaptive/use-window-size-classes)
- **Thumb reach:** Hoober's 1,333 observations: 49% one-handed, 36% cradled, 15% two thumbs. The bottom third is easy, the middle a stretch, the top third needs a grip change. So: the primary action at the bottom (tab bar +, sticky sheet footers), destructive and rare actions at the top. [A List Apart: How we hold our gadgets](https://alistapart.com/article/how-we-hold-our-gadgets/), [Smashing: The thumb zone](https://www.smashingmagazine.com/2016/09/the-thumb-zone-designing-for-mobile-users/), [Smashing: one-hand usage](https://www.smashingmagazine.com/2020/02/design-mobile-apps-one-hand-usage/)
- **Money apps:** Copilot's phone dashboard is a fixed order: new transactions, trending budget categories, upcoming recurring, net income, each a short list with "see all"; Monarch's is user-arranged widgets with tabs for accounts, transactions, cash flow, budget and recurring; YNAB centres one figure ("Ready to Assign") over one category list. [Penny Hoarder: Copilot review](https://www.thepennyhoarder.com/budgeting/budgeting-copilot-money-review/), [Engadget: best budgeting apps 2026](https://www.engadget.com/apps/best-budgeting-apps-120036303.html), [era.app comparison](https://era.app/articles/era-vs-monarch-vs-copilot-vs-ynab/). Apple Wallet (from use, not cited): one card stack, the latest transactions as one inset grouped list under it, detail as a pushed page.
- **Dynamic Type:** not researched further here; #48 recorded 200% root text on the main five pages. 74b re-checks at 200% with the new layouts.

Patterns to adopt: one key figure at the top, one list under it, short lists with "See all" instead of every section in full; the primary action at the bottom (tab bar + or a sticky footer), never only in the top row; sheets for short tasks (add, filter, cover), pushed pages for an item you read (a Bucket, a Transaction); rows open their item, buttons inside rows only when the row has a second action.

### Cross-cutting rules (agree with the desktop sweep)

- **Gutter:** one side gutter, 16 px, for the header, the top row and the content. Fix the 18 px header (finding 1). No element starts between 16 and 24 px except by the card padding.
- **Cards:** `--radius-card` 16 px, `--card-pad` 20 px, rows 12 px × `--card-pad`, one 1 px `border-border`, `shadow-card` or none — the same tokens as desktop. Segmented controls and chips use `--radius-control`.
- **Headings outside cards** (as desktop), so every block starts with a heading at the gutter.
- **Links:** one destination, one link per page; the tab bar and the header are global. Exceptions as desktop: the section's first tab, an empty state's one action, a To do row's action, phone-only "Back to …" and the Month/Plan switch.
- **Sticky areas:** the tab bar is fixed with safe-area padding; page content ends with bottom padding equal to the tab bar's height plus the gutter, so the last row is never under it. Sheet footers are sticky with the same padding. No sticky page headers except Explore's and Afford's outcome.
- **Scrollbars:** one scroll container per screen (the document); inside sheets one scroll area; tab strips and chip rows scroll sideways with an edge fade and `scrollbar-width: none`; the desktop rule's thin, hover-shown bars do not apply on touch.
- **Primary action:** one per page, in the bottom half (tab bar + or a sticky footer).

### Phases (about 30 tool calls each)

- **74b: measure.** Rerun the audit without `networkidle`, JSON written per page, sheets with 5 s click timeouts, on a quiet machine (≥ 6 GB free, no other run). Fill in the table above; look at the 393 shots of Transactions, Plan, Goals, Household and two sheets. Also 320/430 for the main four.
- **74c: shell.** One 16 px gutter (header), the top row's icons into one More menu, tab-bar bottom padding token, tab strips' edge fade on phones, a phone alignment check (first child left edges within 1 px) in phone-overflow.spec.
- **74d: This Month.** Drop the card's "Plan ›", one Cover action, rows open the Bucket, legend behind the help, Bills/Income per the table.
- **74e: Plan pages and detail pages.** Add buttons as list rows, Year rows, Bucket/Commitment/Goal/Account detail.
- **74f: Transactions, Review, Accounts, Goals.**
- **74g: Explore, Afford, Scenarios, Reports, Insights.**
- **74h: Household, Check-in, Glossary, Ask, wizard, every sheet; 200% text and landscape.**
- **74i: guard.** 393 light and dark baselines for every page, the alignment check, axe, overflow and target-size on chromium-mobile and WebKit (WebKit needs a machine that can launch it).
