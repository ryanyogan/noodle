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
| Checkbox, Switch | shadcn, by hand (#47) | Checked takes the primary ink. Each has a 24px target. Name them with `<label htmlFor>`. |
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
| Sidebar | shadcn, by hand (#55) | The desktop sidebar: groups, menu buttons, a badge, a trigger. Collapses to an icon rail only (`rail:` variant, `--sidebar-width-icon`), remembered per device in localStorage and set on `<html>` before first paint by `sidebarStateScript`; Ctrl/⌘+B toggles. No mobile Sheet variant: phones keep the tab bar. A menu button's `tooltip` shows only in the rail. |
| Sheet | Noodle's own, on Radix Dialog | A bottom sheet on phones and a centred dialog on desktop: forms and lists to pick from. `SheetFooter stick` keeps the footer's buttons in view on a desktop too (phones always stick), for a long list like Add Buckets. |
| Slider | shadcn, by hand (#47) | One thumb, named, with its value in words. |
| Spinner | shadcn, by hand (#47) | Decorative unless given a `label`. |
| RowButton | Noodle's own (#56) | A button that is a whole row or tile. See "Rows and tiles that are buttons" below. |
| Stepper | Noodle's own (#53) | "Step 3 of 7 · about 2 minutes left", decorative segments, and an optional `status` line (a polite live region) for background work. The get-started wizard's progress header. |
| StepList, StepListItem | Noodle's own (#56) | In `stepper.tsx`. A flow whose steps have names: a `<nav>` (name it with `aria-label`) of rows, each `state="done"` (a tick), `"current"` (raised, `aria-current="step"`) or `"todo"`. The weekly Check-in. Use Stepper when the steps only need counting. |
| Table | shadcn, by hand (#47) | `numeric` right-aligns a cell in tabular figures. Give each table a caption. `dense` is a few lines of figures in a small space: 12px, no rules, the caption on top (a Scenario's month against the Plan). |
| Tabs | shadcn, by hand (#47) | Plus `LinkTabs`/`LinkTab`: the same look for pages that each have a URL, as a `<nav>` of links rather than a tablist. |
| Textarea | shadcn, by hand (#56) | Input's look, three lines tall, growing with what's typed. |
| Toast | Noodle's own look on Sonner (#47) | `toast(message, options)`. Up to three show at once, each a polite status. Sonner is the toast shadcn recommends; the registry's wrapper needs `next-themes`, so it isn't used. |
| Toggle, ToggleGroup | shadcn, by hand (#47) | Variants `segmented` (a track, the chosen one raised) and `chip` (round, filled when on: filters that can each be on). Sizes `sm`, `default`, `lg`, `icon-sm` (square, an icon only) and `wrap` (words that may run to two lines). Don't restyle an item with `className`: pick a variant and a size. A single-choice group is a radio group: one option is always chosen, and the arrow keys choose. |
| Tooltip | shadcn, by hand (#47) | `WithTooltip` is the common case. Never the only place something is said: touch can't hover. |
| Chart | shadcn | On Recharts, for Reports and Explore. |
| PageLayout, SplitLayout (SplitMain, SplitRail), MasterDetail | Noodle's own (#67) | The page grid, below. Every page under the shared header is one of the three. |
| Stat, StatGrid | Noodle's own (#56) | A figure under its label, and the `<dl>` a few of them sit in. See "Figures" below. |
| Money | Noodle's own (#56) | An amount from cents, in tabular figures on one line: `whole` rounds to dollars, `signed` adds "+" to a gain, `flagNegative` puts a negative in the over ink. `formatMoney` (`lib/money.ts`) is the same text as a string. |
| Field, FormError | Noodle's own | A labelled control with its hint or error. `FormError` is the error under a form: the destructive Alert with `role="alert"`, laid out as a row so a "Try again" Button can sit beside the words. |
| List, PageHeader, Section, SectionGroup, Tile, EmptyState, Logo | Noodle's own | ListRow `below` sits under the title and trailing columns; `belowFull` widens it to the whole row, under the leading tile, for a form opened in the row. SectionGroup puts Sections under one short heading (Household's People, Reminders, Setup) and drops their headings to h3. |

## Palette (#75)

The colours are **Soft stone**, the Parent's choice on 2026-10-04 after trying Warm paper (#75, ADR-0036): in light, a soft greige page (`--background #eff0ec`), an off-white card with a faint sage cast (`--card #f9faf7`, never pure white) and green-grey ink (`--foreground #1a1e1b`); in dark, a green-stone graphite that steps up (`#121513` page, `#191d1a` card, `#202521`/`#282e29` surfaces) with pale stone text (`#e9ede8`). The blue accent (`--brand`), marigold Pace and red Over stay, tuned to the new grounds; field borders use `--input` (`#83877d` light, `#6a716b` dark, at least 3:1 on every surface a field sits on); Bucket colours are the validated set, with light `--bucket-3` at `#038ca5` to stay 3:1 on the stone track. Every value, and its measured contrast, is in `docs/reviews/theme.md`. The browser bar (`theme-color` in `routes/__root.tsx`, and the manifest) matches the page colour of each mode. Components never name a colour: they use the token utilities (`bg-card`, `text-muted-foreground`, `bg-bucket-3`, …), so a palette change is a value change in `globals.css` only.

- **Field borders.** Text boxes, pickers and text areas (`Input`, `Select`, `Textarea`) draw their border with `border-input` (`--input`: `#8f8574` light, `#7a705f` dark), which is at least 3:1 against the card, `--surface-2` and the page, so a Parent can see where to type. `--border` stays the quiet line between rows and around cards; don't use it for a field. A picker's hover border is `border-muted-foreground`.
- **The colour lint.** `apps/web/src/hard-coded-colours.test.ts` fails on a hex, `rgb()`, `hsl()`, `oklch()` (or another CSS colour function) anywhere in `apps/web/src` or `packages/ui/src` outside `globals.css`. Use a token instead (`bg-card`, `var(--pace)`, …); the few files that can't read CSS variables (the `theme-color` metas, email HTML, the logo's dot) are on its allow-list, each with its reason, and an entry that no longer matches fails too. ADR-0034 has the rules every colour follows.

## The page grid

`components/layout.tsx`. A page below the shared header (`SectionLayout` or `PageHeader`) is one of three layouts, so rail widths, gutters and column tops are the same on every page. Don't write a two-column `lg:grid-cols-[…]` template in a page: `apps/web/src/layout-grids.test.ts` fails on a new one (its list of exceptions is for grids inside one card). ADR-0024 has the reasons.

| Token | Value | What it is |
| --- | --- | --- |
| `--gutter` | 16px, 40px from lg | The page's side padding (the shell). |
| `--layout-gap` | 32px | The one gutter: between columns, and between the blocks stacked in a column. |
| `--rail-width` | 320px below 1280, 360px from 1280 | SplitLayout's rail; narrower below 1280 so the main column stays the wider one. |
| `--list-pane-width` | 360px | MasterDetail's list pane. |
| `--reading-width` | 48rem | `PageLayout width="reading"`: the widest a page of prose or forms gets. |
| (shell) | 1200px, 1440px when the route has `staticData: { wide: true }` | The max content width, gutters included. |

- **PageLayout**: one column. `width="reading"` caps it; `columns={2}` is two equal columns from lg; a settings page (Household) is one `width="reading"` column of SectionGroups, with no competing columns; `spacing="tight"` sets a dashboard's cards closer (Reports).
- **SplitLayout** with `SplitMain` and `SplitRail`: main plus the rail from lg, both starting on the same top edge. The rail is sticky only while all of it fits the window (it measures itself and sets `data-fits`); taller than that, it scrolls with the page. It never has its own scrollbar, so don't give it a max height or `overflow-y-auto`. Below lg it is one column: `stack="main"` (main first, the default), `"rail"` (rail first) or `"children"` (both columns become `display: contents` and each block's `order-N` places it; pair each with `lg:order-none`).
- **MasterDetail**: `list`, `detail` and `empty`. From lg the page scrolls as one; the list is as long as it is and the picked item is sticky beside it while it fits the window. No pane scrolls on its own: each measures itself and sets `data-fits`, like SplitRail; a pane taller than the window flows with the page, and a shorter list stays in view beside a long item. Don't give a pane a max height or `overflow-y-auto`. A row's link to its item spreads `masterDetailItem`, which sets `resetScroll={false}`, so picking from far down the list keeps the Parent's place; below lg, opening an item starts its page at the top. `narrowList` (the Plan's Buckets and Commitments, whose rows are a name and an amount) gives the list 22rem beside an item below 1920, so the item has room for two columns at 1440; `listOnly` (Review's list of cards) leaves out the detail pane until something is picked, so the list has the page's width. Below lg it shows one level at a time as ordinary page content: the list, or the detail once there is one. `empty` fills the detail pane at lg while nothing is picked. With `emptyStacks`, `empty` is part of the page (an add form, the section's totals): it starts at the top of its pane and a phone shows it too.
- **ListBesideDetail** (in the app, `apps/web/src/components/master-detail.tsx`, with `DetailHeader`, `DetailPager`, `DetailPending` and `masterDetailKeys`): MasterDetail for a section whose items are child routes (Goals, Accounts, Rules, Scenarios; the Plan's Buckets and Commitments use MasterDetail directly). The item's route renders in the right pane; with nothing picked the pane holds `aside` (the section's totals) and `hint`. `asideFills` is for an aside that is the section's working area (Scenarios' Compare): full pane width, and after the list on a phone.
- **A picked item has its own address**, a child route of its list, and the search is kept. Back, Esc and Cancel in a detail go to the list's address rather than Back through history, so they work when the item's address was opened first. Below lg the same address is a page with a Back link.
- **Transactions** is a SplitLayout, not a MasterDetail: its list is drawn only for the rows in view, against the window, so the page scrolls and the open Transaction sits in the rail.

One scroll per region: `apps/web/e2e/desktop-scroll.spec.ts` fails a page with a scrolling element inside a scrolling page or ancestor, other than open sheets, dialogs and popovers, and things that scroll sideways.

## Desktop rules (#73)

- **One gutter.** `--layout-gap` (32 px) is the space between columns and between a column's blocks, on every layout. There is no tighter dashboard variant: Reports, Explore's rail and Can we afford it? use it too. Don't pass `gap-*` to `SplitMain`, `SplitRail` or `PageLayout`.
- **One card.** `Card` alone draws a surface: radius `--radius-card` (16 px), padding `--card-pad` (16 px on phones and tablets, matching the 16 px gutter; 20 px from lg; #74c), set only through the token (`p-(--card-pad)`), never a literal `p-4`/`p-5`, a 1 px border and `shadow-card`. A card of rows has padding 0 and pads its rows with `--card-pad`. There is no dense card padding; a tighter group inside a card is rows, not a card. Controls (buttons, inputs, tab tracks' outer shape) take `--radius-control` (12 px, `rounded-xl`).
- **Headings outside cards.** A section's heading is a `SectionHeader` above its card, never the card's first line. Each column of a `SplitLayout` starts with the same kind of block, a heading row in both or a card in both, so their tops line up. `e2e/alignment.ts` (`misaligned`) checks the first block of each column shares a top within 1 px and that cards keep their column's left edge; `desktop-scroll.spec.ts` runs it on This Month, Plan › Overview, Explore and Transactions at 1440. (This Month's rail starts with the Free to Spend card beside the Buckets heading; moving its heading out was 73c, and is done.)
- **Widths grow with the window (73L, ADR-0033).** The shell's cap is `--shell-max`: 1200 px below 1440, 1440 px from 1440, 1680 px from 1920; a `wide` route takes `--shell-max-wide` (1440, 1800 from 1920). The rail is 320 / 360 (≥1280) / 380 (≥1440) / 440 (≥1920) px and the list pane 360 / 400 (≥1440) / 460 (≥1920) px. Never write a width of your own; change a token.
- **Sections side by side.** Related sections go in a `SectionGrid` (one column, two from 1280, three from 1680 with `columns={3}`), each cell starting with its `SectionHeader`, so headings in a row line up. A picked item's page puts its blocks in `DetailColumns`, which goes to two columns when the detail pane (a `@container/detail`) is at least 48 rem wide; a block that needs the width takes `col-span-full`.
- **One "?" per heading.** A section's help is its heading's `help`. A legend or a row's explanation is not another "?" floating beside it: it goes into that help, a Term link, or under the card (This Month's bars' key).
- **Tab strips.** `TabsList` and `LinkTabs` share one behaviour: when they don't fit they scroll sideways with no scrollbar, fade the edge that has more, snap to tabs, and scroll the current tab into view without scrolling the page. Don't add `overflow-x-auto` to a tab strip.
- **Scrollbars.** Only the Sidebar scrolls on its own (the page scrolls otherwise). Its bar is thin, shows only on hover or focus, and takes `--border-strong` (so it follows light and dark).

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
- **Button `help`** with `variant="ghost"`: TermHelp's "?", 24px and round, with its 44px hit area on phones.
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
- **AlertDialog**: a question before something that can't be taken back. Focus starts on Cancel.
- **Dialog**: something to look at, or one short question that isn't a warning (the video player). Centred at every width, with a Close button.

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

- **ScrollArea**: one scroll per region (ADR-0024). The sidebar and sheets use the browser's own scrolling, and nothing has needed a styled scrollbar.
- **Pagination**: long lists are virtualized (Transactions) or show the latest, with a "Show N older" button (a Goal's History).
- **Accordion**: Collapsible covers the single disclosures the app has.
- **Drawer**: phones get the bottom Sheet today. #48 (mobile) may move some menus and selects into a Drawer. Select, DropdownMenu and Popover are plain Radix parts, so a phone variant can wrap them without changing the app's calls.
