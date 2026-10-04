# Soft stone replaces Warm paper

Status: accepted (#75, 2026-10-04). Supersedes the palette choice in ADR-0034; keeps its token rules.

## Context

ADR-0034 picked Warm paper from the three directions in docs/reviews/theme.md and set the rules every colour follows. After living with Warm paper on every page, the Parent chose the second direction, Soft stone, on 2026-10-04: the cream read warmer than they wanted, and Soft stone is the quiet one, closest to the old feel without the bright white.

## Decision

Noodle uses **Soft stone**: a soft greige page (`#eff0ec`), an off-white card with a faint sage cast (`#f9faf7`, never pure white) and green-grey ink (`#1a1e1b`) in light; a green-stone graphite that steps up towards the reader (`#121513` page, `#191d1a` card, `#202521` and `#282e29` surfaces) with pale stone text (`#e9ede8`) in dark. The blue brand accent, marigold Pace and red Over stay. Appearance still follows the device setting.

Every rule in ADR-0034 is kept as written (tokens only, 4.5:1 text, 3:1 for non-text that carries meaning, visible field borders through `--input`, Bucket colours in order and through the dataviz validator, dark chosen not flipped, baselines rewritten on a token change).

The values are the Soft stone columns of docs/reviews/theme.md, with the fixes Warm paper needed after its proposal worked out again for the stone grounds (measured numbers in theme.md, section 7):

- `--input` is `#83877d` light and `#6a716b` dark: at least 3.1:1 on the card, surface-2 and the page.
- Light `--pace` is `#b46c00` (3.21:1 on the bar track); dark Pace is the proposal's.
- `--bucket-2` keeps the validated `#8e3fa8` light and `#a95cc0` dark; light `--bucket-3` is `#038ca5` (3.08:1 on the track).
- Light `--brand` is `#3c60da` and light `--over` is `#c43738`, a shade darker than proposed, so each is 4.5:1 as text on surface-2 and the page as well as the card.

## Consequences

- As ADR-0034 promised, the change was `globals.css`, the two theme-color metas, the manifest and the screenshot baselines; no component changed.
- The browser bar is `#eff0ec` in light and `#121513` in dark.
- The favicon and the email templates keep their own brand colours, as before.
