# Every page is one of three layouts, the page is the one thing that scrolls, and a picked item has its own address

Status: accepted (2026-10-02, #67)

## Context

On a desktop each page wrote its own columns: a dozen different `lg:grid-cols-[…]` templates, with rails from 280 to 460 px wide and gutters from 16 to 40 px, so column edges moved from page to page and didn't line up with the header and tabs above them. Several pages had a column that scrolled inside the scrolling page (Explore's outcome, the Plan's lists), which gave two scrollbars and trapped the wheel. A picked item (a Bucket, a Commitment, a Transaction, a Rule) opened in a sheet over its list with no address: it couldn't be linked to or reloaded, Back didn't close it, and the list lost its place. Goals and Accounts had item pages, but going to one left the list behind.

## Decision

- **Three layouts, in `packages/ui/src/components/layout.tsx`.** A page below the shared header (ADR-0023) is one of them, and doesn't write a column template of its own.
  - **PageLayout**: one column. `width="reading"` caps it for prose and forms; `columns={2}` is two equal columns (Household); `spacing="tight"` is for a dashboard's cards (Reports).
  - **SplitLayout**, holding a **SplitMain** and a **SplitRail**: a main column and a rail of one fixed width. The rail stays in view only while all of it fits the window; taller than that, it goes with the page. It never has a scrollbar of its own. On a phone it is one column, and `stack` says which comes first.
  - **MasterDetail**: a list pane of one fixed width beside the picked item. These two panes are full height under the header and each scrolls on its own, so the list keeps its place while the item changes.
- **ListBesideDetail** (`apps/web/src/components/master-detail.tsx`) is MasterDetail for a section whose items are child routes: it renders the item's route in the right pane, shows a skeleton there while the item loads, and wires the keys. With nothing picked the right pane holds the section's totals (`aside`) and a hint. Two options cover the pages that differ:
  - `asideFills`: the aside is the section's working area, not its totals (Scenarios' Compare). It takes the pane's full width, and on a phone it comes after the list rather than before it.
  - `emptyStacks` (on MasterDetail): what fills the right pane while nothing is picked is part of the page, not a placeholder, so it starts at the top of the pane and a phone shows it too.
- **Four sizes, as tokens in `packages/ui/src/styles/globals.css`**: `--layout-gap` (32 px, the one gutter between columns and between the blocks in a column), `--rail-width` (360 px), `--list-pane-width` (360 px) and `--reading-width` (48 rem). The shell caps the page's width. With these, the header, the tabs and the columns share the same left and right edges at every desktop width.
- **One scroll.** The page scrolls, and nothing inside it does, except MasterDetail's two panes (where the page itself then doesn't scroll), an open sheet, dialog or popover, and things that scroll sideways. Transactions is the one list that isn't in a pane: it is long and drawn only for the rows in view, measured against the window, so it stays in a SplitLayout with the page scrolling, and the open Transaction sits in the rail. That pane scrolls only when the editor is taller than the window.
- **A picked item has its own address, as a child route of its list**: `/plan/$month/buckets/$bucketId`, `/plan/$month/commitments/$commitmentId`, `/goals/$goalId`, `/accounts/$accountId`, `/transactions/$month/$transactionId`, `/review/rules/$ruleId`, `/explore/scenarios/$id`. The list's route stays mounted, so the list isn't loaded or drawn again. The search (filters, `?compare=`) is kept when picking and closing. Reloading or opening the address shows the list and the item together. An item that isn't in the loaded list (a Transaction further down, or left out by a filter) is asked for by its ID, under the same privacy rules as the list (ADR-0003).
- **Closing goes to the list's address, not Back.** Back, Esc and Cancel in a detail navigate to the list with the search kept, so they work when the item's address was the first page opened. The browser's own Back still does what it always does.
- **On a phone the same address is a page.** Below 1024 px a layout shows one level at a time: the list, or the item as an ordinary page with a Back link to the list. A Transaction is no exception (2026-10-08): tapped in its list on a phone it opens at its address as a page, which slides in from the right as the desktop's panel does (ADR-0047) and starts at its top; Back, Esc, Save and Delete return to the list where it was scrolled to, with focus on the row. Until then a tap opened a bottom sheet and only the address opened directly was a page: the sheet had no Owed back ("Someone's paying part of this back" is on the page only) and too little room for a Transaction. The page doesn't slide when its address is opened directly or reached with previous and next, and doesn't slide out on Back: the list is not drawn under it, so there would be nothing to uncover.
- **Keys in a list beside its item**: ↑ and ↓ move between rows, Home and End go to the ends, Enter opens the row, and Esc in the detail puts focus back on its row. The detail's header has previous and next.

## Guards

- `apps/web/src/layout-grids.test.ts` fails when a file under `apps/web/src` gains an `lg:grid-cols-[…]` template. Its short list of exceptions is for grids inside one card (Reports), the shell, and two pages whose columns aren't a main and a rail (the Glossary, the Check-in).
- `apps/web/e2e/desktop-scroll.spec.ts` walks the pages on a desktop and fails on a scrolling element inside a scrolling page or ancestor.
- `apps/web/e2e/master-detail.spec.ts` checks that the list is the same node and keeps its scroll while the item changes, that old addresses still arrive, the keys, and the phone pages.

## Consequences

- A new page picks a layout; a new width or gutter is a change to a token, for every page at once.
- Rules and Scenarios lost their wide tables: a 360 px list pane has room for a row of two or three lines, with the one number that matters in a column on the right. The rest is in the item.
- The Explore and "Can we afford it?" pages put their wide column in the SplitRail, because the rule "in view only while it fits" is what that column needs. The slot names read the wrong way round there; the code says so.
- Review's pencil on a desktop goes to the Transaction's address. The editor there starts from the Transaction as filed, not from Review's guess, and saving leaves the Parent on Transactions.
- Not done: ↑ and ↓ on Transactions (its rows are drawn only while in view, so it needs its own handling), and the phone accessibility walk doesn't yet visit the item pages.
