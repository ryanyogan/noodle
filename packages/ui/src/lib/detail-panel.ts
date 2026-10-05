// The rules of a picked item's panel (components/detail-panel.tsx, ADR-0047), kept apart from the
// component so they can be tested without a browser.

export type DetailPanelSize = "default" | "wide";

/** How a picked item shows: a page of its own, a drawer over a dimmed page, or a panel beside the list. */
export type DetailPanelMode = "page" | "drawer" | "beside";

/** The window width from which a picked item is a panel; below it the item is a page with Back. */
export const PANEL_FROM = 1024;

/**
 * The window width from which the panel sits beside the list, over the rail only. From PANEL_FROM
 * up to here the rail is too narrow to give the panel room, so the item is a drawer instead. This
 * is the `xl` breakpoint, which is what the styles switch on; a test checks that `panelLayout`
 * with the layout's tokens changes mode at exactly this width.
 */
export const PANEL_BESIDE_FROM = 1280;

/** The narrowest panel that still reads: `--detail-panel-min`. */
export const PANEL_MIN = 400;

/** The widest the panel gets beside the list: `--detail-panel-max` and `--detail-panel-max-wide`. */
export const PANEL_MAX: Record<DetailPanelSize, number> = { default: 640, wide: 800 };

/** The drawer's width: `--detail-panel-drawer`. */
export const PANEL_DRAWER = 480;

/**
 * The page's layout at each of ADR-0033's steps, in px: the page's cap (`--shell-max`) and the
 * rail (`--rail-width`). The gap (`--layout-gap`) and the gutter from lg (`--gutter`) are the same
 * at every step. These mirror globals.css, which is what the page uses; a test compares the two.
 */
export const LAYOUT_STEPS = [
	{ from: 1024, pageMax: 1200, rail: 320 },
	{ from: 1280, pageMax: 1200, rail: 360 },
	{ from: 1440, pageMax: 1440, rail: 380 },
	{ from: 1920, pageMax: 1680, rail: 440 },
] as const;
export const LAYOUT_GAP = 32;
export const LAYOUT_GUTTER = 40;
export const SIDEBAR_WIDTHS = { open: 248, icons: 60 } as const;

/** The page's cap and rail in a window this wide. */
export function layoutAt(windowWidth: number): { pageMax: number; rail: number } {
	let at: { pageMax: number; rail: number } = LAYOUT_STEPS[0];
	for (const step of LAYOUT_STEPS) if (windowWidth >= step.from) at = step;
	return { pageMax: at.pageMax, rail: at.rail };
}

/**
 * How a picked item shows in a window, and how wide.
 *
 * The panel must not cover the list's columns, so its width comes from the layout: everything to
 * the right of the list column. That is the rail, the gap between the list and the rail, the
 * page's right gutter and, where the window is wider than the page's cap, the margin outside the
 * page. It is never wider than the size's maximum (the rest of the rail then shows beside it).
 *
 * Where the rail, the gap and the gutter together are less than the narrowest panel that reads,
 * the panel could only fit by covering the list, so the item is a drawer instead: modal, over a
 * dimmed page, at its own width.
 */
export function panelLayout(at: {
	size: DetailPanelSize;
	windowWidth: number;
	/** The Sidebar's width: open or collapsed to icons. */
	sidebarWidth: number;
	/** The page's cap (`--shell-max`). */
	pageMax: number;
	/** The rail's width (`--rail-width`). */
	railWidth: number;
	gap?: number;
	gutter?: number;
}): { mode: DetailPanelMode; width: number | null; room: number } {
	const { gap = LAYOUT_GAP, gutter = LAYOUT_GUTTER } = at;
	const margin = Math.max(0, (at.windowWidth - at.sidebarWidth - at.pageMax) / 2);
	const room = at.railWidth + gap + gutter + margin;
	if (at.windowWidth < PANEL_FROM) return { mode: "page", width: null, room };
	// By what the layout always gives (the margin comes and goes with the Sidebar's width, and the
	// item must not change from a drawer to a panel because the Sidebar was collapsed).
	if (at.railWidth + gap + gutter < PANEL_MIN)
		return { mode: "drawer", width: Math.min(PANEL_DRAWER, at.windowWidth), room };
	return { mode: "beside", width: Math.min(room, PANEL_MAX[at.size]), room };
}

/** `panelLayout` with the layout's own tokens for a window this wide. */
export function panelAt(
	size: DetailPanelSize,
	windowWidth: number,
	sidebar: keyof typeof SIDEBAR_WIDTHS = "open",
) {
	const { pageMax, rail } = layoutAt(windowWidth);
	return panelLayout({
		size,
		windowWidth,
		sidebarWidth: SIDEBAR_WIDTHS[sidebar],
		pageMax,
		railWidth: rail,
	});
}

/** Which mode the styles are in for a window this wide (they switch on breakpoints). */
export function panelMode(windowWidth: number): DetailPanelMode {
	if (windowWidth < PANEL_FROM) return "page";
	return windowWidth < PANEL_BESIDE_FROM ? "drawer" : "beside";
}

/**
 * Whether this key closes the panel. Esc does, from anywhere on the page, unless something nearer
 * has a use for it: a handler that took the key (a menu or a sheet closing itself), a field being
 * typed in, or a menu, listbox, sheet or dialog that is open. Below lg there is no panel to close.
 */
export function closesOnEscape(
	event: {
		key: string;
		defaultPrevented: boolean;
		altKey?: boolean;
		ctrlKey?: boolean;
		metaKey?: boolean;
		shiftKey?: boolean;
	},
	at: {
		/** The window is wide enough for the panel. */
		panel: boolean;
		/** The key was pressed in a field, or something else that edits. */
		editing: boolean;
		/** A menu, listbox, sheet or dialog is open. */
		layerOpen: boolean;
	},
): boolean {
	if (event.key !== "Escape" || event.defaultPrevented) return false;
	if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return false;
	return at.panel && !at.editing && !at.layerOpen;
}

/**
 * Which of the list's rows takes focus when the panel closes: the row of the item that was open,
 * or, when that row can't be seen (its group is folded, or it has gone), the first one that can.
 * -1 when no row can.
 */
export function returnTarget(rows: readonly { picked: boolean; shown: boolean }[]): number {
	const own = rows.findIndex((row) => row.picked && row.shown);
	return own === -1 ? rows.findIndex((row) => row.shown) : own;
}

/**
 * Whether closing the panel should move focus to the row at all: only when focus was in the panel
 * or is nowhere (the page's body). Focus the Parent put somewhere else (another row, the Sidebar)
 * stays where it is.
 */
export function returnsFocus(focus: "panel" | "nowhere" | "elsewhere"): boolean {
	return focus !== "elsewhere";
}
