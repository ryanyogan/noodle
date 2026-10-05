import * as React from "react";
import { MasterDetailPane } from "#components/layout";
import {
	closesOnEscape,
	type DetailPanelSize,
	PANEL_FROM,
	returnsFocus,
	returnTarget,
} from "#lib/detail-panel";
import { cn } from "#lib/utils";

/*
 * A picked item in a panel from the window's right edge (issue 107, ADR-0047). The Parent: "the
 * two column views are weird as the rows condense too far on the left when selected". So from lg
 * the list keeps its width and its columns, and the item opens over the page instead of beside a
 * narrowed list. Below lg nothing is different from MasterDetail: the item is a page with Back.
 *
 * It is not a dialog. There is no scrim, no focus trap and no scroll lock: the list under it stays
 * clickable, so the Parent goes from one item to the next without closing anything, and the page
 * behind still scrolls. The panel scrolls on its own, as a sheet does.
 *
 * It renders in place (no portal), so an item opened by its address is in the server's HTML and
 * phones and desktops share one DOM. Nothing between <body> and it may create a containing block
 * for fixed boxes (transform, filter, contain, container-type): keep it out of `@container`s.
 */

const wide = () => window.matchMedia(`(min-width: ${PANEL_FROM}px)`).matches;

const EDITING = 'input, textarea, select, [contenteditable="true"], [role="combobox"]';
const LAYERS = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';

/** The rows of the list this panel belongs to: its sibling in a `ListWithPanel`. */
const rowsOf = (root: Element | null) =>
	root
		? [...root.querySelectorAll<HTMLElement>("[data-slot=master-detail-list] [data-md-item]")]
		: [];

function DetailPanel({
	size = "default",
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
	// The open item's row, remembered while it is marked, since the mark goes as the panel closes.
	const row = React.useRef<HTMLElement | null>(null);
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
	// biome-ignore lint/correctness/useExhaustiveDependencies: runs again for each item opened
	React.useEffect(() => {
		const panel = ref.current;
		if (!panel || !wide() || panel.contains(document.activeElement)) return;
		if (document.querySelector(LAYERS)) return;
		const title = panel.querySelector<HTMLElement>("[data-slot=detail-title][tabindex]");
		(title ?? panel).focus({ preventScroll: true });
	}, [itemKey]);

	// Esc closes, from the panel or the list, unless something nearer has a use for the key.
	React.useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			const target = event.target instanceof Element ? event.target : null;
			const at = {
				panel: wide(),
				editing: target?.closest(EDITING) != null,
				layerOpen: document.querySelector(LAYERS) !== null,
			};
			if (!closesOnEscape(event, at)) return;
			event.preventDefault();
			closing.current();
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, []);

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
		<section
			ref={ref}
			data-slot="master-detail-detail"
			data-panel={size}
			aria-label={label}
			// Takes focus itself while the item's title hasn't arrived (it is still loading).
			tabIndex={-1}
			className={cn(
				"@container/detail min-w-0 outline-none",
				"lg:fixed lg:inset-y-0 lg:right-0 lg:z-30 lg:overflow-y-auto lg:overscroll-contain",
				"lg:rounded-l-3xl lg:border-l lg:bg-background lg:p-6 lg:shadow-pop",
				// Slides in when an item opens; going from item to item it stays where it is.
				"lg:animate-side-in",
				size === "wide" ? "lg:w-(--detail-panel-width-wide)" : "lg:w-(--detail-panel-width)",
				className,
			)}
			{...props}
		>
			{close ? (
				// In the top corner whatever the panel is scrolled to. It takes no room of its own: the
				// item's header leaves the corner free (`DetailHeader inPanel`).
				<div
					data-slot="detail-close"
					className="sticky top-6 z-10 flex h-0 justify-end max-lg:hidden"
				>
					{close}
				</div>
			) : null}
			{children}
		</section>
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
				aside ? "lg:grid-cols-[minmax(0,1fr)_var(--rail-width)]" : null,
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
					className={cn("@container/detail", picked && "max-lg:hidden")}
				>
					{aside}
				</MasterDetailPane>
			) : null}
			{picked ? (
				<DetailPanel
					size={size}
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
