# Components in packages/ui

The design system's parts (ADR-0008). Most are shadcn/ui components, style `radix-nova`, on Radix through the `radix-ui` package, restyled with the tokens in `src/styles/globals.css`.

## How shadcn components are added here

The shadcn CLI (`bunx shadcn add <name> -c packages/ui`) doesn't work cleanly with this package. A dry run (`--dry-run`) for Select, ToggleGroup and DropdownMenu wanted to add an npm package called `cn`, because the `utils` alias is `#lib/utils`, a subpath import rather than an `@/` path. An earlier run also wanted to overwrite Button. So components are added by hand:

1. Read the component's page on ui.shadcn.com, and fetch its source from the registry: `https://ui.shadcn.com/r/styles/radix-nova/<name>.json`. That's the same file the CLI writes.
2. Change `import { cn } from "cn"` to `#lib/utils`, swap `IconPlaceholder` for the lucide icon it names, and drop the registry's `cn-*` marker classes.
3. Restyle onto the tokens: `bg-surface-2`/`surface-3`, `border-border`/`border-strong`, `text-muted-foreground`, `shadow-card`/`shadow-pop`, the app's radii, and focus as `outline-2 outline-ring`. Don't add colours or change a token.
4. Animate with the app's keyframes (`animate-enter`, `animate-dialog-in`, …). The registry's `data-open:animate-in` classes come from `tw-animate-css`, which isn't installed, and Radix sets `data-state`, not `data-open`.
5. Put a comment at the top of the file: the docs link, and anything changed from the registry and why.

Never let the CLI overwrite a file here.

## What's here

| Component | From | Notes |
| --- | --- | --- |
| Alert | shadcn, by hand (#56) | A boxed notice in the page: optional icon, `AlertTitle`, `AlertDescription`, `AlertAction`. `variant="destructive"` is the over ink. Its role is `status`; pass `role="alert"` for an error that has just happened. |
| AlertDialog | shadcn, by hand (#47) | Focus starts on Cancel and returns to the opener (`lib/focus-return.ts`). |
| Avatar | shadcn, by hand (#55) | Root, image and fallback only. The fallback (an initial) shows until the picture loads. |
| Breadcrumb | shadcn, by hand (#47) | A drilled-in Report. |
| Button, Input, Label, Badge, Skeleton | shadcn, restyled | Button's sizes are under "Control sizes" below. |
| Card | shadcn, restyled; header parts by hand (#56) | `Card`, `CardContent`, `CardFooter`, and `CardHeader` with `CardTitle`, `CardDescription` and `CardAction` (top right of the header). Padding is `--card-pad`. |
| Checkbox, Switch | shadcn, by hand (#47) | Checked takes the main button's fill (`--primary`, the accent). Each has a 24px target. Name them with `<label htmlFor>`. |
| Collapsible | shadcn, by hand (#47) | The trigger waits for hydration. `keepMounted` keeps closed content in the page, as `<details>` does. |
| Dialog | shadcn, by hand (#56) | A centred dialog at every width, with a Close button. See "Which dialog" below. |
| DropdownMenu | shadcn, by hand (#47) | Items, labels and separators only. An item that opens a sheet gives focus back to the menu's button (`setNextOpener`). |
| Kbd | shadcn, by hand (#47) | Give a symbol key words for a screen reader. |
| Popover | shadcn, by hand (#47) | Term help. |
| BudgetBar, BudgetBarKey | Noodle's own (#64) | **The one bar rule: a bar fills as money is used up or progress is made**, with the amount and its meaning written beside it. A Bucket fills with what's spent out of Available, in its colour; `marker` is the Today line (where even spending would be by now), in the foreground ink; `state` is the Bucket's status from the domain, never recomputed, so bar and badge agree: `"ahead"` turns the stretch past Today marigold and striped, `"over"` fills it all in the over ink, striped (stripes, so colour isn't the only signal). A Goal fills toward its target (Bucket colour, else brand). 8px, fully rounded, `role="meter"` named by `label` with `valueText` in words. `BudgetBarKey` is the small legend (Spent, Left, Today, Ahead of pace) where bars first appear, in place of a paragraph. It is the only bar: Meter and Progress were folded into it (#64), and `apps/web/src/shared-controls.test.ts` fails on a hand-drawn bar or a Meter/Progress import. Without `label` it is decorative (aria-hidden), only where the words beside it say the value and it sits in a link. `start` floats the fill (the Plan waterfall); `fill` sets a CSS colour when it isn't a Bucket or the brand (neutral summary inks, a Reports series). Bucket colours are all at least 3:1 on the track, in light and dark. Reports' recharts bars are charts, not this bar. |
| RadioGroup | shadcn, by hand (#47) | Plus `RadioGroupCard` (a whole row as the target) and `RadioGroupPrimitiveItem` (unstyled, for swatches). |
| Select | shadcn, by hand (#47) | Trigger sizes `default`, `sm`, `pill`. `OptionSelect` is the form field: choices as data, groups, a hidden input under `name`. |
| Command, Combobox | shadcn, by hand (#47) | cmdk 1.1.1. Combobox = Popover + Command with OptionSelect's props, for long or grouped lists. |
| Calendar, DatePicker | shadcn, by hand (#47) | react-day-picker 10.0.2 (exact). DatePicker = Popover + Calendar in place of `<input type="date">`: a field-sized trigger reading "Oct 1, 2026", month and year dropdowns, `min`/`max`, Clear unless `required`, values stay yyyy-mm-dd (hidden input when `name`). Day buttons carry `data-day` (yyyy-mm-dd); specs use `pickDate()`. |
| Separator | shadcn, by hand (#55) | Decorative by default. |
| Sidebar | shadcn, by hand (#55) | The desktop sidebar: groups, menu buttons, a badge, a trigger. Collapses to an icon rail only (`rail:` variant, `--sidebar-width-icon`), remembered per device in localStorage and set on `<html>` before first paint by `sidebarStateScript`; Ctrl/⌘+B toggles. No mobile Sheet variant: phones keep the tab bar, whose last item, More, opens a Sheet with every destination that isn't a tab (below, "The phone header and More"). A menu button's `tooltip` shows only in the rail. |
| Sheet | Noodle's own, on Radix Dialog | A bottom sheet on phones and a centred dialog on desktop: forms and lists to pick from. `SheetFooter stick` keeps the footer's buttons in view on a desktop too (phones always stick), for a long list like Add Buckets. |
| Slider | shadcn, by hand (#47) | One thumb, named, with its value in words. |
| Spinner | shadcn, by hand (#47) | Decorative unless given a `label`. |
| RowButton | Noodle's own (#56) | A button that is a whole row or tile. See "Rows and tiles that are buttons" below. |
| Stepper | Noodle's own (#53) | "Step 3 of 7 · about 2 minutes left", decorative segments, and an optional `status` line (a polite live region) for background work. The get-started wizard's progress header. |
| StepList, StepListItem | Noodle's own (#56) | In `stepper.tsx`. A flow whose steps have names: a `<nav>` (name it with `aria-label`) of rows, each `state="done"` (a tick), `"current"` (raised, `aria-current="step"`) or `"todo"`. The weekly Check-in. Use Stepper when the steps only need counting. |
| Table | shadcn, by hand (#47) | `numeric` right-aligns a cell in tabular figures. Give each table a caption. `dense` is a few lines of figures in a small space: 12px, no rules, the caption on top (a Scenario's month against the Plan). |
| Tabs | shadcn, by hand (#47) | Plus `LinkTabs`/`LinkTab`: the same look for pages that each have a URL, as a `<nav>` of links rather than a tablist. |
| Textarea | shadcn, by hand (#56) | Input's look, three lines tall, growing with what's typed. |
| Toast | Noodle's own look on Sonner (#47) | `toast(message, options)`. Up to three show at once, each a polite status. How long one stays goes by kind: 2.4 s plain, 6 s with an `action`, 10 s for an error, until dismissed when `sticky`. `duration` (milliseconds) sets another time for a long message that shouldn't be sticky; `sticky` wins over it. **Undo is `undo: () => …`, never an `action` labelled Undo** (#103): the toast shows the Undo button, stays `UNDO_TOAST_MS` (10 s) and goes by itself, at once when Undo is pressed; `onGone` beside it is called once when the toast has left without Undo being pressed (for a change that is only sent then, like deleting a Transaction); it takes no `duration` or `sticky` (a type error), and a guard test (`apps/web/src/undo-toasts.test.ts`) fails a hand-written Undo action. Anything that waits for an Undo to go uses `UNDO_TOAST_MS` too. The countdown waits while a toast is hovered or held, while the tab is hidden, and after Alt+T (which moves the keyboard to the toasts) until Escape. A toast with the same `id` replaces the one showing and its time starts again. Sonner is the toast shadcn recommends; the registry's wrapper needs `next-themes`, so it isn't used. |
| Toggle, ToggleGroup | shadcn, by hand (#47) | Variants `segmented` (a track, the chosen one raised) and `chip` (round, filled when on: filters that can each be on). Sizes `sm`, `default`, `lg`, `icon-sm` (square, an icon only) and `wrap` (words that may run to two lines). Don't restyle an item with `className`: pick a variant and a size. A single-choice group is a radio group: one option is always chosen, and the arrow keys choose. |
| Tooltip | shadcn, by hand (#47) | `WithTooltip` is the common case. Never the only place something is said: touch can't hover. |
| Chart | shadcn | On Recharts, for Reports and Explore. |
| PageLayout, SplitLayout (SplitMain, SplitRail), ListWithPanel (DetailPanel) | Noodle's own (#67, issue 107) | The page grid, below. Every page under the shared header is one of the three. |
| DetailPanel, ListWithPanel | Noodle's own (issue 107) | `components/detail-panel.tsx`. A picked item in a panel on the window's right edge from lg, over the page; a page with Back below lg. See "The page grid" and "Which dialog" below. ADR-0047. |
| DataTable | Noodle's own, on TanStack Table v9 (issues 107 and 99) | `components/data-table.tsx`, rules in `lib/data-table.ts`. A list a Parent works in: sortable headers, checkboxes, a row that opens, a totals row, and the same columns stacked on a phone. See "Working tables" below. ADR-0051. |
| Stat, StatGrid | Noodle's own (#56) | A figure under its label, and the `<dl>` a few of them sit in. See "Figures" below. |
| Money | Noodle's own (#56) | An amount from cents, in tabular figures on one line: `whole` rounds to dollars, `signed` adds "+" to a gain, `flagNegative` puts a negative in the over ink. `formatMoney` (`lib/money.ts`) is the same text as a string. |
| Field, FormError | Noodle's own | A labelled control with its hint or error. `FormError` is the error under a form: the destructive Alert with `role="alert"`, laid out as a row so a "Try again" Button can sit beside the words. |
| List, PageHeader, Section, SectionGroup, Tile, EmptyState, Logo | Noodle's own | ListRow `below` sits under the title and trailing columns; `belowFull` widens it to the whole row, under the leading tile, for a form opened in the row. SectionGroup puts Sections under one short heading (Household's People, Reminders, Setup) and drops their headings to h3. |

## Working tables

Two tables, two jobs. `Table` is a few figures to read (a `<table>` with a caption). `DataTable` is a list a Parent works in: Transactions, the Plan's Buckets. It is TanStack Table v9 in manual mode (ADR-0051): the library holds the columns, the header and row models, hidden columns, the order and which loaded rows are selected, and never sorts, filters or pages the rows itself. **The page owns the order and the selection**; the rows are drawn in the order given.

- **One column list for every width.** Each column has an `id`, a `header`, a `cell(row)`, a `min` width in rem, and optionally `width` (its grid track: `"6rem"`, `"minmax(0,2fr)"`; never `auto`, since each row is its own grid), `align: "end"` for money (right-aligned, tabular figures), `priority` (1 always shows; a 3 drops before a 2 as the table's container narrows), `stacked` (where it goes when rows are blocks: `title`, `value` on the right of the title, `secondary` for a line under them, `trailing` for an edit button at the end, `hidden`), `wide: false` for a line that only exists stacked, `sortable`, `footer` (its cell in the totals row), `hidden`. The table calls `cell` as a plain function while it draws the row, so `cell` must not use hooks itself: put them in a component it returns.
- **Width is the container's, not the window's.** Below `@2xl` (42rem: every phone) rows are stacked and there is no header row. Above it columns come in at `@2xl`, `@3xl`, `@4xl`, `@5xl` and `@6xl` by priority. Nothing scrolls sideways. Don't write a column template in the page.
- **Sorting.** `sort={{ id, desc }}` and `onSortChange`: the header's button asks, the page (its address, its server) sorts. One column at a time, no unsorted step. The header says which way with `aria-sort`.
- **Selecting.** `selection={{ isSelected, canSelect, rowLabel, all, onSelect, onSelectAll }}`. The table keeps none: `onSelect` gives the ids to set and whether on or off (one row, or a shift-click or Shift+Space range over the rows that can be selected), and `all` is what the header's checkbox shows (`headerCheck(selected, total)` from `lib/data-table`, where the page's total may count rows not loaded). With a row in focus, Shift+Up / Shift+Down take the selection along (`extendIds`) and Ctrl/Cmd+A asks for everything (`onSelectAll(true)`). `stacked: false` leaves the checkbox column out where rows are stacked, for a page with its own way to select on a phone (Transactions: a Select button and a tick on the row's tile).
- **Opening.** `onOpen(row)` on a click that isn't on a control, or Enter; `isOpen(row)` marks the row `aria-current`. In a `ListWithPanel` the table is the `list` and the panel its sibling (the table's root is a `@container`, which must not hold the fixed panel). Keep the item's link in the title cell with `masterDetailItem`, so focus returns to it when the panel closes.
- **Keys**, with a row in focus: ↑ ↓ Home End move, Space selects, Enter opens. One row is in the tab order; the controls inside a row follow it.
- **Also:** `leading` (a slot before the first column, for a drag handle; the table never reorders rows and `rowProps` passes `data-*` and refs to the row for the drag to measure), `groupBefore` (a full-width row before a row: a day's label), `empty`, `loading`, `more` (a last full-width row for "Loading more"), `rowCount`, `stickyHeader` (set `--data-table-top` to stop it under something), `surface="card"` when it sits on a card.
- **Two tables in one column.** `indent={{ width, min }}` on a table with no `leading` slot, sitting under one that has it (the Plan's Personal Allowances under its Buckets, ADR-0053): an empty track of that slot's size before the first column, from `@2xl` only, so the two tables' columns line up and drop at the same widths. A stacked row is not indented. Pass it only while the other table really has its slot.
- `role` is `grid` when rows open or select, else `table`. Both are divs; a raw `<table>` in the app fails `shared-controls.test.ts`.

```tsx
const columns: DataTableColumn<Row>[] = [
	{ id: "date", header: "Date", min: 4.5, width: "4.5rem", priority: 2, stacked: "hidden",
		sortable: { descFirst: true, said: { asc: "oldest first", desc: "newest first" } }, cell: (t) => shortDay(t.date) },
	{ id: "name", header: "Name", min: 12, width: "minmax(0,2fr)", stacked: "title", sortable: true, cell: (t) => <NameCell row={t} /> },
	{ id: "amount", header: "Amount", min: 6, width: "6rem", align: "end", stacked: "value",
		sortable: { descFirst: true }, cell: (t) => <Money cents={t.amountCents} /> },
];

<DataTable
	label={`Transactions in ${monthName(month)}`}
	columns={columns}
	data={rows} // as the server sent them
	getRowId={(t) => t.id}
	sort={sortOf(search.sort)} // the address is the state
	onSortChange={(next) => navigate({ search: (s) => ({ ...s, sort: sortParam(next) }) })}
	selection={{
		isSelected: (t) => isPicked(picking, t.id),
		rowLabel: (t) => `Select ${t.name}`,
		all: headerCheck(pickedCount(picking, matching) ?? 0, matching ?? 0),
		onSelect: ({ ids, on }) => setPicking((p) => setPicked(p, ids, on)),
		onSelectAll: (on) => setPicking(on ? pickAll(false) : nothingPicked),
	}}
	onOpen={(t) => navigate({ to: "/transactions/$month/$transactionId", params: { month, transactionId: t.id } })}
	isOpen={(t) => t.id === openId}
/>
```

## Palette (#75)

The colours are **Indigo**, the Parent's choice on 2026-10-04 after Soft stone (#83, ADR-0038), modelled on Linear's light and dark: in light, a near-white page (`--background #f7f7f8`), white cards (`--card #ffffff`), cool neutral greys, hairline borders (`--border #e7e7ea`) and near-black ink (`--foreground #16171a`); in dark, a near-black ground with a slight cool cast that steps up (`#0c0d10` page, `#141519` card, `#1b1c21`/`#24262c` surfaces) with off-white text (`#f0f1f3`). There is one accent, indigo (`--brand`: `#4f5ad4` light, `#8e96ff` dark), for the main button, links, the focus ring, the selected-row tint and the active phone tab; marigold Pace and red Over stay. **The main button is the accent with white text**: `--primary` is `var(--brand)` in light and a darker fill (`#5a64d6`) in dark so the white text stays 4.5:1, and `--primary-hover` is a step darker. `--primary` is a fill only (button, checked box, switch, radio dot, selected day); for accent-coloured words use `text-brand`, never `text-primary`. The page ground is flat (one faint accent wash, no second glow). Field borders use `--input` (`#86888f` light, `#6c6f79` dark, at least 3:1 on every surface a field sits on); Bucket colours are the validated set, unchanged. Every value, and its measured contrast, is in `docs/reviews/theme.md` (section 8). The browser bar (`theme-color` in `routes/__root.tsx`, and the manifest) matches the page colour of each mode. Components never name a colour: they use the token utilities (`bg-card`, `text-muted-foreground`, `bg-bucket-3`, …), so a palette change is a value change in `globals.css` only.

- **Field borders.** Text boxes, pickers and text areas (`Input`, `Select`, `Textarea`) draw their border with `border-input` (`--input`: `#86888f` light, `#6c6f79` dark), which is at least 3:1 against the card, `--surface-2` and the page, so a Parent can see where to type. `--border` stays the quiet line between rows and around cards; don't use it for a field. A picker's hover border is `border-muted-foreground`.
- **The colour lint.** `apps/web/src/hard-coded-colours.test.ts` fails on a hex, `rgb()`, `hsl()`, `oklch()` (or another CSS colour function) anywhere in `apps/web/src` or `packages/ui/src` outside `globals.css`. Use a token instead (`bg-card`, `var(--pace)`, …); the few files that can't read CSS variables (the `theme-color` metas, email HTML, the logo's dot) are on its allow-list, each with its reason, and an entry that no longer matches fails too. ADR-0034 has the rules every colour follows.

## The page grid

`components/layout.tsx`. A page below the shared header (`SectionLayout` or `PageHeader`) is one of three layouts, so rail widths, gutters and column tops are the same on every page. Don't write a two-column `lg:grid-cols-[…]` template in a page: `apps/web/src/layout-grids.test.ts` fails on a new one (its list of exceptions is for grids inside one card). ADR-0024 has the reasons.

| Token | Value | What it is |
| --- | --- | --- |
| `--gutter` | 16px, 40px from lg | The page's side padding (the shell). |
| `--layout-gap` | 32px | The one gutter: between columns, and between the blocks stacked in a column. |
| `--rail-width` | 320px below 1280, 360px from 1280 | SplitLayout's rail; narrower below 1280 so the main column stays the wider one. |
| `--list-pane-width` | 360px | The list's column in a `ListWithPanel` whose aside fills the rest (`asideFills`: Scenarios beside Compare). |
| `--detail-panel-min`, `--detail-panel-max`, `--detail-panel-max-wide`, `--detail-panel-clear` | 400px, 640px, 800px, 16px | DetailPanel beside the list (from xl): its width is the rail + the gap + the gutter + any margin outside the page's cap, less the 16px left clear beside the list (utilities `w-detail-panel`, `w-detail-panel-wide`), between these limits. 416px at 1280, 436px at 1440, 496px at 1920. |
| `--detail-panel-drawer` | 480px | DetailPanel as a drawer (lg to xl), where the rail is too narrow for it to sit beside the list. |
| `--elevation-side` (`shadow-side`) | a shadow thrown left | The edge of a layer on the window's right (DetailPanel). |
| `--reading-width` | 48rem | `PageLayout width="reading"`: the widest a page of prose or forms gets. |
| (shell) | 1200px, 1440px when the route has `staticData: { wide: true }` | The max content width, gutters included. |

- **PageLayout**: one column. `width="reading"` caps it; `columns={2}` is two equal columns from lg; a settings page (Household) is one `width="reading"` column of SectionGroups, with no competing columns; `spacing="tight"` sets a dashboard's cards closer (Reports).
- **SplitLayout** with `SplitMain` and `SplitRail`: main plus the rail from lg, both starting on the same top edge. The rail is sticky only while all of it fits the window (it measures itself and sets `data-fits`); taller than that, it scrolls with the page. It never has its own scrollbar, so don't give it a max height or `overflow-y-auto`. Below lg it is one column: `stack="main"` (main first, the default), `"rail"` (rail first) or `"children"` (both columns become `display: contents` and each block's `order-N` places it; pair each with `lg:order-none`).
- **ListBesideDetail** (in the app, `apps/web/src/components/master-detail.tsx`, with `DetailHeader`, `DetailPager`, `DetailPending`, `masterDetailItem` and `panelKeys`): `ListWithPanel` for a section whose items are child routes (Goals, Accounts, Rules, Scenarios; the Plan's Buckets and Commitments use `PlanMasterDetail`). `panel={{ size, close, itemKey }}` is required: the item's route renders in the panel, and the list and `aside` (the section's totals) stay as they are. `asideFills` is for an aside that is the section's working area (Scenarios' Compare): it takes the width left of the list's `--list-pane-width` column, comes after the list on a phone, and `hint` stands in for it while there is none. A row's link to its item spreads `masterDetailItem`, which sets `resetScroll={false}`, so picking from far down the list keeps the Parent's place. Neither column scrolls on its own: each measures itself and sets `data-fits` (sticky while it fits the window), like SplitRail; don't give one a max height or `overflow-y-auto`. The older layout, `MasterDetail` (the item beside a narrowed list, with `narrowList`, `listOnly`, `emptyStacks` and `DetailHeader`'s `listBeside`), was removed when the last page moved to the panel (issue 107).
- **ListWithPanel** and **DetailPanel** (`components/detail-panel.tsx`, ADR-0047): the layout for every list whose items have addresses (it replaced MasterDetail, issue 107). `list`, `aside` and `detail`. From lg the list and the aside (the rail) are laid out as if nothing were picked, and never change shape; the picked item (`detail`, the child route's `<Outlet />`) is a `DetailPanel`: a labelled `<section>` fixed to the window's right edge at `z-30` (over page stickies, under sheets), on `bg-popover` with the strong border and `shadow-side`, scrolling on its own while the page scrolls behind it. **From xl it is beside the list**: as wide as what is to the right of the list column less 16px of the gap (`w-detail-panel`, or `-wide` for the higher maximum), so it covers the rail and none of the list's columns. It is not a dialog there: no scrim, no focus trap, the list stays clickable and a click on another row changes what the panel shows. **From lg to xl it is a drawer**: the rail is too narrow, so rather than cut the list's columns it is `role="dialog"` `aria-modal`, 480px, with a scrim (`[data-panel-scrim]`, `z-35`), everything else `inert`, closed by Esc, Close or a click on the scrim. `panelLayout` / `panelAt` / `panelMode` in `lib/detail-panel.ts` are the same rule as numbers (window × Sidebar × page cap × rail → mode and width); a test holds them to the tokens. It stays in place in the DOM (no portal), so a deep link is in the server's HTML; nothing between `<body>` and it may have a `transform`, `filter`, `contain` or `container-type`. Opening an item (`itemKey` changes) moves focus to `[data-slot=detail-title]` unless focus is already in the panel (previous and next keep it); the title draws the ring only when a key opened the item (`data-keyboard-open`), never after a click or a page load. Esc anywhere on the page calls `onClose` unless a field, a menu, a listbox, a dialog or anything that handled the key has it; `close` is the visible Close control (a link to the list, named "Close Commitment"). When the panel goes, focus returns to the item's row (`[data-md-item]`). Below lg the same section is ordinary page content and the list and aside are hidden: a page with Back. In the app: `PlanMasterDetail panel={{ size, close }}`, `DetailHeader inPanel` and `panelKeys` (`apps/web/src/components/master-detail.tsx`). Beside the list the panel covers the rail and the part of the page's header above it: a control of the page whose middle is under the panel leaves the tab order while it is open (`data-panel-covered`, measured again as elements come and go), so focus is never hidden; a list with no rail has no room beside it and needs its own decision; anything fixed that is drawn over the panel (Ask Noodle, `z-31`) says so with `data-over-panel` and keeps its place, and the panel's `lg:pb-16` keeps the end of an item clear of that button.
  - `besideFrom="late"` (the Plan's first page, ADR-0053): for a list that is a table and needs the page's width. The rail is under the list up to 1440 (`min-[90rem]`) and beside it from there, and since there is then nothing but the list for a panel to cover, the item stays a drawer up to 1440 as well (`panelMode(width, PANEL_BESIDE_FROM_LATE)`). The default, `xl`, is unchanged.
- **A picked item has its own address**, a child route of its list, and the search is kept. Back, Esc and Cancel in a detail go to the list's address rather than Back through history, so they work when the item's address was opened first. Below lg the same address is a page with a Back link.
- **Transactions** is a SplitLayout, not a ListWithPanel (until its own move, phase 99e): its list is drawn only for the rows in view, against the window, so the page scrolls and the open Transaction sits in the rail.

One scroll per region: `apps/web/e2e/desktop-scroll.spec.ts` fails a page with a scrolling element inside a scrolling page or ancestor, other than open sheets, dialogs and popovers, a `DetailPanel`, and things that scroll sideways.

## Desktop rules (#73)

- **One gutter.** `--layout-gap` (32 px) is the space between columns and between a column's blocks, on every layout. There is no tighter dashboard variant: Reports, Explore's rail and Can we afford it? use it too. Don't pass `gap-*` to `SplitMain`, `SplitRail` or `PageLayout`.
- **One card.** `Card` alone draws a surface: radius `--radius-card` (16 px), padding `--card-pad` (16 px on phones and tablets, matching the 16 px gutter; 20 px from lg; #74c), set only through the token (`p-(--card-pad)`), never a literal `p-4`/`p-5`, a 1 px border and `shadow-card`. A card of rows has padding 0 and pads its rows with `--card-pad`. There is no dense card padding; a tighter group inside a card is rows, not a card. Controls (buttons, inputs, tab tracks' outer shape) take `--radius-control` (12 px, `rounded-xl`).
- **Headings outside cards.** A section's heading is a `SectionHeader` above its card, never the card's first line. Each column of a `SplitLayout` starts with the same kind of block, a heading row in both or a card in both, so their tops line up. `e2e/alignment.ts` (`misaligned`) checks the first block of each column shares a top within 1 px and that cards keep their column's left edge; `desktop-scroll.spec.ts` runs it on This Month, Plan › Overview, Explore and Transactions at 1440. (This Month's rail starts with the Free to Spend card beside the Buckets heading; moving its heading out was 73c, and is done.)
- **Widths grow with the window (73L, ADR-0033).** The shell's cap is `--shell-max`: 1200 px below 1440, 1440 px from 1440, 1680 px from 1920; a `wide` route takes `--shell-max-wide` (1440, 1800 from 1920). The rail is 320 / 360 (≥1280) / 380 (≥1440) / 440 (≥1920) px and the list pane 360 / 400 (≥1440) / 460 (≥1920) px. Never write a width of your own; change a token.
- **Sections side by side.** Related sections go in a `SectionGrid` (one column, two from 1280, three from 1680 with `columns={3}`), each cell starting with its `SectionHeader`, so headings in a row line up. A picked item's page puts its blocks in `DetailColumns`, which goes to two columns when the detail pane (a `@container/detail`) is at least 48 rem wide; a block that needs the width takes `col-span-full`.
- **One "?" per heading.** A section's help is its heading's `help`. A legend or a row's explanation is not another "?" floating beside it: it goes into that help, a Term link, or under the card (This Month's bars' key).
- **Tab strips.** `TabsList` and `LinkTabs` share one behaviour: when they don't fit they scroll sideways with no scrollbar, fade the edge that has more, snap to tabs, and scroll the current tab into view without scrolling the page. Don't add `overflow-x-auto` to a tab strip. On a phone the strip is one row whatever the number of tabs: a 40px track of 36px tabs, each with a 44px tap area (issue 115); a section's tabs (`SectionLayout`) have 16px over them and 12px under.
- **Scrollbars.** Only the Sidebar scrolls on its own (the page scrolls otherwise). Its bar is thin, shows only on hover or focus, and takes `--border-strong` (so it follows light and dark).

## The phone header and More (#74)

Below lg every page starts the same way. `PageHeader` (and `SectionLayout`, which wraps it) draws it; a page never builds its own, and `apps/web/e2e/phone-header.spec.ts` walks every page at 393 to check it.

- **Row 1: eyebrow and title.** The eyebrow is the small line over the h1 and says the section (the Sidebar group, or the area: "Planning" over Goals, "Transactions" over Review, "This Month" over October). Every page has one. The row is 52px tall (`min-h-13`), starts on the 16px gutter, 16px under the top of the page (plus `--safe-top`, the notch, in the installed app; the shell's `<main>` adds it), and has 16px under it.
- **At most one action on the right** of row 1 (Add Account, Add Goal, Export CSV, Review with its count). A page with a month also has the previous and next arrows there. No links to other pages: those are in More.
- **Row 2 (optional): the page's tabs**, always under the title, never above it and never instead of it: Review | Rules, the Plan's, Reports', Explore's and Insights' tabs (`SectionLayout`'s `tabs`). A page with nothing to switch has no second row. (The Month | Plan switch is gone: Month is a tab in the tab bar and the Plan is in More.)
- **An item's page** (a Goal, an Account, a Bucket, a Commitment, a Scenario, a Transaction) starts with `DetailHeader` under its section's header, on the same rule: one row at least 52px tall on the 16px gutter, with Back (its arrow on the gutter), the eyebrow and title (an h2), and previous/next; at most one action, which drops under the row when the title needs the width (320px); anything the item has to switch comes under it. A second or rare action goes in that one action's menu or after the item (a Scenario's Rename and Delete).
- **Nothing above the title.** No hamburger, no "⋯" menu of pages, no back arrow to another section.
- **More.** The tab bar is Month, Transactions, Quick Add, Goals, More. More opens a bottom Sheet (`app-shell.tsx`, `MoreTab`) listing every `nav.ts` item without a `tab`, in the Sidebar's groups, plus Review with its count, and the signed-in Parent with Manage account and Sign out. The current page is marked (`aria-current="page"`), and More itself is marked while the page is one of its items. The sheet is open while the address ends in `#more`, so Back closes it; picking a page replaces that entry; dragging the grabber or header down closes it; its bottom padding includes `--safe-bottom`. Add a destination to `nav.ts` and it appears in the Sidebar and in More; give it a `tab` only if it replaces one of the three.

## Control sizes

One height scale, so controls that sit in a row line up without a height class. Don't pass `h-*` or `size-*` in `className` to a Button, Input or SelectTrigger: pick a size. `apps/web/src/shared-controls.test.ts` fails on an `h-*` class on one of them, and on a raw `<button>`, `<input>`, `<select>`, `<textarea>` or `<table>` outside its short list of exceptions.

| Height from lg | What |
| --- | --- |
| 36px (`h-9`) | Button `default`, Input, SelectTrigger `default` (so OptionSelect, Combobox and DatePicker too), Button `icon-lg` (square, beside an Input). |
| 32px (`h-8`) | Button `icon`, SelectTrigger `sm` and `pill`, Toggle and Tabs. |
| 30px and 28px | Button `sm` (30), Button `icon-sm` and `chip` (28). |
| 44px (`h-11`) | Button `lg`. |

- **Button `wrap`**: `sm` whose words may run to a second line, for a label with a long name in it ("End … in the Plan…" on Insights).
- **Button `chip`** with `variant="secondary"`: a filter that is on, with an × to take it off (Transactions, Reports).
- **Button `inline`** with `variant="link"`: a few underlined words inside a sentence that do something ("Try again", "Use the estimate"). It takes the sentence's text size; for the sentence's colour too, add `text-current hover:text-current`.
- **Button `help`** with `variant="ghost"`: TermHelp's "?", 24px and round, with its 44px hit area on phones. That hit area, Switch's and Checkbox's are one pattern: an `::after` box at `inset: calc(50% - 22px)` (44×44, centred whatever the control's border) on a control with `z-1` below lg, so a later positioned element can't cover its lower or right part; `phone-a11y.spec.ts` taps around each one.
- Below lg every size is 44px, as "Tap targets" says, apart from `chip`, `inline` and `help`.

## Rows and tiles that are buttons

Button is a word or an icon at a control height. When the thing to press is a whole row or a tile, with its own layout inside, it is a `RowButton`, never a raw `<button>`. It is as tall as its content; grid columns and negative margins come from `className`. `asChild` puts the look on a link.

| Variant | What | Where |
| --- | --- | --- |
| `row` (default) | A row on a card that opens something. | A Report's line that drills in; a Bucket's row in the phone heatmap. |
| `list` | A row of a List, edge to edge. | A Transaction. |
| `bordered` | A row with its own border, on its own. | "3 lumpy months ahead" on Commitments. |
| `tile` | A bordered tile in a grid of choices. `bucket` (a Bucket colour) tints its hover with that colour. | A Bucket in Quick Add (tinted), a source in Cover. |
| `soft` | A tile without a border, on the soft ground. | Reports' "By Bucket" small charts. |
| `value` | The value at the end of a row, which opens its editor. | A Scenario's lines. |
| `key` | A key of the amount keypad. | Quick Add. |

- `aria-disabled` dims it and stops the hover, but it can still be pressed, so it can say what is missing. `disabled` takes it out altogether.
- Still raw, on purpose: the cells of Reports' heatmap table and the days of its spending calendar (`report-charts.tsx`). Each is a coloured data cell in a grid, sized and tinted by its figure, with roving focus in the calendar; the heatmap's `<table>` is that grid (sticky first column, its own sideways scroller), not a Table of text. Hidden file inputs driven by a Button also stay.

## Notices

- A notice in the page is an `Alert`; an error is `variant="destructive"`, with `role="alert"` when it has just happened. A form's error is `FormError`, which is the same box.
- Not an Alert: a page that failed to load (`PageError`, an EmptyState, since it is the whole page); a strip along the bottom of a card (an Account's "set aside more than the balance", a payoff Goal's "new charges"), which is part of its card; Plan health and Explore's warnings, which are lists of links.
- An error under one field (`Field`'s `error`) is a line of text, not a box.

## Figures

A figure with a label is a `Stat` in a `StatGrid`, never a hand-written `<dl>`. The grid picks the layout and the size, so every figure in it matches; columns come from `className`.

| Layout | Size | Label / value | Where |
| --- | --- | --- | --- |
| `ruled` | `sm` | 12px / 14px semibold | A strip along the bottom of a card, ruled above and between: This Month's totals, a Bucket's, a Commitment's and a payoff Goal's facts. `wrapLast` gives the last of three its own row on a phone. |
| `spaced` (default) | `default` | 13px / 18px semibold | A card's totals: Accounts, Goals. |
| `cards` | `lg` | 13px / 24px semibold | Each figure is its own Card: a Scenario against the Plan. |
| `spaced` with `size="lg"` | `lg` | 13px / 24px semibold | A Report's headline figures, in one Card; `note` holds what changed since the period before. |

- `note` is a second line under the value, `help` a TermHelp beside the label, `tone="over"` the over ink.
- Give the value as text, or as `<Money cents={…} />` so it never wraps.
- A list of words and their meanings (the Glossary) and a table of Plan against actual (the Year) are not figures; they stay a `<dl>` or a Table.

## Which dialog

- **Sheet**: a form, or a list to pick from. A bottom sheet on a phone, centred on a desktop.
- **DetailPanel**: something with its own address (a Commitment). From the right on a desktop: beside the list and not modal from xl, a modal drawer with a scrim from lg to xl; a page on a phone. A panel may open a Sheet; a Sheet never opens a panel.
- **AlertDialog**: a question before something that can't be taken back. Focus starts on Cancel.
- **Dialog**: something to look at, or one short question that isn't a warning (the video player). Centred at every width, with a Close button.

## Tap targets on phones

Below `lg` (phones and small tablets) every control is at least 44×44 px; at `lg` and up the
desktop density stays as it was. One approach everywhere: `max-lg:` sizes in the component.

- Button: `default`, `sm`, `icon` and `icon-sm` become `max-lg:h-11` / `max-lg:size-11` (`lg` is already 44).
- Input, SelectTrigger (all sizes), Combobox and DatePicker triggers: `max-lg:h-11`. Select and
  dropdown items: `max-lg:min-h-11`.
- Toggle / ToggleGroup items: `max-lg:h-11`. TabsTrigger / LinkTab: 36 px (`max-lg:h-9`) with a 44 px tall tap area from an `::after` box (issue 115).
- Sheet Close: `max-lg:size-11`. Calendar cells: 40 px below `lg` (7 × 44 doesn't fit a 320 px phone).
- Controls that stay visually small (Checkbox, Radio, Switch, TermHelp's "?") get a 44 px hit area
  from an `::after` box (`max-lg:after:absolute max-lg:after:-inset-…`). Keep 8 px or more between
  them and the next control so the hit areas don't overlap; better still, wrap the row in a `<label>`.
- Don't pass a fixed height in `className` to shrink a control on phones; if a caller needs a
  smaller control at desktop, override with `lg:h-…`.

## Which select

- **Select**: a choice that changes what a page shows, or sits inline as a chip. For example Reports' Period, Transactions' filters, and Explore's Scenario and chips.
- **OptionSelect**: a labelled field in a form with a short list (Kind, How often, a role). The user chose shadcn's look over the platform's own picker (2026-10-01), so there is no native select in the app.
- **Combobox**: a long or grouped list, searchable: a Transaction's and a Split's "Assigned to", Extra income's "To", a Rule's Bucket. Groups keep their headings.
- **DatePicker**: every date a person picks: a Goal's date, a Commitment's due date, a Report's custom range (two pickers, From and To). Times (quiet hours) stay `Input type="time"` with the browser's clock icon hidden, as shadcn's date-time example does; shadcn has no time picker.

## Not added, and why

- **ScrollArea**: one scroll per region (ADR-0024). The sidebar and sheets use the browser's own scrolling, and nothing has needed a styled scrollbar.
- **Pagination**: Transactions is one list whose rows load 50 at a time as you reach the end (no virtualizer); a Goal's History shows the latest, with a "Show N older" button.
- **Accordion**: Collapsible covers the single disclosures the app has.
- **Drawer**: phones get the bottom Sheet today. #48 (mobile) may move some menus and selects into a Drawer. Select, DropdownMenu and Popover are plain Radix parts, so a phone variant can wrap them without changing the app's calls.
