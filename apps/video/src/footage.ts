/**
 * The footage contract: the stills the video is cut from.
 *
 * `bun run --cwd apps/web video:capture` writes them to `apps/video/public/footage/` as
 * `<name>-desktop.png` (1440×900 at device scale 2, so 2880×1800 px) and `<name>-phone.png`
 * (393×852 at device scale 3, so 1179×2556 px), in the light theme. Nothing here imports Remotion,
 * so scripts and tests can read the list.
 */

import measured from "./measured.json";

export type Cut = "desktop" | "phone";

/** A part of a still, as fractions (0–1) of its width and height. */
export type Rect = { x: number; y: number; w: number; h: number };

export const VIEWPORT: Record<Cut, { width: number; height: number; scale: number }> = {
	desktop: { width: 1440, height: 900, scale: 2 },
	phone: { width: 393, height: 852, scale: 3 },
};

export const STILLS = [
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
 * Where each still's subject is when the capture didn't measure it: the camera moves in on it and
 * the highlight ring is drawn round it. These are guesses; `focusFor` prefers the measured box. A
 * still without either is shown whole, with a slight move in on its middle.
 */
export const FOCUS: Record<StillName, Partial<Record<Cut, Rect>>> = {
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
		// The "Set aside" card: on a computer the Goal opens beside the list of Goals (read off the first render)
		desktop: { x: 0.49, y: 0.185, w: 0.485, h: 0.25 },
		phone: { x: 0.04, y: 0.1, w: 0.92, h: 0.28 },
	},
	"explore-afford": {
		// tune after first render: the "Can we afford it?" answer
		desktop: { x: 0.2, y: 0.16, w: 0.56, h: 0.4 },
		phone: { x: 0.04, y: 0.14, w: 0.92, h: 0.4 },
	},
	"check-in": {
		// The Check-in's card, to the right of its list of steps (read off the first render)
		desktop: { x: 0.385, y: 0.165, w: 0.59, h: 0.6 },
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

/** A subject's box as the capture measures it: fractions of the window. */
type Box = { x: number; y: number; width: number; height: number };

/** How much room the ring leaves round a measured subject, and how near a still's edge it may go, in CSS px. */
const ROOM = 10;
const EDGE = 6;

/** A measured box as a focus: a little room round it, kept inside the still. Undefined if it is empty. */
export function focusFromBox(box: Box | undefined, cut: Cut): Rect | undefined {
	if (!box || !(box.width > 0) || !(box.height > 0)) return undefined;
	const { width, height } = VIEWPORT[cut];
	const left = Math.max(EDGE / width, box.x - ROOM / width);
	const top = Math.max(EDGE / height, box.y - ROOM / height);
	const right = Math.min(1 - EDGE / width, box.x + box.width + ROOM / width);
	const bottom = Math.min(1 - EDGE / height, box.y + box.height + ROOM / height);
	if (right <= left || bottom <= top) return undefined;
	return { x: left, y: top, w: right - left, h: bottom - top };
}

/**
 * Where a still's subject is. The capture writes each subject's place to footage.json, which
 * `bun run footage:boxes` copies to src/measured.json before a render, so the ring lands on the
 * real element; a still it has no box for falls back to the guess in FOCUS.
 */
export function focusFor(name: StillName, cut: Cut): Rect | undefined {
	const boxes: Record<string, Box | undefined> = measured;
	return focusFromBox(boxes[`${name}-${cut}`], cut) ?? FOCUS[name][cut];
}

/** The still's file under `public/`, which is also what `staticFile()` takes. */
export function footageFile(name: StillName, cut: Cut): string {
	return `footage/${name}-${cut}.png`;
}
