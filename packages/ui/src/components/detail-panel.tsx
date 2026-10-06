import * as React from "react";
import { MasterDetailPane } from "#components/layout";
import {
	closesOnEscape,
	type DetailPanelMode,
	type DetailPanelSize,
	PANEL_BESIDE_FROM,
	PANEL_BESIDE_FROM_LATE,
	panelMode,
	returnsFocus,
	returnTarget,
} from "#lib/detail-panel";
import { cn } from "#lib/utils";

/*
 * A picked item in a panel from the window's right edge (ADR-0047). The Parent: "the two column
 * views are weird as the rows condense too far on the left when selected". So from lg the list
 * keeps its width and its columns, and the item opens over the page instead of beside a narrowed
 * list. Below lg nothing is different from MasterDetail: the item is a page with Back.
 *
 * From xl it is beside the list: as wide as what is to the right of the list column (the rail,
 * the gap, the gutter), so it covers the rail and none of the list's columns. It is not a dialog
 * there. No scrim, no focus trap and no scroll lock: the list stays clickable, so the Parent goes
 * from one item to the next without closing anything, and the page behind still scrolls.
 *
 * From lg to xl the rail is too narrow for that, and a panel that reads would cut the list's
 * columns. There it is an honest drawer: a dialog over a dimmed page, the rest of the window
 * inert, closed by Esc, Close or a click on the dimmed page.
 *
 * It renders in place (no portal), so an item opened by its address is in the server's HTML and
 * phones and desktops share one DOM. Nothing between <body> and it may create a containing block
 * for fixed boxes (transform, filter, contain, container-type): keep it out of `@container`s.
 */

/**
 * From where the rail is beside the list, and so the panel too: `xl`, or `late` (1440) for a page
 * whose list has the page's whole width until then, with the rail under it. Up to there the item
 * is a drawer.
 */
type BesideFrom = "xl" | "late";
const BESIDE_FROM: Record<BesideFrom, number> = {
	xl: PANEL_BESIDE_FROM,
	late: PANEL_BESIDE_FROM_LATE,
};

const mode = (besideFrom: BesideFrom = "xl"): DetailPanelMode =>
	panelMode(window.innerWidth, BESIDE_FROM[besideFrom]);
const wide = () => mode() !== "page";

// Whether the Parent's last move was a key: an item opened from the keyboard shows the ring on its
// title, one opened by a click or by its address does not. Kept for the whole page, since the key
// that opens an item is pressed before its panel exists.
let byKeyboard = false;
if (typeof document !== "undefined") {
	document.addEventListener(
		"keydown",
		(event) => {
			if (!event.metaKey && !event.ctrlKey && !event.altKey) byKeyboard = true;
		},
		true,
	);
	document.addEventListener(
		"pointerdown",
		() => {
			byKeyboard = false;
		},
		true,
	);
}

const EDITING = 'input, textarea, select, [contenteditable="true"], [role="combobox"]';
const LAYERS = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';
/** A sheet, dialog, menu or listbox is open (the panel itself, a dialog as a drawer, aside). */
const layerOpen = () =>
	[...document.querySelectorAll(LAYERS)].some((layer) => !layer.hasAttribute("data-panel"));
// Left usable beside a drawer: where toasts are announced (an Undo must stay reachable).
const KEPT = "[aria-live], [data-sonner-toaster]";

const CONTROLS = "a[href], button, input, select, textarea, summary, [tabindex]";

/** The rows of the list this panel belongs to: its sibling in a `ListWithPanel`. */
const rowsOf = (root: Element | null) =>
	root
		? [...root.querySelectorAll<HTMLElement>("[data-slot=master-detail-list] [data-md-item]")]
		: [];

function DetailPanel({
	size = "default",
	besideFrom = "xl",
	label,
	itemKey,
	onClose,
	close,
	className,
	children,
	...props
}: Omit<React.ComponentProps<"section">, "aria-label"> & {
	/** `default` is a form's worth (a Transaction, a Rule); `wide` a page's worth (a Commitment). */
	size?: DetailPanelSize;
	/** From where it is beside the list rather than a drawer. Default `xl`; see `BesideFrom`. */
	besideFrom?: BesideFrom;
	/** Names the region, e.g. "Commitment details". */
	label: string;
	/** The open item's id. When it changes, focus moves to the item's title. */
	itemKey?: string;
	/** Esc: go to the list's address. */
	onClose: () => void;
	/**
	 * The visible Close control, shown from lg in the panel's top corner: a link to the list's
	 * address (so it works before hydration), named for what it closes ("Close Commitment").
	 */
	close?: React.ReactNode;
}) {
	const ref = React.useRef<HTMLElement>(null);
	// Known once the window is: the server's HTML is the same for every width.
	const [shown, setShown] = React.useState<DetailPanelMode | null>(null);
	React.useLayoutEffect(() => {
		const read = () => setShown(mode(besideFrom));
		read();
		window.addEventListener("resize", read);
		return () => window.removeEventListener("resize", read);
	}, [besideFrom]);
	const drawer = shown === "drawer";
	// The open item's row, remembered while it is marked, since the mark goes as the panel closes.
	const row = React.useRef<HTMLElement | null>(null);
	// Whether the panel's own content is scrolled: Close then gets a ground of its own.
	const [scrolled, setScrolled] = React.useState(false);
	const closing = React.useRef(onClose);
	React.useEffect(() => {
		closing.current = onClose;
	});
	React.useLayoutEffect(() => {
		const marked = rowsOf(ref.current?.parentElement ?? null).find((item) =>
			item.hasAttribute("aria-current"),
		);
		if (marked) row.current = marked;
	});

	// Below lg the item is a page of its own, so opening one starts it at the top (a row's link
	// leaves the window's scroll alone, for the sake of the list on a desktop).
	React.useEffect(() => {
		if (!wide()) window.scrollTo({ top: 0 });
	}, []);

	// Opening an item puts focus on its title, so a keyboard or screen reader lands in what just
	// opened rather than having to cross the rest of the list. Focus already in the panel (previous
	// and next in its header) stays, and so does focus in a sheet that is open over the page.
	// An item that is still loading has no title yet: the panel takes focus meanwhile and hands it
	// to the title when it arrives, unless the Parent has moved it somewhere else by then.
	// biome-ignore lint/correctness/useExhaustiveDependencies: runs again for each item opened
	React.useEffect(() => {
		const panel = ref.current;
		if (!panel || !wide() || panel.contains(document.activeElement)) return;
		if (layerOpen()) return;
		// The ring is for an item opened from the keyboard only (see `byKeyboard`): read now, since
		// the title may arrive after other keys or clicks.
		const keyboard = byKeyboard;
		const land = (to: HTMLElement) => {
			if (keyboard) {
				to.setAttribute("data-keyboard-open", "");
				to.addEventListener("blur", () => to.removeAttribute("data-keyboard-open"), { once: true });
			} else to.removeAttribute("data-keyboard-open");
			to.focus({ preventScroll: true });
		};
		const find = () => panel.querySelector<HTMLElement>("[data-slot=detail-title][tabindex]");
		const title = find();
		land(title ?? panel);
		if (title) return;
		const watch = new MutationObserver(() => {
			const arrived = find();
			if (!arrived) return;
			watch.disconnect();
			if (document.activeElement === panel) land(arrived);
		});
		watch.observe(panel, { childList: true, subtree: true });
		return () => watch.disconnect();
	}, [itemKey]);

	// Esc closes, from the panel or the list, unless something nearer has a use for the key.
	React.useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			const target = event.target instanceof Element ? event.target : null;
			const at = {
				panel: wide(),
				editing: target?.closest(EDITING) != null,
				layerOpen: layerOpen(),
			};
			if (!closesOnEscape(event, at)) return;
			event.preventDefault();
			closing.current();
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, []);

	// As a drawer, the rest of the window is out of reach while it is open: every branch of the
	// page that the panel is not in is inert (no clicks, no focus, not read out), which is also what
	// keeps Tab inside the drawer. Sheets opened from the drawer arrive later and are not touched.
	// Declared before the effect that returns focus, so the row can take focus again by then.
	React.useLayoutEffect(() => {
		const panel = ref.current;
		if (!panel || !drawer) return;
		const held: HTMLElement[] = [];
		for (let node: HTMLElement = panel; node.parentElement; node = node.parentElement) {
			for (const other of node.parentElement.children) {
				if (other === node || !(other instanceof HTMLElement) || other.inert) continue;
				if (other.hasAttribute("data-panel-scrim")) continue;
				if (other.matches("script, style") || other.matches(KEPT) || other.querySelector(KEPT))
					continue;
				other.inert = true;
				held.push(other);
			}
			if (node.parentElement === document.body) break;
		}
		return () => {
			for (const other of held) other.inert = false;
		};
	}, [drawer]);

	// Beside the list the panel lies over the rail and whatever of the page's header is above the
	// rail. A control under it can't be seen or clicked, so it must not take keyboard focus either:
	// while the panel is open, every control of the page whose middle is under the panel leaves the
	// tab order, and comes back when the panel goes or the window changes width. What the panel
	// covers is still there for a screen reader. (A drawer makes the whole page inert instead.)
	// Measured again when the page gains or loses elements, so a row or a form that arrives while
	// the panel is open is held too.
	// biome-ignore lint/correctness/useExhaustiveDependencies: measured again for each item opened
	React.useLayoutEffect(() => {
		const panel = ref.current;
		const page = panel?.closest("main") ?? panel?.parentElement;
		if (!panel || !page || shown !== "beside") return;
		const held = new Map<HTMLElement, string | null>();
		const release = () => {
			for (const [control, was] of held) {
				if (!control.hasAttribute("data-panel-covered")) continue;
				control.removeAttribute("data-panel-covered");
				if (was === null) control.removeAttribute("tabindex");
				else control.setAttribute("tabindex", was);
			}
			held.clear();
		};
		const cover = () => {
			release();
			// Where the panel's left edge rests (it may still be sliding in).
			const edge = document.documentElement.clientWidth - panel.offsetWidth;
			for (const control of page.querySelectorAll<HTMLElement>(CONTROLS)) {
				if (panel.contains(control) || control.tabIndex < 0) continue;
				// Drawn over the panel (the Ask Noodle button), so still in view.
				if (control.closest("[data-over-panel]")) continue;
				const box = control.getBoundingClientRect();
				if (box.width === 0 || box.left + box.width / 2 < edge) continue;
				held.set(control, control.getAttribute("tabindex"));
				control.setAttribute("tabindex", "-1");
				control.setAttribute("data-panel-covered", "");
			}
		};
		cover();
		let frame = 0;
		const later = () => {
			cancelAnimationFrame(frame);
			frame = requestAnimationFrame(cover);
		};
		// Elements coming and going only: `cover` itself changes attributes, never the tree.
		const watch = new MutationObserver((changes) => {
			if (changes.some((change) => !panel.contains(change.target))) later();
		});
		watch.observe(page, { childList: true, subtree: true });
		window.addEventListener("resize", later);
		return () => {
			watch.disconnect();
			cancelAnimationFrame(frame);
			window.removeEventListener("resize", later);
			release();
		};
	}, [itemKey, shown]);

	// When the panel goes (Esc, Close, or the list's own tab), focus that was in it returns to the
	// item's row. A layout effect, so it runs while the panel can still say where focus was.
	React.useLayoutEffect(() => {
		const panel = ref.current;
		const root = panel?.parentElement ?? null;
		return () => {
			if (!panel || !wide()) return;
			const active = document.activeElement;
			const focus =
				active === null || active === document.body
					? "nowhere"
					: panel.contains(active)
						? "panel"
						: "elsewhere";
			if (!returnsFocus(focus)) return;
			const rows = rowsOf(root);
			const to = returnTarget(
				rows.map((item) => ({ picked: item === row.current, shown: item.offsetParent !== null })),
			);
			rows[to]?.focus();
		};
	}, []);

	return (
		<>
			{/* The dimmed page behind a drawer: a click on it closes, as Esc does. */}
			<div
				data-panel-scrim=""
				aria-hidden="true"
				// The press must not take focus out of the drawer (to the page's <main>), or closing
				// would not know to put it back on the item's row.
				onMouseDown={(event) => event.preventDefault()}
				onClick={() => closing.current()}
				className={cn(
					"fixed inset-0 z-35 hidden animate-fade-in bg-scrim",
					besideFrom === "late" ? "lg:max-[90rem]:block" : "lg:max-xl:block",
				)}
			/>
			<section
				ref={ref}
				data-slot="master-detail-detail"
				data-panel={size}
				data-panel-mode={shown ?? undefined}
				// A dialog only as a drawer; beside the list it is a region of the page.
				{...(drawer ? { role: "dialog", "aria-modal": true } : null)}
				aria-label={label}
				// Takes focus itself while the item's title hasn't arrived (it is still loading).
				tabIndex={-1}
				onScroll={(event) => {
					if (event.target === event.currentTarget) setScrolled(event.currentTarget.scrollTop > 0);
				}}
				className={cn(
					"@container/detail min-w-0 outline-none",
					"lg:fixed lg:inset-y-0 lg:right-0 lg:z-30 lg:overflow-y-auto lg:overscroll-contain",
					// A raised surface with an edge that reads in both themes: the stronger border, and
					// a shadow thrown left. The bottom padding keeps the end of the item clear of the Ask
					// Noodle button, which stays in the window's corner over the panel.
					"lg:rounded-l-3xl lg:border-l lg:border-border-strong lg:bg-popover lg:p-6 lg:pb-16 lg:shadow-side",
					// Slides in when an item opens; going from item to item it stays where it is.
					"lg:animate-side-in",
					// A drawer from lg (over its scrim and the Ask Noodle button, under sheets); from xl
					// what is to the right of the list column.
					"lg:w-[min(var(--detail-panel-drawer),100%)]",
					besideFrom === "late"
						? [
								"lg:max-[90rem]:z-35",
								size === "wide" ? "min-[90rem]:w-detail-panel-wide" : "min-[90rem]:w-detail-panel",
							]
						: ["lg:max-xl:z-35", size === "wide" ? "xl:w-detail-panel-wide" : "xl:w-detail-panel"],
					className,
				)}
				{...props}
			>
				{close ? (
					// In the top corner whatever the panel is scrolled to. It takes no room of its own:
					// the item's header leaves the corner free (`DetailHeader inPanel`).
					<div
						data-slot="detail-close"
						// Sticks at the panel's own padding (a scroller's padding already insets what sticks
						// in it); the margin puts the control on the middle line of the item's header.
						className="sticky top-0 z-10 flex h-0 justify-end max-lg:hidden [&>*]:mt-2.5"
					>
						{/* Once the panel is scrolled, Close has a strip of the panel's ground to itself, edge
						    to edge, so a row's amount goes under an edge and not under the button (issue
						    115). Not at the top, where the item's header is on this line. */}
						{scrolled ? (
							<span
								aria-hidden="true"
								data-slot="detail-close-ground"
								className="pointer-events-none absolute -inset-x-6 -top-6 -z-10 mt-0! h-19 border-b bg-popover"
							/>
						) : null}
						{close}
					</div>
				) : null}
				{children}
			</section>
		</>
	);
}

/**
 * A list, its rail and the item picked from the list (the list route's `<Outlet />`). From lg the
 * list and the rail are laid out as with nothing picked, whether or not an item is open, and the
 * item is a `DetailPanel` over them. Below lg it shows one level at a time: the list and then the
 * rail, or the item as ordinary page content.
 *
 * A row's link to its item carries `data-md-item` (the app's `masterDetailItem`), as in
 * MasterDetail; the router's `aria-current` on it is how the open item's row is known.
 */
function ListWithPanel({
	list,
	aside,
	detail,
	itemKey,
	size,
	besideFrom = "xl",
	asideFills,
	listLabel,
	asideLabel,
	detailLabel,
	onClose,
	close,
	className,
	...props
}: Omit<React.ComponentProps<"div">, "children"> & {
	list: React.ReactNode;
	/** The rail: the list's totals, its add form. On phones it follows the list. */
	aside?: React.ReactNode;
	/** The picked item, e.g. the detail route's outlet. Null or undefined when nothing is picked. */
	detail?: React.ReactNode;
	itemKey?: string;
	size?: DetailPanelSize;
	/**
	 * `late`: the list has the page's whole width up to 1440 with the rail under it, and the rail is
	 * beside it only from there (a table that needs the room). The item is a drawer until then.
	 */
	besideFrom?: BesideFrom;
	/**
	 * The aside is the page's working area rather than a rail (Scenarios' Compare): from lg it has
	 * the wide column and the list the list pane's width, item open or not, so neither changes shape
	 * when one opens. The panel is then over the aside's right-hand part.
	 */
	asideFills?: boolean;
	/** Names the list pane, e.g. "Commitments". */
	listLabel: string;
	/** Names the rail, e.g. "Commitments: totals, add and about". */
	asideLabel?: string;
	/** Names the panel, e.g. "Commitment details". */
	detailLabel: string;
	onClose: () => void;
	close?: React.ReactNode;
}) {
	const picked = detail !== null && detail !== undefined && detail !== false;
	return (
		<div
			data-slot="master-detail"
			data-picked={picked}
			className={cn(
				"grid grid-cols-[minmax(0,1fr)] gap-(--layout-gap) lg:items-start",
				asideFills
					? "lg:grid-cols-[var(--list-pane-width)_minmax(0,1fr)]"
					: aside
						? besideFrom === "late"
							? "min-[90rem]:grid-cols-[minmax(0,1fr)_var(--rail-width)]"
							: "lg:grid-cols-[minmax(0,1fr)_var(--rail-width)]"
						: null,
				className,
			)}
			{...props}
		>
			<MasterDetailPane
				data-slot="master-detail-list"
				aria-label={listLabel}
				className={cn(picked && "max-lg:hidden")}
			>
				{list}
			</MasterDetailPane>
			{aside ? (
				<MasterDetailPane
					data-slot="master-detail-aside"
					aria-label={asideLabel}
					className={cn(
						"@container/detail",
						// Under the list it is part of the page's flow: it doesn't stay put as a rail does.
						besideFrom === "late" && "lg:max-[90rem]:static!",
						picked && "max-lg:hidden",
					)}
				>
					{aside}
				</MasterDetailPane>
			) : null}
			{picked ? (
				<DetailPanel
					size={size}
					besideFrom={besideFrom}
					label={detailLabel}
					itemKey={itemKey}
					onClose={onClose}
					close={close}
				>
					{detail}
				</DetailPanel>
			) : null}
		</div>
	);
}

export { DetailPanel, ListWithPanel };
