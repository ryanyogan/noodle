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
| AlertDialog | shadcn, by hand (#47) | Focus starts on Cancel and returns to the opener (`lib/focus-return.ts`). |
| Avatar | shadcn, by hand (#55) | Root, image and fallback only. The fallback (an initial) shows until the picture loads. |
| Breadcrumb | shadcn, by hand (#47) | A drilled-in Report. |
| Button, Input, Label, Badge, Card, Skeleton | shadcn, restyled | |
| Checkbox, Switch | shadcn, by hand (#47) | Checked takes the primary ink. Each has a 24px target. Name them with `<label htmlFor>`. |
| Collapsible | shadcn, by hand (#47) | The trigger waits for hydration. `keepMounted` keeps closed content in the page, as `<details>` does. |
| DropdownMenu | shadcn, by hand (#47) | Items, labels and separators only. An item that opens a sheet gives focus back to the menu's button (`setNextOpener`). |
| Kbd | shadcn, by hand (#47) | Give a symbol key words for a screen reader. |
| Popover | shadcn, by hand (#47) | Term help. |
| Progress | shadcn, by hand (#47) | Name it, or hide it when the text beside it says the same. |
| RadioGroup | shadcn, by hand (#47) | Plus `RadioGroupCard` (a whole row as the target) and `RadioGroupPrimitiveItem` (unstyled, for swatches). |
| Select | shadcn, by hand (#47) | Trigger sizes `default`, `sm`, `pill`. `OptionSelect` is the form field: choices as data, groups, a hidden input under `name`. |
| Command, Combobox | shadcn, by hand (#47) | cmdk 1.1.1. Combobox = Popover + Command with OptionSelect's props, for long or grouped lists. |
| Calendar, DatePicker | shadcn, by hand (#47) | react-day-picker 10.0.2 (exact). DatePicker = Popover + Calendar in place of `<input type="date">`: a field-sized trigger reading "Oct 1, 2026", month and year dropdowns, `min`/`max`, Clear unless `required`, values stay yyyy-mm-dd (hidden input when `name`). Day buttons carry `data-day` (yyyy-mm-dd); specs use `pickDate()`. |
| Separator | shadcn, by hand (#55) | Decorative by default. |
| Sidebar | shadcn, by hand (#55) | The desktop sidebar: groups, menu buttons, a badge, a trigger. Collapses to an icon rail only (`rail:` variant, `--sidebar-width-icon`), remembered per device in localStorage and set on `<html>` before first paint by `sidebarStateScript`; Ctrl/⌘+B toggles. No mobile Sheet variant: phones keep the tab bar. A menu button's `tooltip` shows only in the rail. |
| Sheet | Noodle's own, on Radix Dialog | A bottom sheet on phones and a centred dialog on desktop. It plays the part of shadcn's Dialog. |
| Slider | shadcn, by hand (#47) | One thumb, named, with its value in words. |
| Spinner | shadcn, by hand (#47) | Decorative unless given a `label`. |
| Stepper | Noodle's own (#53) | "Step 3 of 7 · about 2 minutes left", decorative segments, and an optional `status` line (a polite live region) for background work. The get-started wizard's progress header. |
| Table | shadcn, by hand (#47) | `numeric` right-aligns a cell in tabular figures. Give each table a caption. |
| Tabs | shadcn, by hand (#47) | Plus `LinkTabs`/`LinkTab`: the same look for pages that each have a URL, as a `<nav>` of links rather than a tablist. |
| Toast | Noodle's own look on Sonner (#47) | `toast(message, options)`. Up to three show at once, each a polite status. Sonner is the toast shadcn recommends; the registry's wrapper needs `next-themes`, so it isn't used. |
| Toggle, ToggleGroup | shadcn, by hand (#47) | A `segmented` variant. A single-choice group is a radio group: one option is always chosen, and the arrow keys choose. |
| Tooltip | shadcn, by hand (#47) | `WithTooltip` is the common case. Never the only place something is said: touch can't hover. |
| Chart | shadcn | On Recharts, for Reports and Explore. |
| PageLayout, SplitLayout (SplitMain, SplitRail), MasterDetail | Noodle's own (#67) | The page grid, below. Every page under the shared header is one of the three. |
| Field, List, Meter, PageHeader, Section, Tile, EmptyState, Logo | Noodle's own | |

## The page grid

`components/layout.tsx`. A page below the shared header (`SectionLayout` or `PageHeader`) is one of three layouts, so rail widths, gutters and column tops are the same on every page. Don't write a two-column `lg:grid-cols-[…]` template in a page: `apps/web/src/layout-grids.test.ts` fails on a new one (its list of exceptions is for grids inside one card). ADR-0024 has the reasons.

| Token | Value | What it is |
| --- | --- | --- |
| `--gutter` | 16px, 40px from lg | The page's side padding (the shell). |
| `--layout-gap` | 32px | The one gutter: between columns, and between the blocks stacked in a column. |
| `--rail-width` | 360px | SplitLayout's rail. |
| `--list-pane-width` | 360px | MasterDetail's list pane. |
| `--reading-width` | 48rem | `PageLayout width="reading"`: the widest a page of prose or forms gets. |
| (shell) | 1200px, 1440px when the route has `staticData: { wide: true }` | The max content width, gutters included. |

- **PageLayout**: one column. `width="reading"` caps it; `columns={2}` is two equal columns from lg (Household); `spacing="tight"` sets a dashboard's cards closer (Reports).
- **SplitLayout** with `SplitMain` and `SplitRail`: main plus the rail from lg, both starting on the same top edge. The rail is sticky only while all of it fits the window (it measures itself and sets `data-fits`); taller than that, it scrolls with the page. It never has its own scrollbar, so don't give it a max height or `overflow-y-auto`. Below lg it is one column: `stack="main"` (main first, the default), `"rail"` (rail first) or `"children"` (both columns become `display: contents` and each block's `order-N` places it; pair each with `lg:order-none`).
- **MasterDetail**: `list`, `detail` and `empty`. From lg, two full-height panes under the header that each scroll on their own, and the page doesn't scroll. This is the only place a region scrolls inside the app's page; the panes carry `data-scroll-pane`. Below lg it shows one level at a time as ordinary page content: the list, or the detail once there is one. `empty` fills the detail pane at lg while nothing is picked. With `emptyStacks`, `empty` is part of the page (an add form, the section's totals): it starts at the top of its pane and a phone shows it too.
- **ListBesideDetail** (in the app, `apps/web/src/components/master-detail.tsx`, with `DetailHeader`, `DetailPager`, `DetailPending` and `masterDetailKeys`): MasterDetail for a section whose items are child routes (Goals, Accounts, Rules, Scenarios; the Plan's Buckets and Commitments use MasterDetail directly). The item's route renders in the right pane; with nothing picked the pane holds `aside` (the section's totals) and `hint`. `asideFills` is for an aside that is the section's working area (Scenarios' Compare): full pane width, and after the list on a phone.
- **A picked item has its own address**, a child route of its list, and the search is kept. Back, Esc and Cancel in a detail go to the list's address rather than Back through history, so they work when the item's address was opened first. Below lg the same address is a page with a Back link.
- **Transactions** is a SplitLayout, not a MasterDetail: its list is drawn only for the rows in view, against the window, so the page scrolls and the open Transaction sits in the rail.

One scroll per region: `apps/web/e2e/desktop-scroll.spec.ts` fails a page with a scrolling element inside a scrolling page or ancestor, other than MasterDetail's panes, open sheets, dialogs and popovers, and things that scroll sideways.

## Tap targets on phones

Below `lg` (phones and small tablets) every control is at least 44×44 px; at `lg` and up the
desktop density stays as it was. One approach everywhere: `max-lg:` sizes in the component.

- Button: `default`, `sm`, `icon` and `icon-sm` become `max-lg:h-11` / `max-lg:size-11` (`lg` is already 44).
- Input, SelectTrigger (all sizes), Combobox and DatePicker triggers: `max-lg:h-11`. Select and
  dropdown items: `max-lg:min-h-11`.
- TabsTrigger / LinkTab and Toggle / ToggleGroup items: `max-lg:h-11`.
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

- **Pagination**: long lists are virtualized (Transactions) or show the latest, with a "Show N older" button (a Goal's History).
- **Accordion**: Collapsible covers the single disclosures the app has.
- **Drawer**: phones get the bottom Sheet today. #48 (mobile) may move some menus and selects into a Drawer. Select, DropdownMenu and Popover are plain Radix parts, so a phone variant can wrap them without changing the app's calls.
