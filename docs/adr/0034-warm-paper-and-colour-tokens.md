# Warm paper, and every colour through a token

Status: the palette (Warm paper) was superseded by ADR-0036 (Soft stone, 2026-10-04), itself superseded by ADR-0038 (Indigo, #83); the six token rules below still stand (#75, October 2026)

## Context

Light mode was a bright blue-white and dark mode a generic blue-black. #75 compared three directions (docs/reviews/theme.md): Warm paper, Soft stone and Tinted night. Each is a swap of the same tokens, because components already read colour only through `packages/ui/src/styles/globals.css`.

## Decision

Noodle uses **Warm paper**: an off-white paper page (`#f3efe7`), a cream card a step above it and warm ink text in light; warm brown-blacks that step up towards the reader, with cream text, in dark. The blue brand accent stays, and Pace (marigold) and Over (red) stay the two reserved state colours. Appearance follows the device setting; there is no in-app switch.

The token rules:

1. **Every colour is a token in `globals.css`**, light in `:root` and dark under `prefers-color-scheme: dark`. Components and pages use the Tailwind utilities (`bg-card`, `text-muted-foreground`, `border-input`, `bg-pace`) or `var(--…)`, never a written colour. `apps/web/src/hard-coded-colours.test.ts` fails on a hex, `rgb()`, `hsl()`, `oklch()` or similar colour anywhere else under `apps/web/src` and `packages/ui/src`; the few files that can't read CSS variables (theme-color metas, email HTML, the logo's dot, Recharts' default-stroke selectors) are allowed by name with the reason.
2. **Text** is at least 4.5:1 on every surface it sits on (card, page, surface-2, surface-3, and soft badge fills composited on the card). Three levels only: foreground, muted, subtle.
3. **Non-text that carries meaning** is at least 3:1 against what is next to it (WCAG 1.4.11): `--input` (Input, Select, Textarea borders) on the card, surface-2 and the page; `--pace` on the bar track; chart allowance bars on the card. `--border` and `--border-strong` are decoration and can be fainter.
4. **Bucket colours** keep their order (a Bucket's colour follows the Bucket, never its rank) and pass the dataviz validator (`validate_palette.js`, adjacent pairs) in both modes against the card: lightness band, chroma floor, normal-vision floor, contrast. Colour-blind separation may sit in the 6–8 warning band only because a Bucket is never told apart by colour alone: its name is always beside its colour.
5. **Dark mode is chosen, not flipped**: its own steps (surfaces step up, accents lighten and desaturate), each checked against the dark card.
6. Changing a token updates the screenshot baselines with `--update-snapshots=all` (Playwright's 0.2 per-pixel threshold hides a palette shift from `=changed`).

## Consequences

- A future palette change is a `globals.css` change plus baselines; nothing else should need editing.
- The chart neutrals (`--chart-spend` ink, `--chart-allowance` grey) are greys on purpose and so fail the validator's chroma and lightness checks, which are meant for categorical hues; they pass its colour-blind and contrast checks against the brand income colour.
- The favicon and the email templates keep the old cool brand colours until someone warms them deliberately.

- 2026-10-06 (issue 124): dark is no longer only under `prefers-color-scheme`. A Parent can choose Light, Dark or Device in the account menu; the choice is stored per device (localStorage `theme`, `<html data-theme>` set before first paint), and Device, which follows the device's setting, is the default.
