# A picked item opens in a panel from the right, and the list keeps its width

Status: accepted for Plan › Commitments (2026-10-05, issue 107, phase 107a); the other lists move to it one at a time. Amends ADR-0033 (the list pane's widths go as pages move) and ADR-0024 (one more thing may scroll on its own).

## Context

ADR-0024 and ADR-0033 put a picked item beside its list: the list shrank to the list pane (360 / 400 / 460 px, or 22 rem on the Plan's pages) and the item took the rest. So a list that was 700 to 1100 px wide dropped to about 400 px on a click, its rows lost their columns, and the rail's totals were swapped out for the item. The Parent: "the double column master detail … is weird and hard to use … slide out from the right … the two column views are weird as the rows condense too far on the left when selected".

Every item already has its own address (a child route of its list, rendered through the list's `<Outlet />`), and below lg every item is already a page with Back. Only where the item sits on a desktop needed to change.

## Decision

- **From lg, a picked item opens in a panel fixed to the window's right edge, over the page.** The list and the rail are laid out as with nothing picked and never change shape. Below lg nothing changes: the item is a page with Back.
- **It is not modal.** No scrim, no focus trap, no scroll lock. The list under it stays clickable and a click on another row changes what the panel shows; the page behind still scrolls. A modal drawer would make looking at three items in turn nine steps instead of three, which is worse than what it replaces.
- **It is a labelled region** (`<section aria-label="Commitment details">`), not a `dialog` (which would promise containment that isn't there) and not `complementary` (it is the main content of its address).
- **The address is the item's own, as before**: the same child route, so deep links, reload, Back and Forward and the old redirects all work untouched. Opening or switching is a push; closing navigates to the list's address, so it works when the item's address was the first one opened.
- **It renders in place, not in a portal**, so a deep-linked item is in the server's HTML and one DOM serves phones and desktops. Nothing between `<body>` and the panel may create a containing block for fixed boxes (`transform`, `filter`, `contain`, `container-type`).
- **Focus and keys.** Opening an item moves focus to its title, unless focus is already in the panel (previous and next keep it). Esc, from the panel or the list, closes it, unless a field, a menu, a listbox, a sheet or a dialog has the key or something already handled it. A visible Close (a link to the list, named for what it closes: "Close Commitment") sits in the panel's top corner. When the panel goes, focus that was in it returns to the item's row. Clicking outside does not close: a stray click must not throw the item away.
- **Widths are stepped tokens** at ADR-0033's breakpoints, not `clamp()`:

  | Token | 1024 | 1280 | 1440 | 1920 | For |
  | --- | --- | --- | --- | --- | --- |
  | `--detail-panel-width` | 480 | 480 | 520 | 560 | a form's worth: a Transaction, a Rule |
  | `--detail-panel-width-wide` | 480 | 560 | 640 | 800 | a page's worth: a Commitment, a Bucket, a Goal, an Account |

  At 1024 the page beside the open Sidebar is 776 px, so a 480 px panel leaves about 300 px of the list showing: enough to read and click names. One rule at every desktop width; no second, modal behaviour below 1280.
- **Layers and look.** `z-30`: over the page's sticky bars (`z-10`), under sheets (`z-40`), so a sheet opened from the panel (Edit) opens over it. The page's background, a left border, the pop shadow, 24 px of padding. It slides in when an item opens (`animate-side-in`, which the reduced-motion rule switches off) and does not move again while going from item to item; closing is instant.
- **The panel may scroll on its own** (an exception to ADR-0024's one scroll per region, as sheets are): it is a fixed layer the height of the window.
- **Panel or Sheet.** A panel is something with its own address. A Sheet is a task with no address (add, edit, pick, confirm). A panel may open a Sheet; a Sheet never opens a panel; a link in a panel to another item changes what the panel shows.

In the code: `DetailPanel` and `ListWithPanel` in `packages/ui/src/components/detail-panel.tsx`, the rules that can be tested without a browser in `packages/ui/src/lib/detail-panel.ts`. In the app, `PlanMasterDetail` takes `panel={{ size, close }}` and the item's `DetailHeader` takes `inPanel`.

## Consequences

- While the panel is open it covers the rail and the right-hand part of the list (about 190 px of a 700 px list at 1440, 290 px of 1120 px at 1920, 90 px of 344 px at 1024). A row's name is always clear of it, and opening the row puts its figures and its Edit in the panel; Esc or Close uncovers the list. A control at a row's far right (the pencil) can't be clicked while it is covered, and takes keyboard focus out of sight: accepted for now, since the same action is in the panel, and to be looked at again when Buckets' table moves to the panel.
- The item's page is one column in the panel at every width: with 24 px of padding even the 800 px panel leaves 752 px, under `DetailColumns`' 48 rem. Before, a Commitment had two columns from about 1440. If two columns are wanted back at 1920 the wide token there has to be at least 816 px.
- The Ask Noodle button in the window's bottom right corner (`z-20`) is under the panel while one is open.
- Until the last page has moved, both layouts exist: `MasterDetail` (the item beside a narrowed list) and `ListWithPanel`. When the last one has moved, `MasterDetail`'s pane mode, `narrowList`, `--list-pane-width`, the scroll holding in `layout.tsx`, `DetailHeader`'s `listBeside` and `Sheet layout="side"` go, and this ADR's status and ADR-0033's list pane line are updated.
- `desktop-scroll.spec.ts` lets the panel scroll, as it does sheets.
