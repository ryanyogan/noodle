/**
 * The app's light tokens, copied from packages/ui/src/styles/globals.css (Indigo, ADR-0038).
 *
 * The video can't read the app's CSS: Remotion bundles with webpack, and the tokens live in a
 * Tailwind v4 stylesheet. So the values are written once here, and `story.test.ts` fails when one
 * of them no longer matches globals.css. Every colour in the video comes from this module.
 */
export const cssTokens = {
	"--background": "#f7f7f8",
	"--card": "#ffffff",
	"--surface-2": "#f2f2f4",
	"--surface-3": "#e8e8eb",
	"--border": "#e7e7ea",
	"--border-strong": "#d4d4d9",
	"--foreground": "#16171a",
	"--muted-foreground": "#595b63",
	"--subtle-foreground": "#656770",
	"--brand": "#4f5ad4",
	"--brand-soft": "rgb(79 90 212 / 0.1)",
	"--pace": "#b86e00",
	"--pace-foreground": "#85590a",
	"--glow-1": "rgb(79 90 212 / 0.05)",
	"--elevation-card": "0 1px 2px rgb(22 23 26 / 0.05), 0 1px 1px rgb(22 23 26 / 0.03)",
	"--elevation-pop": "0 12px 32px -8px rgb(22 23 26 / 0.2), 0 2px 6px rgb(22 23 26 / 0.06)",
	"--bucket-1": "#2a78d6",
	"--bucket-4": "#008300",
	"--chart-spend": "#33353c",
	"--chart-compare": "#d5d6db",
	"--primary-foreground": "#ffffff",
} as const;

export const tokens = {
	background: cssTokens["--background"],
	card: cssTokens["--card"],
	surface2: cssTokens["--surface-2"],
	surface3: cssTokens["--surface-3"],
	border: cssTokens["--border"],
	borderStrong: cssTokens["--border-strong"],
	foreground: cssTokens["--foreground"],
	mutedForeground: cssTokens["--muted-foreground"],
	subtleForeground: cssTokens["--subtle-foreground"],
	brand: cssTokens["--brand"],
	brandSoft: cssTokens["--brand-soft"],
	pace: cssTokens["--pace"],
	paceForeground: cssTokens["--pace-foreground"],
	glow: cssTokens["--glow-1"],
	elevationCard: cssTokens["--elevation-card"],
	elevationPop: cssTokens["--elevation-pop"],
	bucketBlue: cssTokens["--bucket-1"],
	bucketGreen: cssTokens["--bucket-4"],
	chartSpend: cssTokens["--chart-spend"],
	chartCompare: cssTokens["--chart-compare"],
	primaryForeground: cssTokens["--primary-foreground"],
	/** The mark's marigold "today" dot: the logo's own colour (packages/ui/src/components/logo.tsx). */
	logoDot: "#f2a20c",
	/** --radius-card and --radius-control. */
	radiusCard: 16,
	radiusControl: 12,
} as const;
