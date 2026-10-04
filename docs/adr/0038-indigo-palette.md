# Indigo palette

Status: accepted (#83, 2026-10-04). Supersedes ADR-0036 (Soft stone); keeps the token rules of ADR-0034.

## Context

After living with Soft stone (ADR-0036) the Parent found it "kind of boring" and said they really like Linear's light and dark modes. Three directions built from that model (Indigo, Violet, Ink) were shown side by side; the Parent chose **Indigo**, the most neutral one, with its two role changes: the main button takes the accent, and the page ground goes flat.

What was taken from the model is its relationships, with Noodle's own numbers; no logo, wordmark or typeface.

## Decision

Noodle uses **Indigo**.

- **Page, card, raised.** Light: a near-white page (`#f7f7f8`), pure white cards (`#ffffff`), and two cool grey steps for hover, tracks and raised parts (`#f2f2f4`, `#e8e8eb`). Dark: a near-black ground with a slight cool cast (`#0c0d10`), cards one step lighter (`#141519`), then `#1b1c21` and `#24262c`. The card sits about 1.07:1 from the page in both modes: the step is felt, not drawn.
- **Hairlines.** `--border` is about 1.2:1 on the card (`#e7e7ea` / `#22242a`), `--border-strong` about 1.5:1 (`#d4d4d9` / `#32353d`). Dark lines read as light on dark. Fields keep the stronger `--input` (`#86888f` / `#6c6f79`), at least 3:1 where a field sits.
- **Text steps.** Three: near-black or off-white ink (`#16171a` / `#f0f1f3`, about 17:1), secondary (`#595b63` / `#a4a7b0`, about 7:1) and hint (`#656770` / `#8b8e98`, about 5.6:1 on the card and at least 4.5:1 on every surface).
- **One accent.** Indigo: `--brand` `#4f5ad4` light, `#8e96ff` dark. It is used for the main button, links, the focus ring, the selected-row tint (`--brand-soft`), the active phone tab and income in charts, and nowhere else. Marigold Pace and red Over stay as the two state colours; the eight Bucket colours are unchanged and carry the rest of the colour.
- **The main button is the accent.** `--primary` is `var(--brand)` in light and its own darker fill `#5a64d6` in dark, with white text (`--primary-foreground: #ffffff`): 5.61:1 and 4.97:1. Before, the main button was ink on paper. `--primary-hover` is a step darker in both modes. `--primary` is a fill, not a text colour: in dark it is 3.67:1 on the card, enough for a checked box or a switch, not for words. Accent-coloured text uses `text-brand`.
- **Flat ground.** `--glow-2` is `transparent` and `--glow-1` is a faint accent wash (5% light, 7% dark) at the top of the page. No warm glow.

Rules kept as written from ADR-0034 and ADR-0036: colours only through tokens (the hard-coded-colours guard test), 4.5:1 for text and 3:1 for non-text that carries meaning, measured with a script and recorded in docs/reviews/theme.md (section 8); visible field borders through `--input`; Bucket colours in order and through the dataviz validator; dark is chosen, not flipped; appearance follows the device setting; comparison pictures are redrawn when a token changes.

Changes from the proposal's values: light `--input` `#8a8c94` -> `#86888f` (3.00 -> 3.17 on surface-2, so it isn't sitting on the line); `--primary-hover` is new.

## Consequences

- The change is `globals.css`, the two `theme-color` metas (`#f7f7f8` / `#0c0d10`), the manifest, and three places that leaned on the old meaning of `--primary`: the Button's hover (it mixed primary with the brand, which are now the same colour), the same hover on the sign-in button, and three accent-coloured bits on Perks that used `text-primary` and now use `text-brand`.
- Cards are pure white in light. ADR-0036 said "never pure white"; that line goes with Soft stone.
- Checked boxes, switches, radio dots and the selected day in the calendar follow `--primary`, so they are indigo too.
- The favicon and the email templates keep their own brand colours, as before.
