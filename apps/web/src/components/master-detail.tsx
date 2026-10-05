import { Button } from "@noodle/ui/components/button";
import { Card } from "@noodle/ui/components/card";
import { ListWithPanel } from "@noodle/ui/components/detail-panel";
import { DetailColumns, MasterDetail } from "@noodle/ui/components/layout";
import { Skeleton } from "@noodle/ui/components/skeleton";
import type { DetailPanelSize } from "@noodle/ui/lib/detail-panel";
import { cn } from "@noodle/ui/lib/utils";
import { Link, type LinkOptions, Outlet, useNavigate } from "@tanstack/react-router";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { type KeyboardEvent, type ReactNode, Suspense } from "react";

// What every list-beside-its-item page shares (#67), next to `MasterDetail` in @noodle/ui: the
// row's marker and highlight, the keys, the detail's header with previous and next, and the
// skeleton that fills the detail pane alone while an item loads.
//
// A row's link to its item carries `{...masterDetailItem}`. The router marks the link of the item
// being shown with aria-current, which is what the highlight and the keys read: nothing else
// needs to know which item is picked.

/**
 * Spread on a row's link to its item, so the keys can find it and the row can show it's picked.
 * The link leaves the window's scroll alone, so picking from far down the list keeps the Parent's
 * place in it (on a phone, where the item is a page of its own, `MasterDetail` starts it at the top).
 */
export const masterDetailItem = { "data-md-item": "", resetScroll: false } as const;

/** On the list's wrapper: the picked item's row stands out. */
export const selectedRow =
	"[&_[data-slot=list-row]:has([data-md-item][aria-current])]:bg-surface-2 [&_[data-slot=list-row]:has([data-md-item][aria-current])]:shadow-[inset_2px_0_0_var(--color-primary)]";

const EDITING =
	'input, textarea, select, [contenteditable="true"], [role="menu"], [role="listbox"], [role="combobox"], [role="dialog"]';

/**
 * `onKeyDown` for a `MasterDetail`. In the list, ↑ and ↓ (and Home and End) move between the rows'
 * links, and Enter opens the one in focus, as a link does. In the detail, Esc puts focus back on
 * the picked item's row. Keys typed into a field, a menu or a sheet are left alone.
 */
export function masterDetailKeys(event: KeyboardEvent<HTMLElement>) {
	const root = event.currentTarget;
	const target = event.target as HTMLElement;
	// A sheet opened from a pane is elsewhere in the page, though its keys still arrive here.
	if (event.defaultPrevented || !root.contains(target) || target.closest(EDITING)) return;
	if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
	const list = root.querySelector<HTMLElement>('[data-slot="master-detail-list"]');
	if (!list) return;
	const items = [...list.querySelectorAll<HTMLElement>("[data-md-item]")].filter(
		(item) => item.offsetParent !== null,
	);
	if (items.length === 0) return;
	const picked = items.find((item) => item.hasAttribute("aria-current"));
	if (event.key === "Escape") {
		if (list.contains(target)) return;
		event.preventDefault();
		(picked ?? items[0])?.focus();
		return;
	}
	if (!list.contains(target)) return;
	const row = target.closest('[data-slot="list-row"]');
	const from = items.findIndex((item) => item === target || row?.contains(item));
	const at = from === -1 && picked ? items.indexOf(picked) : from;
	const to =
		event.key === "ArrowDown"
			? Math.min(at + 1, items.length - 1)
			: event.key === "ArrowUp"
				? Math.max(at - 1, 0)
				: event.key === "Home"
					? 0
					: event.key === "End"
						? items.length - 1
						: null;
	if (to === null) return;
	event.preventDefault();
	items[to]?.focus();
}

/**
 * `onKeyDown` where the picked item opens in a `DetailPanel` (issue 107): the list's keys as above.
 * Esc is the panel's own: it closes the item and puts focus back on its row.
 */
export function panelKeys(event: KeyboardEvent<HTMLElement>) {
	if (event.key !== "Escape") masterDetailKeys(event);
}

/**
 * On the section's header (its `PageHeader`, or the header and tabs of a `SectionLayout`). On a
 * phone an open item is a page of its own with its own header (`DetailHeader`: Back returns to the
 * list), so the section's header isn't drawn over it: its h1 stays for screen readers, and its
 * actions and tabs, which belong to the list, go (#74). From lg, where the list is beside the item,
 * nothing changes. `DetailHeader` and `DetailPending` carry `data-item-page`.
 */
export const sectionHeaderOverItem =
	"max-lg:[main:has([data-item-page])_&]:sr-only max-lg:[main:has([data-item-page])_&]:min-h-0 max-lg:[main:has([data-item-page])_&_:is(a,button,nav)]:hidden";

/** The item before and after `id` in the list's order. */
export function neighbours(ids: readonly string[], id: string) {
	const at = ids.indexOf(id);
	return at === -1
		? { previous: undefined, next: undefined }
		: { previous: ids[at - 1], next: ids[at + 1] };
}

/** Previous and next in the detail's header, in the list's order. Nothing for an item not in it. */
export function DetailPager({
	ids,
	id,
	noun,
	link,
}: {
	ids: readonly string[];
	id: string;
	/** What an item is called, e.g. "Bucket". */
	noun: string;
	link: (id: string) => LinkOptions;
}) {
	const { previous, next } = neighbours(ids, id);
	if (!ids.includes(id) || ids.length < 2) return null;
	// At either end the link stays, switched off, so focus isn't dropped when the last step lands.
	const step = (to: string | undefined, label: string, icon: ReactNode) => (
		<Button
			variant="ghost"
			size="icon"
			asChild
			className="aria-disabled:pointer-events-none aria-disabled:opacity-50"
		>
			<Link {...link(to ?? id)} disabled={!to} tabIndex={0} aria-label={label}>
				{icon}
			</Link>
		</Button>
	);
	return (
		<div data-slot="detail-pager" className="flex items-center">
			{step(previous, `Previous ${noun}`, <ChevronUp />)}
			{step(next, `Next ${noun}`, <ChevronDown />)}
		</div>
	);
}

/**
 * In a panel, where the header's controls start: as far down as the panel's Close (`detail-close`
 * in @noodle/ui's DetailPanel), so the three are on one line however many lines the title takes
 * (issue 107).
 */
const inPanelLine = "lg:mt-2.5";

/**
 * The detail's header: Back to the list, what the item is, its actions, and previous and next.
 * Its title is an h2, under the section's h1 (which a phone keeps for screen readers only:
 * `sectionHeaderOverItem`). On a phone it follows the phone header's rule
 * (COMPONENTS.md, #74): one row at least 52px tall on the 16px gutter with Back, the eyebrow and
 * title, and previous/next; at most one action, which drops under the row when it doesn't fit.
 */
export function DetailHeader({
	eyebrow,
	title,
	leading,
	actions,
	pager,
	listBeside,
	inPanel,
}: {
	eyebrow?: ReactNode;
	title: ReactNode;
	/** Back to the list. */
	leading?: ReactNode;
	actions?: ReactNode;
	pager?: ReactNode;
	/**
	 * From lg the list is on screen beside this item, and is the way to it and between items (#73):
	 * Back and previous/next show only below lg, where the item is a page of its own.
	 */
	listBeside?: boolean;
	/**
	 * From lg the item is in a `DetailPanel` over the page (issue 107): the panel has its own Close,
	 * so Back shows only below lg, where the item is a page; previous and next show at every width.
	 */
	inPanel?: boolean;
}) {
	const phoneOnly = listBeside ? "lg:hidden" : undefined;
	return (
		<header
			data-slot="detail-header"
			data-item-page=""
			className={cn(
				"mb-6 flex flex-wrap items-center gap-x-2 gap-y-1 max-lg:mb-4 max-lg:min-h-13 max-lg:gap-x-1",
				// Room for the panel's Close, which sits in this corner. Previous/next and the actions
				// start on Close's line (`inPanelLine`) rather than the middle of a title that wraps.
				inPanel && "lg:items-start lg:pe-10",
			)}
		>
			{/* Phones: the arrow's glyph, not its 44px box, sits on the 16px gutter. */}
			{leading ? (
				<div
					data-slot="detail-back"
					className={cn("flex max-lg:-ms-3", inPanel ? "lg:hidden" : phoneOnly)}
				>
					{leading}
				</div>
			) : null}
			{/* At least ~12 characters of title: past that the actions drop to their own row (#65). */}
			<div className="min-w-0 flex-1 basis-32 lg:basis-36">
				{eyebrow ? (
					<p data-slot="detail-eyebrow" className="text-[13px] font-medium text-muted-foreground">
						{eyebrow}
					</p>
				) : null}
				<h2
					data-slot="detail-title"
					// Focus lands here when the item opens in a panel (ADR-0047). The app's ring, around the
					// words only, and only when the panel was opened from the keyboard: DetailPanel marks
					// the title then. Focus moved here after a click or a page load draws nothing.
					tabIndex={-1}
					className="w-fit max-w-full rounded-sm text-xl font-semibold tracking-[-0.02em] text-balance break-words outline-none data-keyboard-open:focus:outline-offset-2 data-keyboard-open:focus:[outline:2px_solid_var(--ring)] lg:text-2xl"
				>
					{title}
				</h2>
			</div>
			{/* Previous and next stay on the title's row at 320 (they come before the actions, which
			    may drop under it); from lg they are last. */}
			{pager ? (
				<div
					className={cn(
						"flex lg:order-last",
						!actions && "max-lg:-me-2",
						phoneOnly,
						inPanel && inPanelLine,
					)}
				>
					{pager}
				</div>
			) : null}
			{actions ? (
				<div
					data-slot="detail-actions"
					className={cn("ms-auto flex items-center gap-1", inPanel && inPanelLine)}
				>
					{actions}
				</div>
			) : null}
		</header>
	);
}

/** An item that's slow to load: a skeleton in the detail pane, while the list stays as it is. */
export function DetailPending() {
	return (
		<div role="status" aria-label="Loading" data-slot="detail-pending" data-item-page="">
			{/* As DetailHeader: the same space under it, then the blocks in the columns the item's page
			    uses, so nothing moves when it arrives. */}
			<div className="mb-6 grid gap-2">
				<Skeleton className="h-3.5 w-20" />
				<Skeleton className="h-7 w-48 lg:h-8" />
			</div>
			<DetailColumns className="gap-8">
				<Card className="col-span-full grid gap-3 p-(--card-pad)">
					<Skeleton className="h-3.5 w-24" />
					<Skeleton className="h-10 w-36" />
					<Skeleton className="h-3.5 w-52" />
				</Card>
				{[0, 1].map((column) => (
					<div key={column} className="grid gap-3">
						<Skeleton className="h-4 w-28" />
						<Card className="grid gap-3 p-(--card-pad)">
							<Skeleton className="h-4 w-full" />
							<Skeleton className="h-4 w-4/5" />
							<Skeleton className="h-4 w-3/5" />
						</Card>
					</div>
				))}
			</DetailColumns>
		</div>
	);
}

/**
 * A section whose items have pages of their own (Goals, Accounts): the list on the left and, from
 * lg, the picked item beside it (its route is this one's child). With nothing picked the right
 * pane holds the section's totals; on phones those come first, then the list, and an item is a
 * page with Back.
 */
export function ListBesideDetail({
	picked,
	noun,
	listLabel,
	hint,
	list,
	aside,
	asideFills,
	listFills,
	panel,
}: {
	/** An item's route is showing. */
	picked: boolean;
	/** What an item is called, e.g. "Goal". */
	noun: string;
	/** Names the list pane, e.g. "Goals". */
	listLabel: string;
	/**
	 * Says what the right pane is for while it is empty, e.g. "Tick Scenarios to compare them here."
	 * Left out where the list fills the page: its cards say they open. With `panel` it shows only
	 * for an `asideFills` page with no aside, from lg.
	 */
	hint?: string;
	list: ReactNode;
	/** The right pane while nothing is picked; on phones it comes before the list. */
	aside?: ReactNode;
	/**
	 * The aside is the section's own working area rather than its totals (Scenarios' Compare): it
	 * takes the pane's width, and on phones it comes after the list.
	 */
	asideFills?: boolean;
	/**
	 * While nothing is picked the list takes the wide column and the aside the rail's width, so a
	 * list of cards (Goals) fills the window; once an item is picked it's the narrow list pane again
	 * (#73L, ADR-0033).
	 */
	listFills?: boolean;
	/**
	 * From lg the picked item opens in a panel from the window's right edge, over the page, and the
	 * list and the aside stay as they are with nothing picked (issue 107, ADR-0047). `close` is the
	 * list's own address. Without it, the item sits beside a narrowed list, as before.
	 */
	panel?: {
		size?: DetailPanelSize;
		close: LinkOptions /** The picked item's id. */;
		itemKey?: string;
	};
}) {
	const navigate = useNavigate();
	const shownList = (
		<div className={cn("grid min-w-0 content-start gap-8", selectedRow)}>{list}</div>
	);
	const detail = picked ? (
		<div className="@container">
			<Suspense fallback={<DetailPending />}>
				<Outlet />
			</Suspense>
		</div>
	) : undefined;
	if (panel)
		return (
			<ListWithPanel
				className={cn(
					asideFills
						? // A phone has no use for the hint alone.
							"max-lg:[&>[data-slot=master-detail-aside]:has(>[data-hint-only])]:hidden"
						: // Phones: the section's totals come before the list, as they did.
							"max-lg:[&>[data-slot=master-detail-aside]]:order-first",
				)}
				asideFills={asideFills}
				size={panel.size}
				itemKey={panel.itemKey}
				listLabel={listLabel}
				asideLabel={`${listLabel} overview`}
				detailLabel={`${noun} details`}
				onKeyDown={panelKeys}
				onClose={() => navigate({ ...panel.close, resetScroll: false })}
				close={
					// A link, so it works before the page has hydrated.
					<Button variant="ghost" size="icon" asChild className="bg-background">
						<Link {...panel.close} resetScroll={false} aria-label={`Close ${noun}`}>
							<X />
						</Link>
					</Button>
				}
				list={shownList}
				aside={
					aside ? (
						<div className="grid w-full content-start gap-4">{aside}</div>
					) : asideFills && hint ? (
						<p data-hint-only="" className="px-1 text-sm text-muted-foreground">
							{hint}
						</p>
					) : undefined
				}
				detail={detail}
			/>
		);
	return (
		<MasterDetail
			className={cn(!asideFills && "max-lg:[&>[data-slot=master-detail-detail]]:order-first")}
			data-list-fills={listFills && !picked ? "true" : undefined}
			listLabel={listLabel}
			detailLabel={picked ? `${noun} details` : `${listLabel} overview`}
			emptyStacks={Boolean(aside)}
			onKeyDown={masterDetailKeys}
			list={shownList}
			detail={detail}
			empty={
				<div className={cn("grid w-full content-start gap-4", !asideFills && "lg:max-w-md")}>
					{aside}
					{hint ? <p className="px-1 text-sm text-muted-foreground max-lg:hidden">{hint}</p> : null}
				</div>
			}
		/>
	);
}
