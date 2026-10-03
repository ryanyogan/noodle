import { Button } from "@noodle/ui/components/button";
import { Card } from "@noodle/ui/components/card";
import { MasterDetail } from "@noodle/ui/components/layout";
import { Skeleton } from "@noodle/ui/components/skeleton";
import { cn } from "@noodle/ui/lib/utils";
import { Link, type LinkOptions, Outlet } from "@tanstack/react-router";
import { ChevronDown, ChevronUp } from "lucide-react";
import { type KeyboardEvent, type ReactNode, Suspense } from "react";

// What every list-beside-its-item page shares (#67), next to `MasterDetail` in @noodle/ui: the
// row's marker and highlight, the keys, the detail's header with previous and next, and the
// skeleton that fills the detail pane alone while an item loads.
//
// A row's link to its item carries `{...masterDetailItem}`. The router marks the link of the item
// being shown with aria-current, which is what the highlight and the keys read: nothing else
// needs to know which item is picked.

/** Spread on a row's link to its item, so the keys can find it and the row can show it's picked. */
export const masterDetailItem = { "data-md-item": "" } as const;

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
 * The detail's header: Back to the list, what the item is, its actions, and previous and next.
 * Its title is an h2, under the section's h1.
 */
export function DetailHeader({
	eyebrow,
	title,
	leading,
	actions,
	pager,
}: {
	eyebrow?: ReactNode;
	title: ReactNode;
	/** Back to the list. */
	leading?: ReactNode;
	actions?: ReactNode;
	pager?: ReactNode;
}) {
	return (
		<header data-slot="detail-header" className="mb-6 flex flex-wrap items-center gap-x-2 gap-y-1">
			{leading}
			{/* At least ~12 characters of title: past that the actions drop to their own row (#65). */}
			<div className="min-w-0 flex-1 basis-36">
				{eyebrow ? (
					<p className="text-[13px] font-medium text-muted-foreground">{eyebrow}</p>
				) : null}
				<h2
					data-slot="detail-title"
					className="text-xl font-semibold tracking-[-0.02em] text-balance break-words lg:text-2xl"
				>
					{title}
				</h2>
			</div>
			<div className="ms-auto flex items-center gap-1">
				{actions}
				{pager}
			</div>
		</header>
	);
}

/** An item that's slow to load: a skeleton in the detail pane, while the list stays as it is. */
export function DetailPending() {
	return (
		<div role="status" aria-label="Loading" data-slot="detail-pending" className="grid gap-8">
			<div className="grid gap-2">
				<Skeleton className="h-3.5 w-20" />
				<Skeleton className="h-7 w-48" />
			</div>
			<Card className="grid gap-3 p-(--card-pad)">
				<Skeleton className="h-3.5 w-24" />
				<Skeleton className="h-10 w-36" />
				<Skeleton className="h-3.5 w-52" />
			</Card>
			<Card className="grid gap-3 p-(--card-pad)">
				<Skeleton className="h-4 w-full" />
				<Skeleton className="h-4 w-4/5" />
				<Skeleton className="h-4 w-3/5" />
			</Card>
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
}: {
	/** An item's route is showing. */
	picked: boolean;
	/** What an item is called, e.g. "Goal". */
	noun: string;
	/** Names the list pane, e.g. "Goals". */
	listLabel: string;
	/** Says what the right pane is for while nothing is picked, e.g. "Pick a Goal to see it here." */
	hint: string;
	list: ReactNode;
	/** The right pane while nothing is picked; on phones it comes before the list. */
	aside?: ReactNode;
	/**
	 * The aside is the section's own working area rather than its totals (Scenarios' Compare): it
	 * takes the pane's width, and on phones it comes after the list.
	 */
	asideFills?: boolean;
}) {
	return (
		<MasterDetail
			className={asideFills ? undefined : "max-lg:[&>[data-slot=master-detail-detail]]:order-first"}
			listLabel={listLabel}
			detailLabel={picked ? `${noun} details` : `${listLabel} overview`}
			emptyStacks={Boolean(aside)}
			onKeyDown={masterDetailKeys}
			list={<div className={cn("grid min-w-0 content-start gap-8", selectedRow)}>{list}</div>}
			detail={
				picked ? (
					<div className="@container">
						<Suspense fallback={<DetailPending />}>
							<Outlet />
						</Suspense>
					</div>
				) : undefined
			}
			empty={
				<div className={cn("grid w-full content-start gap-4", !asideFills && "lg:max-w-md")}>
					{aside}
					<p className="px-1 text-sm text-muted-foreground max-lg:hidden">{hint}</p>
				</div>
			}
		/>
	);
}
