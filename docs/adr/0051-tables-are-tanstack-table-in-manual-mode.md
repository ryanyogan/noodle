# A working table is `DataTable`: TanStack Table in manual mode, on divs

Status: accepted (2026-10-05, issues 107 and 99, phase 107b). The shell is built; no page uses it yet. Plan › Buckets (107c) and Transactions (99b) move to it next.

## Context

The Parent asked for two lists to become tables: Transactions ("perhaps we should use tanstack data table with a lot of interractivity here, ability to select multiples, sort easier, see values in rows, edit, expand") and Plan › Buckets ("the bucket management should become a tanstack table"). The design phase recommended our own column list instead of the library; the Parent chose the library.

What makes these lists unlike the library's examples:

- A list arrives from the server a page at a time, already sorted, with privacy applied in SQL (ADR-0003). Sorting the loaded rows in the browser would give a wrong order and could let a row's place say something about what is hidden.
- Transactions selects "everything the filters match, except these" (ADR-0045), which includes rows that have not loaded. A map of selected row ids cannot say that.
- Buckets are in the Parent's own order, moved by a drag that shifts rows on screen and reorders once at the drop (issue 106).
- A phone has no room for columns, the first page is server-rendered without knowing the width, and a guard test forbids a raw `<table>` in the app.

## Decision

- **One component, `DataTable` in `packages/ui`, for a list a Parent works in** (sorts, selects, opens). The read-only shadcn `Table` stays for small tables of figures.
- **TanStack Table v9 (`@tanstack/react-table`, pinned) is the model**: column definitions, the header, footer and row models, hidden columns, the sort state and which loaded rows are selected. Only three features are registered (row sorting, row selection, column visibility).
- **Manual mode.** `manualSorting` is on and no sorted, filtered or paginated row model is registered, so the table cannot reorder, cut or page the rows. They are drawn in the order given, under the page's own row ids.
- **The page owns the order and the selection.** The table is told the current `sort` and reports the next one (`onSortChange`); the page changes its address and the server sorts. For selection the page answers `isSelected(row)` and says what the header's checkbox shows, and is told what was asked (`onSelect` with the ids of a row or a shift-click range, `onSelectAll`). The library's `rowSelection` is derived from that for the loaded rows on every render and never written back. No page keeps a second selection in the table.
- **Divs with table roles, each row a grid.** `role="grid"` when rows take the focus (they open or can be selected), else `role="table"`. Never a `<table>`.
- **Width comes from the table's container, never the window.** Below `@2xl` (42rem, so every phone) each row is a block laid out from the same column list (`stacked: "title" | "value" | "secondary" | "trailing" | "hidden"`); above it, columns show from the tier their `priority` and `min` earn (`columnTiers`), so low-priority columns drop first. Nothing scrolls sideways. A column's track must not depend on its content (no `auto`), since rows are separate grids.
- **A row opens by callback.** A click on the row that is not on a control, or Enter, calls `onOpen`; the page navigates to the item's address and `ListWithPanel` shows it (ADR-0047). The open row is marked `aria-current`.

## Consequences

- A page writes one column list for phone and desktop and no column template of its own (the `layout-grids` guard stays as it is).
- Sorting by a new column is a server change first (a sort key, a keyset cursor), then one `sortable` on a column.
- What the library would do for free on loaded rows (its own sorting, filtering, grouping, paging) is deliberately unused. If a list is ever small and wholly loaded, that is a new decision, not a flag to flip.
- The header row, and so the sort buttons and the select-all checkbox, are not shown when rows are stacked: a page that needs them on a phone offers its own (a Sort menu, "Select" in its bar).
- The table's root is a `@container`, so a fixed `DetailPanel` must be its sibling, never inside it.
- The library adds to the bundle of each page that uses the table and nothing to the others; the figures are in phase 107b's handoff.
