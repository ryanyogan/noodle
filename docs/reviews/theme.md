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

## 5. Phase 75b: Warm paper applied

The Parent picked **Warm paper** for both light and dark (#75). What changed:

- **`globals.css`**: every value in the Warm paper columns above, light and dark, under the same token names: surfaces, borders, the three text levels, brand, Pace, Over, `--chart-spend`, `--chart-compare`, `--chart-allowance`, and light `--bucket-3` (`#058ca5`). The other Buckets are unchanged. The tints that are built from those colours follow them: `--brand-soft`, `--pace-soft`, `--over-soft` and the two page glows keep their old opacity on the new colour; light `--scrim` and the light shadows use the warm ink (`rgb(33 29 23 / …)`) instead of blue-black; dark `--scrim` is a warm black, and the dark pop outline and card highlight are a warm white at the same low opacity. Aliases (`--primary`, `--ring`, `--input`, the chart aliases) are unchanged, so they follow.
- **Browser bar**: `theme-color` in `routes/__root.tsx` is `#f3efe7` in light and `#15120e` in dark (the page colour of each), and the manifest's `theme_color` and `background_color` are `#f3efe7`. The iOS `apple-mobile-web-app-status-bar-style` stays `black-translucent`: the page draws under the status bar, so the bar shows the page's own colour in both modes.
- **Hard-coded colours**: outside `globals.css` the app had none in components or pages. The ones left on purpose: `public/favicon.svg` (the mark, which can't read CSS variables; its colours are the logo's), and `server/email/templates.ts` (email HTML can't use the app's CSS; its brand blue `#3e63dd` and grey are the email's own). Both are for 75c's colour lint to allow by name.
- **Screenshots**: Playwright's per-pixel threshold (0.2) is wider than the step from the old cool tones to Warm paper, so `--update-snapshots=changed` kept the old images while passing. Every baseline was rewritten with `--update-snapshots=all` so the stored images show the new palette.

Left for 75c: the dataviz validator on the Bucket and chart palettes in both modes; a separate, darker `--input` token (input border on card is 1.53:1 light, 1.43:1 dark); the Pace marker on the track in light (2.19:1, next to the "Ahead" words); the hard-coded-colour lint; axe on every page in both modes; an ADR.

## 6. Phase 75c: finishing Warm paper

Decision recorded in ADR-0034 (Warm paper, and every colour through a token).

- **`--input`** is its own token now, no longer `--border-strong`: `#8f8574` light (3.46:1 on the card, 3.06 on surface-2, 3.17 on the page) and `#7a705f` dark (3.56, 3.32, 3.83). Input, Select and Textarea draw their border with `border-input`; Select's hover goes to `muted-foreground` so it still darkens.
- **Pace** in light is `#a86c06` (was `#cf8a0c`): 3.32:1 on the bar track (`--surface-3`, was 2.19) and 4.15 on the card. `--pace-soft` and the second page glow follow it. Dark Pace is unchanged (7.66 on the track).
- **Dataviz validator** (`validate_palette.js`, adjacent pairs, against the card). Before: light failed colour-blind separation (Bucket 2 `#a347ba` against Bucket 3, deutan 5.3); dark failed it (Bucket 2 `#c27ad6` against Bucket 1, protan 3.1) and the lightness band (Bucket 2 at L 0.689). Only Bucket 2 changed, order kept: light `#8e3fa8`, dark `#a95cc0`. After: every check passes in both modes; the worst colour-blind pair is in the 6–8 warning band (light Bucket 6 and 7, deutan 6.1; dark Bucket 1 and 2, deutan 6.5; dark tritan 6.4), which is allowed because every Bucket's name sits beside its colour.
- **Chart palette** (spend ink, income brand, allowance grey): colour-blind separation and contrast pass in both modes (worst 22.6 light, 15.6 dark). Spend and allowance fail the validator's chroma and lightness checks because they are neutrals on purpose, not categorical hues.
- **Hard-coded colours**: `apps/web/src/hard-coded-colours.test.ts` fails on a written colour under `apps/web/src` or `packages/ui/src` outside `globals.css`. Allowed by name, with reasons: the theme-color metas in `__root.tsx`, the email templates, the logo's dot, Recharts' default-stroke selectors in `chart.tsx`, and three AI files whose `#0482` are store numbers.
- **Still to do**: axe on every page in both modes (see the 75c handoff for the runs), screenshot baselines after these token changes (`--update-snapshots=all`), and warming the favicon and the email brand.

## 7. Phase 75e: Soft stone replaces Warm paper

On 2026-10-04 the Parent chose **Soft stone** (direction B) for both modes, after using Warm paper: the quiet one, less cream. Recorded in ADR-0036; ADR-0034's token rules are unchanged.

- **`globals.css`**: every Soft stone value from the table in section 3, light and dark, including its nudges (`--subtle-foreground`, `--chart-allowance`). The tints follow their colours at the same opacity (`--brand-soft`, `--pace-soft`, `--over-soft`, the page glows); the light scrim and shadows use the stone ink (`rgb(26 30 27 / …)`); the dark scrim is a green-black and the dark pop outline and card highlight are the stone text colour at the same low opacity.
- **The fixes Warm paper got after its proposal, worked out again for Soft stone** (same method: only OKLCH lightness moves):
  - `--input`: `#83877d` light, `#6a716b` dark (the proposal's `--border-strong` was 1.51 and 1.53 on the card).
  - Light `--pace`: `#d98f0a` -> `#b46c00` (2.07 -> 3.21 on the bar track). Dark Pace unchanged.
  - `--bucket-2`: the validated `#8e3fa8` light and `#a95cc0` dark are kept.
  - Light `--bucket-3`: `#0b8ea7` -> `#038ca5` (3.00 -> 3.08 on the track, so it isn't sitting on the line).
- **Two more, found by measuring text on every surface, not only the card**: light `--brand` `#3e63dd` -> `#3c60da` (on surface-2 4.41 -> 4.59, on its soft fill 4.35 -> 4.53) and light `--over` `#c93c3c` -> `#c43738` (on the page 4.37 -> 4.64, on surface-2 4.24 -> 4.51).
- **Browser bar**: `theme-color` is `#eff0ec` light and `#121513` dark; the manifest's `theme_color` and `background_color` are `#eff0ec`.

### Measured contrast, as shipped

WCAG 2.x ratios from a script over the shipped values; soft badge fills are composited on the card first. Nothing is under its threshold.

| Pair | Needs | Soft stone light | Soft stone dark |
|---|---|---|---|
| Body text on page | 4.5:1 | 14.73 | 15.53 |
| Body text on card | 4.5:1 | 16.09 | 14.40 |
| Body text on surface-2 | 4.5:1 | 14.29 | 13.16 |
| Muted text on card | 4.5:1 | 6.78 | 7.58 |
| Muted text on page | 4.5:1 | 6.20 | 8.17 |
| Muted text on surface-2 | 4.5:1 | 6.02 | 6.92 |
| Muted text on surface-3 | 4.5:1 | 5.52 | 6.17 |
| Subtle text on card | 4.5:1 | 5.55 | 5.59 |
| Subtle text on page | 4.5:1 | 5.08 | 6.03 |
| Subtle text on surface-2 | 4.5:1 | 4.93 | 5.11 |
| Subtle text on surface-3 | 4.5:1 | 4.52 | 4.55 |
| Primary button text (card on foreground) | 4.5:1 | 16.09 | 14.40 |
| Brand text on card | 4.5:1 | 5.17 | 6.49 |
| Brand text on page | 4.5:1 | 4.73 | 6.99 |
| Brand text on surface-2 | 4.5:1 | 4.59 | 5.93 |
| Brand text on its soft fill | 4.5:1 | 4.53 | 5.14 |
| Pace badge text | 4.5:1 | 5.07 | 7.90 |
| Over badge text | 4.5:1 | 5.25 | 5.56 |
| Over text on card (`--over-foreground`) | 4.5:1 | 6.09 | 6.81 |
| Over (`--over`) as text on card | 4.5:1 | 5.07 | 5.93 |
| Over (`--over`) as text on page | 4.5:1 | 4.64 | 6.39 |
| Over (`--over`) as text on surface-2 | 4.5:1 | 4.51 | 5.42 |
| Focus ring on page | 3:1 | 4.73 | 6.99 |
| Focus ring on card | 3:1 | 5.17 | 6.49 |
| Over bar on bar track | 3:1 | 4.13 | 4.83 |
| Worst Bucket on bar track | 3:1 | 3.08 | 3.29 |
| Worst Bucket on card | 3:1 | 3.78 | 4.04 |
| Allowance bar on card | 3:1 | 3.05 | 3.09 |
| Allowance bar vs spend bar | 3:1 | 3.09 | 3.05 |
| Spend bar on card | 3:1 | 9.44 | 9.42 |
| Pace marker on bar track | 3:1 | 3.21 | 7.48 |
| Input border on card | 3:1 | 3.50 | 3.40 |
| Input border on surface-2 | 3:1 | 3.11 | 3.11 |
| Input border on page | 3:1 | 3.20 | 3.67 |
| Card vs page step (info) | - | 1.09 | 1.08 |

### Dataviz validator, as shipped

`validate_palette.js`, adjacent pairs, against the Soft stone card of each mode.

- **Buckets, light** (`#f9faf7`): lightness band, chroma floor, normal-vision floor (worst 15.7, Bucket 7 and 8) and contrast all pass; colour-blind separation is in the 6–8 warning band (worst Bucket 6 and 7, deutan 6.1; tritan 7.7).
- **Buckets, dark** (`#191d1a`): all pass; colour-blind separation in the warning band (worst Bucket 1 and 2, deutan 6.5; tritan 6.4); normal-vision worst 15.3 (Bucket 7 and 8).
- The warning band is allowed for the reason ADR-0034 gives: a Bucket's name is always beside its colour.
- **Chart palette** (spend, income, allowance): colour-blind separation and contrast pass (worst 21.7 light, 17.3 dark). Spend and allowance fail the chroma and lightness checks because they are neutrals on purpose, as before.

### Screenshots

The baselines under `apps/web/e2e/*-snapshots/` were replaced with the images CI drew in Soft stone with `--update-snapshots=all` in a one-off job on the `ci-75` branch, since the specs pass against the old images (ADR-0034, rule 6). Looked at before they went in: This Month (desktop light and dark, phone dark), Household settings (phone light), Reports (desktop light), setup Buckets (desktop dark, phone light) and sign-in (desktop light, phone dark).

## 8. Phase 83b: Indigo replaces Soft stone

On 2026-10-04 the Parent chose **Indigo** from the three Linear-style directions of #83 (Indigo, Violet, Ink). Recorded in ADR-0038, which supersedes ADR-0036; ADR-0034's token rules are unchanged.

- **`globals.css`**: every colour token, light and dark, takes Indigo's value. Bucket colours are the same validated set. The tints follow their colours (`--brand-soft` 10% light and 16% dark, `--pace-soft`, `--over-soft`); the light scrim and shadows use the new ink (`rgb(22 23 26 / …)`); the dark scrim is black and the dark pop outline and card highlight are white at low opacity.
- **The main button is the accent**: `--primary` is `var(--brand)` light and `#5a64d6` dark, `--primary-foreground` is `#ffffff`, and the new `--primary-hover` is 12% towards the ink (light) or the page (dark), so hover only darkens the fill. The Button and the sign-in button use it; before, hover mixed `--primary` with `--brand`, which are now one colour in light.
- **Flat ground**: `--glow-2` is `transparent`; `--glow-1` is the accent at 5% light and 7% dark.
- **Nudges made by the proposal's script** (OKLCH lightness only): light `--subtle-foreground` `#6a6c75` -> `#656770`, light `--over` `#cf3a3f` -> `#cb363c`; light Pace, Pace text and Over text re-picked by hand (`#b86e00`, `#85590a`, `#b02f33`); dark Pace and Over are Soft stone's.
- **One more, found measuring the shipped file**: light `--input` `#8a8c94` -> `#86888f` (on surface-2 3.00 -> 3.17, on the card 3.35 -> 3.54, on the page 3.13 -> 3.31).
- **Accent words on Perks** used `text-primary`, which in dark is now the button fill (3.67:1 on the card, too low for text); they use `text-brand` (6.91:1).
- **Browser bar**: `theme-color` is `#f7f7f8` light and `#0c0d10` dark; the manifest's `theme_color` and `background_color` are `#f7f7f8`.

### Measured contrast, as shipped

WCAG 2.x ratios from a script that reads the shipped `globals.css`; soft fills are composited on the card first. Nothing is under its threshold. Tightest: dark allowance bar beside the spent bar 3.02, hint text on surface-3 4.61 light and 4.62 dark, light field border on surface-2 3.17. A field on surface-3 is not a required surface (ADR-0034 rule 3).

| Pair | Needs | Indigo light | Indigo dark |
|---|---|---|---|
| Body text on page | 4.5:1 | 16.74 | 17.19 |
| Body text on card | 4.5:1 | 17.92 | 16.14 |
| Body text on surface-2 | 4.5:1 | 16.03 | 15.05 |
| Muted text on card | 4.5:1 | 6.77 | 7.59 |
| Muted text on page | 4.5:1 | 6.32 | 8.08 |
| Muted text on surface-2 | 4.5:1 | 6.06 | 7.07 |
| Muted text on surface-3 | 4.5:1 | 5.54 | 6.29 |
| Muted text on a selected row (brand-soft on card) | 4.5:1 | 5.88 | 5.86 |
| Subtle text on card | 4.5:1 | 5.63 | 5.58 |
| Subtle text on page | 4.5:1 | 5.26 | 5.94 |
| Subtle text on surface-2 | 4.5:1 | 5.04 | 5.20 |
| Subtle text on surface-3 | 4.5:1 | 4.61 | 4.62 |
| Main button text (white on `--primary`) | 4.5:1 | 5.61 | 4.97 |
| Main button fill, checked box and switch on card | 3:1 | 5.61 | 3.67 |
| Main button fill on page | 3:1 | 5.24 | 3.91 |
| Brand text on card | 4.5:1 | 5.61 | 6.91 |
| Brand text on page | 4.5:1 | 5.24 | 7.36 |
| Brand text on surface-2 | 4.5:1 | 5.01 | 6.44 |
| Brand text on its soft fill | 4.5:1 | 4.87 | 5.34 |
| Pace badge text | 4.5:1 | 5.31 | 8.60 |
| Over badge text | 4.5:1 | 5.50 | 6.01 |
| Over text on card (`--over-foreground`) | 4.5:1 | 6.36 | 7.28 |
| Over (`--over`) as text on card | 4.5:1 | 5.08 | 6.35 |
| Over (`--over`) as text on page | 4.5:1 | 4.75 | 6.76 |
| Over (`--over`) as text on surface-2 | 4.5:1 | 4.55 | 5.92 |
| Focus ring on page | 3:1 | 5.24 | 7.36 |
| Focus ring on card | 3:1 | 5.61 | 6.91 |
| Over bar on bar track | 3:1 | 4.16 | 5.26 |
| Worst Bucket on bar track | 3:1 | 3.24 | 3.59 |
| Worst Bucket on card | 3:1 | 3.96 | 4.33 |
| Allowance bar on card | 3:1 | 3.84 | 3.53 |
| Allowance bar vs spend bar | 3:1 | 3.19 | 3.02 |
| Spend bar on card | 3:1 | 12.24 | 10.68 |
| Pace marker on bar track | 3:1 | 3.26 | 8.15 |
| Input border on card | 3:1 | 3.54 | 3.64 |
| Input border on surface-2 | 3:1 | 3.17 | 3.39 |
| Input border on page | 3:1 | 3.31 | 3.87 |
| Input border on surface-3 (info) | - | 2.90 | 3.02 |
| Hairline on card (info) | - | 1.23 | 1.18 |
| Stronger line on card (info) | - | 1.48 | 1.49 |
| Card vs page step (info) | - | 1.07 | 1.07 |

The main button's hover fill with white text is about 6.5:1 light and 5.9:1 dark (the mix worked out in sRGB; the browser mixes in OKLab, which differs a little but stays darker than the resting fill).

### Dataviz validator, as shipped

`validate_palette.js`, adjacent pairs, against the Indigo card of each mode.

- **Buckets, light** (`#ffffff`): lightness band, chroma floor, normal-vision floor (worst 15.7, Bucket 7 and 8) and contrast all pass; colour-blind separation is in the 6–8 warning band (worst Bucket 6 and 7, deutan 6.1; tritan 7.7).
- **Buckets, dark** (`#141519`): all pass; colour-blind separation in the warning band (worst Bucket 1 and 2, deutan 6.5; tritan 6.4); normal-vision worst 15.3 (Bucket 7 and 8).
- The same numbers as on Soft stone, since the colours are the same and only the surface moved. The warning band is allowed for the reason ADR-0034 gives: a Bucket's name is always beside its colour.
- **Chart palette** (spend, income, allowance): colour-blind separation and contrast pass (worst 18.1 light, 17.2 dark). Spend and allowance fail the chroma and lightness checks because they are neutrals on purpose, as before.
- **Accent, Pace, Over**: in dark, separation passes (worst Pace and Over, 13.3 deutan, 17.9 normal). In light, Pace `#b86e00` and Over `#cb363c` are 13.1 apart for normal vision and 5.6 for deutan, under the validator's floors for a categorical set. They are state colours, not categories: each always comes with its word (Ahead, Over) or a marker's position, never colour alone. The accent is far from both (at least 24 in every simulation).
- The accent sits near Bucket 5 (`#4a3aa7` / `#9085e9`) in hue. Buckets are tiles and meters with their name beside them, and the accent is buttons and links, so the two do not stand for the same thing in one place.

## 9. Phase 73ah: the controls' edge and three dark chart values

73af looked at every page in dark at 1440 for #73 and found empty tick boxes, unchosen options and off switches almost invisible, Explore's "Plan" bars very dim, and Cash flow's nodes the brightest things on the page. 73ah changed the following (0ecd7f1). ADR-0038 has a sentence on it under Hairlines and a bullet under Consequences. The values below were checked against `globals.css`; the ratios are 73ah's.

- **Checkbox, Radio and Switch**: their edge is `border-input`, where it was `border-border-strong`, in both themes. No token changed value: `--input` is `#86888f` light and `#6c6f79` dark, as in section 8. The edge was `#d4d4d9` light and `#32353d` dark. So in light too an empty box, an unchosen option and an off switch now have the line a text field has, which ADR-0038 asks for.
- **`--switch-track`** (new, with `--color-switch-track`): an off Switch's track. Light `var(--surface-3)` (`#e8e8eb`), the colour it had; dark `var(--input)` (`#6c6f79`), where it was surface-3 (`#24262c`, 1.2:1 on the card). Ticked and on states are untouched.
- **`--chart-compare`**, dark only: `#30333a` -> `#626570`. Light is `#d5d6db`, unchanged. It is the comparison series: Explore's "Plan" bars, Reports' "Comparison" and "One-off" bars, Cash flow's bands (at 0.55) and the "Goals" part of This Month's glance.
- **`--chart-flow-hub` and `--chart-flow-out`** (new): the fill of Cash flow's Household node and of its destinations. Light `var(--chart-net)` and `var(--chart-spend)`, the colours they had. Dark `var(--muted-foreground)` (`#a4a7b0`; it was `#f0f1f3`) and `var(--subtle-foreground)` (`#8b8e98`; it was `#c3c6ce`).
- **The contrast script** (`apps/web/src/contrast.test.ts`) had been reading the light block for every "dark" check: it looked for `@media (prefers-color-scheme: dark)` and first met the `@custom-variant dark` line. It now finds the rule with its brace, and checks that dark is not light. The dark checks that were there pass on the real dark values. New checks: `--input` at 3:1 or more on the card, the page and surface-2 in both themes; dark `--chart-compare` at 3:1 or more on the card and under half the Scenario line's contrast; the dark thumb on an off track at 3:1 or more; the flow nodes at 3:1 or more.
- **Not changed**: Reports' "Left over" and "Spent" legend keys in dark (`#f0f1f3` and `#c3c6ce`, 1.51:1 apart). Dark `--chart-spend` must stay 3:1 from `--chart-allowance` (3.02 now), which must stay 3:1 from the card (3.53), so Spent cannot go darker, and Left over is already ink. It needs a different mark in the legend, not a token. 73ai gave it one (below).

### Measured contrast, as shipped

WCAG 2.x ratios from 73ah's handoff. A dash in a column means 73ah gave no number there: the light chart and track colours did not change.

| Pair | Needs | Indigo light | Indigo dark |
|---|---|---|---|
| Control edge (`--input`) on card | 3:1 | 3.54 | 3.64 |
| Control edge on page | 3:1 | 3.31 | 3.87 |
| Control edge on surface-2 | 3:1 | 3.17 | 3.39 |
| Control edge before (`--border-strong`) on card (info) | - | 1.48 | 1.49 |
| Off switch thumb (`--card`) on its track (`--switch-track`) | 3:1 | - | 3.64 |
| Off switch track before (surface-3) on card (info) | - | - | 1.2 |
| Comparison series (`--chart-compare`) on card | 3:1 | - | 3.14 |
| Comparison series on page (info) | - | - | 3.34 |
| Comparison series on surface-2 (info) | - | - | 2.93 |
| Comparison series before (`#30333a`) on card (info) | - | - | 1.44 |
| Scenario line on card, which the comparison series must stay under half of | - | - | 6.91 |
| Cash flow's Household node (`--chart-flow-hub`) on card | 3:1 | - | 7.59 |
| Cash flow's destinations (`--chart-flow-out`) on card | 3:1 | - | 5.58 |
| Household node before (`#f0f1f3`) on card (info) | - | - | 16.1 |
| Destinations before (`#c3c6ce`) on card (info) | - | - | 10.7 |
| Cash flow's bands on card, about `#3f4149` (info) | - | - | 1.79 |
| Bands before, `#23262b` (info) | - | - | 1.20 |
| Glance's "Goals" part beside "Spent from Buckets" (`--chart-allowance`) (info) | - | - | 1.13 |
| Reports' "Left over" key beside "Spent" (info) | - | - | 1.51 |

Tightest: the comparison series on the card, 3.14, and on surface-2 it is under 3:1 (2.93); the contrast script checks it on the card only, and whether any chart sits on surface-2 was not checked. The glance's Goals part and Spent from Buckets are close in dark; they are separated by the striped "Left in Buckets" part and a gap, and 73ai looked and made the Goals part hollow in dark (below).

### Looked at

Dark at 1440 only, as full-size crops (73ah): setup's step 3 (eight empty boxes plainly outlined), Household's Nudges (the off switch a grey pill with a dark thumb), Explore's Free to Spend chart (Plan bars a readable mid grey, the Scenario line leading), Cash flow (nodes mid grey, bands a visible slate) and Reports' overview (unchanged). Not looked at by 73ah: light, where no pictures were drawn; step 1's unchosen options; phone widths; tick boxes and options on other pages; This Month's glance in dark. Since then ci227 opened the comparison pictures CI drew and saw off switches with their edge in Household on a phone, light and dark, and in setup's Buckets at 1440, light and dark. If the darker edge reads too heavy in light, the lever is the class in the three components, not the token.

### Phase 73ai: two marks where a colour could not do it, and a look at light

Two pairs of dark chart marks were too close and no grey could part them, so the mark changed and the colours stayed. Light is drawn as before except for one legend key.

- **This Month's glance, the "Goals" part, dark only.** It was filled with `--chart-compare` (`#626570`), 1.13:1 from "Spent from Buckets" and "Left in Buckets" (`--chart-allowance`, `#6a6d77`); in the picture the two legend squares looked the same. No fill works: it would need 3:1 from the card and from the Bucket grey, and the only room is between the Bucket grey and Commitments, which are 3.02 apart. In dark the part is now hollow: the card shows through and a 1.5px edge draws it, in the bar and in the legend key. Two new tokens swap per theme: `--chart-goal` (the fill: `var(--chart-compare)` light, `transparent` dark) and `--chart-goal-edge` (`transparent` light, `var(--chart-compare)` dark). In light the part is the same filled `#d5d6db` with no edge.
- **Reports' "Left over" legend key, both themes.** The overview chart's legend had three squares; in dark "Left over" (ink, `#f0f1f3`) and "Spent" (`#c3c6ce`) were 1.51:1 apart. "Left over" is the dashed line with dots, so its key is now a short line through a hollow dot, the series' own shape; Earned and Spent, the bars, keep squares. The line in the chart is unchanged. The key is the same in light, where it replaces an ink square.
- **The contrast script** checks: the dark Goals tokens are the hollow pair and the light ones the filled pair; the edge is 3:1 or more on the card; the card inside the part is 3:1 or more from the Bucket grey and from Free to Spend's indigo; "Left over" has a key of its own and the bars do not.

| Pair | Needs | Indigo light | Indigo dark |
|---|---|---|---|
| Goals part's edge (`--chart-compare`) on card | 3:1 | no edge | 3.14 |
| Inside of the Goals part (card) beside "Left in Buckets" and "Spent from Buckets" (`--chart-allowance`) | 3:1 | - | 3.53 |
| Inside of the Goals part (card) beside Free to Spend (`--brand`) | 3:1 | - | 6.91 |
| Goals part as a fill beside the Bucket grey, before (info) | - | - | 1.13 |
| "Left over" key beside "Spent" key, by colour (info; now told apart by shape) | - | - | 1.51 |

Comparison pictures: none should change. The Household in `shell.spec.ts` has no take-home pay, so its This Month has no glance bar, and its Reports says "Nothing to report yet", so no chart or legend is drawn in `month-*` or `reports-*-light`.

Looked at, 1440, full-size crops. Dark before (run 37238169201): the glance's "Spent from Buckets" and "Goals" keys read as the same grey; Reports' "Left over" and "Spent" keys as two near-white squares. Dark after (run 37238720453, at cfca9cb): the Goals part is an outlined empty box between the striped part and the indigo end, and its key an outlined square; the Reports legend reads square, line with dot, square. Light after (run 37238412045): the glance is as it was, a filled light grey Goals part with no edge; the Reports legend has the line key in ink.

Light, the controls' edge (`--input`, `#86888f`), same run: setup's Bills (eight empty boxes: a thin mid grey line, plainly boxes, quieter than the labels), setup's first step (three unchosen options, the same line on a circle), setup's Buckets (off "Carries over" switches beside name and amount fields: the switch's edge and the fields' edge are the same line and weight, and the one switch that is on is solid indigo and leads without the off ones looking faint) and Household's Nudges (one off switch among three on, the same line as the From and Until fields under it). Nothing reads heavier than a text field or competes with the ticked state; nothing was changed. Kept Scenarios' compare page was opened too, but both of its boxes were ticked, so it shows no empty box. Left alone: the tooltip on Reports' chart still shows a square for "Left over"; its rows are labelled and far apart. Not looked at by 73ai: phone widths, and the glance when "Left in Buckets" is zero (the hollow part then sits straight after "Spent from Buckets") or when Free to Spend is zero or less (the hollow part is then last, and the bar's rounded end clips its edge). On a phone, 74ag has since seen the hollow Goals part at 393 in dark, at full size: distinct from the grey and hatched parts, its key a hollow ring, quiet but readable. The two glance cases are still not looked at at any width.
