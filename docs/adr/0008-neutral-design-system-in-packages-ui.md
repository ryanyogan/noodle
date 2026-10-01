# A neutral design system in `packages/ui`: Tailwind v4, shadcn on Radix, Geist

The first prototype of This Month (#2) used big colourful Bucket vessels and Bricolage Grotesque, and the Parents rejected it as too playful. The approved second round is neutral and quiet. Colour means only two things: which Bucket something belongs to (a small tinted icon tile and the meter fill), or its state against Pace (marigold for ahead, soft red for over). What needs attention comes first; anything on track stays quiet. The spec's vessel is now a slim meter that drains as money is spent, with a marigold Pace tick. One typeface, **Geist**, replaces Bricolage Grotesque and Hanken Grotesk.

The tokens live in `packages/ui/src/styles/globals.css` and are the only source of colour, type, spacing, radii and motion. Tailwind v4 exposes them as utilities (`bg-card`, `text-muted-foreground`, `bg-pace`, `bg-bucket-3`), and shadcn's role names (`--primary`, `--muted`, `--border`, …) are mapped onto them. That way shadcn components installed later (`bunx shadcn add … -c packages/ui`) pick up the look without edits. Components are shadcn primitives on Radix, restyled, plus Noodle's own shared parts: page header, section header, card, list row, tile, meter, badge, field, empty state. Every screen is built from these.

## Consequences

- Appearance follows the device (`prefers-color-scheme`); there is no in-app theme switch. The dark palette is chosen separately, not inverted.
- Geist's Latin subset is self-hosted from `packages/ui/src/fonts` (OFL) and preloaded. A fallback face (Arial resized with Capsize metrics) takes its place until it loads, so the swap doesn't shift layout.
- Clerk's sign-in and account screens are themed through its `--clerk-*` CSS variables, which point at the same tokens.
- Bucket colours are assigned in a fixed, colour-blind-validated order (`--bucket-1` … `--bucket-8`) and never cycled. Their exact values were checked with the dataviz palette validator in #2.
- Screenshot tests (`apps/web/e2e/shell.spec.ts`) guard the shell in light and dark at iPhone and desktop sizes. Intentional visual changes update the baselines with `bun run e2e --update-snapshots`.
- `packages/ui/COMPONENTS.md` lists every component, how shadcn ones are added (by hand from the registry: the CLI wants an npm `cn` package here), which select goes where, and what wasn't added and why (#47).
