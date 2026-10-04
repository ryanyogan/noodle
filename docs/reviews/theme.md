# Theme review: softer light, a custom dark (#75)

Phase 75a: an analysis of today's colour tokens and three directions for the Parent to choose from. Nothing in the app changes until one is picked. The rendered comparison (every direction in light and dark on a small This Month, with swatches and measured contrast) is `palettes.html`, made by the same script as the tables below, and attached to #75.

What the Parent asked for: "something subtle and easy on the eyes, not quite as bright or white. And for dark mode … It looks a little generic … something a little bit more custom in terms of the color thing."

## How this was measured

All numbers here come from a script (`palettes.py`, kept with the HTML in the session scratchpad and attached to #75). It reads `packages/ui/src/styles/globals.css`, counts where each token is used in `apps/web/src` and `packages/ui/src`, and measures:

- **Contrast** as WCAG 2.x relative luminance ratios. Soft badge fills (`--pace-soft`, `--over-soft`, `--brand-soft`) are composited onto `--card` first, the way the browser draws them.
- **Brightness** as relative luminance Y (white = 100%).
- **Bucket separation** as the smallest OKLab distance (x100) between any two of the eight Bucket colours, with normal vision and under Machado (2009) protan, deutan and tritan simulation at full severity. This is the same idea as the dataviz validator used in #2 and #64; the real validator run is part of phase 75c, before anything ships.

When a proposed colour missed AA, the script moved only its OKLCH lightness (hue and chroma kept) until it passed. Those changes are listed under "Nudges" and marked `*` in the token table.

## 1. The current tokens

Every colour-bearing custom property in `globals.css`. "Uses" counts Tailwind utilities (`bg-card`, `text-muted-foreground`, …), `var(--token)` and `--color-token` references outside `globals.css`; "Most in" names the files with the most uses. shadcn role names (`--primary`, `--muted`, `--ring`, …) are aliases onto the tokens above them, so their count is how often the alias itself is used.

| Token | Light | Dark | Uses | Files | Most in |
|---|---|---|---|---|---|
| `--background` | `#f4f5f7` | `#090c12` | 17 | 15 | kbd.tsx, transactions.$month.tsx, tooltip.tsx |
| `--card` | `#ffffff` | `#10141c` | 91 | 38 | scenario-outcomes.tsx, report-charts.tsx, review.index.tsx |
| `--surface-2` | `#f2f4f7` | `#161b25` | 92 | 47 | row-button.tsx, report-charts.tsx, toggle.tsx |
| `--surface-3` | `#e9ecf1` | `#1d2330` | 14 | 13 | budget-bar.tsx, tabs.tsx, switch.tsx |
| `--border` | `#e5e8ed` | `#1c2230` | 40 | 23 | chart.tsx, auth-page.tsx, review.index.tsx |
| `--border-strong` | `#d6dae1` | `#283041` | 28 | 20 | scenario-outcomes.tsx, month.$month.index.tsx, report-charts.tsx |
| `--foreground` | `#0e1525` | `#eceff4` | 153 | 71 | report-charts.tsx, toggle.tsx, scenario-outcomes.tsx |
| `--muted-foreground` | `#545e70` | `#a0a8b7` | 447 | 119 | report-views.tsx, explore.index.tsx, statements.tsx |
| `--subtle-foreground` | `#616a7c` | `#838b9c` | 66 | 37 | quick-add.tsx, scenario-outcomes.tsx, money-sections.tsx |
| `--brand` | `#3e63dd` | `#7c9bff` | 20 | 12 | auth-page.tsx, stepper.tsx, slider.tsx |
| `--brand-soft` | `rgb(62 99 221 / 0.1)` | `rgb(124 155 255 / 0.14)` | 12 | 10 | glossary.tsx, calendar.tsx, textarea.tsx |
| `--pace` | `#e0940a` | `#f5b23a` | 6 | 3 | affordability.tsx, budget-bar.tsx, plan-health.tsx |
| `--pace-soft` | `rgb(224 148 10 / 0.12)` | `rgb(245 178 58 / 0.14)` | 2 | 2 | payoff-goal.tsx, badge.tsx |
| `--pace-foreground` | `#8a5b06` | `#f5c46a` | 2 | 2 | payoff-goal.tsx, badge.tsx |
| `--over` | `#cc3d3d` | `#f07171` | 48 | 28 | scenario-outcomes.tsx, explore.index.tsx, report-charts.tsx |
| `--over-soft` | `rgb(204 61 61 / 0.1)` | `rgb(240 113 113 / 0.14)` | 11 | 10 | explore.index.tsx, textarea.tsx, select.tsx |
| `--over-foreground` | `#b42f2f` | `#f07171` | 14 | 11 | setup.tsx, dropdown-menu.tsx, alert.tsx |
| `--glow-1` | `rgb(62 99 221 / 0.07)` | `rgb(124 155 255 / 0.1)` | 0 | 0 | (aliased in globals.css only) |
| `--glow-2` | `rgb(242 162 12 / 0.05)` | `rgb(245 178 58 / 0.05)` | 0 | 0 | (aliased in globals.css only) |
| `--scrim` | `rgb(14 21 37 / 0.36)` | `rgb(0 0 0 / 0.6)` | 4 | 4 | styles.css, sheet.tsx, dialog.tsx |
| `--elevation-card` | `0 1px 2px rgb(14 21 37 / 0.04), 0 1px 1px rgb(14 21 37 / 0.02)` | `0 1px 2px rgb(0 0 0 / 0.4)` | 0 | 0 | (aliased in globals.css only) |
| `--elevation-pop` | `0 12px 32px -8px rgb(14 21 37 / 0.22), 0 2px 6px rgb(14 21 37 / 0.06)` | `0 16px 40px -8px rgb(0 0 0 / 0.7), 0 0 0 1px rgb(255 255 255 / 0.04)` | 0 | 0 | (aliased in globals.css only) |
| `--card-highlight` | `inset 0 0 0 0 transparent` | `inset 0 1px 0 rgb(255 255 255 / 0.03)` | 0 | 0 | (aliased in globals.css only) |
| `--bucket-1` | `#2a78d6` | `#3987e5` | 1 | 1 | scenario-outcomes.tsx |
| `--bucket-2` | `#a347ba` | `#c27ad6` | 1 | 1 | scenario-outcomes.tsx |
| `--bucket-3` | `#0e8fa8` | `#2aa3bd` | 0 | 0 | (aliased in globals.css only) |
| `--bucket-4` | `#008300` | `#2f9e3a` | 0 | 0 | (aliased in globals.css only) |
| `--bucket-5` | `#4a3aa7` | `#9085e9` | 0 | 0 | (aliased in globals.css only) |
| `--bucket-6` | `#138a5f` | `#199e70` | 0 | 0 | (aliased in globals.css only) |
| `--bucket-7` | `#9a5b2e` | `#c47a36` | 1 | 1 | scenario-outcomes.tsx |
| `--bucket-8` | `#cc4a80` | `#d55181` | 0 | 0 | (aliased in globals.css only) |
| `--chart-spend` | `#3a4659` | `#b9c2d0` | 15 | 5 | report-charts.tsx, report-views.tsx, scenario-outcomes.tsx |
| `--chart-income` | `var(--brand)` | `same` | 14 | 3 | scenario-outcomes.tsx, report-charts.tsx, report-views.tsx |
| `--chart-compare` | `#c9d0da` | `#323b4d` | 6 | 4 | report-views.tsx, report-charts.tsx, scenario-outcomes.tsx |
| `--chart-allowance` | `#8a94a6` | `#5c6679` | 4 | 2 | report-charts.tsx, month-glance.tsx |
| `--chart-net` | `var(--foreground)` | `same` | 2 | 1 | report-charts.tsx |
| `--chart-grid` | `var(--border)` | `same` | 9 | 2 | scenario-outcomes.tsx, report-charts.tsx |
| `--chart-mid` | `var(--surface-3)` | `same` | 1 | 1 | report-charts.tsx |
| `--chart-seq-1` | `color-mix(in oklab, var(--brand) 14%, var(--card))` | `same` | 1 | 1 | report-charts.tsx |
| `--chart-seq-2` | `color-mix(in oklab, var(--brand) 34%, var(--card))` | `same` | 2 | 2 | scenario-outcomes.tsx, report-charts.tsx |
| `--chart-seq-3` | `color-mix(in oklab, var(--brand) 60%, var(--card))` | `same` | 2 | 2 | report-views.tsx, report-charts.tsx |
| `--chart-seq-4` | `var(--brand)` | `same` | 2 | 2 | scenario-outcomes.tsx, report-charts.tsx |
| `--card-foreground` | `var(--foreground)` | `same` | 1 | 1 | card.tsx |
| `--popover` | `var(--card)` | `same` | 9 | 9 | select.tsx, scenario-outcomes.tsx, report-charts.tsx |
| `--popover-foreground` | `var(--foreground)` | `same` | 5 | 5 | select.tsx, popover.tsx, dropdown-menu.tsx |
| `--primary` | `var(--foreground)` | `same` | 20 | 12 | calendar.tsx, swipe-card.tsx, review.index.tsx |
| `--primary-foreground` | `var(--card)` | `same` | 11 | 9 | calendar.tsx, swipe-card.tsx, styles.css |
| `--secondary` | `var(--surface-2)` | `same` | 0 | 0 | (aliased in globals.css only) |
| `--secondary-foreground` | `var(--foreground)` | `same` | 0 | 0 | (aliased in globals.css only) |
| `--muted` | `var(--surface-2)` | `same` | 3 | 2 | chart.tsx, quick-add.tsx |
| `--accent` | `var(--surface-2)` | `same` | 0 | 0 | (aliased in globals.css only) |
| `--accent-foreground` | `var(--foreground)` | `same` | 0 | 0 | (aliased in globals.css only) |
| `--destructive` | `var(--over)` | `same` | 0 | 0 | (aliased in globals.css only) |
| `--input` | `var(--border-strong)` | `same` | 1 | 1 | explore.index.tsx |
| `--ring` | `var(--brand)` | `same` | 32 | 25 | review.index.tsx, toast.tsx, report-charts.tsx |

### Brightness and elevation today, against the proposals

| Palette | Page Y (light) | Card Y (light) | Page Y (dark) | Card Y (dark) | Card-vs-page ratio dark |
|---|---|---|---|---|---|
| Current | 91.3% | 100.0% | 0.36% | 0.69% | 1.06 |
| Warm paper | 86.6% | 94.8% | 0.62% | 1.05% | 1.08 |
| Soft stone | 86.7% | 95.2% | 0.71% | 1.16% | 1.08 |
| Tinted night | 87.2% | 95.6% | 0.64% | 1.08% | 1.08 |

### What is too bright in light mode

- **Every card is pure white** (`--card: #ffffff`, Y 100%) on a cool near-white page (`#f4f5f7`). The card is the brightest thing on the screen and there are a lot of cards, so the page reads as white with grey gaps. This is the "too bright, too white" the Parent noticed.
- **The step from page to card is carried by brightness, not tone.** Card-on-page is only about 1.09:1, so the card edge relies on `--border` and a faint shadow; making the card darker without changing the page would lose the step entirely. Each direction lowers both and keeps a gentle step.
- **`--surface-2` (`#f2f4f7`) is nearly the page colour** (`#f4f5f7`), so a surface-2 area inside a card looks like a hole through to the page rather than a layer.
- **The neutrals are cool blue-grey** (`--foreground #0e1525`, hue around 225 degrees). With pure white this gives the slightly clinical, "default SaaS" feel. Warmer or greener neutrals read as softer at the same contrast.

### What is generic in dark mode

- **Near-black base.** `--background #090c12` is about Y 0.4%. Material's guidance is to start from a dark grey (about `#121212`) rather than near-black, because shadows and elevation can't show on black and bright text on black glares (sources below).
- **The ramp is plain cool blue-grey with very low chroma.** It's what most dark themes ship (Tailwind slate, GitHub dark, shadcn's default) and is what reads as "generic".
- **Elevation steps are small and borders barely show.** `--border #1c2230` sits between `--surface-2` and `--surface-3`, so a border on a surface-2 area is almost invisible.
- **Accents are already desaturated and clear**: brand `#7c9bff`, pace `#f5b23a`, over `#f07171`. These are kept or lightly tuned in every direction.

### Already fine, and kept

- Text contrast passes AA everywhere in both modes today (see the ratio table).
- The Bucket palette was validated in #2 and #64 and every Bucket is at least 3:1 on the bar track. Every direction keeps the order and hues; only lightness moves, and only where the new track needed it.
- One token file, read through Tailwind utilities: the directions are value swaps only.

### Open points for 75b/75c

- **Input borders.** `--input` is `--border-strong`, which is well under 3:1 against the card in every palette (see "Input border on card"). Inputs here are identified by their fill, label and placeholder as well as the border, so this isn't failing WCAG 1.4.11 on its own, but a separate, darker `--input` token would be the safe choice when the palette changes.
- **The Pace marker** on the bar track is under 3:1 in light mode today and in the proposals (marigold on a pale track). The marker sits next to the "Ahead" text, so it isn't the only signal, but it's worth checking in 75c.
- **Screenshots** of every page in both modes (acceptance item 1) are deferred to the phase that can run the app; this phase ran no browser.

## 2. Research notes

- **Off-white, not white; dark grey, not black.** Material Design's dark theme uses `#121212` as its base "to express elevation and space", because shadows read on grey, and because light text on dark grey glares less than on black. ([Material Design: Dark theme](https://m2.material.io/design/color/dark-theme.html))
- **Elevation in dark mode is lighter surfaces, not shadows.** Material raises a surface by lightening it (`#121212` base, `#1E1E1E` at elevation 1, `#242424` at 2). Apple splits dark backgrounds into *base* and *elevated* sets, so a sheet or popover on top is lighter than what's behind it. ([Material](https://m2.material.io/design/color/dark-theme.html), [Apple HIG: Dark Mode](https://developers.apple.com/design/human-interface-guidelines/foundations/dark-mode/))
- **Desaturate accents for dark.** Saturated colours "vibrate" on dark backgrounds; Material desaturates primaries so they still pass 4.5:1. ([Material](https://m2.material.io/design/color/dark-theme.html))
- **Build ramps in a perceptual colour space.** Linear rebuilt its themes in LCH so equal lightness looks equally light across hues, and derives its whole theme from three inputs: a base colour, an accent and a contrast level. A tinted neutral ramp is exactly that: one base hue, low chroma, stepped lightness. ([Linear: How we redesigned the Linear UI](https://linear.app/now/how-we-redesigned-the-linear-ui), [Linear: A calmer interface](https://linear.app/now/behind-the-latest-design-refresh))
- **Stripe** rebuilt its colours with a perceptual model so each step had predictable contrast, and kept vivid hand-picked hues while meeting AA. Same method here: pick the hue for character, let the script settle the lightness. ([Stripe: Designing accessible color systems](https://stripe.com/blog/accessible-color-systems))
- **Warm off-whites are the calm-app default now.** Notion and others use warm paper tones (around `#f9f7f3`, `#faf7f2`) with a soft charcoal instead of near-black text, to cut glare on long sessions. ([Figma: Off-white](https://www.figma.com/colors/off-white/), [EnigmaEasel: palettes that reduce eye strain](https://enigmaeasel.com/color-palettes-that-reduce-eye-strain/))
- **Things, Bear and Apple's own apps** follow the same pattern: an off-white or lightly tinted base in light mode, and in dark mode a tinted (not neutral) near-black with a few clear elevation steps and one accent.

## 3. Three directions

All three keep the same structure (one page colour, a card a gentle step above it, surface-2 and surface-3 inside cards, two border weights, three text levels, one accent, Pace and Over), so any one is a token swap. In each, `--primary` is `--foreground`, `--primary-foreground` is `--card`, `--destructive` is `--over`, `--ring` is `--brand` and `--input` is `--border-strong`, as today.

### A. Warm paper (most change, most character)

Light is an off-white paper page (`#f3efe7`) with a cream card and warm ink instead of blue-black; nothing on screen is pure white. Dark is a lamp-lit desk: warm brown-blacks that step up clearly, with cream text. The blue accent stays, so Free to Spend, links and focus still read as Noodle. Risk: warm can read as "vintage" if pushed further; the chroma here is kept low.

### B. Soft stone (the quiet one)

Closest to today in feel. Light is a soft greige page and an off-white card with a faint sage cast, so it is calmer without looking cream. Dark swaps blue-black for a green-stone graphite with even elevation steps: neutral, but no longer the stock grey. Risk: the least "custom" of the three in dark mode.

### C. Tinted night (leans into the brand blue)

Takes the brand blue into the neutrals. Light is a cool mist page with a soft, not-white card. Dark is a deep indigo night, lifted off near-black, with clear elevation steps, so dark mode feels like Noodle's own colour rather than grey. Risk: light mode stays cool, so it answers "less bright" more than "softer".

### Token values

| Token | Warm paper light | Warm paper dark | Soft stone light | Soft stone dark | Tinted night light | Tinted night dark |
|---|---|---|---|---|---|---|
| `--background` | `#f3efe7` | `#15120e` | `#eff0ec` | `#121513` | `#eef0f6` | `#0f1220` |
| `--card` | `#fbf9f4` | `#1d1a15` | `#f9faf7` | `#191d1a` | `#f9fafd` | `#161a2b` |
| `--surface-2` | `#f0ebe2` | `#24201a` | `#ebede7` | `#202521` | `#eceef6` | `#1d2236` |
| `--surface-3` | `#e7e0d3` | `#2d2821` | `#e1e4dc` | `#282e29` | `#e2e5f0` | `#252b42` |
| `--border` | `#e5dfd3` | `#2b261f` | `#dfe2d9` | `#262c27` | `#dfe2ed` | `#242a3f` |
| `--border-strong` | `#d4cbba` | `#3c352b` | `#cbcfc4` | `#363d37` | `#cacfdf` | `#343b55` |
| `--foreground` | `#211d17` | `#f2ece2` | `#1a1e1b` | `#e9ede8` | `#141a2e` | `#eceef9` |
| `--muted-foreground` | `#5d5548` | `#b9ae9d` | `#535a54` | `#a7afa7` | `#50586f` | `#a6acc6` |
| `--subtle-foreground` | `#6b6254` | `#9a8f7f` | `#606761`* | `#8d968e`* | `#5d657c` | `#8b92ad`* |
| `--brand` | `#3b5ccc` | `#8fa5f7` | `#3e63dd` | `#7c9bff` | `#3a5bd9` | `#93a8ff` |
| `--pace` | `#cf8a0c` | `#f0b04a` | `#d98f0a` | `#f5b23a` | `#d98c06` | `#f5b23a` |
| `--pace-foreground` | `#85560a` | `#f3c477` | `#85590a` | `#f5c46a` | `#855709` | `#f6c66e` |
| `--over` | `#c23b32` | `#ee7b6e` | `#c93c3c` | `#f07171` | `#c73a45` | `#f47a80` |
| `--over-foreground` | `#a8322a` | `#f2897d` | `#b02f2f` | `#f38383` | `#ad2f3a` | `#f7888d` |
| `--chart-spend` | `#4a4237` | `#cdc1af` | `#3d4540` | `#bac3bb` | `#384260` | `#bdc4de` |
| `--chart-allowance` | `#988e7e`* | `#6f6656` | `#8a928b`* | `#626b63` | `#888fa6`* | `#5e6685`* |
| `--chart-compare` | `#d8cfbf` | `#3a342b` | `#cfd3ca` | `#333a34` | `#cdd2e1` | `#303751` |
| `--bucket-1` | `#2a78d6` | `#3987e5` | `#2a78d6` | `#3987e5` | `#2a78d6` | `#3987e5` |
| `--bucket-2` | `#a347ba` | `#c27ad6` | `#a347ba` | `#c27ad6` | `#a347ba` | `#c27ad6` |
| `--bucket-3` | `#058ca5`* | `#2aa3bd` | `#0b8ea7`* | `#2aa3bd` | `#0e8fa8` | `#2aa3bd` |
| `--bucket-4` | `#008300` | `#2f9e3a` | `#008300` | `#2f9e3a` | `#008300` | `#2f9e3a` |
| `--bucket-5` | `#4a3aa7` | `#9085e9` | `#4a3aa7` | `#9085e9` | `#4a3aa7` | `#9085e9` |
| `--bucket-6` | `#138a5f` | `#199e70` | `#138a5f` | `#199e70` | `#138a5f` | `#199e70` |
| `--bucket-7` | `#9a5b2e` | `#c47a36` | `#9a5b2e` | `#c47a36` | `#9a5b2e` | `#c47a36` |
| `--bucket-8` | `#cc4a80` | `#d55181` | `#cc4a80` | `#d55181` | `#cc4a80` | `#d55181` |

`*` the script moved this colour's lightness to reach AA (see Nudges).

### Nudges

- Warm paper light: `--bucket-3` `#0e8fa8` -> `#058ca5` (to reach 3:1)
- Warm paper light: `--chart-allowance` `#8e8474` -> `#988e7e` (to reach 3:1)
- Soft stone light: `--subtle-foreground` `#616862` -> `#606761` (to reach 4.5:1)
- Soft stone light: `--bucket-3` `#0e8fa8` -> `#0b8ea7` (to reach 3:1)
- Soft stone light: `--chart-allowance` `#868d87` -> `#8a928b` (to reach 3:1)
- Soft stone dark: `--subtle-foreground` `#889189` -> `#8d968e` (to reach 4.5:1)
- Tinted night light: `--chart-allowance` `#858ca3` -> `#888fa6` (to reach 3:1)
- Tinted night dark: `--subtle-foreground` `#8a91ac` -> `#8b92ad` (to reach 4.5:1)
- Tinted night dark: `--chart-allowance` `#636b8a` -> `#5e6685` (to reach 3:1)

### Contrast, key pairs (current and every direction)

"(fail)" marks a pair under its WCAG AA threshold. "(info)" rows have no fixed threshold and are listed to compare.

| Pair | Needs | Current L | Current D | Warm paper L | Warm paper D | Soft stone L | Soft stone D | Tinted night L | Tinted night D |
|---|---|---|---|---|---|---|---|---|---|
| Body text on page | 4.5:1 | 16.70 | 16.98 | 14.62 | 15.89 | 14.73 | 15.53 | 15.14 | 16.11 |
| Body text on card | 4.5:1 | 18.22 | 16.00 | 15.93 | 14.76 | 16.09 | 14.40 | 16.53 | 14.93 |
| Muted text on card | 4.5:1 | 6.54 | 7.71 | 6.98 | 7.93 | 6.78 | 7.58 | 6.78 | 7.67 |
| Muted text on surface-3 | 4.5:1 | 5.52 | 6.57 | 5.60 | 6.68 | 5.52 | 6.17 | 5.63 | 6.21 |
| Subtle text on page | 4.5:1 | 4.99 | 5.72 | 5.23 | 5.88 | 5.08 | 6.03 | 5.09 | 6.04 |
| Subtle text on surface-3 | 4.5:1 | 4.59 | 4.60 | 4.57 | 4.60 | 4.52 | 4.55 | 4.62 | 4.53 |
| Primary button text (card on foreground) | 4.5:1 | 18.22 | 16.00 | 15.93 | 14.76 | 16.09 | 14.40 | 16.53 | 14.93 |
| Brand text on card | 4.5:1 | 5.21 | 7.02 | 5.56 | 7.34 | 4.97 | 6.49 | 5.47 | 7.63 |
| Brand text on page | 4.5:1 | 4.77 | 7.45 | 5.10 | 7.91 | 4.55 | 6.99 | 5.01 | 8.23 |
| Pace badge text | 4.5:1 | 5.28 | 8.79 | 5.37 | 8.06 | 5.25 | 7.90 | 5.37 | 8.28 |
| Over badge text | 4.5:1 | 5.39 | 5.34 | 5.48 | 5.75 | 5.28 | 5.56 | 5.39 | 5.92 |
| Over text on card | 4.5:1 | 6.20 | 6.41 | 6.33 | 7.14 | 6.09 | 6.81 | 6.20 | 7.28 |
| Focus ring on page | 3:1 | 4.77 | 7.45 | 5.10 | 7.91 | 4.55 | 6.99 | 5.01 | 8.23 |
| Focus ring on card | 3:1 | 5.21 | 7.02 | 5.56 | 7.34 | 4.97 | 6.49 | 5.47 | 7.63 |
| Over bar on bar track | 3:1 | 4.12 | 5.47 | 4.03 | 5.35 | 3.89 | 4.83 | 4.05 | 5.28 |
| Worst Bucket on bar track | 3:1 | 3.22 | 3.99 | 3.02 | 3.70 | 3.00 | 3.52 | 3.03 | 3.54 |
| Worst Bucket on card | 3:1 | 3.81 | 4.67 | 3.77 | 4.40 | 3.68 | 4.32 | 3.65 | 4.37 |
| Allowance bar on card | 3:1 | 3.06 | 3.19 | 3.07 | 3.06 | 3.05 | 3.09 | 3.08 | 3.05 |
| Allowance bar vs spend bar | 3:1 | 3.12 | 3.22 | 3.06 | 3.19 | 3.09 | 3.05 | 3.08 | 3.26 |
| Spend bar on card | 3:1 | 9.54 | 10.26 | 9.39 | 9.78 | 9.44 | 9.42 | 9.51 | 9.96 |
| Pace marker on bar track (info) | - | 2.11 | 8.47 | 2.19 | 7.66 | 2.07 | 7.48 | 2.17 | 7.53 |
| Input border on card (info) | - | 1.40 | 1.40 | 1.53 | 1.43 | 1.51 | 1.53 | 1.49 | 1.56 |
| Card vs page step (info) | - | 1.09 | 1.06 | 1.09 | 1.08 | 1.09 | 1.08 | 1.09 | 1.08 |

### Bucket colour-blind separation

The smallest OKLab distance (x100) between any two Bucket colours, and which pair it is. Higher is better; the point is that no direction is meaningfully worse than today. Dark Buckets are unchanged in every direction, so their numbers match today's.

| Palette | Mode | Normal | Protan | Deutan | Tritan |
|---|---|---|---|---|---|
| Current | light | 8.5 (bucket-4/bucket-6) | 7.4 (bucket-4/bucket-6) | 1.7 (bucket-4/bucket-7) | 3.2 (bucket-1/bucket-3) |
| Current | dark | 6.4 (bucket-4/bucket-6) | 1.9 (bucket-1/bucket-5) | 1.6 (bucket-6/bucket-8) | 1.5 (bucket-4/bucket-6) |
| Warm paper | light | 8.5 (bucket-4/bucket-6) | 7.4 (bucket-4/bucket-6) | 1.7 (bucket-4/bucket-7) | 2.7 (bucket-1/bucket-3) |
| Warm paper | dark | 6.4 (bucket-4/bucket-6) | 1.9 (bucket-1/bucket-5) | 1.6 (bucket-6/bucket-8) | 1.5 (bucket-4/bucket-6) |
| Soft stone | light | 8.5 (bucket-4/bucket-6) | 7.4 (bucket-4/bucket-6) | 1.7 (bucket-4/bucket-7) | 3.0 (bucket-1/bucket-3) |
| Soft stone | dark | 6.4 (bucket-4/bucket-6) | 1.9 (bucket-1/bucket-5) | 1.6 (bucket-6/bucket-8) | 1.5 (bucket-4/bucket-6) |
| Tinted night | light | 8.5 (bucket-4/bucket-6) | 7.4 (bucket-4/bucket-6) | 1.7 (bucket-4/bucket-7) | 3.2 (bucket-1/bucket-3) |
| Tinted night | dark | 6.4 (bucket-4/bucket-6) | 1.9 (bucket-1/bucket-5) | 1.6 (bucket-6/bucket-8) | 1.5 (bucket-4/bucket-6) |

**A finding about today's palette, not the directions:** under deutan simulation (and, in dark mode, protan and tritan too) the closest pair is very close by this all-pairs measure. Buckets are never told apart by colour alone in Noodle (every bar and legend entry carries the Bucket's name), and the #2/#64 validation may have scored adjacent pairs rather than all pairs, so this isn't necessarily a regression. It should be re-checked with the real dataviz validator in 75c, whichever direction is picked.

## 4. Next

- **75b:** the Parent picks one (or asks for a mix, say Warm paper light with Tinted night dark).
- **75c:** implement it through the tokens only, re-run the dataviz validator on the Bucket and chart palettes in both modes, set `theme-color` and the iOS status bar per mode, add the hard-coded-colour check, axe colour-contrast on every page in both modes, screenshot baselines, an ADR and the token docs in COMPONENTS.md.
