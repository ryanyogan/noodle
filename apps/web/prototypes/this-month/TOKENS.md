# Proposed design tokens (PROTOTYPE — issue #2, round 2)

Status: **proposed, not yet approved.** Once approved these move into `packages/ui`
(ticket #4). This folder stays on the `prototype/this-month-quick-add` branch only.
`index.html` defines exactly these values in its `:root` block.

## Principles

- The UI is neutral. Colour only means **identity** (a Bucket's icon tile and meter) or **state** (ahead of Pace, over).
- One accent (indigo) for focus, links and Goals. Marigold is reserved for Pace and "today".
- What needs attention comes first ("Needs a look"). Anything on track stays quiet.
- Amounts use tabular figures and are right-aligned.
- Every screen is built from the same parts: page header, section header, card, list row, tile, meter, pill, button, sheet, toast.

Round 1 changes: Bricolage Grotesque and Hanken Grotesk are replaced by **Geist**. The big coloured vessels are replaced by slim meters. The palette now starts from neutrals instead of colour.

## Colour

| Role | Light | Dark |
|---|---|---|
| Background | `#F4F5F7` + faint indigo/marigold glow at the top | `#090C12` + faint glow |
| Surface (cards) | `#FFFFFF` | `#10141C` |
| Surface 2 (tracks, hover, segmented control) | `#F2F4F7` | `#161B25` |
| Surface 3 (meter track, badges) | `#E9ECF1` | `#1D2330` |
| Line | `#E5E8ED` | `#1C2230` |
| Strong line (button borders) | `#D6DAE1` | `#283041` |
| Text | `#0E1525` | `#ECEFF4` |
| Secondary text | `#545E70` | `#A0A8B7` |
| Tertiary text | `#8A93A4` | `#6C7486` |
| Accent | `#3E63DD` | `#7C9BFF` |
| Pace / today | `#E0940A` | `#F5B23A` |
| Over | `#CC3D3D` | `#F07171` |

The Pace and Over colours also come as soft tints (10–14%) for pill backgrounds. Primary buttons are ink on light and near-white on dark.

Bucket identity colours are unchanged from round 1 (validated order: blue, red, cyan, green, violet, aqua, brown, magenta). They now appear only as a 13% tinted tile with a coloured icon, and as the meter fill.

## Type

**Geist** (Google Fonts), weights 400–650, with tabular figures on every amount.

| Token | px | Used for |
|---|---|---|
| `t-12` | 12 | meta, pills, axis labels |
| `t-13` | 13 | secondary lines, links |
| `t-14` | 14 | body, row titles |
| `t-16` | 16 | sheet titles, stat values |
| `t-24` / `t-32` | 24 / 32 | page title (phone / desktop) |
| `t-44` | 44 | the hero number (Free to Spend) |

Headings use negative tracking (−0.025em; −0.04em for the hero number).

## Spacing

4pt scale: `4, 8, 12, 16, 20, 24, 32, 40, 48`.

- Page gutter: 16px on phones, 40px on desktop.
- Card padding: 16px on phones, 20px on desktop.
- Sections are 32px apart; a section header sits 12px above its card.
- List rows: 14px vertical padding, 12px between the tile and the text.

## Radii

`8` (small buttons, nav items) · `12` (buttons, tiles, inputs, keys) · `16` (cards) · `24` (sheets) · full (pills, meters, avatars).

## Motion

| Token | Value | Used for |
|---|---|---|
| `ease` | `cubic-bezier(0.2, 0.8, 0.2, 1)` | everything by default |
| `ease-spring` | `cubic-bezier(0.3, 1.25, 0.5, 1)` | meters settling (small overshoot) |
| `d-fast` | 120ms | hover and press |
| `d-base` | 220ms | toasts, Pace tick |
| `d-slow` | 420ms | sheet in and out |
| `d-meter` | 650ms | meter level change |

Numbers count to their new value over 600ms (ease-out cubic). A new row slides in with a brief accent tint. The "today" dot on the chart pulses gently.
With reduce-motion on, all of this is instant.
