# Desktop sweep (#73)

The sections below are in the order the phases ran, and later phases overtook some of the earlier ones. For each page as it is on main now, what was looked at, and what is left, read "Where #73 stands" at the end.

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

Decisions (code and tests; the after screenshots were looked at in 73d2, verdicts at the end):

- **Month and Plan switch:** gone on a computer (the Sidebar has This Month and Plan). Kept on phones only: the phone tab bar has no Plan tab, so the switch is how a phone reaches the Plan. The whole row above the header (switch, Reports, Ask, Glossary) is lg:hidden. The e2e helper switchTo uses the Sidebar at 1024px and wider, the switch below.
- **Plan › Overview:** the waterfall rows are figures with no links or chevrons; the tabs open each part. "See the whole of <year>" is gone (the Year tab). Coming up is gone from the rail (it is This Month's, in Bills), so both columns start with a heading (Waterfall / What changed); Plan Overview was already in desktop-scroll's aligned list.
- **What changed:** shows its first three changes with "Show all N" / "Show fewer" (aria-expanded).
- **Year:** each month links once (its name in the table or the phone list); Lumpy months names months without a second link.
- **Screenshots (73d2):** sheet-plan.png: Plan and Year look right (the lead). sheet-month.png: at 1440 and 1920 This Month has no switch row, so the title sits at the top beside the Sidebar with nothing lost; at 1920 Income moves up into a middle column; Plan › Year at 1920 has the tabs right under the title and one link per month. sheet-phone.png: the Month and Plan switch with Reports, Ask and the Glossary is still above the header on Plan, Year and This Month; the waterfall rows have no chevrons, "See the whole of 2026" is gone so What changed shows right under it; Year and This Month are unchanged.

## Explore, Can we afford it?, Scenarios (73f)

Done (2026-10-03):
- Below 1280 (lg to xl) Explore and Can we afford it? give the editors' column 320px instead of the 360px rail, so the outcome / answer is the wider column (about 340px against 300px at 1024). From xl both keep the standard rail.
- Can we afford it?'s "Housing a month" and "Cash to buy" tables sit side by side by the answer's own width (`@md/answer`), not the window's (`sm:`), so at 1024 they stack instead of clipping "$80,000" and "$2,022".
- Column tops: Explore was already in `desktop-scroll`'s alignment list; it passes at 1440.

Looked at (a plain Household: Plan, three Buckets, no Goals, no kept Scenarios):
- 1024 before: Explore's outcome column wrapped "over 2 years" and the totals table's labels onto two lines, and the chart tabs clipped "Each m"; Afford's two tables clipped their figures. After: the totals table reads on one line per row, all three chart tabs fit, Afford's tables stack and read fully.
- 393 after (Afford): unchanged layout, tables stacked, nothing clipped.
- 1440 and 1920 were taken but only 1440 before was looked at; from xl nothing changed, so they are not claimed.
- Scenarios at 1024: only the empty state (no kept Scenarios), which looked fine. Compare was not looked at (needs two kept Scenarios).

Not done (left for a later phase):
- The chart control stays a `TabsList` (it scrolls and fades like every tab strip, per the Tab strips rule) rather than turning into a select.
- Explore's editors as collapsed sections showing their totals: not started. Many specs click rows inside Income, Buckets, Commitments, Goals and One-offs, so it needs the REDESIGN RULE grep and a full run of explore*, scenarios-kept, try-in-explore and affordability specs.
- The kept Scenario page (`scenario-view.tsx`) still puts its Changes before the Outcome charts.

## 73h: shared pieces (2026-10-03, partly done)

- **EmptyState** pads with the card token: `--card-pad` across and twice it down, instead of `40px 24px`. The 40px 20px reading on Insights, Perks, Review and Scenarios was taken before the last biome fix and has not been re-measured since (73h2's re-measure did not finish).
- **Reports' chart titles sit above their cards.** `ChartCard` is now a heading row (title, description, its table toggle and actions) over a Card holding the chart; the `group` role and its name stay on the wrapper. Looked at: Reports Overview at 1440 and 1920, Spending at 1920. The headline-figure cards had no title, so they are unchanged.
- **Measured, nothing to change:** Clerk's sign-in card is already 16px (`appearance` themes it); no card on Household, Check-in, Insights or Reports has a radius other than 16px or padding other than 0/20px. One leftover: Household's danger-zone box ("These clear your Household for good") is 12px radius, `12px 14px` padding.
- **Looked at, not changed:** Household at 1440/1920 (one reading-width column, left-aligned; at 1920 the shell itself is centred: main runs 484 to 1684 on most pages and 364 to 1804 on Reports and Scenarios, so the leftover space is on both sides, not on the right as the rule says; that is the shell's max width, not Reports); Check-in at 1440/1920 (step list beside one card, fine); Insights at 1440 only (empty state and the rail, fine; 1920 was measured, not looked at; density not re-judged with Insights present, as the test Household had none).
- **Not done:** the shell's centring at 1920; Household's danger-zone radius; Check-in's step chips with real data; the wizard; error and loading states; the 393 shots (taken, not looked at); screenshot baselines for Plan Overview, Transactions, Goals and Explore. shell.spec's `month-iphone-*` and `reports-iphone-light` baselines change with this commit (EmptyState and Reports) and need regenerating and looking at.

73h2 (2026-10-03):

- **The shell no longer centres.** `main` starts at the gutter beside the Sidebar and keeps its cap (1200px, 1440px on wide routes), so the leftover goes on the right. Measured: main 248 to 1440 at 1440 (unchanged), 248 to 1448 at 1920 and 2560 on This Month and Plan, 248 to 1688 on Reports and Scenarios. Looked at: This Month, Plan, Reports and Scenarios at 1920. Shot, not looked at: the same four at 2560 (same measurements).
- **Household's danger-zone box** uses the card tokens: measured 16px radius, 20px padding at 1440.
- **ChartCard's biome-ignore** now sits above the element, where biome applies it (it was a no-op on the attribute and biome failed).
- **Not done:** shell.spec baselines changed (household-desktop-{dark,light}, household-iphone-{dark,light}, month-iphone-{dark,light}, reports-iphone-light) but were not looked at, so they were restored, not committed; CI's shell.spec will fail until they are regenerated and looked at. reports.spec's "Big expenses" test failed (Flights to Denver not found in the largest list) and needs checking against 73h's ChartCard change.


## ADR-0033 rollout as it stands (2026-10-04, 73y and 73z)

Read from the page code and `git log`, not re-measured. The shell caps the page at `--shell-max` (1200, 1440 from 1440, 1680 from 1920) and starts it at the gutter beside the Sidebar; routes marked `wide` use `--shell-max-wide`. No pane scrolls on its own: a rail or a picked item's pane stays in view (sticky, 24px from the top) only while it fits the window.

| Page | Layout pieces in use | State |
| --- | --- | --- |
| This Month | `PageLayout`, `SplitLayout stack="children"` | Rolled out. Get started (new Household) is stacked full width (73y). |
| Plan › Overview | `SplitLayout`, `SectionGrid` (two columns from 1920) | Rolled out. |
| Plan › Goal funding | `SplitLayout stack="children"` | Rolled out. |
| Plan › Year | `SectionGrid` | Rolled out. |
| Bucket, Commitment, Goal, Account, kept Scenario | `MasterDetail` pane with `DetailColumns` (Commitment, Goal, Account, Scenario); the Bucket page uses `StatGrid` | Rolled out. The Goal's side column is held in view again (73z). |
| Transactions | `SplitLayout stack="rail"` | Rolled out. One list for every month length (73z). |
| Review | `MasterDetail`, `SectionGrid columns={3}` | Rolled out. |
| Reports | `PageLayout` on the wide cap | The model the others follow. |
| Insights, Perks | `SplitLayout`; `SectionGrid` | Rolled out. |
| Explore, Can we afford it? | `SplitLayout` | Rolled out; Explore's editors as collapsed sections are still not started (see 73f). |
| Household | `PageLayout` (reading width below xl), `SectionGrid` | Rolled out: two columns that end near the same line. |
| Check-in | step list (240px) beside one card | The card takes the full width beside the steps (73y). |
| Accounts list, Goals list, Glossary, Ask, wizard | none of the above pieces in the route file | Not checked in this pass. |

### 73y (2026-10-04)

- **Household's Danger zone** says what each button does: "Start fresh can be put back. Deleting can't.", then one paragraph each (Start fresh takes a snapshot first and can be put back from Snapshots for up to 90 days; Delete Household removes everything, with one last snapshot kept 30 days).
- **Check-in** card: the `lg:max-w-4xl` cap is gone, so the card runs the full width beside the step list. Looked at 1920. Open: rows are about 1300px wide there (name left, amount right); cap and centre if that reads too wide.
- **Get started** on This Month (new Household): the "Finish setting up" card and the step list are stacked, each the page's width, instead of side by side.
- **Explore › Goal paths**: "Reached in Mar 2027" (was "Reached Mar 2027"); the "· new" mark sits outside the truncating name, so a long name is cut and the mark and the month stay whole. Not looked at (the shot showed the Free to Spend tab).
- **No change needed**: the Bucket page's stat grids (already `StatGrid`), the one-off form's Name label.

### 73z (2026-10-04)

- **Transactions has one list.** A month past 300 items used to switch to a windowed list (`useWindowVirtualizer`: rows placed by hand against the window's scroll, the card as tall as an estimate). That path had no test, and the shorter path beside it was already the one every real month took. It is removed, with its dependency (`@tanstack/react-virtual`): every loaded row is drawn in the page's flow, 50 more load as the end nears the screen, and the page is the only thing that scrolls (ADR-0033). Why this is enough: a row is a few lines of text with no work of its own (one lookup of its Bucket and its Member), rows arrive a page at a time, and a busy family month is a few hundred rows; a thousand rows is about 20 pages of scrolling before all are in the page. New spec `e2e/transactions-long-month.spec.ts`: a 400-row month at 1440 loads every row by scrolling the page, no ancestor of the list scrolls, no row is absolutely placed, the list is as tall as its rows, and the last row opens beside the list. This also closes 73g's "the list card stays as tall as the virtualizer's estimate". Not measured: frame times with 1,000 rows on a phone (`phone-long-list.spec.ts` still guards a busy month there).
- **Goal page** (desktop.md "Desktop: 672px, with History below the fold"): the right column (progress card, Emergencies, Finish) is held in view (`sticky`, 24px from the top, the same inset as `SplitRail`) while a long History scrolls with the page. It is held only while all of it, plus the inset above and below, fits the window (measured on the column, re-measured when it or the window changes size); taller than that it scrolls with the page, so nothing is out of reach and it never scrolls on its own. In a narrow pane (one column) nothing sticks.
- **Household, Child edit** (desktop.md "Child edit expands inline"): already closed on main by c931a1b: a Child's pencil opens the shared Sheet with Name, colour, Save and Remove (Remove asks in an AlertDialog). No change in this phase.
- Proposal, not made in 73z (shared file): `packages/ui/COMPONENTS.md` line 197 said "long lists are virtualized (Transactions)". Done since: on main it says Transactions is one list whose rows load 50 at a time, with no virtualizer.

## Where #73 stands (2026-10-04, through 73ai, 74ah and 78i)

This section says how the desktop stands now. It was rewritten from the phase handoffs (73i to 73ai; ci73ac, ci227 and base2; 84a; 74t to 74ah where they reach the desktop; 78g to 78i for the Rule toast and the Snapshots list) and from `git log`. Nothing was rendered or measured to write it. The phase-by-phase record it replaces is in this file's history (a8d0d9b and before) and in the handoffs.

Everything below is on main at 76f9f27, and CI passed on that commit. Whether that commit is deployed was not checked here.

The words, used strictly. Nothing here says more than a handoff does.

- **looked at** or **seen**: someone opened the picture, at the width named;
- **measured**: numbers were read in the browser or in a picture, and nobody judged the picture by eye;
- **read**: from the code only;
- **not looked at**: a picture may have been taken, and nobody opened it;
- **crops**: parts of a picture were opened, not the whole of it;
- **sheet only**: the page was seen as one tile of a contact sheet, at about 0.45 scale, and not opened. 73af's "near full size" is a crop 1,170px wide of the top 1,150px of a page, shown at 0.85 scale;
- **inferred**: worked out from other measurements, with no picture of the thing itself.

**Pictures.** They come from the Page shots workflow on GitHub (`e2e/page-shots.spec.ts`, one job per width: 1024, 1440, 1920, 393 and 320 by default), not from this machine. Numbers such as 01, 10 and 27 are that spec's picture names. 2560 is not one of its widths. Every picture is taken with reduced motion, so a chart is drawn as it ends up (e493b7a). A full-page picture draws a fixed bar (the wizard's Back, Skip and Continue) across the middle of the page: that is the picture, not the page. 19b, 19c and 19d are drawn at phone widths only. Dark has been drawn at 1440 only (73af, 73ah, 73ai).

**Palette.** The colours are Indigo (ADR-0038). Warm paper (ADR-0034) and Soft stone (ADR-0036) came before it, and most looks recorded below from before #83 (34a25d0) were at pages in one of those two: they are looks at layout, not at the present colours. 73x's note that the sign-in page's left panel "reads blue-grey beside the stone page" was made on Soft stone and has not been checked in Indigo.

### What the sections above no longer describe

- **Phones no longer have the Month and Plan switch** (73d kept it): the tab bar ends in More, and the Plan is in More (#74, a41dbc5).
- **This Month from 1920** (73c, 73L): the main column is one column at every width. Income sits in the rail under To do from 1024, and Bills are two columns inside the main column (5e5e39f). The three columns 73L5 looked at at 1920 are gone.
- **A kept Scenario** shows its outcome before its Changes (58bde14); 73f listed that as not done.
- **List-and-detail pages** (73e): no pane scrolls on its own any more (243d3f1, 2213abe). "Pick a … to see it here" is gone from Goals, Accounts, Buckets, Commitments and Rules; Scenarios keeps its hint.
- **Every comparison picture** is current: redrawn in Indigo (34a25d0), then after 74ae, 73ag and 73ah (2523d3f, 48df31f, f33eca0).

### The layout the pages share (73L, 73p, 73r, 73s, 73u)

- **Widths grow with the window** (ADR-0033, 2cabc15): the page cap is 1200, 1440 from 1440 and 1680 from 1920 (1440 and 1800 on wide routes); the side column is 320, 360, 380 and 440; the list beside an item is 360, 400 and 460. `SectionGrid` and `DetailColumns` are the two shared pieces.
- **One scroll** (243d3f1, 2213abe, fe9d44b): a list beside an item scrolls with the page. Each pane measures itself and is held in view only while it fits the window.
- **Picking an item** (7a85ace, fdb3fba, bc4fc9f): the window is not sent to the top. An item that fits the window stays beside the row that was clicked; an item taller than the window starts 24px under the top. `master-detail.spec.ts` checks the taller case; the case where the item fits has no test.
- **A section's tab** is the current one on the pages beneath it: a Bucket, a Commitment, a Rule, a kept Scenario (66a6cf6; `section-tabs.spec.ts` and `master-detail.spec.ts`).
- **Loading and failed pages** (fbe2d57, c4b0c27): a placeholder has the header's space and the page's columns; a failed page has a heading.
- **The controls' edge** (0ecd7f1): an empty tick box, an unchosen option and an off switch take a field's edge, `--input`, in both themes; an off switch's track is `--switch-track`. The numbers are in `docs/reviews/theme.md`, section 9.
- Seen for these: Buckets at 1920 and a Bucket at 1440 (73p, 73s): it flows with the page, nothing scrolls inside. Not looked at: keeping your place on a pick, in a browser, at any width (tests only); loading and failed pages (no picture covers them).

### Per page

| Page | How it is on main | Seen | Not seen, or measured only |
| --- | --- | --- | --- |
| This Month | One "?" on the Buckets heading, the bars' key under the list (2cabc15). No "Plan ›" in Free to Spend; one "?" per open To do row (dc9545b). Buckets a block of its own (9c831db). Income in the rail, Bills in two columns, Record payment on the bill's line (5e5e39f). In dark the glance's Goals part is hollow, an outline; in light it is filled as before (cfca9cb). | 01 at 1440 (73s): 2,192px tall; the rail ends near 1,200 and the main column near 2,130, so the rail is about 54% of it, short of the 60% aimed for. In dark at 1440, near full size (73af, before 0ecd7f1): fine. The glance in dark at 1440 after cfca9cb (73ai, a crop): an outlined empty box between the striped part and the indigo end, its key an outlined square; in light unchanged. | 1920 and 1024 since 5e5e39f. 02, the To do rows open, at any width. The glance with Left in Buckets at 0, or with Free to Spend at 0 or less, where the bar's rounded end clips the hollow part's edge. |
| This Month, new Household | Continue setup shows without opening anything (01165e2). The "Finish setting up" card and the steps are stacked, each the page's width (412f020). On its own page the Get started steps sit two by two inside one card from 1280 (394fa6e); inside To do they are as before. The strict pictures at 1440 by 900, light and dark, are this page (54bae37). | 30 at 1920, the top 600px (73ac): two by two, each cell about 795px, one upright hairline; the card ends near 372px. At 1440 by 900 from CI's own pictures (ci73ac): two by two in light and dark, the card's edges in line with the card above. | Dark at any width but 1440. 1280 and 1024. Get started with "Don't ask again" pressed, and inside To do: not pictured. At 1920 and 1440 the page is empty below about 370px, and "Finish setting up" has its buttons about 1,100px from its words (item 6). |
| Plan › Overview, Goal funding, Year | Overview: what to check beside the waterfall from 1920, What changed lists six (bd64226). Goal funding: funded this month and Free to Spend in the side column (efdff82). Year: the table first, how to read it below beside Lumpy months (3c45020). | 03, 08 and 09 at 1440 and 1920 (73v). 03 at 1024 and 1440 (73ad): nothing cut; at 1024 each thing to check wraps to three or four lines; at 1440 the right column ends about 280px above the left. | 08 and 09 at 1024. Plan › Income at any width (item 26). |
| Plan › Buckets, a Bucket | The list fills the page until one is picked (243d3f1). Allowance, Spent, Left and the bar in columns, totals in the side column (e8703aa). A Bucket's page starts level with the list, two columns from a 42rem pane (d31db8b). Left to plan stays at the top through the whole list (e093b6f). Under a Bucket's bar the three figures go two across with the third below when the pane is under 448px, as at 1024 (40bf7e2). The Transactions card starts level with the chart card beside it (66a6cf6). | 04 and 05 at 1440 (73s). After 66a6cf6 (73ae): 05 at 1440, the two cards both starting near 535px, by eye; 05 at 1024, whole, nothing cut; 04 at 1024. | 04 at 1920, where the wider bars apply: never seen. 05 at 1920. 04 at 1440 since 40bf7e2. The two cards' level start is by eye, not measured (item 22). At 1024 the third figure's row (item 23). At 1024 a row keeps its name and allowance only: left as it is (decided by the Parent, 2026-10-04). |
| Plan › Commitments, a Commitment | Paid state in its own column, totals in the side column (e8703aa). The cost across the top, Charges beside Next due and Terms history (d66f551). From a list 512px wide the last amount in a row has a fixed width, so Paid or Due and the yearly figure line up down the list; a Commitment's three figures go two across in a narrow pane (40bf7e2). | 07 at 1440 and 1920 (73w): at 1920 Next due and Terms history start on one line; at 1440 it is one column. 07 at 1440 and 1024 after 40bf7e2 (73ae): at 1024 two figures across and Ends below. | 06 since 40bf7e2, so the lined-up columns at 1440: crops only (73ad). A Commitment with Charges (the seed has none). |
| Transactions | One list for every month: rows are drawn in the page and load 50 at a time (f08b655, bc402e4). `transactions-long-month.spec.ts` loads a 400-row month at 1440. | 10 at 1440 (73t, 73z): every row drawn, the card ends at the last row. 11, a Transaction open, at 1920 (73t). | 10 at 1920; 11 at 1440. The 400-row month by eye (the test only). Frame times with about 1,000 rows on a phone: not measured. A Transaction edited from this sheet while a Review decision on it is still waiting to be sent: #85, open (item 35). |
| Review, Rules | Review's list shows its cards two and three across until one is opened (d90fa0c). Rules fill the page until one is picked, Add Rule beside the heading (b14a655). In List view the One by one and List switch sits at the right end of the "N to review" row (40bf7e2). Review's writes (a decision, Confirm all, filing without a Bucket, a return, saving a Rule) are sent one at a time, in order, so an Undo and a decision on the same Transaction cannot cross on the server; Undo is enabled whenever there is something to undo, also while a save is on its way (#84, 46a5d4a). After a Rule files several Transactions the toast says Noodle took a snapshot first and where to put things back; it stays ten seconds and goes by itself (#78; 628c5da, ae12f1d). | 14 at 1440 (73t, 73ae). 13 and 12 at 1024 and 1440 before 40bf7e2 (73ad): at 1440 the list's cards are two across; One by one is a card capped near 576px at the left, and at 1440 the right half of the page is empty. | 13 since 40bf7e2: crops only, so the switch on the "to review" row is not recorded as seen whole. A card opened from far down the list. A Rule's own page: not pictured. 14 at 1920. 12a at any desktop width. #84's change: nothing looked at in a browser. The Rule toast: never looked at on any screen (item 34). |
| Accounts, an Account | Cards two or three across with Totals beside them, under its own heading (deae23a, a2984d2). The balance on its own line; "Log in again" as a badge (e798845, e1298fa). A Bank Connection's buttons wrap under its name (473ca69). Balance has a heading like Transactions (086e49e). An Account with no balance says "No balance yet" on its own page (394fa6e). | Accounts and an Account at 1440 and 1920 (73L5); an Account at 1920 after 086e49e (73L6): the two headings and the two cards start on one line. 16a at 1920 (73ac): the list row and the Balance card say the same words, Add balance beside them. | Accounts since a2984d2: before it the Totals card was measured 13px above the first heading at 1440 (73q), and nobody has looked or measured after. 1024 with a Bank Connection. Two Bank Connections. A card or loan with no balance. |
| Goals, a Goal | A grid of cards with the summary beside it, under the heading "In all" (473ca69, a2984d2). A Goal's figures beside its History in two even columns (58bde14). The side column is held in view while History scrolls (5b8299f); `goal-side-sticky.spec.ts` checks it at 1920 by 1080. A History row says its month in the heading only (394fa6e). | 18 at 1920 (73aa): two columns of 533px, 32px apart; History's heading and the progress card start on one line. **18b at 1920 (73ab): after 700px of scroll the side column is held 24px under the top, with Add money, Spend, Emergencies and Finish on screen while History moves.** 18a at 1920, the top 1,000px (73ac). 18 at 1440 (73z): one column, so the held column does not apply. | 18b since 394fa6e. 18a below its first 1,000px. The Goals list since a2984d2. 18a and 18b at 1440 and 1024. "Set aside" is a heading inside the progress card while "History" is outside its card, so the two cards start 39px apart (item 1). A Goal that pays off a card. |
| A kept Scenario | Outcome charts first, Changes beside them when there is room (58bde14). | 22 at 1440 in light (74af): 24 grey Plan bars and the indigo Scenario line, legend and axes. 22 at 1440 for its tab (73ae). | The layout, at every width. 73q2's worry: the charts in half a pane, about 640px at 1920, may be tight. 22 in dark since pictures are taken with reduced motion (item 24). |
| Explore, Can we afford it? | Goal paths say "Reached in" a month, and a long name keeps its "new" mark (cb9cac4). Comparing Scenarios: the two charts draw at once (c37d2a1). From 640px every line is listed as before; from 1024 a line's actions (End, Undo, Archive, Remove) are plain text buttons in the editor beside the line, as before, and outlined below that (2fe13c5). No layout change since 73f. | Explore at 1920 (73y), on the Free to Spend tab. 19 at 1440 after 3e77866 (74ad), whole, at reduced size: all 11 Commitments, 14 Buckets and 4 Goals listed, no summary line. 19 at 1440, the top 1,300px, after 2fe13c5 (74ah): every Commitment listed, Take-home pay's editor with a plain "Undo" at the right; unchanged, judged against the code and not against an earlier picture. 21a at 1440 (74ab, 74af): the table fine, both charts with three lines. | The Goal paths tab, so cb9cac4 itself. 21a at 1024 and 1920; 640 to 1023. 19 at 1024 and 1920 since 3e77866. The charts once pictured empty (item 24). |
| Insights, Perks, Glossary | From 1680 the Glossary runs in two columns; Insights sit two across when their column is 64rem or more and there are two or more (9683cc5). Perks was redone under #80. | Nothing at full size. | The Glossary at 1680 and up, with a word picked and with a search. Insights two across. Perks' top at 1440 and 1920: measured only (the summary and Do now end on one line). |
| Check-in | The card takes the width beside the steps, with no cap (fadc927). Each step shows its own line, in full (4ca535f, 36640bd). "N more" starts where the rows start (4b90839). Below 640px the footer may wrap (7785023); from there up it is as before. | 26 at 1920 (73y, 73aa): no empty band, the steps and "1 of 4" start on one line. 26 at 1440 before fadc927 (73v, 73w). | 1440 since fadc927. 4b90839. 26a, the card's footer, at any desktop width. The rows at 1920, about 1,300px wide, are left as they are (decided by the Parent, 2026-10-04). |
| Household | Two columns, the Danger zone last across both (6274e4a). Left: Household, People, Bringing in spending, Setup. Right: Reminders, Your data (a2c58c5). The Danger zone says "Start fresh can be put back. Deleting can't.", and that Start fresh keeps the Household, its Parents and Children, takes a snapshot first and can be put back for up to 90 days, statement and Receipt files included (44ef76e, 858d552; ADR-0035). A snapshot taken by hand, before a restore, before a Fresh start or before a Rule files several Transactions shows in the other Parent's Snapshots list straight away (628c5da, e0a0d94). The two More buttons of 74ae show below 640px only. | Light at 1440 (73x): the left column ends near 1,558px, the right near 1,450. 1440 after ee3eb4a (74ae), the bottom 700px: the Danger zone's new first paragraph, Snapshots with both paragraphs. Dark at 1440, whole, near full size (73af, before 0ecd7f1); after it a crop (73ah): the off switch a grey pill with a dark thumb, plainly not one of the three indigo on ones. In light at 1440 (73ai, a crop of Nudges): one off switch among three on, its edge matching the fields below. The comparison pictures at 1440: crops of the two changed bands only, the switch and the Danger zone's paragraph (ci227 in dark, base2 in light). | Dark at any width but 1440. The top of the page at 1440 since ee3eb4a. A Child's edit sheet, open. The other Parent's list updating live: not run end to end (78g, 78h). Outside the two bands the comparison pictures are the same pixel for pixel by measurement, not opened. |
| Sign-in, the setup wizard | Sign-in's fields have the border every field has (c218057). The wizard's buttons follow the last field and its cards share one padding (92ddba3, 171a116). From 1440 the Buckets step is a column of 1,200px with the Buckets two across; the other steps, and the Buckets step below 1440, stay narrow (7214a48; the Parent's decision). "Paid every two weeks?" is an outlined button. | After 7214a48 (73ag): 34 at 1920, eight cards in four rows of two, the whole step in one 1,080px window; 34 at 1440, two across, 1,019px tall; 34 at 1024, one card a row in 592px; 31 at 1920, unchanged; 32 at 1920, "Paid every two weeks?" a small outlined button. Setup's Buckets comparison pictures at 1440, light and dark, whole (ci227). In dark at 1440 (73af, 73ah): steps 1 and 3 near full size, 2 and 4 sheet only; step 3's eight empty boxes plainly outlined. In light at 1440 (73ai, crops): 33's empty boxes, 31's unchosen options, 34's off switches, each with a field's edge and fine. Setup's Hello comparison pictures at 1440 (base2): crops of the three options, a clear grey ring in both themes. | 33 in light, whole. 31 and 32 at 1440 and 1024. 2560. The opened "One paycheck" card. Sign-up. Sign-in in dark. Between steps 3, 4 and 5 from 1440 the logo and the steps change width with the column (item 15). |
| Reports › Cash flow | Below 640px the chart gives way to two lists (#74); from 640px it is the same chart. In dark the Household node and the destinations are quieter greys and the bands a step lighter (0ecd7f1). Reports' Left over has a line for its legend key in both themes, a short line through a hollow dot; Earned and Spent keep their squares (cfca9cb). | 23a at 1920 before 4c66182 (73ab): the chart 1,590px wide and 425 tall, readable; empty below 878px. 23a at 1440 after 2fe13c5 (74ah): the flow chart and no lists; unchanged, judged against the code and not against an earlier picture. 23a at 1440 in dark after 0ecd7f1 (73ah, a crop): the nodes mid grey, the indigo sources and "Saved" standing out, the bands a slate that shows against the card. Reports' legend at 1440, dark and light (73ai): square, line and dot, square; clear. | 1024 and 1920 since 4c66182. 640 to 1023, where the chart still scrolls sideways inside its card (item 16). The Period select sits alone on its row. Reports' tooltip still shows a square for Left over (left alone). |
| Accounts and Goals lists, Glossary, Ask, the wizard against ADR-0033 | | | Not checked (73z). |
| Every page in dark, 1440 only | See the controls' edge above, and the rows for This Month, Household, the wizard and Cash flow. No page file changed for dark. | 73af, before 0ecd7f1. Near full size and fine: This Month, Plan › Buckets, a Bucket, Plan › Commitments, Review's list, Transactions, Accounts, an Account, Goals, a Goal, Explore, Scenarios compared, Reports' overview, Household. Near full size, with findings since fixed or recorded: a kept Scenario, Cash flow, setup's steps 1 and 3. Sheet only: Insights, Check-in, the Glossary, Get started, setup's steps 2 and 4. Over all: no white boxes or light shadows left over; ink, secondary and hint text readable on cards; hairlines quiet but there; a selected row, the focused Review card, ticked boxes and on switches plain. 73ah and 73ai, after, as crops: 33, 27, 19 (the Plan bars a readable mid grey, the Scenario line leading), 23a, 23's legend and This Month's glance. | In dark: Plan › Overview, a Commitment, Goal funding, Year, an open Transaction, Review one by one, Rules, an Account with no balance, the Goal with a long History, Explore with a change, the three checks, the Scenarios list, Perks, Check-in's footer, To do open; anything below the first 1,150px of This Month, Transactions, Explore and the Glossary; every width but 1440. After 0ecd7f1: 31's unchosen options other than in the comparison picture's crops; tick boxes and options on any other page. In light: an empty box on Scenarios (on 21a both were ticked; 21 not opened). The comparison colour on the second surface (item 36). |

### Still to do

Item numbers are the ones this list has always used, so a note elsewhere that names "item 24" still finds it; none is reused. Each item is listed once, where its work stands. Where an item also holds a decision, the decision is repeated under "Waiting on the Parent". "The Parent" there is the user.

#### Open

| | What | Where it stands |
| --- | --- | --- |
| 2 | **2560.** | Last looked at in 73a (This Month), before everything above. 73h2 took four pages there and did not open them. Not a width the Page shots draw. |
| 4 | **Explore's editors as collapsed sections** showing their totals. | Done below 640px (#74, 3e77866). From 640px every line is still listed. Many specs click rows inside the editors. |
| 5 | **Transactions past 300 rows.** | The code and a 400-row test are on main (bc402e4). The look by eye, and frame times on a phone: open. |
| 8 | **Look at what was changed and never opened whole:** the To do rows open on This Month; Review's list and the Commitments list since 40bf7e2; Buckets at 1920; a kept Scenario's layout; Accounts and Goals since a2984d2; the Glossary and Insights at 1920; the Goal paths tab; 18b and Cash flow since their last changes; 33 at 1920; a Rule's own page, which has no picture. | Open. |
| 9 | This Month at 1440: the rail is about 54% of the main column's height. | Open. |
| 10 | Household at 1440: the columns end about 108px apart. | Judged near enough in 73x. |
| 11 | Explore's chart control as a select below about 480px (73f). | Open. |
| 12 | **Dark at desktop widths.** | 1440 only: 18 pages near full size and 6 as sheet tiles (73af), then crops of five pages (73ah) and of the glance and Reports' legend (73ai). Open: the pages and lower parts 73af did not open; every other width; a kept Scenario's chart in dark. |
| 13 | **1024 since ADR-0033.** | Looked at: Plan › Overview, Buckets, a Bucket, Commitments, a Commitment, Review's list and One by one (73ad, 73ae). Every other page at 1024 is open. |
| 14 | A test for an item that fits the window keeping its place on a pick. `e2e/alignment.ts` skips a wrapper with `display: contents`. | Open. |
| 16 | **Cash flow from 640 to 1023** still shows the chart, at least 36rem wide, scrolling sideways inside its card. | Open. The cents are a decision (below). |
| 17 | **A Goal's History:** a row with Undo (this month's) is about 10px taller than the rest (73ac). | Open. |
| 18 | A new Household's sidebar shows a Check-in dot with nothing to check in on (73ab, 30 at 1920). | Not traced. |
| 19 | The car comparison on Can we afford it?: "Costs all in" has no rule above it at any width; the shared table body removes the last row's border (74t). | Open. |
| 22 | **A Bucket's page:** the Transactions card starts level with the chart card by a fixed 42.6px on its heading row, the height of the chart's two-line heading in `report-charts.tsx`. | On main, coupled by a number: if that heading changes, this must too. Level by eye at 1440, not measured. |
| 23 | **The three figures, two across** (40bf7e2): the third figure's row has no rule above it across the full width and sits about 1px right (the shared stat grid; seen at 1024, 73ae). | Small. A window 448 to 639 wide would get three across: not measured. |
| 24 | **The Compare charts once pictured empty** (74y at 320; 73af's kept Scenario in dark at 1440). | A picture problem as far as measured: with motion on, in light, at 320 and 1440, a chart finished its entrance within 400ms and stayed (74af); pictures are now taken with reduced motion, and 22 and 21a at 1440 in light show their bars and lines. Not established: why those runs caught the first frame. Dark was not rerun. A late chart on a slow real load is not ruled out. |
| 26 | Plan › Income has no row in the table above; 73ad left it out of its look at the Plan. | Open. |
| 27 | Goals came in a different order in 21a's pictures at 320 and 1440 (74ab). | Not traced; it may be a sort that is not stable. |
| 34 | **The Rule toast** (#78). After a Rule files several Transactions the toast says Noodle took a snapshot first (628c5da). It stays ten seconds and goes by itself (ae12f1d, 78i); it is no longer the sticky toast of e0a0d94. | Never looked at on any screen. By the code (78h): 356px wide at the bottom centre of the page on a desktop, and from Rules nothing important is under it. For the phone see #74, item 38. |
| 35 | **A Transaction edited from the Transactions sheet while a Review decision on it is still waiting to be sent** (#85): the sheet's edit lands first and the queued decision then overwrites it. | #85 is open. Narrow: it needs a stalled Review write and the Parent going to that Transaction. Look again and applying an existing Rule are also outside Review's queue, and by the code neither can undo a decision (78g): the server files by Rule only what is still unassigned. |
| 36 | The charts' comparison colour on the second surface is 2.93:1 by the numbers, under 3:1. | Whether any chart sits on that surface has not been checked (73ah, 73ai). Small. |

#### Waiting on the Parent

| | The decision | What is known |
| --- | --- | --- |
| 1 | **A Goal at 1920:** should "Set aside" move out of its card so the two cards start level? | They start 39px apart (73aa). |
| 6 | **Get started:** at 1920 and 1440 the page is empty below about 370px and "Finish setting up" has its buttons about 1,100px from its words. Put the buttons under the words, or cap this page at the reading width (which would look like half the width again)? | Seen at 1920 and 1440. |
| 15 | **The setup wizard from 1440:** the logo and the steps change width between steps 3, 4 and 5. | Left as a judgment call by 73ag. |
| 16 | **Cash flow:** "Came in" shows no cents beside "Went out" with cents. | The app shows cents only when there are some, so matching the three is a product decision. |
| 25 | **Three judgment calls** 73ad and 73ae left alone. Plan › Buckets at 1440: the side column ends about 840px above the list. A Bucket at 1440: the Transactions column ends about 175px above the right column. Review, One by one: the card is capped near 576px and the right half of 1440 is empty. | Plan › Buckets at 1024 is decided: left as it is (2026-10-04). |
| 33 | **Review's queue, its trade-offs** (#84): a request that never answers stalls every later Review write on that screen, and no timeout was added; a queued decision is lost if the tab closes before it is sent; two screens writing one Transaction is still last write wins. | From 84a's handoff; accept or ask for more. |

#### Done

| | What | Left unseen, if anything |
| --- | --- | --- |
| 1 | **A Goal at 1920:** the held side column was seen working in 18b (73ab), and `goal-side-sticky.spec.ts` passes on CI. | 18b since 394fa6e shortened the rows. Its decision is above. |
| 3 | **Check-in rows at 1920**, about 1,300px wide: left as they are (decided by the Parent, 2026-10-04). | The 240px step column is still a literal, not a token. |
| 6 | **Get started:** the full content width, two by two from 1280 (394fa6e). Seen at 1920, and at 1440 by 900 in light and dark, which is now the strict picture (54bae37). | 1280, 1024, and the list inside To do. Its decision is above. |
| 7 | **Household's Danger zone:** the words are right for Start fresh (44ef76e, 858d552). Seen in light at 1440 (74ae; base2's crop of the redrawn picture) and in dark at 1440 as a crop (ci227). | |
| 15 | **The setup wizard** (decided by the Parent, 2026-10-04): steps 1 to 3 stay narrow and the Buckets step goes two across from 1440 (7214a48). Seen at 1920, 1440 and 1024; "Paid every two weeks?" seen as an outlined button. | 33 in light, whole; 2560. Its decision is above. |
| 20 | **Tests written and not run when their phase handed off** have all passed on CI since: `goal-side-sticky.spec.ts`, the Plan tab check in `master-detail.spec.ts` (8d97a16), `section-tabs.spec.ts` (48df31f). `rule-snapshot.spec.ts` (78h) was written and not run by its phase; CI has passed on e0a0d94 and 76f9f27, which carry it. This section did not open those runs. | |
| 21 | **A section's tab on the pages beneath it** (66a6cf6). Seen as the one current tab on a Bucket, a Commitment and a kept Scenario; tested for all four. | A Rule's page is not pictured: by the test and the code. |
| 28 | **Reports' legend in dark:** Left over has a line for its key in both themes (cfca9cb). Seen at 1440, dark and light. | The tooltip still shows a square (left alone). Phone widths. |
| 29 | **The comparison pictures after 74ae, 73ag and 73ah** are all redrawn from CI (2523d3f, 48df31f, f33eca0). base2 compared all 19 pictures of its run with the committed ones: 13 byte-identical and exactly the six expected differing. `setup-shots.spec.ts` moves the pointer away and takes the focus off before every picture (476bf98); `shell.spec.ts` did not need it. | base2 opened crops of the changed bands only. That a retried Buckets picture passes is not proven: no retry has happened since. If one fails once and its retry differs around Skip, the leftover is not hover (look at the focus ring or the pressed state). The spec's header comment still describes redrawing on this machine. |
| 30 | **The controls' edge in light** (`#86888f`, where it was `#d4d4d9`): looked at in light at 1440 on four pages, 33, 31, 34 and 27, and judged fine: not heavier than a field, and it does not shout beside the checked state (73ai). Nothing changed. | An empty box on Scenarios; any width but 1440. |
| 31 | **This Month's glance in dark:** the Goals part is hollow (cfca9cb; its edge 3.14:1 on the card, by the numbers). Seen in dark at 1440 (73ai) and at 393 (74ag). | Left in Buckets at 0; Free to Spend at 0 or less. |
| 32 | **The contrast test read the wrong block:** every "dark" check was reading the light values. Fixed in 0ecd7f1, with a check that dark differs from light and new checks for the controls' edge, the comparison colour, the off switch's thumb and Cash flow's nodes. | |
| 33 | **Review, Undo then a decision** (#84, closed; 46a5d4a). Review's writes queue and are sent in order, so a return and a filing of the same Transaction can no longer cross from one screen, in either direction; Undo is enabled whenever there is something to undo. Before it, a decision on the same Transaction could be lost, by the code and a unit test. | Nothing was looked at in a browser. Why Undo stayed disabled for five seconds in the failing run is not proven (the likeliest cause is the refetch round its pending flag waited on; the trace was not opened), nor whether a decision was lost in that run. `suggestions.spec.ts:59`, also flaky in ci227, is not in 84a's handoff. Its trade-offs are above. |

### #78, where these reviews touch it

Household snapshots have their own record in ADR-0035. What is still open there, from the handoffs of 78e to 78i, kept here so the three tickets can be read in one place:

- **The Rule toast** has never been looked at on any screen; whether it should have a Dismiss button, and whether a second toast's shorter showing after a pause matters, are for the Parent (item 34; #74, item 38).
- **The other Parent's Snapshots list updating live** is unit-tested at the point where the change is sent and not run end to end (78g, 78h).
- **No E2E** covers applying an existing Rule ("File what's still unassigned now") or the second Parent's live update (78h).
- **The Start fresh and Delete Household sheets** are not pictured (#74, item 31). Not said in either: a prepared download does not come back, and removing an Import by hand still deletes its file even when a snapshot refers to it.
- **A bulk Rule apply on a big Household** takes a whole snapshot inside the request: its time was not measured (78f).
- **The restore drill** in `docs/runbooks/snapshot-restore-drill.md` has not been run by anyone (78e).
- **For the Parent:** after Delete Household without "Also delete backups", statement and Receipt files the last snapshot refers to stay for its 30 days, where they used to go at once (78e; ADR-0035 records the trade-off).
- **#85** (item 35).
