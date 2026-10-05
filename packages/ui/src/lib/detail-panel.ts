// The rules of a picked item's panel (components/detail-panel.tsx, ADR-0047), kept apart from the
// component so they can be tested without a browser.

export type DetailPanelSize = "default" | "wide";

/** The window width from which a picked item is a panel; below it the item is a page with Back. */
export const PANEL_FROM = 1024;

/** The window widths at which the panel's width steps: ADR-0033's breakpoints. */
export const PANEL_STEPS = [1024, 1280, 1440, 1920] as const;

/**
 * The panel's width at each step, in px. These mirror `--detail-panel-width` and
 * `--detail-panel-width-wide` in globals.css, which are what the page uses; a test compares the two.
 */
export const PANEL_WIDTHS: Record<DetailPanelSize, readonly [number, number, number, number]> = {
	default: [480, 480, 520, 560],
	wide: [480, 560, 640, 800],
};

/** How wide the panel is in a window this wide, or null where the item is a page instead. */
export function panelWidth(size: DetailPanelSize, windowWidth: number): number | null {
	let width: number | null = null;
	PANEL_STEPS.forEach((from, step) => {
		if (windowWidth >= from) width = PANEL_WIDTHS[size][step] ?? width;
	});
	return width;
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
