# Mobile review (#48)

Phase 1a (2026-10-01): research notes and an automated scan of every page on phones. Phase 1b (2026-10-01) added a look at every screenshot, a pass over the sheets, a long-name and 7-figure stress probe, and Welcome. Later phases fix the rows below.

## Research notes

What we hold every page to, and where it comes from.

**Touch targets.**

- Apple's Human Interface Guidelines ask for controls of at least 44×44 pt, with room between them (HIG, Accessibility → Buttons and controls: https://developer.apple.com/design/human-interface-guidelines/accessibility). 28×28 pt is the smallest Apple allows, and only for dense controls you can't miss.
- Material 3 asks for 48×48 dp targets with 8 dp between them (https://m3.material.io/foundations/designing/structure).
- WCAG 2.2 has two levels (https://www.w3.org/TR/WCAG22/):
  - 2.5.8 Target Size (Minimum), level AA: a target is at least 24×24 CSS px. A smaller target still passes if a 24 px circle centred on it doesn't touch another target's circle. Links inside a sentence are exempt, and so are controls the browser draws.
  - 2.5.5 Target Size (Enhanced), level AAA: 44×44 CSS px.
- Our rule (#48): **44×44 CSS px for everything**, which meets both Apple and 2.5.5. Anything under 24 also fails 2.5.8 (AA), so those are fixed first.
- A small icon can keep its look and still get a 44 px hit area from a transparent `::after`, provided the hit areas don't overlap.

**iOS input zoom.**

- iOS Safari zooms the page when an input, select or textarea with a computed font-size under 16 px gets focus. It stays zoomed after you leave the field.
- The fix is a font-size of at least 16 px on phones. Our Input and Command input already use `text-base md:text-sm`.
- Don't fix it with `maximum-scale=1`. That also turns off pinch zoom, which breaks WCAG 1.4.4 Resize Text.

**Viewport height and safe areas.**

- On iOS, `100vh` is the *large* viewport: the height with the browser toolbars hidden. Content sized with it ends up under the toolbar.
- `dvh` follows the toolbars as they show and hide. `svh` and `lvh` are the fixed small and large sizes. Use `dvh` for full-height shells, and `svh` where a jump would show (web.dev, "The large, small, and dynamic viewport units": https://web.dev/blog/viewport-units).
- `env(safe-area-inset-*)` keeps clear of the notch and the home indicator. It needs `viewport-fit=cover` in the viewport meta (WebKit, "Designing Websites for iPhone X": https://webkit.org/blog/7929/designing-websites-for-iphone-x/).
- Noodle already uses `min-h-dvh`, `viewport-fit=cover` and safe-area padding on the shell, the tab bar and the sheets. The source has no `100vh` or `h-screen`.

**On-screen keyboard.**

- iOS Safari doesn't resize the layout viewport when the keyboard opens. Only the visual viewport shrinks, so `position: fixed; bottom: 0` content ends up behind the keyboard.
- `window.visualViewport` (its `resize` and `scroll` events, `height` and `offsetTop`) tells you the area you can actually see. Use it to keep a sheet's primary action above the keyboard (MDN, Visual Viewport API: https://developer.mozilla.org/en-US/docs/Web/API/Visual_Viewport_API).
- Chromium has two extra controls:
  - The VirtualKeyboard API: `navigator.virtualKeyboard.overlaysContent` plus `env(keyboard-inset-height)` (MDN, VirtualKeyboard API: https://developer.mozilla.org/en-US/docs/Web/API/VirtualKeyboard_API).
  - The viewport meta key `interactive-widget=resizes-content` (Chrome for Developers, "Prepare for viewport resize behavior changes": https://developer.chrome.com/blog/viewport-resize-behavior).
- Safari supports neither, so iOS needs the visualViewport route, and it has to be checked on a real device.

**Layout shift (CLS).**

- "Good" is a CLS of 0.1 or less at the 75th percentile (web.dev, CLS: https://web.dev/articles/cls).
- Shifts are grouped into session windows of up to 5 s, with gaps under 1 s. Shifts within 500 ms of a tap or keypress don't count (`hadRecentInput`).
- Skeletons should be the same size as whatever replaces them.
- The scan measures load only. Shifts on refetch, on live updates, when the keyboard opens and when a sheet closes need a person (phase 4).

**Money fields and keyboards.**

- `inputmode="decimal"` brings up the decimal pad. Avoid `type="number"` for money: it accepts e and ±, it changes the value when you scroll, and screen readers struggle with it (GOV.UK Design System, Text input → Numbers: https://design-system.service.gov.uk/components/text-input/#numbers).
- Add `enterkeyhint` and `autocomplete` where they help (MDN `inputmode`: https://developer.mozilla.org/en-US/docs/Web/HTML/Global_attributes/inputmode).

**Double-tap zoom and tap feedback.**

- With `width=device-width`, browsers drop the 300 ms tap delay. `touch-action: manipulation` on controls also stops double-tap zoom there.
- We set `-webkit-tap-highlight-color: transparent`, so every control needs its own `:active` state.

**Sheets.**

- shadcn's Drawer (Vaul) is the bottom sheet you can swipe. Its "responsive dialog" pattern shows a Dialog on desktop and a Drawer on phones (https://ui.shadcn.com/docs/components/drawer, https://ui.shadcn.com/docs/components/sheet).
- Use `overscroll-behavior: contain` on scrolling panels, so the page behind doesn't scroll (MDN `overscroll-behavior`).
- Apple's HIG on sheets: keep the primary action reachable and allow swipe-down to dismiss (https://developer.apple.com/design/human-interface-guidelines/sheets).

## How the scan worked

- **Script:** `p48/scan.ts`, with `p48/sheets.ts` for the sheets. Both live in the session scratchpad, not the repo.
- **Setup:** signed in as Alex, against our own dev server on port 5174 with `AI_MODEL=stub`.
- **Coverage:** every route under `R/` (36 page views on `busy`, including the six Reports views and the Bucket, Commitment, Account and Goal detail pages), plus Sign-in when signed out. Each page was loaded at 320, 375, 393 and 430 wide, in light and in dark.
- **Seeds:** `busy` (304 loads), then `fresh` after a reseed (224 loads; `fresh` has no detail pages).
- **Gaps:**
  - Welcome redirects to Month for both seeded users, because they already have a Household.
  - `/goals/accounts/:id` had no link on either seed.

For each load it recorded:

- `scrollWidth` against `innerWidth`, and the outermost element sticking out without being clipped.
- Every visible interactive element (`a`, `button`, `input`, `select`, `textarea`, and roles button, tab, radio, checkbox, switch, combobox and menuitem) smaller than 44×44 or 24×24, with its name and `data-slot`. Links inside a sentence were left out (2.5.8 exemption; 130 of them on `busy`).
- Inputs with a computed font-size under 16 px.
- CLS from a `layout-shift` PerformanceObserver installed before the page loads.
- Money-looking inputs (a "$" next to them, or a label like amount, price, balance, target or owed) without `inputmode="decimal"`.

It saved full-page screenshots at 393 light and 320 dark for every page and seed. `sheets.ts` then opened each page's sheets and popovers at 393 on `busy` and measured where each one sits, its inputs and its targets.

**Results at a glance:**

- No horizontal overflow on any of the 528 loads.
- CLS at most 0.01 (Month, `busy`).
- No input under 16 px in the app, on the pages or in the sheets opened. The only one is Clerk's Sign-in field.
- No money field without the decimal pad.
- Tap targets are the big gap: 51 groups of controls are under 44, and 9 groups are under 24.

**Phase 1b (the human-eye pass):**

- **Screenshots:** every page's full-page shot at 393 light and 320 dark on `busy`, viewed six at a time as contact sheets.
- **Sheets:** `p48/sheetpass.ts` opened 15 sheets and 2 AlertDialogs at 393 with the page scrolled to 300. For each it recorded position and height, whether the primary action shows without scrolling, a wheel over the sheet (sheet `scrollTop` against `document.scrollingElement.scrollTop`), 25 Tabs for the focus trap, Escape, where focus and the page's scroll land after closing, and a drag down from the top edge.
- **Stress probe:** on local `busy`, a Bucket, Goal, Account and the Household got names of 40+ characters, and an Account balance and a Transaction got 7 figures ($1,234,567.89). Then 9 pages were shot at 320 and `busy` was reseeded. Nothing overflowed sideways; the damage is truncation and cramping.
- **Welcome:** a fresh Clerk test Parent with no Household, at 320 and 393, light and dark. It's clean.
- **Totals:** 39 rows added, 77 in all: 21 high, 37 med, 19 low. By phase: 2 has 23, 3 has 25, 4 has 13, 5 has 14 and 6 has 2.
- **The pattern:** at 320, page headers with actions squeeze the title ("Octobe / r", "Ex / p…"), and badges and amounts squeeze names to a letter. Three-column tables (Household's Child costs, Commitment charges, Plan vs actual) should become lists on phones. Sheets behave well except Quick Add's hidden Add button and nine sheets that lose the page's scroll position.

## Audit

Each row is one page × one issue. Repeated small targets are grouped by component; sizes are W×H in CSS px at 393 wide. **Phase** is the #48 phase that fixes it:

- 2: overflow and input zoom
- 3: tap targets
- 4: sheets, keyboard and steadiness
- 5: mobile patterns and heavy data
- 6: accessibility and the final pass

**Status** works as in `desktop.md`: `open` until a later phase changes it to `fixed (<sha>)`, `partly fixed (<sha>): <what's left>` or `won't fix: <reason>`.

| Page | Issue | Severity | Fix | Phase | Status |
|---|---|---|---|---|---|
| Every page | No horizontal page scroll at 320, 375, 393 or 430, in light or dark, on `busy` or `fresh`: `scrollWidth` equals `innerWidth` on all 528 loads. But seed names and amounts are realistic, not extreme. | med | Add a long-name and 7-figure-amount probe (rename a Bucket, Account and Goal to 60 characters, set a $1,234,567.89 balance) and recheck at 320. Then guard it with the phone E2E spec. | 2 | partly fixed (7665705): long-name probe rerun at 320 after the fixes, no overflow on 9 pages; the E2E guard is still open |
| Month (Close month sheet) | The Sweep select clips "Emergency fun…" at 393 (found in #47). | low | Let the Select trigger take the full row width on phones, and show full names in the list. | 2 | fixed (fd4c4ed): full-width select on phones |
| Sign-in | Clerk's email field is 13 px, so iOS zooms the page when it gets focus. | high | Clerk `appearance`: set the form field input to 16 px below `md`. | 2 | fixed (7665705): Clerk appearance sets the fields to 16 px below md; measured 16 px at 320 |
| Shell (every page) | The Quick Add button in the tab bar is 48×40. | med | Make it at least 44 tall (`h-11`). It's the most-used control in the app. | 3 | fixed (bff0f06) |
| Shell header (Month, Plan and their tabs; 20 pages) | Header icon buttons are 32×32: Reports, Ask, Glossary, Previous/Next month, Previous/Next year, Back to Plan, and Next month on Transactions. Household's "Open user menu" is 28×28. | high | `size="icon"` gets a 44 hit area on phones (`max-lg:size-11`, or a 44 px `::after` with the icon kept at 16). | 3 | fixed (bff0f06) |
| TermHelp (16 pages, 35 buttons, plus Add a Goal) | The "What's '…'?" button is 24×24: exactly the 2.5.8 minimum, short of 44. | med | Give term-help.tsx a 44 px `::after` hit area, keep the visual size, and check that it doesn't overlap the next control. | 3 | fixed: 44 px ::after hit area (the scan still measures the 24 px box) (bff0f06) |
| Small buttons (`size="sm"`, h 30) on 25+ pages | Row actions: Cover, Record payment and Fund (68 on 10 pages). Links: New Goal, Review, Explore, Scenarios, "Can we afford it?" (21 on 19 pages). Submits: Add income, Export CSV, Ask's suggested questions (38 on 16 pages). Quick Add chips: Everyone/Maya/Theo/Alex/Jordan, Snap receipt, Say it (also in Edit Transaction). Commitment sheet: End. | high | `sm` becomes `max-lg:h-11` (or make the whole row the target for row actions). Recheck the Quick Add chip row: it may need to wrap. | 3 | fixed (bff0f06) |
| Default buttons (h 36) on 10 pages and in every sheet | Close September, Add Bucket, Add Commitment, Ask, Skip for now, Open Review, Make it a Goal, Explore as a Scenario, Add money, Spend, and every sheet's Save, Cancel and primary action. | med | Default size becomes `max-lg:h-11`. | 3 | fixed (bff0f06) |
| Inputs, Select and Date picker triggers (h 40) on 17 pages and in sheets | Input (7 pages), search (Transactions, Glossary), Select (the "Where X's leftover goes" rows on Month, plus Commitments, Transactions, Explore, Afford and Reports), Date picker (Commitment), Filters (Reports), and Account and Frequency in sheets. | med | Input, SelectTrigger, Combobox and Date picker become `max-lg:h-11`. | 3 | fixed (bff0f06) |
| Plan (Overview, Income, Commitments, Buckets, Goal funding; 16 pages) | The Plan sub-tabs (link-tab) are 32 tall (121 links). The Month/Plan switch (6 pages) is 28 tall. | med | Tabs become `max-lg:h-11`. | 3 | fixed (bff0f06) |
| Plan, Year | The rows in Plan's summary list (Take-home pay, Commitments, Buckets, Personal Allowances, Goal funding) are links only 20 tall, which fails 2.5.8. So are Year's month links (March, April…). | high | Make the whole row the link, at least 44 tall. | 3 | fixed: Plan rows were already whole-row links (::after; the scan measures the text), Year links now 44 (bff0f06) |
| Month | The "Goals in the Plan" section link is 111×19 (<24). | high | Turn it into a 44 tall row link or button. | 3 | fixed (bff0f06) |
| Month | The status links "11 to review", "2 Plan changes this month", "3 new Insights" and "4 things to check in" are 32 tall. | med | At least 44 tall, or a list of rows. | 3 | fixed (bff0f06) |
| Month | The "This month / Coming up (11)" tabs are 32 tall. | med | Same tab fix as the Plan tabs. | 3 | fixed (bff0f06) |
| Month, Commitments | The "Not this month" collapsible is 36 tall. Related: "What it's based on" on Insights (40) and "Leftovers from…" on Goal (41). | low | `min-h-11` on collapsible triggers. | 3 | fixed (bff0f06) |
| Month, Income | "Actions for $3,400 of income" (32×32) and "More actions for Chase" on Account (77×30) are dropdown triggers. | med | 44 hit area. | 3 | fixed (bff0f06) |
| Buckets, Commitments, Income, Household | The per-row "Edit <name>" icon buttons are 32×32 (28 of them). | high | Make the row itself open the editor, or give the button a 44 hit area. | 3 | fixed (icon buttons 44) (bff0f06) |
| Explore | The "Leave out" and "Remove" buttons on changes are 28×28 and 36×28. The 1/2/3/5 year toggle and the Free to Spend / Projected balance / Each month / Goal paths tabs are 32 tall. "New Scenario from the Plan" is 40 tall. | high | 44 hit areas, `max-lg:h-11` on the toggles and tabs. | 3 | fixed (toggles, buttons and tabs 44) (bff0f06) |
| Scenarios, Afford | Checkboxes are 18×18 ("Compare '…'", the Goal choices on Afford), which fails 2.5.8. | high | Make the label row the target (`<label>` wrapping the whole row, at least 44 tall). | 3 | partly fixed: 44 px ::after hit area; the label row isn't the target yet (bff0f06) |
| Buckets (Add Bucket), Bucket sheet | The "Resets monthly / Carries over" radios are 18×18 (<24). | high | Radio cards: the whole option is the target. | 3 | partly fixed: 44 px ::after hit area; not radio cards yet (bff0f06) |
| Household | The 4 Nudge switches are 40×24. | med | The label row toggles the switch; the row is at least 44 tall. | 3 | partly fixed: 44 px ::after hit area; the label row doesn't toggle yet (bff0f06) |
| Perks | The "Source" link in each row is 56×19 (<24). The URL input is 40 tall. | high | Make the link a 44 tall row action. | 3 | fixed (Source 44 tall, MetaParts) (bff0f06) |
| Reports (all views) | The chart view toggles ("Show … as a table") are 36×28. Donut/Bars/Treemap are 28×28. | med | 44 hit areas. | 3 | fixed (toggles 44); chart marks (Spending by day cells 24, month bars 36) still small (bff0f06) |
| Every sheet | The Close (X) button is 32×32. | high | 44 hit area in sheet.tsx. | 3 | fixed (bff0f06) |
| Bucket sheet | The 8 colour swatches are 32×32. | med | 44 hit areas with 8 px gaps (wrap to two rows at 320). | 3 | fixed (bff0f06) |
| Commitment and Take-home pay sheets | The "Just October / From October on" toggle is 32 tall. "History" is 20 tall (<24). | med | `max-lg:h-11`. History becomes a full-width row. | 3 | fixed (bff0f06) |
| Date picker | The Calendar day cells are under 44 (12 targets in the popover). | med | Set the shadcn Calendar `--cell-size` to 44 below `lg`, or use a bottom sheet on phones. | 3 | partly fixed: cells 40 below lg (7 x 44 doesn't fit 320) (bff0f06) |
| Sign-in | Clerk's buttons (Continue with Google, Continue) and its input are 32 tall. The Clerk logo link is 48×14. | med | Clerk `appearance`: 44 tall buttons and inputs. | 3 | partly fixed: buttons and field 44; Clerk logo link left (bff0f06) |
| Every page | Load CLS is at most 0.01 (Month on `busy`, every width) and 0 everywhere else. Nothing jumps on load. Refetch, live updates, the keyboard opening and a sheet closing aren't measured. | low | In phase 4, measure CLS while adding a Transaction (live update), on refetch (window focus), and when a sheet closes. Check scroll position after a sheet closes. | 4 | open |
| Every sheet | The bottom sheet is our own Sheet, not shadcn Drawer (Vaul). Drag-to-close works only from the 16 px grabber; you can't drag down from the header or from content scrolled to the top. Back-gesture behaviour isn't defined. | med | Decide: move phones to shadcn Drawer (the responsive dialog pattern) or widen the drag area to the header. Make Back close the sheet consistently. | 4 | open |
| Quick Add, Glossary, Reports Filters | Full-height sheets (836 of 852): the Close button and the top fields sit out of thumb reach. | med | Keep actions at the bottom. Consider a shorter first snap point for Quick Add. | 4 | open |
| Reports Filters sheet | Its primary action sits at y=898 in an 852 tall viewport, so it can't be seen until you scroll. | med | Sticky sheet footer with a safe-area bottom pad. | 4 | open |
| Sheets with forms (Quick Add, Cover, Fund, Add income, Edit Bucket and Commitment, Add Account and Goal, Edit Transaction) | Nothing keeps the primary action above the iOS keyboard (no visualViewport handling). That needs a device. | high | Check on an iPhone. If it hides, pin the footer to `visualViewport` (and use `interactive-widget=resizes-content` for Chrome). | 4 | open |
| Explore (Scenario outline) | The growth % fields are `type="number"` (scenario-outline.tsx:989). They have `inputMode="decimal"`, but number inputs change on scroll and accept "e". | low | `type="text"` plus `inputMode="decimal"` and a pattern, like MoneyInput. | 5 | open |
| Every form | The money fields the scan saw (pages and opened sheets) all use `inputmode="decimal"` (MoneyInput). `enterkeyhint` and `autocomplete` weren't audited. | low | Audit `enterkeyhint` ("next" and "done" in sheets) and `autocomplete="off"` on money and name fields. | 5 | open |
| Reports (Trends, Plan, Big) | Chart marks are separate focusable tooltip buttons: 154 day bars on Trends (24×24), 102 month bars on Plan (48×36), and 10 histogram bars on Big (31×82). That's hard to explore by touch and a long Tab and VoiceOver run. | med | One focusable chart with a touch scrubber (drag to read values) and a table or list fallback. Check it stays smooth with 8+ months. | 5 | open |
| Welcome | The scan can't reach it: both seeded Parents already have a Household, so it redirects to Month. | med | In phase 1b or 6, check it with a fresh Clerk test user who has no Household. | 6 | fixed (phase 1b): checked with a fresh test Parent; see the last Welcome row |
| Every page | A phone-size E2E guard for overflow and tap-target size doesn't exist yet. | high | Port `measure()` from the scan into an e2e spec at 320 and 393 that fails on overflow and on targets under 44 (allowlisting inline links). | 6 | open |
| Month (Close September card) | The Close-month card on Month itself also clips "Emergency fun…" in every Sweep select at 393. At 320 the Bucket names shrink too: "Gas & park…", "Fun & outin…", "Extra inco…". | med | On phones, stack each row: name and amount on one line, the select full width below. | 2 | fixed (fd4c4ed): rows stack below sm |
| Month (Buckets list) | At 320 the status badge squeezes the Bucket's name: Eating out shows as "E…" next to "Over by $224.69", and Car maintenance as "Car…". With a 47-character name, Groceries shows only "G" next to "Ahead of pace". | high | Below `sm`, put the badge on its own line under the name and let the name wrap to two lines. | 2 | fixed (7665705): ListRow names wrap to two lines and the badge drops below |
| Month | "incl. $400 Personal Allowances" under In Buckets wraps to three lines in the three-column stat row. The Buckets section's "?" sits alone on the line under its paragraph. | low | Use two columns at 320, or move the note under the row. Put the TermHelp inline in the heading. | 2 | open |
| Plan (every Plan tab, Year), Reports | The sub-tabs scroll sideways with no hint. At 393 "Goal funding" is cut to a sliver, and at 320 only three Plan tabs show. Reports' view tabs do the same ("Plan vs a…"). | med | Fade the clipped edge and scroll the active tab into view, or use a Select below `sm`. | 5 | fixed (7665705): the strip snaps, scrolls the current tab into view, and fades the edge that has more |
| Plan Goals, Buckets, Commitments, Accounts, Account, Household, Rules | Long names get one line and an ellipsis, so on a phone you can't read them in full: "Spring break: Disney World with Gran…", "Back-to-school, field trips, cl…", "Maya's braces — Dr. Patel's …", "Ally Online Savings — Ho…". | med | Let names wrap to two lines (`line-clamp-2`) in list rows. Truncate only the secondary meta line. | 2 | partly fixed (7665705): ListRow and Goals' LinkRow clamp to two lines; other row types not checked |
| Goals (Saving for list) | A long Goal name is cut off with no ellipsis: "Spring break: Disney World \". In the stress probe, "Family trip to see Grandma in Lagos and Oslo" lost "in Lagos and Oslo" without any mark. | high | Wrap to two lines with `line-clamp-2`. Never clip with `overflow-hidden` and no ellipsis. | 2 | fixed (7665705): line-clamp-2 with an ellipsis |
| Goals, Goal, Perks | Meta lines joined with "·" wrap so that a line starts with a lone "·" ("· No target date", "· in Ally Online Savings…", Perks' "· Seen in…"). | low | Make each meta part an inline-flex item and draw the separator as a pseudo-element that drops at a wrap. Or show one fact per line on phones. | 2 | fixed (fd4c4ed): MetaParts (separators drop at a wrap); then fixed (bff0f06): Perk Source rows use MetaParts |
| Transactions | At 320 the month title breaks mid-word, "Octobe / r", because the header icons (Upload statement, Review 11, Previous, Next) take the row. | high | Below `sm`, let the actions wrap under the title, or move Upload statement into a menu. Headings never break mid-word. | 2 | fixed (7665705): PageHeader wraps its actions to their own row |
| Explore | At 320 the title shrinks to "Ex / p…" next to the Scenario icon and the "Can we afford it?" button. | high | Same header fix: put the actions on their own row below `sm`, or make "Can we afford it?" an icon button with a label. | 2 | fixed (7665705): same PageHeader wrap |
| Transactions | The Bucket, For and Account selects sit above the list and take about 200 px at 393, so the first Transaction starts mid-screen. | med | One "Filters" button showing the active count, opening a Filters sheet as Reports does, with chips for the active filters. | 5 | open |
| Transactions, Account | At 320 the meta line under each Transaction is cut to almost nothing ("Pending · Auto · E.", "Unassigned · Everyone · …"). | low | Drop the Account from the meta below `sm`, or let it wrap to a second line. | 2 | fixed (fd4c4ed): detail gets its own line under badges |
| Accounts | Account rows put four facts in the meta line: kind, Set aside, Not set aside, and "Connected · Chase". At 393 it wraps to 3–4 lines beside the balance, and at 320 to 6. The name truncates ("Chase Total Chec…", "Ally Online Sa…"). | high | Phone layout: name and balance on the first line, kind · source on the second, Set aside and Not set aside as a small two-column row below. | 5 | open |
| Commitment (detail) | The Charges table has four columns (Due, Paid, Status, Amount) at 393, and Due and Paid are the same date on almost every row. | med | On phones, a list: the date and Amount on one line, and Status only when it isn't "On time" or Paid differs from Due. | 5 | open |
| Accounts (Bank Connections) | Each connection's text (Accounts, imports, Matched, "11 waiting in Review") runs in a narrow column, with the "Accounts" link and the Reconnect button off to the side. At 320 the column is about 140 px wide and 15 lines tall. | med | Stack it: text full width, actions in a row underneath. | 5 | open |
| Household (What each Child costs) | The per-Child tables have three columns. Bucket names are cut to "Hockey & s…" at 393 and to one letter ("H.", "M.", "C.") at 320. | high | A list per Child: the Bucket name on its own line, This month and This year under it. Or drop This month below `sm`. | 5 | partly fixed (7665705): auto table layout on phones, so names wrap whole words instead of one letter; a phone list is still open; then fixed (fd4c4ed): phone list below sm |
| Household | The Household name is truncated in the title even with the seed name ("The Okonkwo-Lindqvist Househol…" at 393). Parents' emails break mid-word ("seed- / jordan+…"). | med | Let the title wrap as far as it needs; it's the page's only heading. Break emails only after "@", or truncate them and show the full address on tap. | 2 | partly fixed (7665705): titles wrap fully; emails still break mid-word; then fixed (fd4c4ed): emails break at the @ |
| Goal, Account (detail headers) | With a 40-character name the title is cut after two lines ("Family trip to see Grandma…", "Chase Total Checking fo…"). The full name isn't shown anywhere else on the page. | med | Let detail titles wrap fully, or use a smaller title size below `sm`. | 2 | fixed (7665705): PageHeader no longer clamps |
| Accounts, Account (7-figure stress) | With 7-figure balances at 320, the Totals card's two columns ($1,348,719.44 and $1,271,614.44) almost touch. An Account row's $1,234,567.89 squeezes its meta to six lines. Nothing overflows: `scrollWidth` equals `innerWidth` on all 9 stressed pages. | low | Use `tabular-nums`, and one column for Totals below 360. The row is covered by the Accounts row fix above. | 2 | fixed (fd4c4ed): Totals one column below 360 |
| Insights | Action buttons truncate their labels: "End Netflix in the Plan…", "End Spotify Family in the Plan…". | low | Let action buttons wrap, or shorten the label ("End it in the Plan") since the card title already names it. | 2 | fixed (fd4c4ed): buttons wrap |
| Scenarios | "Made by Alex Changed Sep 22" runs two facts together with no separator, and it wraps oddly at 393. | low | "Made by Alex · changed Sep 22", or two lines. | 2 | fixed (fd4c4ed): MetaParts |
| Year | Each month card pairs Plan and actual as "$5,772.97 · $5,729.76" in one right-hand cell. At 393 it's hard to tell which is which, and the numbers don't line up. | med | Two right-aligned `tabular-nums` columns headed Plan and Actual, or show only the difference, with Plan on a second line. | 5 | open |
| Reports (all views) | At 320 the selects cut their values: "Last 6 month", "By month (au". | med | Stack full-width selects on phones, or move Period and Group by into the Filters sheet. | 2 | fixed (7665705): selects take a full row below 375 px |
| Reports (Plan vs actual) | The heat-map table scrolls sideways inside its card and opens scrolled to the end. At 320 a sliver of an earlier column ("%") shows at the left edge, and the Bucket names truncate ("Gas & park…", "Household…"). | med | On phones, a list per Bucket: this month's % and a small spark of past months. Or pin the Bucket column and snap the scroll to whole columns. | 5 | fixed (fd4c4ed): badge under the name |
| Reports (Plan vs actual: Usually over or under) | At 320 the rows are cramped: names truncate to "Car ma…" and "Eating o…", and "5 of 6 months under" wraps to three lines beside the badge. | low | Put the badge under the name and keep "5 of 6 months" on one line. | 2 | fixed (fd4c4ed): badge under the name |
| Reports (Buckets) | The "Share of spending" header crams its title, description and four icon toggles into one row: the title wraps and the description runs in a 120 px column. The row meta "Commitment · 29% · 6 Transactions" wraps into a ragged block. | med | Give the toggles their own row below `sm`, and keep the meta on one line ("29% · 6 Transactions"). | 5 | open |
| Reports (Trends: By Bucket) | At 320 the small multiples overlap: "Honda car payme" runs into "Car maintenance", and "Household suppli" is clipped. | med | One column of small multiples below 360, with truncated names. | 5 | open |
| Reports (Big expenses) | The histogram title "What did we spend over…" is truncated at 320. | low | Wrap the title. | 2 | open |
| Quick Add sheet | The primary action (Add) sits at y≈1065 in an 852 tall viewport. The sheet scrolls inside (1112 of 835), so you scroll past the Bucket grid and For to reach it. Bucket names truncate in the two-column grid ("Household supp…", "Alex's Personal …", "Piano lessons (…"). | high | Sticky footer with the Add button and a safe-area pad. Bucket chips wrap to two lines. | 4 | open |
| Sheets: Add a Goal, Add money, Bucket, Rule, Reports Filters, Account rename, Add Account, Glossary, Delete Scenario | Opening the sheet scrolls the page behind to the top, and it stays there after closing: page `scrollTop` 300 → 0 → 0. Quick Add, Cover, Edit Transaction and Remove Perk keep 300; the Commitment sheet ends at 275. | high | Find what resets the scroll when these open (probably autofocus or a remount behind the sheet) and keep the page where it was. Add an E2E check in phase 6. | 4 | open |
| Every sheet | Baseline from the sheet pass (393, `busy`, 15 sheets and 2 AlertDialogs). Every sheet opens from the bottom. Focus stays inside (none of 25 Tabs escaped). Escape closes it, and focus goes back to the trigger. Scrolling over a sheet never scrolled the page behind. The primary action is visible without scrolling in all but Quick Add and Reports Filters. | low | Keep these as phase 4's E2E assertions. | 4 | open |
| Every sheet (grabber) | Dragging the mouse down 400 px from 8 px inside the sheet's top edge closed none of them headless. That may just miss the 16 px grabber, so it needs a touch check on a device. | med | Goes with the Vaul row above: drag to close from the whole header. | 4 | open |
| AlertDialogs (Delete Scenario, Remove Perk) | They open as centred dialogs (top 322 of 852). Every other dialog is a bottom sheet. | low | Fine as is. Or anchor alerts to the bottom on phones for thumb reach; decide in phase 4. | 4 | open |
| Add a Goal sheet | The Account select cuts its value: "Chase Total Checking · $6,086.17 not set as". | med | Show only the name in the trigger and the amounts in the list, or put the amount on a second line. | 2 | fixed (fd4c4ed): amount on a second line in the list only |
| Add money sheet | In the "Where's it from?" toggle, the second option wraps to three lines ("Already in Ally Online Savings — House & Rainy Days") beside a one-line first option. | low | Show the options as stacked radio cards on phones. | 2 | fixed (fd4c4ed): options stack below sm |
| Edit Transaction, Add a Rule sheets | "Assigned to" and Bucket are still native selects (the ⇕ trigger), which the 2026-10-01 decision rules out. | med | A shadcn Combobox (Command) for Assigned to, and a Select for Bucket. | 5 | not a bug (7665705): both were already the shadcn Combobox (d4fcb47); its ⇕ chevron read as native, so it now uses Select's chevron. Popover is min(trigger, 100vw−16px) |
| Rename Account sheet | Focus lands on the Close button, with its ring showing, not on the Name field. | low | Autofocus the Name input so the keyboard comes up. | 4 | open |
| Bucket sheet | Save and Cancel sit mid-sheet, with History, Move up/down and Archive below them, so the primary action isn't at the bottom as in the other sheets. | low | Sticky footer for Save. Move ordering and Archive above it. | 4 | open |
| Upload statement, Connect a bank, Close-month sheet | The sheet pass couldn't open these headless: no trigger matched by name on Transactions, the bank chooser didn't open within 4 s, and the "Close September" click timed out. | med | Check them by hand in phase 4. | 4 | open |
| Welcome | Checked with a fresh test Parent at 320 and 393, light and dark: no overflow, 16 px inputs, a full-width Create Household button. "Your name" is empty with no placeholder, though Clerk has the first name. | low | Prefill Your name from Clerk's first name. | 2 | fixed (fd4c4ed) |

## Needs a real device or a person

Phase 1b covered the screenshot review. These can't be measured headless:

- **Standalone PWA on iPhone**:
  - Status bar and safe-area insets in standalone mode.
  - Launch splash.
  - Back gesture with no browser chrome.
  - No pull-to-refresh: decide whether to add one deliberately.
- **On-screen keyboard**:
  - Do sheets keep their primary action and the field being typed in visible?
  - Does the page jump when the keyboard opens?
  - Is typed text kept when the keyboard closes?
- **Rubber-banding**: fixed tab bar and sticky headers (Explore, Afford) while overscrolling. Does `overscroll-contain` on sheets stop the page behind from scrolling?
- **Sheet close**: scroll position and focus return after a sheet closes. Swipe-to-dismiss feel.
- **Tap feedback**: `:active` states on every control (the tap highlight is turned off). Accidental taps near the tab bar and home indicator.
- **VoiceOver**: reading order, labels (Reports' chart buttons especially), rotor headings. Also Dynamic Type or 200 % text zoom, reduced motion, and contrast in both themes (phase 6).
- **Heavy data**: 60 fps scroll on long Transaction lists and Reports with 8+ months, on a mid-range phone.
- **Hover-only affordances**: the scan can't detect them. Phase 1b looks for them in the screenshots.
