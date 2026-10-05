# Indigo palette

Status: accepted (#83, 2026-10-04). Supersedes ADR-0036 (Soft stone); keeps the token rules of ADR-0034.

## Context

After living with Soft stone (ADR-0036) the Parent found it "kind of boring" and said they really like Linear's light and dark modes. Three directions built from that model (Indigo, Violet, Ink) were shown side by side; the Parent chose **Indigo**, the most neutral one, with its two role changes: the main button takes the accent, and the page ground goes flat.

What was taken from the model is its relationships, with Noodle's own numbers; no logo, wordmark or typeface.

## Decision

Noodle uses **Indigo**.

- **Page, card, raised.** Light: a near-white page (`#f7f7f8`), pure white cards (`#ffffff`), and two cool grey steps for hover, tracks and raised parts (`#f2f2f4`, `#e8e8eb`). Dark: a near-black ground with a slight cool cast (`#0c0d10`), cards one step lighter (`#141519`), then `#1b1c21` and `#24262c`. The card sits about 1.07:1 from the page in both modes: the step is felt, not drawn.
- **Hairlines.** `--border` is about 1.2:1 on the card (`#e7e7ea` / `#22242a`), `--border-strong` about 1.5:1 (`#d4d4d9` / `#32353d`). Dark lines read as light on dark. Fields keep the stronger `--input` (`#86888f` / `#6c6f79`), at least 3:1 where a field sits. An empty Checkbox, an unchosen Radio and an off Switch are drawn by their edge alone, so they use `--input` too (#73); the off Switch's track (`--switch-track`) is the light grey step in light and `--input` in dark, where its dark thumb is 3.64:1 on it.
- **Text steps.** Three: near-black or off-white ink (`#16171a` / `#f0f1f3`, about 17:1), secondary (`#595b63` / `#a4a7b0`, about 7:1) and hint (`#656770` / `#8b8e98`, about 5.6:1 on the card and at least 4.5:1 on every surface).
- **One accent.** Indigo: `--brand` `#4f5ad4` light, `#8e96ff` dark. It is used for the main button, links, the focus ring, the selected-row tint (`--brand-soft`), the active phone tab and income in charts, and nowhere else. Marigold Pace and red Over stay as the two state colours; the eight Bucket colours are unchanged and carry the rest of the colour.
- **The main button is the accent.** `--primary` is `var(--brand)` in light and its own darker fill `#5a64d6` in dark, with white text (`--primary-foreground: #ffffff`): 5.61:1 and 4.97:1. Before, the main button was ink on paper. `--primary-hover` is a step darker in both modes. `--primary` is a fill, not a text colour: in dark it is 3.67:1 on the card, enough for a checked box or a switch, not for words. Accent-coloured text uses `text-brand`.
- **Flat ground.** `--glow-2` is `transparent` and `--glow-1` is a faint accent wash (5% light, 7% dark) at the top of the page. No warm glow.

Rules kept as written from ADR-0034 and ADR-0036: colours only through tokens (the hard-coded-colours guard test), 4.5:1 for text and 3:1 for non-text that carries meaning, measured with a script and recorded in docs/reviews/theme.md (section 8); visible field borders through `--input`; Bucket colours in order and through the dataviz validator; dark is chosen, not flipped; appearance follows the device setting; comparison pictures are redrawn when a token changes.

Changes from the proposal's values: light `--input` `#8a8c94` -> `#86888f` (3.00 -> 3.17 on surface-2, so it isn't sitting on the line); `--primary-hover` is new.

## Consequences

- The change is `globals.css`, the two `theme-color` metas (`#f7f7f8` / `#0c0d10`), the manifest, and three places that leaned on the old meaning of `--primary`: the Button's hover (it mixed primary with the brand, which are now the same colour), the same hover on the sign-in button, and three accent-coloured bits on Perks that used `text-primary` and now use `text-brand`.
- Cards are pure white in light. ADR-0036 said "never pure white"; that line goes with Soft stone.
- Charts in dark (#73): the comparison series `--chart-compare` is `#626570` (3.14:1 on the card; it was `#30333a`, 1.44:1), which also lifts Cash flow's bands; Cash flow's Household and right-hand nodes take `--chart-flow-hub` and `--chart-flow-out` (ink and `--chart-spend` in light, as before; the secondary and hint greys in dark, 7.59:1 and 5.58:1, instead of near-white). Light values are unchanged.
- Checked boxes, switches, radio dots and the selected day in the calendar follow `--primary`, so they are indigo too.
- The favicon and the email templates keep their own brand colours, as before.

## Note, 2026-10-05: dark cards stand one step further off the page (#73)

Two look passes found dark cards "held by their hairline, not their fill", and the Parent agreed to one more step. In dark only, the card and what is stacked on it are lifted and the page stays `#0c0d10`: `--card` `#1c1d21` (was `#141519`), `--surface-2` `#232429`, `--surface-3` `#292b31`, `--border` `#2a2c32`, `--border-strong` `#383b43`. The card is 1.15:1 from the page (was 1.07), the two inner steps 1.09 each, the hairline 1.21 on the card and the stronger line 1.50. Two greys moved in lightness to keep their pairs: hint text `--subtle-foreground` `#8f929c` (was `#8b8e98`; 4.55:1 on surface-3, 5.42 on the card) and `--chart-compare` `#676a75` (was `#626570`; 3.12:1 on the card). So in dark the Decision's "about 1.07:1" and the dark values above for card, raised steps, hairlines, hint text and the comparison series are replaced by these; the main button's fill is 3.39:1 on the card (was 3.67) and the off Switch's thumb 3.36:1 on its track (was 3.64). The page was not darkened instead: only a pure black page would reach the same step, and the ground keeps its cool near-black. Light, the `theme-color` metas and the manifest are unchanged. Numbers: docs/reviews/theme.md, section 11.
