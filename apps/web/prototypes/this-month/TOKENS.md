# Proposed design tokens (PROTOTYPE — issue #2)

Status: **proposed, not yet approved.** Once the Parents approve a direction, these
move into `packages/ui` (ticket #4) and this folder stays on the
`prototype/this-month-quick-add` branch only.

The prototype page (`index.html`) defines exactly these values in its `:root` block.

## Colour

| Role | Light | Dark ("Midnight rink") |
|---|---|---|
| Background | Ice `#EDF2F7` | `#0D1525` |
| Surface | Board `#FFFFFF` | `#16213A` |
| Sunk surface (empty vessel, keys) | `#E3EAF2` | `#111A2E` |
| Line | `#D3DCE7` | `#26344F` |
| Text | Ink `#15213A` | `#E8EEF7` |
| Secondary text | Slate `#5A6A82` | `#97A6BD` |
| Pace / today (only) | Marigold `#F2A20C` | Marigold `#F2A20C` |
| Focus ring | `#2a78d6` | `#6da7ec` |
| Scrim | Ink at 42% | `#03070F` at 62% |

### Bucket colours (assigned in this order, never cycled)

| Slot | Hue | Light | Dark |
|---|---|---|---|
| 1 | blue | `#2a78d6` | `#3987e5` |
| 2 | red | `#e34948` | `#e66767` |
| 3 | cyan | `#0e8fa8` | `#2aa3bd` |
| 4 | green | `#008300` | `#2f9e3a` |
| 5 | violet | `#4a3aa7` | `#9085e9` |
| 6 | aqua | `#1baf7a` | `#199e70` |
| 7 | brown | `#9a5b2e` | `#c47a36` |
| 8 | magenta | `#e87ba4` | `#d55181` |

There's no yellow or orange in the set, so nothing competes with the marigold Pace line.
The order was chosen by checking every ordering with the dataviz palette validator.

- Light, on Board: neighbouring colours stay distinct for colour-blind viewers (score ≥ 13.7; the target is 8) and for everyone else (≥ 19.5). Aqua and magenta are under 3:1 contrast, which is acceptable only because every vessel always shows its name and amount.
- Dark, on `#16213A` and `#0D1525`: all colours reach 3:1 contrast. The weakest neighbouring pair (brown and aqua) scores 7.7 for colour-blind viewers, just under the target, so each vessel keeps its name label and doesn't rely on colour alone.

Ahead of Pace is shown without numbers: a marigold hatch fills the gap between the
liquid level and the Pace line. Over is shown as an empty vessel with a dashed outline.
No red or green status colours are used; the wording stays calm ("A little ahead of Pace", "A little over").

## Type

- Amounts: **Bricolage Grotesque**, tabular figures, weights 600–750, tight tracking (−0.02 to −0.04em).
- UI: **Hanken Grotesk**, 400–700.
- No all-caps labels, no monospace.

| Token | rem | px |
|---|---|---|
| `t-xs` | 0.75 | 12 |
| `t-sm` | 0.875 | 14 |
| `t-md` | 1 | 16 |
| `t-lg` | 1.25 | 20 |
| `t-xl` | 1.625 | 26 |
| `t-2xl` | 2.25 | 36 |
| `t-3xl` | 3.25 | 52 |

The Quick Add amount display uses 56px.

## Spacing (4pt)

`4, 8, 12, 16, 24, 32, 48, 64` → `s-1` … `s-8`. The page gutter is 16px on phones and 48px on desktop.

## Radii

| Token | px | Used for |
|---|---|---|
| `r-sm` | 8 | chips, keypad keys, Bucket picks |
| `r-md` | 14 | cards, lists, toasts |
| `r-lg` | 22 | sheets and dialogs |
| `r-vessel` | 18 (+6 at the base) | vessels |
| `r-full` | 999 | pills, avatars, tubes |

## Motion

| Token | Value | Used for |
|---|---|---|
| `ease-out` | `cubic-bezier(0.2, 0.8, 0.2, 1)` | most transitions |
| `ease-spring` | `cubic-bezier(0.34, 1.5, 0.64, 1)` | the vessel level (overshoots, then settles) |
| `dur-fast` | 140ms | press feedback |
| `dur-base` | 240ms | toasts, Pace line moving |
| `dur-sheet` | 340ms | Quick Add sheet in and out |
| `dur-level` | 760ms | liquid level change |

With reduce-motion on, every duration is 0: the level jumps straight to its new value.
