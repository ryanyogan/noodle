# Desktop sweep (#73)

## 73a: audit and research (2026-10-03)

How it was done: a throwaway Playwright spec signed in as a fresh Parent with a busy Household (`createPlannedHousehold` with $6,200 take-home pay and four Buckets, `seedReportHistory` for 8 months, a Joint Savings Account, a Trip Goal). It visited every desktop page at 1024, 1440 and 1920 wide (1024, 1280, 1440, 1680, 1920 and 2560 for This Month, Transactions, Plan and Reports), took full-page screenshots, and measured each page in the browser:

- (a) every visible link and button: href, label and region (Sidebar, page header, main, rail/list), grouped by destination;
- (b) the top and left/right edges of the header, each layout column's children, top-level cards and sections, flagging side-by-side tops and shared edges that differ by 2 to 24 px;
- (c) horizontal page overflow, elements past the viewport, clipped content and truncated text;
- (d) every element that scrolls, with its scrollbar's width;
- (e) the computed padding, radius, border, shadow and background of every card and the gaps of the layout grids.

The screenshots and the raw `measure.json` were kept outside the repo (scratchpad). Four were looked at closely: This Month at 1440 and 2560, Plan at 1440, Explore at 1024.

Not reached by this pass (do in 73b): the Reports tabs (the spec found no `/reports?view=` links, only `?sheet=quick-add`), a Commitment page, Scenarios › Compare (needs two Scenarios), the Transaction editor and a Rule, loading states, and dark mode.

### Top findings

1. **Two navigations for the same places.** The Month/Plan switch above every This Month and Plan page goes to the same two places as the Sidebar's This Month and Plan. On Plan pages the switch's "Plan" and the "Overview" tab are both `/plan/<month>`.
2. **Plan › Overview links every tab twice.** The take-home-to-Free-to-Spend rows (Take-home pay, Commitments, Buckets, Goal funding) and "See the whole of 2026" go to the Income, Commitments, Buckets, Goal funding and Year tabs right above them. That is five duplicate destinations on one page.
3. **This Month's rail is three times as tall as its main column.** At 1440 the main column (Buckets, Bills) ends at about 1,050 px and the rail runs to 2,400 px: Free to Spend, Close September, Get started, Extra income, Coming up, Goals, Income. Below 1,050 px the left two thirds of the page are empty. At 2560 it is the same, with about 460 px of empty space left of the content as well.
4. **This Month shows the same data twice.** Every Commitment is linked from Bills and again from Coming up (Mortgage, Internet, Streaming). "Left in Buckets $67" is in the Free to Spend legend and again in the stat row under it. Extra income appears in Close September ("$1,426 above your usual take-home pay") and again in its own section ("$2,328 came in above"), with two different figures and no explanation. "What's "Cover"?" help shows three times.
5. **Column tops don't line up.** Where the main column starts with a section heading and the rail starts with a card, their tops differ. This Month: the Bills section is 8 px below the rail card beside it, and the Buckets heading is about 11 px below the Free to Spend card. Plan › Overview: "Things to check" sits about 14 px below the Coming up card. Explore: the chart tabs are 17 px below the outcome card, and the Buckets section is 13 px below the chart card. The existing E2E check only compares `split-main` and `split-rail` themselves, not their first blocks.
6. **Explore at 1024 still clips its chart tabs.** The tab strip ends at "Each m", with no fade or arrow to show it scrolls sideways (it scrolls with a hidden bar, so the overflow probe doesn't count it). The main column (about 300 px) is narrower than the 360 px rail, so "Same as the Plan over 2 years" and "Over 2 years" in the table wrap badly.
7. **Gutters aren't one token.** `--layout-gap` is 32 px, but Reports' PageLayout uses 20 px (`spacing="tight"`), Explore's and Afford's rail stack 16 px, and Afford's main column 12 px.
8. **Card padding takes seven values.** Cards set 20 px (26 cards), 0 with padded rows inside (69), `40px 24px` for empty states (7), `16px 20px` (Explore), `12px 14px` (Household), `10px 20px` (Bucket page) and `8px 12px` (Buckets list, Check-in). Radii: 16 px (93), 12 px (5: Explore, Household, the Bucket page), 8 px (Check-in and Clerk's sign-in card), plus pills. Borders are consistent: one 1 px `rgb(229,232,237)` on 100 of 105 cards. Shadow: `shadow-card` on 94, none on 16.
9. **"Back to …" and "Next …" duplicate the visible list.** On the Bucket, Goal and Account pages, the MasterDetail list is on screen at desktop widths, yet the detail repeats "Back to Buckets/Goals/Accounts" (same destination as the tab or Sidebar), and the Bucket page's "Next Bucket" repeats the next list row. They are needed only on a phone.
10. **No horizontal overflow and no visible scrollbars were measured**, at any width from 1024 to 2560. Two caveats: headless Chromium may draw scrollbars that don't take width, so 0 px isn't proof, and the Sidebar only fits because the test window is 900 px tall (1080 at 1920 and up). Shorter windows, real browsers and macOS's "always show scrollbars" setting still need checking (73b). The only truncation: Transactions' "Everyone" filter label at 1280.

### Per page

Columns: duplicates (destination: places), crowding, alignment (measured), overflow/scroll, card styles, and the proposed representation.

#### Shell and Sidebar
- Duplicates: the Sidebar is the global navigation. Page-level copies of it: the Month/Plan switch (finding 1), and section tabs whose first tab repeats the Sidebar (Explore › "Explore", Reports › "Overview", Insights › "Insights"). Section index tabs are a recorded exception (ADR-0023: one row of tabs per section).
- At 2560 the content is capped and centred, leaving about 460 px of empty space between the Sidebar and the content. Let the content start at the Sidebar's edge plus the page margin, and grow by columns instead (see "Large screens" below).
- Scrollbars: none at 900 px tall. Give the Sidebar `scrollbar-width: thin`, a bar that shows only on hover or scroll, and `scrollbar-gutter: stable`.

#### This Month
- Duplicates: the Commitment links in Bills and Coming up; "Plan" in the switch and the "Plan ›" link in the Free to Spend card; "Invite" in Get started and Household settings (keep: it's the step's action); "Goals in the Plan" and the Goal funding tab; three "What's "Cover"?" buttons.
- Crowding: the rail has seven sections, the main column two (finding 3). Extra income is shown twice with different figures (finding 4).
- Alignment: Bills Δ8 px, Buckets heading about Δ11 px (finding 5).
- Card styles: 13 cards, 16 px radius, plus pill rows.
- Proposal: **summary, then to do, then lists.** Rail: only Free to Spend (the one key figure) with its legend, minus the repeated stat row. One "To do" card under it gathers Close September, Extra income and Get started, one row each with its own action, so Extra income has one figure. Main column: Buckets, then Bills with a "This month / Coming up" switch (already there), which replaces the rail's Coming up list. Goals and Income move to their own pages (Goals; Plan › Income), each with a one-line link from the To do card only when there is something to do. One "What's Cover?" help in the Buckets header instead of one per row.

#### Transactions (list, editor, filters)
- Duplicates: none measured on the list. #73's text notes Review is reachable from the Sidebar count, the header's Review button and "Waiting in Review" in the side pane; the count rendered 0 for this Household, so recheck with Transactions waiting.
- Overflow: at 1280 the "Everyone" filter label truncates. The editor wasn't reached (the first `/transactions/…` link was a month).
- Proposal: keep the one virtualised list and the rail. Make the Sidebar's count the one way into Review, with the side pane's line as a recorded exception only when it adds a figure. Give the filters a fixed min width so labels don't truncate at 1280.

#### Review and Rules
- Duplicates: "See Transactions" in the empty state goes where the Sidebar goes (keep: an empty state's one action).
- Card styles: the empty-state card is `40px 24px`; others 20 px. Proposal: an `EmptyState` with one padding token, used everywhere (Review, Scenarios, Insights, Perks, 404).

#### Accounts and an Account
- Duplicates: "Back to Accounts" on the Account page (finding 9).
- Card styles: 20 px and 0 (row lists), all 16 px radius. Clean otherwise.
- Proposal: hide "Back to …" at desktop widths where the list pane is visible (container query on MasterDetail); keep it on a phone.

#### Plan (Overview, Income, Commitments, Buckets, Goal funding, Year), Bucket and Commitment pages
- Duplicates: finding 2 on Overview; "Plan" and "Overview" on every Plan page; Commitments' "1 lumpy month ahead" card goes to Year (keep: it says why); Goal funding's "All Goals and their progress" goes to Goals, as the Sidebar does; Year links October three times (the "Plan", "Overview" and "October" links) and March twice; the Bucket page's "Back to Buckets" and "Next Bucket" (finding 9).
- Alignment: Overview's "Things to check" heading is about 14 px below the Coming up card (finding 5).
- Card styles: the Buckets list uses `8px 12px` with a 12 px radius; the Bucket page `10px 20px` with 12 and 16 px radii.
- Proposal: Overview is **one waterfall card** (Take-home pay → Free to Spend). Its rows stay as figures with no chevrons or links, because the tabs above already lead to each part. "Things to check" goes in as rows of the same card, or in the rail. Drop "See the whole of 2026" (the Year tab does that). The rail holds "What changed", collapsed to the last 3 changes with "Show all". Coming up goes away here (it belongs to This Month). Year: one link per month (the month name), not three.

#### Goals and a Goal
- Duplicates: "Back to Goals" (finding 9).
- Card styles: one card with a 0 radius inside the list (`rad 0px`), which should be a row, not a card.
- Proposal: the list stays a MasterDetail. At 1680 and up the Goal paths grid goes to three columns (as Explore already does since #51).

#### Explore, Can we afford it?, Scenarios, Compare
- Duplicates: the "Explore" tab and the Sidebar's Explore (a recorded section exception). Scenarios has two in-page "Explore" links (a tab and an empty-state link): keep one.
- Crowding: Explore stacks the Scenario card, a period switch, the outcome, chart tabs, a chart, a table, Goals reached and Assumptions in main; the rail stacks seven editors (Your changes, Income, Commitments, Buckets, Goals, One-offs, Assumptions).
- Alignment: chart tabs Δ17 px against the outcome card, Buckets Δ13 px against the chart card (finding 5).
- Overflow: at 1024 the tabs clip, and the main column is narrower than the rail (finding 6).
- Gaps: rail 16 px, Afford main 12 px (finding 7).
- Proposal: **outcome first, editors behind disclosure.** Main: the outcome sentence and figure, then one chart, with a segmented control (Free to Spend / Balance / Each month / Goal paths) that turns into a select below about 480 px of container width. Below that, one table (Plan against Scenario), with Goals reached as rows of it. Rail: "Your changes" first, then the editors as collapsed accordions (each showing its total), so the rail is about as tall as the main column. Below 1280, swap the widths: main flexible, rail at least 320 px.

#### Reports (each tab)
- Duplicates: "Overview" = `/reports` = Sidebar Reports; the header's "Insights" link = the Sidebar's Insights. Drop the header link: Insights has its own Sidebar entry.
- Gaps: PageLayout `tight` is 20 px against 32 elsewhere (finding 7). Card padding is 20 px. The tabs weren't walked (see "Not reached").
- Proposal: one gap token. Dashboard cards keep a 12-column grid inside PageLayout, with a 1/2/3-column card grid by container width.

#### Insights, Perks
- Duplicates: the "Insights" tab and the Sidebar's Insights (a section exception).
- Card styles: an empty state of `40px 24px`; others 20 px. Fine otherwise.

#### Ask, Check-in
- Check-in: the step chips use an 8 px radius and `8px 12px` padding, unlike the 16 px cards elsewhere. Proposal: the chips use the control radius token (see the rules below).

#### Household settings
- Duplicates: Check-in's "Start" goes where the Sidebar's Check-in goes (keep: it says when the next one is).
- Crowding: 12 cards, 2,864 px tall, `columns={2}`. One card uses `12px 14px` padding with a 12 px radius.
- Proposal: group the settings into three titled groups (People, Money, Notifications and data) with an in-page index at 1440 and up.

#### Glossary, the get-started wizard, sign-in, 404
- Glossary: one 8 px padding card. Clean.
- The wizard and 404 each have one centred card. Fine.
- Sign-in: Clerk's card uses an 8 px radius. Theme Clerk's `borderRadius` variable to the card radius.

### What others do (research)

- **Window size classes** (Material 3 / Android): compact < 600, medium 600–839, expanded 840–1199, large 1200–1599, extra-large ≥ 1600 dp. List-detail and supporting-pane layouts start at expanded; at large and extra-large add panes rather than stretching one column. Noodle's 1024 is "expanded" (two panes), 1280–1440 "large", and 1680+ "extra-large", where a third pane or a third card column is the expected growth. [developer.android.com: window size classes](https://developer.android.com/develop/ui/compose/layouts/adaptive/use-window-size-classes)
- **Stripe Dashboard**: depth from background tints and hairline rules rather than heavy shadows; tabular figures for money; a constrained content width; a strict 4/8 px spacing scale. At Config 2021 Stripe described dropping a card-per-widget dashboard because cards wasted space and buried the important figures. [Stripe design system breakdown](https://www.designmd.run/blog/stripe-design-system-breakdown), [Behind the Gradient: Design at Stripe](https://uwux.medium.com/behind-the-gradient-design-at-stripe-476dcf61a51a)
- **Monarch**: a customizable two-column widget dashboard, a collapsed sidebar that still works, breadcrumbs on detail pages, and shorter transaction rows on desktop to fit more in view. [Monarch: refreshed look and product updates](https://www.monarch.com/blog/monarch-brand-refresh), [Customizing your dashboard](https://help.monarch.com/hc/en-us/articles/360058127551-Customizing-Your-Dashboard)
- **Linear / Mercury / Copilot** (from using them, not a cited source): one primary button per page header, top right; the list is the page, and detail opens beside it; filters as a chip row, not a panel; summary figures in one quiet row above the list, not one card each.
- Apple's HIG for macOS/iPadOS uses the same split-view model (sidebar, then content list, then detail), with the inspector as an optional trailing pane. It matches ADR-0024's MasterDetail plus an optional rail.

Patterns to adopt: one primary action per page header; summary, then list, then detail; a destination is linked once per page (the Sidebar is global, the section tabs are local, and in-page rows don't repeat either); secondary groups behind a disclosure that shows their total; on large screens, grow by columns.

### Cross-cutting rules to adopt

- **Grid:** keep PageLayout, SplitLayout and MasterDetail (ADR-0024). Gap: only `--layout-gap` (32 px) between columns and between blocks in a column. Remove `spacing="tight"`, or make it a second token `--layout-gap-tight` (16 px) used only *inside* a card grid. A list of rows inside a card has no gap (the rows' borders separate them).
- **Column tops:** every column's first child is either a section heading or a card. Rule: **a section heading always sits outside its card, and the rail's first block has a heading too** (for example, "Free to Spend" moves from inside the card to above it), so both tops are headings and line up. Add an E2E check comparing the first child of `split-main` and `split-rail` (not only the columns) within 1 px.
- **Cards:** one `Card` radius (`--radius-card` 16 px), one padding (`--card-padding` 20 px; rows inside use 12 px vertical × 20 px horizontal, so text lines up with a padded card's text), one border (`border-border` 1 px), `shadow-card` or none, the same for all. Empty states: `--card-padding` × 2 vertical. Controls and chips: `--radius-control` (8 px); pills only for badges.
- **Links:** one destination, one link per page. Allowed exceptions (write them in COMPONENTS.md): the section's first tab, an empty state's one action, and a To do row's action. "Back to …" only below the MasterDetail breakpoint.
- **Scrollbars:** in `globals.css`, for `[data-slot=sidebar]` and `[data-scroll-pane]`, use `scrollbar-width: thin; scrollbar-color: transparent transparent`, switching to `var(--border-strong) transparent` on `:hover`/`:focus-within`, with `scrollbar-gutter: stable`. That keeps keyboard and screen-reader scrolling. Horizontal tab strips get an edge fade (mask-image) when they overflow. Keep the one-scroll rule (desktop-scroll.spec).
- **Large screens:** keep the shell's cap on line length (`--reading-width` for prose), but rather than centring a capped page at ≥ 1680:
  - SplitLayout's rail grows to `--rail-width-wide` (420 px);
  - pages with a long rail (This Month, Explore) get an optional **third column** at ≥ 1920 (container width ≥ 1500 px), so the rail's lower half moves up beside it;
  - card grids (Reports, Goals, Goal paths) add a column by container query (1 → 2 → 3);
  - content starts at the Sidebar edge plus the page margin; any leftover space goes on the right, never as a gutter between the Sidebar and the content.

### Phases (about 30 tool calls each)

- **73b: tokens, shell and guard.** `--card-padding`, `--radius-card`, `--radius-control`, gap cleanup (Reports, Explore rail, Afford); themed overlay scrollbars on the Sidebar and panes; tab-strip edge fade; the first-child alignment E2E check; COMPONENTS.md rules. Also walk what 73a didn't reach (Reports tabs, Compare, Commitment, Transaction editor, Rule, dark mode, a 700 px tall window).
- **73c: This Month.** Rail down to Free to Spend plus one To do card; Bills' Coming up replaces the rail list; Goals and Income out; one "Cover" help; heading-outside-card tops; a third column at ≥ 1920.
- **73d: Plan.** Overview as one waterfall card with no duplicate links; drop "See the whole of 2026"; Year one link per month; the rail's What changed collapsed; the Month/Plan switch removed (the Sidebar does it), or kept with a recorded reason.
- **73e: MasterDetail pages.** Buckets, Commitments, Goals, Accounts, Rules: "Back"/"Next" only below the breakpoint; list rows not cards; Goals grid columns by container.
- **73f: Explore and Scenarios.** Outcome first, segmented chart control that turns into a select, editors as accordions with totals, widths swapped below 1280, Compare checked.
- **73g: Transactions and Review, Reports and Insights.** One way into Review, filter widths, Reports' header Insights link removed, card grid by container.
- **73h: Household, Check-in, sign-in, wizard, empty/error/loading states, then screenshot baselines.** Settings groups, Clerk radius, the `EmptyState` padding, 1440/1920 baselines, axe on every page, and the ADR for the layout system.

### 73g: Transactions, Review, Reports and Insights (done 2026-10-03)

- **One way into Review from Transactions.** The Sidebar count is the global entry. In the page, the header's Review button stays and the rail's "Waiting in Review" link is gone. Why the button: it is there at every width (phones have no Sidebar), it already carries the count, it is reachable from the keyboard in the header, and the rail line showed only from lg, where the Sidebar count and the button already said the same thing.
- **Transactions columns at 1280.** The For column keeps a 4.5rem minimum, so "Everyone" shows whole beside the rail; the column gap is 12px until 2xl (16px after); the header's "Description" name hides below 1400px, where the Date sort button fills that column (it overlapped "Assigned to" at 1280). The filter pane keeps the one rail width (360px), and its labels did not truncate at 1024, 1280, 1440 or 1920.
- **Reports.** The header's Insights link is gone (Insights has its own Sidebar entry). Overview looked at by eye at 1920; Spending, Trends and Merchants only measured at 1440 and 1920 (not looked at): no truncation, cards 16px radius and 20px padding, one gutter (PageLayout).
- **Review and Insights.** Measured only, not looked at by eye: no truncation at 1440 or 1920; cards 16px radius, 20px padding; the empty state is still `40px 24px`, left for the shared EmptyState padding in 73h. Insights' density was left as is: one column of cards plus the empty state.
- **Guard.** desktop-scroll.spec.ts's alignment check now also covers /review, /reports, /reports?view=spending and /insights.
- **List-and-detail pages (73e).** Buckets, Commitments, Goals, Accounts and Rules: from lg the detail header no longer shows "Back to …" or previous/next (`DetailHeader listBeside`), since the list beside it is the way to and between items; below lg, where the item is its own page, both stay. Transactions and Scenarios were left as they were. Radius outliers moved to tokens: the Bucket page's spending strip (12px, `10px 20px`) is `--radius-card` with 12px × `--card-pad` rows; the Buckets list's sticky toolbar is `--radius-control`; the Goals grid cards are `--radius-card`. These five pages are in desktop-scroll's alignment check. Not done: screenshots at 1440/1920/393 were not looked at in this phase, nor the 1920/2560 detail width, the Goals "0 radius card" row, or crushing in the 360px list pane.
73e2 (looked at, busy Household): Bucket page at 1440 and 1920, Commitment page at 1440, Goal page at 1920. The page column is capped, so at 1920 the detail pane does not grow past about 710px and no line stretches. The Bucket page cards stopped at 672px (max-w-2xl) while its title row and Edit ran to the pane edge; at lg they now span the pane like the Commitment and Goal cards. Shot but not looked at: Account at 1440/1920, Buckets list at 393. No Rule page was shot (the busy Household has no Rule).

73e3 (Bank Connections card in the list pane): the empty Bank Connections card sat its icon, a long paragraph and the button in one row, so in the 360px list pane beside an Account the paragraph ran about two words a line. It now sizes by its own width (a container query): below 32rem it is the icon and text, then the button full width; wider, one row as before. The copy is two sentences (balances and about 90 days, can't move money; pick the Accounts you already have; one of 10 Plaid connections), and the Add Account intro card shares it. The other list panes (Goals, Buckets, Commitments, Rules) use EmptyState, which already stacks and centres, so nothing changed there. Looked at: an Account at 1440 and 1920 (card stacked, button full width, text at a normal measure), the Accounts list at 393 (card stacked; the buttons were still greyed because the shot was taken before hydration), a Rule at 1440 (list and editor side by side, nothing squeezed).

- Still open: the Transactions list card stays as tall as the virtualizer's estimate, leaving empty space under short months; the rail's Bucket/For selects showed no value text in the headless screenshots (check headed).

## This Month (73c)

Looked at: 1440 closed (after the To do card), 393 with To do open (the phone view, unchanged; its length is for #74), and 1440 at 73c2. Measured only: 1920 and 2560 (rail 600px vs main 610px). Not yet looked at: 1440 with the To do rows open after 73c5's flattening.

What moved where:

- **Bills** has its This month / Coming up switch at every size; the rail's separate Coming up section is gone (and its code with it).
- **The stat row** is gone; Free to Spend's card says the same.
- **Goals** are off This Month; they live on Goals and Plan.
- **Income** sits in the main column under Bills. On a phone the reading order is now Buckets, Income, Free to Spend, To do (visually the phone still shows Free to Spend and the To do strip first).
- **From 1920** the main column and the rail each get their own wrapper, so neither stretches past a readable width.
- **Cover help** shows only on the first overspent Bucket row, not on every one.
- **To do** is one card in the rail: a collapsed row per prompt with a status line ("2 Buckets and Extra income to decide", "3 of 4 done", "$2,328 in October to place"), its heading lined up with Free to Spend's. An opened row shows its content inside the same card: Close September's leftovers are plain rows between the card's own dividers (no card inside the card), its heading is not repeated (it stays for screen readers, and its help moves to the start of the text), and the Extra income line takes the rail's full width with its choice underneath. The phone is unchanged.

Extra income shows two amounts, and both are right: **$1,426** in the Close September row is September's Extra income nobody has decided on yet; **$2,328** in the Extra income row is October's, $8,528 received less the $6,200 usual take-home pay.

## Plan (73d)

Decisions (code and tests only; the after screenshots did not get looked at in 73d, see the handoff):

- **Month and Plan switch:** gone on a computer (the Sidebar has This Month and Plan). Kept on phones only: the phone tab bar has no Plan tab, so the switch is how a phone reaches the Plan. The whole row above the header (switch, Reports, Ask, Glossary) is lg:hidden. The e2e helper switchTo uses the Sidebar at 1024px and wider, the switch below.
- **Plan › Overview:** the waterfall rows are figures with no links or chevrons; the tabs open each part. "See the whole of <year>" is gone (the Year tab). Coming up is gone from the rail (it is This Month's, in Bills), so both columns start with a heading (Waterfall / What changed); Plan Overview was already in desktop-scroll's aligned list.
- **What changed:** shows its first three changes with "Show all N" / "Show fewer" (aria-expanded).
- **Year:** each month links once (its name in the table or the phone list); Lumpy months names months without a second link.
