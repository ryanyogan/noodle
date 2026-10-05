/**
 * The footage contract: the stills the video is cut from.
 *
 * `bun run --cwd apps/web video:capture` writes them to `apps/video/public/footage/` as
 * `<name>-desktop.png` (1440×900 at device scale 2, so 2880×1800 px) and `<name>-phone.png`
 * (393×852 at device scale 3, so 1179×2556 px), in the light theme. Nothing here imports Remotion,
 * so scripts and tests can read the list.
 */

export type Cut = "desktop" | "phone";

/** A part of a still, as fractions (0–1) of its width and height. */
export type Rect = { x: number; y: number; w: number; h: number };

export const VIEWPORT: Record<Cut, { width: number; height: number; scale: number }> = {
	desktop: { width: 1440, height: 900, scale: 2 },
	phone: { width: 393, height: 852, scale: 3 },
};

export const STILLS = [
	"setup-hello",
	"plan-overview",
	"month",
	"month-bucket",
	"accounts-bank",
	"transactions",
	"review",
	"review-rule",
	"quick-add",
	"import-statement",
	"goals",
	"goal",
	"explore-afford",
	"check-in",
	"close-month",
	"household-invite",
] as const;

export type StillName = (typeof STILLS)[number];

/**
 * Where each still's subject is: the camera moves in on it and the highlight ring is drawn round
 * it. Every rectangle is a guess made without seeing the footage. A still without one is shown
 * whole, with a slight move in on its middle.
 */
export const FOCUS: Record<StillName, Partial<Record<Cut, Rect>>> = {
	"setup-hello": {},
	"plan-overview": {
		// tune after first render: the Plan's steps down to Free to Spend
		desktop: { x: 0.2, y: 0.14, w: 0.5, h: 0.62 },
		phone: { x: 0.04, y: 0.12, w: 0.92, h: 0.6 },
	},
	month: {
		// tune after first render: the Free to Spend headline
		desktop: { x: 0.2, y: 0.1, w: 0.36, h: 0.2 },
		phone: { x: 0.04, y: 0.1, w: 0.92, h: 0.16 },
	},
	"month-bucket": {
		// tune after first render: one Bucket's row, with its bar and Pace line
		desktop: { x: 0.2, y: 0.4, w: 0.5, h: 0.12 },
		phone: { x: 0.04, y: 0.38, w: 0.92, h: 0.1 },
	},
	"accounts-bank": {
		// tune after first render: the connected bank's Accounts
		desktop: { x: 0.2, y: 0.16, w: 0.56, h: 0.3 },
		phone: { x: 0.04, y: 0.14, w: 0.92, h: 0.26 },
	},
	transactions: {
		// tune after first render: the newest Transactions in the list
		desktop: { x: 0.2, y: 0.18, w: 0.6, h: 0.4 },
		phone: { x: 0.04, y: 0.16, w: 0.92, h: 0.4 },
	},
	review: {
		// tune after first render: the Transaction Review is asking about
		desktop: { x: 0.2, y: 0.18, w: 0.56, h: 0.3 },
		phone: { x: 0.04, y: 0.16, w: 0.92, h: 0.3 },
	},
	"review-rule": {
		// tune after first render: the "Always file … here" choice
		desktop: { x: 0.3, y: 0.52, w: 0.4, h: 0.1 },
		phone: { x: 0.06, y: 0.56, w: 0.88, h: 0.08 },
	},
	"quick-add": {
		// tune after first render: the open Quick Add
		desktop: { x: 0.3, y: 0.16, w: 0.4, h: 0.62 },
		phone: { x: 0.02, y: 0.3, w: 0.96, h: 0.66 },
	},
	"import-statement": {
		// tune after first render: where a statement is uploaded
		desktop: { x: 0.24, y: 0.2, w: 0.52, h: 0.4 },
		phone: { x: 0.04, y: 0.18, w: 0.92, h: 0.36 },
	},
	goals: {
		// tune after first render: the list of Goals
		desktop: { x: 0.2, y: 0.16, w: 0.6, h: 0.44 },
		phone: { x: 0.04, y: 0.14, w: 0.92, h: 0.44 },
	},
	goal: {
		// tune after first render: the Goal's progress
		desktop: { x: 0.2, y: 0.12, w: 0.56, h: 0.3 },
		phone: { x: 0.04, y: 0.1, w: 0.92, h: 0.28 },
	},
	"explore-afford": {
		// tune after first render: the "Can we afford it?" answer
		desktop: { x: 0.2, y: 0.16, w: 0.56, h: 0.4 },
		phone: { x: 0.04, y: 0.14, w: 0.92, h: 0.4 },
	},
	"check-in": {
		// tune after first render: the Check-in's card
		desktop: { x: 0.26, y: 0.16, w: 0.48, h: 0.56 },
		phone: { x: 0.04, y: 0.12, w: 0.92, h: 0.56 },
	},
	"close-month": {
		// tune after first render: where the leftovers are Swept
		desktop: { x: 0.24, y: 0.18, w: 0.52, h: 0.46 },
		phone: { x: 0.04, y: 0.16, w: 0.92, h: 0.46 },
	},
	"household-invite": {
		// tune after first render: the invite for the other Parent
		desktop: { x: 0.24, y: 0.3, w: 0.52, h: 0.26 },
		phone: { x: 0.04, y: 0.3, w: 0.92, h: 0.24 },
	},
};

/** The still's file under `public/`, which is also what `staticFile()` takes. */
export function footageFile(name: StillName, cut: Cut): string {
	return `footage/${name}-${cut}.png`;
}
