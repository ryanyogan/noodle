# Quick Add without scrolling: a few likely Buckets, and search for the rest

Status: accepted, built (77b–77e) (#77).

## Why

Quick Add shows the amount, then **every** Bucket the Parent may spend from as a 2-column grid of tiles (`BucketPick` in `apps/web/src/components/quick-add.tsx`), ordered by `likelyBucketOrder` (`packages/domain/src/likely.ts`), then For, then the note. On a phone the keypad sits in the footer. A real Household has 15–30 Buckets plus a Personal Allowance, so the grid runs to 8–15 rows: the Parent scrolls down past the amount to find a Bucket, and on a phone the keypad takes about half the height. The Parent: "there's a lot of scrolling required… on mobile, it's even more complex."

## What Quick Add does today

- **Open:** `?sheet=quick-add` over any screen (Back closes it), the tab bar's button, or `q` on a keyboard. Focus goes to the sheet, not the note, so the phone keyboard stays down.
- **Amount:** the on-screen keypad (phones, `lg:hidden`) or digits, `.` and Backspace on a hardware keyboard. Five whole digits at most. What's typed survives a stray close (`draft`).
- **Bucket:** tapping a tile **is** the save. There's no separate Save button. With no amount the sheet shakes. A double tap counts once (the ULID).
- **Fill-ins:** Snap and Speak (`SnapAndSpeak`) can fill in the amount, note, For and a `suggested` Bucket, which goes first, full width, marked "Suggested". A snapped Receipt dates the entry and picks that month's Buckets (or today's, if that month has no Plan).
- **Who may spend:** only `canAssign(bucket, parentId)` Buckets, so never the other Parent's Personal Allowance (ADR-0003).
- **Data for prediction today:** `bucketUsesQuery()` → `getBucketUses` → `loadBucketUses(db, viewer, since)` gives `{ bucketId, date }` per past use, scored with a 14-day half-life. Ties keep the Plan's order. Nothing uses the note, the time of day, Rules or merchants yet.
- **Data that exists but isn't used here:** Rules (`rules.pattern` is a `merchantKey`, matched as whole words by `ruleFor`, longest first, with a Parent's private Rule winning; ADR-0030); learned filing (a correction or confirmation learns its merchant, `settleCategorization`); `transactions.merchant` clean names and `merchantKey()`. The time of day can come from `transactions.created_at` in the Household's time zone. Location is never asked for, and this design doesn't ask either.

## Research: what other apps do

- **YNAB (mobile):** fills in the payee's default category, then **suggests the next five categories recently used with that payee**, above the full list. There are no suggestions for a new payee or a payee only ever used with one category. The rest is a long list you scroll, with search. → *Merchant-first prediction, five choices, everything else behind it.* ([YNAB: Categorizing Transactions](https://support.ynab.com/en_us/categorizing-transactions-a-guide-HyRl60sks), [Adding Transactions](https://support.ynab.com/en_us/how-to-add-transactions-in-ynab-HyDwA_byi))
- **Copilot Money:** a manual transaction starts with a default category that you tap to change. After about 30 reviewed transactions, "Copilot Intelligence" suggests the category from past reviews, and **name rules** file by merchant. → *Predict one, make changing it one tap, learn from corrections.* ([Creating Manual Transactions](https://help.copilot.money/en/articles/4038706-creating-manual-transactions), [Transactions FAQ](https://help.copilot.money/en/articles/10761907-transactions-faq), [Name Rules](https://help.copilot.money/en/articles/3971270-creating-name-rules))
- **Toshl:** amount first, then a **grid of category squares** (sorted alphabetically). Tags are then ordered by how often they go with the chosen category. → *A grid works for 10–15 choices. Alphabetical order doesn't predict anything.* ([Toshl iOS](https://toshl.com/blog/how-to-track-expenses-incomes-and-transfers-ios/), [Toshl web](https://toshl.com/blog/how-to-track-expenses-incomes-and-transfers-web-app/))
- **Monarch:** categories sit in **groups** (a group header with categories under it), and you pick from a searchable dropdown. → *Sections in the long list.* ([Monarch: Categories and Groups](https://help.monarch.com/hc/en-us/articles/360048883771-Creating-Custom-Categories-and-Groups))
- **Spendee:** like Toshl, a category grid after the amount (from memory; there's no help page for it). Same lesson.
- **Raycast:** with no query, it shows a **ranked list of recent items**. Typing does **fuzzy matching** on titles, subtitles and keywords. The ranking goes: exact alias, alias prefix, fuzzy title, keywords, then **frecency** (how often and how recently). It also learns which result you pick for a given query. A good rule from palette write-ups: apply frecency only to the empty query, so learned order never fights the search. ([Raycast fuzzy search](https://www.raycast.com/changelog/1-40-0), [Raycast search bar](https://manual.raycast.com/search-bar), [command palette teardowns](https://www.setproduct.com/blog/command-palette-ui-design-guide))
- **Linear:** a keyboard-first palette. ↑/↓ moves the highlight and Enter acts. Once a palette has depth (a nested page), Back is a different key from close. ([teardowns](https://www.setproduct.com/blog/command-palette-ui-design-guide))
- **Apple HIG sheets:** use medium and large detents, with a grabber. Keep a sheet's navigation inside the sheet, so swipe-to-dismiss still works. **Material bottom sheets:** a modal sheet spans the width on phones; on large screens a dialog or menu often fits better than a bottom sheet. ([Material bottom sheets](https://m2.material.io/components/sheets-bottom), [Android bottom sheets](https://developer.android.com/develop/ui/compose/components/bottom-sheets), [Apple HIG via WWDC25](https://developer.apple.com/videos/play/wwdc2025/356/))

What the apps share: **a handful of predicted choices (YNAB shows 5), driven first by the merchant, then by recency, and a searchable, sectioned list for the rest.** Nobody makes you scroll a 30-item grid to file a common purchase.

## Decision

### 1. Six cells, fixed: five likely Buckets plus "More Buckets"

- The Bucket area is always a **2 × 3 grid of 6 cells**: the 5 most likely Buckets, then a **More Buckets** tile, at a fixed height, so nothing below it jumps. With 6 or fewer Buckets, all of them show and there's no More tile.
- Each tile is at least 48px tall, wider than 44px, and keeps today's look (monogram, name, "$N left").
- A `suggested` Bucket (from Snap or Speak) still takes a full row, marked "Suggested", then 3 likely Buckets and More: still 3 rows.
- Tapping a tile still **is** the save. That one tap is the "Save" the E2E checks measure.

### 2. How the top five are chosen (`quickAddChoices` in `packages/domain/src/likely.ts`)

This is a pure function, unit-tested. It takes the Buckets the Parent may spend from (`canAssign`), uses, Rules, the note, now (DayKey + hour in the Household's time zone) and `suggested`. Each step only reorders the Buckets the step before left tied, or pins one to the top:

1. **Suggested** (Snap/Speak) is first, as today.
2. **A Rule for the note's merchant:** run `ruleFor(rules, merchantKey(note))`. If it names one of these Buckets, that Bucket is pinned first, with the hint "From your Rule". A Rule into a Commitment is ignored (Quick Add files to Buckets only).
3. **Learned filing:** past uses whose `merchantKey` matches the note's. The most-used Bucket for that merchant is pinned next (YNAB's payee categories).
4. **Frecency:** today's score (each use counts 0.5^(age/14 days)), times **1.5 for a use within ±2 hours of now** (coffee in the morning, takeout at night). The boost is small on purpose, so a weekly habit can't beat a daily one.
5. **Ties** keep the Plan's order, so a new Household sees its Plan order.

**Steadiness:** the five only reorder when the note changes (debounced 150 ms) or a fill-in arrives. They never reorder within 400 ms after a pointerdown on the grid, so a tile can't jump away from a finger. Reordering moves tiles (a FLIP animation, off under reduced motion). There's no location signal; if location is ever allowed, it would be one more factor in step 4.

**Data:** `loadBucketUses` adds `hour` (from `created_at` in the Household's time zone) and `merchant` (`merchantKey` of `transactions.merchant ?? note`, or null) to each `BucketUse`, covering the same viewer and the same window. A new `quickAddRulesQuery()` returns the viewer's visible Rules that file to a Bucket (only their own private Rules, as `loadRules` already does for the viewer). Both are cached with TanStack Query (ADR-0006) and loaded before the sheet opens.

### 3. More Buckets: one searchable, sectioned list (phone), and type-to-filter (desktop)

- **Phone:** More Buckets opens a **page inside the same sheet**, not a second dialog. The sheet goes to its large detent, with a back arrow ("Back to Quick Add") and the search field focused, so the keyboard comes up. The list sits above the keyboard and scrolls inside itself. Sections: **Household**, then **My Personal Allowance**. Commitments are left out; Quick Add doesn't file to them (that would be its own ticket). Each row is 48px: monogram, name, "$N left".
- **Matching** (`matchBuckets(query, buckets, rules)`, pure): word-prefix matches on the name first ("gro" → Groceries), then substring, then **Rule patterns** ("costco" → Groceries, "via your Costco Rule"). A Bucket whose words match out of order also counts ("sup pet" → Pet supplies). There's no fuzzy library. With an empty query, the list shows every Bucket, likely first (frecency on the empty query only, as Raycast does).
- **Picking** a row: with an amount typed, it saves right away, as a tile does. With no amount, it goes back to the main page with that Bucket in the first cell, marked "Picked". The amount then saves to it with one more tap.
- Any Bucket is reachable in 2 taps (More → row), or with a few letters of search.

### 4. The note moves up and steers the Buckets

The note field (now "Where or what? (optional)") moves **above** the grid, under the amount, with the Snap and Speak buttons inline at its right end. Typing in it reorders the five (step 2 and 3 above): "costco" puts Groceries first. Its keyboard Enter still just closes the keyboard. For becomes a one-line control under the grid ("For: Everyone ▾"), with the same `ForPicker` inside a popover. On a phone with the keyboard up, the keypad steps aside as today. Header, amount, note and grid stay above the keyboard (about 310px at 375×667 with a 300px keyboard).

### 5. Phone layout (375 × 667)

```
┌───────────────────────────────────┐  ← sheet top (large detent, 8px below status bar)
│ ═══            Quick Add       ✕ │ 44
│                                   │
│              $ 24.50              │ 56   output aria-label="Amount"
│        Tap a Bucket to add it     │ 18
│ ┌───────────────────────┐ 📷 🎤  │ 44   note: "Where or what? (optional)"
│ │ Costco                │        │
│ └───────────────────────┘        │
│ Add to                            │ 16
│ ┌──────────────┐┌──────────────┐ │
│ │GR Groceries  ││DI Dining out │ │ 48   From your Rule ↑
│ │  $312 left   ││  $88 left    │ │
│ ├──────────────┤├──────────────┤ │
│ │GA Gas        ││KI Kids       │ │ 48
│ │  $140 left   ││  $60 left    │ │
│ ├──────────────┤├──────────────┤ │
│ │HO Household  ││ ⋯ More       │ │ 48   More Buckets (25 more)
│ │  $95 left    ││   Buckets    │ │
│ └──────────────┘└──────────────┘ │
│ For: Everyone ▾                   │ 36
├───────────────────────────────────┤
│   1    │    2    │    3           │
│   4    │    5    │    6           │ 4 × 50 = 200   keypad (unchanged)
│   7    │    8    │    9           │
│   .    │    0    │    ⌫           │
└───────────────────────────────────┘  ≈ 44+56+18+44+16+160+36+200+gaps(~60) ≈ 634 ≤ 659
```

More Buckets (same sheet, large detent, keyboard up):

```
┌───────────────────────────────────┐
│ ‹ Quick Add     More Buckets   ✕ │
│ ┌───────────────────────────────┐ │
│ │ 🔍 Find a Bucket   pet        │ │  search, focused
│ └───────────────────────────────┘ │
│ HOUSEHOLD                         │
│ PE  Pet supplies        $40 left  │ 48
│ PE  Pets — vet          $200 left │ 48
│ MY PERSONAL ALLOWANCE             │
│   (no match)                      │
├───────────────────────────────────┤
│        on-screen keyboard         │
└───────────────────────────────────┘
```

### 6. Desktop layout (1280 × 720), keyboard first

On `lg` and up, Quick Add stays the app's right-hand Sheet (same Back and URL behaviour as today, and the same focus rules as the `sheet-focus` spec), about 440px wide. The Bucket area is a **combobox**: a "Find a Bucket" input over a listbox of at most **6 rows** (the likely five plus "More…", or up to 6 matches). It's fixed at 6 × 44px. With more matches than fit, the listbox scrolls inside itself; the sheet never scrolls.

```
┌──────────────────────────────── 1280 ────────────────────────────────┐
│ sidebar │ page underneath (dimmed)          │ Quick Add            ✕ │
│         │                                   │                        │
│         │                                   │        $ 24.50         │
│         │                                   │  Enter adds it to the  │
│         │                                   │  highlighted Bucket    │
│         │                                   │ Where or what?         │
│         │                                   │ [Costco            ]📷 │
│         │                                   │ Bucket                 │
│         │                                   │ [🔍 Find a Bucket    ] │
│         │                                   │ ▶ GR Groceries $312 ← │ highlighted (aria-activedescendant)
│         │                                   │   DI Dining out  $88   │
│         │                                   │   GA Gas        $140   │
│         │                                   │   KI Kids        $60   │
│         │                                   │   HO Household   $95   │
│         │                                   │   ⋯ 25 more — type to  │
│         │                                   │     find               │
│         │                                   │ For: Everyone ▾        │
│         │                                   │ [ Add $24.50 to        │
│         │                                   │   Groceries ]          │ ≈ 560px total, within 720
└──────────────────────────────────────────────────────────────────────┘
```

On desktop, an explicit **Add button** follows the highlighted Bucket ("Add $24.50 to Groceries"), because a row click and Enter both need a visible target. Clicking a row still adds straight away.

**Keyboard flow** (no mouse):

| Key | Does |
|---|---|
| `q` (anywhere but a field or dialog) | Opens Quick Add (unchanged) |
| digits, `.`, Backspace (no field focused) | Type the amount (unchanged) |
| any letter (no field focused) | Focuses "Find a Bucket" with that letter typed |
| ↑ / ↓ | Move the highlight in the list (also from the note field) |
| Enter (in Find, note, or no field) | Adds the amount to the highlighted Bucket; with no amount it shakes |
| Tab / Shift-Tab | amount → note → Find → list → For → Add |
| Esc | In Find with text: clears it. Otherwise closes Quick Add (keeping the draft, as today) |

So `q 2 4 . 5 Enter` files $24.50 to the most likely Bucket, and `q 1 2 p e t Enter` files $12 to Pet supplies.

### 7. What stays the same

The `?sheet=quick-add` URL and Back. `q`. The draft that survives a close. Tap-a-Bucket-to-save on a phone. Snap and Speak, and how a Receipt dates the entry (and the "that month has no Plan" fallback). `canAssign` and Personal Allowance privacy (the other Parent's never shows in tiles, search or Rule hints; their private Rules never reach this viewer). The ULID retry and optimistic save (`useQuickAdd`). The keypad and its keyboard-up behaviour. The empty "Add a Bucket to your Plan first" state.

### 8. E2E and other checks

A new `e2e/quick-add-many.spec.ts` uses a **30-Bucket Household** (plus both Personal Allowances) seeded through a fixture, with seeded uses and a Rule `costco → Groceries`:

1. **375×667, no scroll:** type an amount on the keypad. The bounding boxes of the Amount output, the first tile, the More tile and the keypad all sit inside the viewport. The sheet's scroll container has `scrollHeight <= clientHeight`. Tap the first tile, and it's saved.
2. **1280×720, no scroll:** the same with the Amount, the highlighted option and the Add button.
3. **Search finds a Bucket outside the five:** phone (More → "pet" → Pet supplies → saved to it), and desktop (type "pet", Enter).
4. **Keyboard only on desktop:** `q`, `2`, `4`, `p e t`, ↓, Enter saves to the second match. Esc clears, then closes. No mouse events.
5. **The note reorders:** type "Costco", and Groceries is first with "From your Rule".
6. **Privacy:** signed in as one Parent, the other's Personal Allowance appears in neither the five nor search.
7. **axe** on the main sheet and on the More page (phone) and the combobox (desktop).
8. **Screenshot baselines** at 393 and 1440 wide, made on CI's Linux (like `shell.spec.ts-snapshots`).
9. `quick-add.spec.ts` still passes. Its "Buckets are offered most likely first" test now reads the five plus More. `sheet-phone`, `sheet-focus`, `snap-and-speak` and `phone-keyboard` still pass.

Unit tests in `likely.test.ts` cover each ranking step, the time-of-day boost, steadiness inputs, `matchBuckets` (prefix, substring, out-of-order words, Rule pattern) and a private Rule winning.

## Alternatives considered

- **A centered command palette on desktop** (Raycast/Linear style, a floating box near the top). It's the fastest feel, but it differs from every other sheet: its own Back/URL handling, focus trap, `sheet-focus` and `sheet-leave` specs, and the Snap/Speak layout. The combobox inside the existing Sheet gives the same keys (letters filter, ↑/↓, Enter) with none of that cost. We can revisit if the Sheet feels heavy.
- **Bucket first, then amount** (pick from a grouped list, then a keypad page). It suits apps whose list is the main screen, but it puts a 30-item choice in front of every entry and loses "type an amount, tap the obvious Bucket" (two moves). It also breaks `q 2 4 Enter`.
- **Keep every Bucket, but in a horizontally scrolling strip or smaller tiles.** That's still scrolling (sideways), smaller targets go under 44px, and it hides "what's likely".

## Implementation phases (each about 30 tool calls)

- **77b: ranking and data, no UI.** `quickAddChoices` and `matchBuckets` in `packages/domain/src/likely.ts`, with unit tests. `BucketUse` gains `hour` and `merchant` (`loadBucketUses`, plus a DB test). `getQuickAddRules`, a server function returning the viewer's Bucket Rules, plus `quickAddRulesQuery`. `quick-add.tsx` uses `quickAddChoices` for its order (the UI is unchanged). Bun unit tests and typecheck.
- **77c: phone layout.** The 2 × 3 grid with More, the note moved up with Snap/Speak inline, For as a one-line popover, fixed heights, and steadiness (debounce, pointerdown freeze, FLIP). The More page inside the sheet, with search, sections and pick behaviour. Update `quick-add.spec` and `sheet-phone`, and run them locally at 1–2 workers.
- **77d: desktop combobox and keys.** The listbox (`role=combobox`/`listbox`, `aria-activedescendant`), letters → Find, ↑/↓, Enter, Esc order, and the Add button. The note's reordering shows "From your Rule". Run `sheet-focus`, `quick-add` and `keyboard` locally.
- **77e: guard.** The 30-Bucket fixture, `quick-add-many.spec.ts` (checks 1–7), baselines at 393 and 1440 (on CI), notes in `docs/reviews/mobile.md` and `desktop.md`, and the CONTEXT.md Quick Add entry updated ("the five likely Buckets, More Buckets"). Push once to CI when green.
