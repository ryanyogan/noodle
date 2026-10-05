import type { BucketState, MonthKey, PlanBucket } from "@noodle/domain";
import { Button } from "@noodle/ui/components/button";
import { List } from "@noodle/ui/components/list";
import { useHydrated } from "@tanstack/react-router";
import { GripVertical } from "lucide-react";
import {
	type KeyboardEvent,
	type PointerEvent as ReactPointerEvent,
	useEffect,
	useId,
	useRef,
	useState,
} from "react";
import {
	clampDrag,
	dragBegins,
	edgeScroll,
	indexAt,
	moved,
	type RowBox,
	shifts,
} from "../bucket-drag";
import { BucketColumns, BucketEditor, useBucketChanges } from "./bucket-editor";

/** A press on a handle, from pointer down until it's dropped, cancelled or let go unmoved. */
type Drag = {
	id: string;
	pointerId: number;
	pointerType: string;
	handle: HTMLElement;
	/** The rows and where they were when the press began; they don't move in the page until the drop. */
	rows: HTMLElement[];
	boxes: RowBox[];
	order: string[];
	from: number;
	to: number;
	startX: number;
	startY: number;
	x: number;
	y: number;
	/** What scrolls the list, and how far it had scrolled when the press began. */
	scroller: Element;
	startScroll: number;
	/** Whether the press has become a drag (see `dragBegins`). */
	lifted: boolean;
	frame: number;
	/** Takes the page's listeners off again. */
	unlisten: () => void;
};

/** The nearest thing around `element` that scrolls up and down: a pane, or else the page. */
function scrollerOf(element: Element): Element {
	for (let parent = element.parentElement; parent; parent = parent.parentElement) {
		const { overflowY } = getComputedStyle(parent);
		if (
			(overflowY === "auto" || overflowY === "scroll") &&
			parent.scrollHeight > parent.clientHeight
		) {
			return parent;
		}
	}
	return document.scrollingElement ?? document.documentElement;
}

/**
 * The Plan's shared Buckets, in order. Each row's handle moves it: dragged by mouse or touch, or
 * by the up and down arrow keys once focused. Where it lands is said aloud ("Groceries moved to
 * position 2 of 8") and saved once, at the drop. Plain pointer events cover mouse, pen and touch, so
 * no drag library is needed.
 *
 * While a row is dragged the rows stay where they are in the page and are only shifted on screen
 * (issue 106). Putting them in their new order as the pointer passed took the dragged row out of
 * the page and back whenever it went down the list, and a browser stops sending a press to a
 * handle that has left the page: the drag died after one row, half the time. The page, not the
 * handle, listens for the rest of the press, so nothing that happens to the handle can lose it.
 */
export function BucketList({
	month,
	buckets,
	editable,
	was,
	onDraft,
	figures,
}: {
	month: MonthKey;
	buckets: (PlanBucket | BucketState)[];
	/** In a wide list each row shows its allowance, spent, left and bar in columns. */
	figures?: boolean;
	editable: boolean;
	was: Record<string, number | undefined>;
	/** A Bucket's amount while it's being typed in the list, or null when it's put away. */
	onDraft: (bucketId: string, cents: number | null) => void;
}) {
	const hydrated = useHydrated();
	const hintId = useId();
	const changes = useBucketChanges(month);
	const listRef = useRef<HTMLDivElement>(null);
	const drag = useRef<Drag | null>(null);
	/** The Bucket being dragged, for its row's raised look. */
	const [lifted, setLifted] = useState<string | null>(null);
	/** The order just dropped, shown until the Plan has it (or has refused it). */
	const [dropped, setDropped] = useState<string[] | null>(null);
	const [said, setSaid] = useState("");
	const known = new Set(buckets.map((b) => b.id));
	const ids =
		dropped && dropped.length === known.size && dropped.every((id) => known.has(id))
			? dropped
			: buckets.map((b) => b.id);
	const shown = ids.flatMap((id) => buckets.find((b) => b.id === id) ?? []);
	const nameOf = (id: string) => buckets.find((b) => b.id === id)?.name ?? "Bucket";

	function save(next: string[], id: string) {
		if (next.join() === ids.join()) {
			setSaid(`${nameOf(id)} stays at position ${next.indexOf(id) + 1} of ${next.length}`);
			return;
		}
		setDropped(next);
		changes.reorder.mutate({ bucketIds: next }, { onSettled: () => setDropped(null) });
		setSaid(`${nameOf(id)} moved to position ${next.indexOf(id) + 1} of ${next.length}`);
	}

	function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, id: string) {
		const by = { ArrowUp: -1, ArrowDown: 1, Home: -ids.length, End: ids.length }[event.key];
		if (by === undefined) return;
		event.preventDefault();
		event.stopPropagation();
		const from = ids.indexOf(id);
		const to = Math.max(0, Math.min(ids.length - 1, from + by));
		if (to === from) return;
		save(moved(ids, id, to), id);
		// The row is moved in the page, which can take focus from its handle; give it back.
		requestAnimationFrame(() =>
			listRef.current?.querySelector<HTMLElement>(`[data-reorder="${id}"]`)?.focus(),
		);
	}

	/** Shows the drag where the pointer now is: the row under it, the others making room. */
	function follow() {
		const now = drag.current;
		if (!now) return;
		if (!now.lifted) {
			if (!dragBegins(now.pointerType, now.x - now.startX, now.y - now.startY)) return;
			now.lifted = true;
			setLifted(now.id);
			const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
			now.rows.forEach((row, index) => {
				if (index !== now.from && !still) row.style.transition = "transform 150ms ease";
			});
			document.documentElement.style.cursor = "grabbing";
			now.frame = requestAnimationFrame(nearEdge);
		}
		// The page may have scrolled under a pointer that stayed still; the row goes with the pointer.
		const scrolled = now.scroller.scrollTop - now.startScroll;
		const dy = clampDrag(now.boxes, now.from, now.y - now.startY + scrolled);
		now.to = indexAt(now.boxes, now.from, dy);
		shifts(now.boxes, now.from, now.to, dy).forEach((by, index) => {
			const row = now.rows[index];
			if (row) row.style.transform = by === 0 ? "" : `translate3d(0, ${by}px, 0)`;
		});
	}

	/** Scrolls while the row is held near the top or bottom edge, so a long list can be crossed. */
	function nearEdge() {
		const now = drag.current;
		if (!now?.lifted) return;
		const page = now.scroller === (document.scrollingElement ?? document.documentElement);
		const box = now.scroller.getBoundingClientRect();
		const by = edgeScroll(now.y, page ? 0 : box.top, page ? window.innerHeight : box.bottom);
		if (by !== 0) {
			const before = now.scroller.scrollTop;
			now.scroller.scrollTop = before + by;
			if (now.scroller.scrollTop !== before) follow();
		}
		now.frame = requestAnimationFrame(nearEdge);
	}

	/** Ends the press: the rows go back to being laid out by the page, and a drop is saved once. */
	function finish(drop: boolean) {
		const now = drag.current;
		if (!now) return;
		drag.current = null;
		now.unlisten();
		cancelAnimationFrame(now.frame);
		if (now.handle.hasPointerCapture(now.pointerId))
			now.handle.releasePointerCapture(now.pointerId);
		for (const row of now.rows) {
			row.style.transform = "";
			row.style.transition = "";
		}
		const root = document.documentElement.style;
		root.cursor = "";
		root.userSelect = "";
		root.removeProperty("-webkit-user-select");
		if (!now.lifted) return;
		setLifted(null);
		if (drop && now.to !== now.from) save(moved(now.order, now.id, now.to), now.id);
		else if (!drop)
			setSaid(`${nameOf(now.id)} put back at position ${now.from + 1} of ${now.order.length}`);
	}

	function onPointerDown(event: ReactPointerEvent<HTMLButtonElement>, id: string) {
		if (event.button !== 0 || !event.isPrimary || drag.current) return;
		const rows = [...(listRef.current?.querySelectorAll<HTMLElement>("[data-bucket-row]") ?? [])];
		const from = rows.findIndex((row) => row.dataset.bucketRow === id);
		if (from < 0 || !listRef.current) return;
		const handle = event.currentTarget;
		const { pointerId } = event;
		// Capture keeps the press on the handle (its pressed look, the click that ends it); the drag
		// itself doesn't depend on it.
		try {
			handle.setPointerCapture(pointerId);
		} catch {}
		// No text is picked up by a press that wanders off the handle.
		const root = document.documentElement.style;
		root.userSelect = "none";
		root.setProperty("-webkit-user-select", "none");

		const mine = (e: PointerEvent) => e.pointerId === pointerId;
		const onMove = (e: PointerEvent) => {
			const now = drag.current;
			if (!now || !mine(e)) return;
			now.x = e.clientX;
			now.y = e.clientY;
			follow();
		};
		const onUp = (e: PointerEvent) => {
			if (mine(e)) finish(true);
		};
		const onCancel = (e: PointerEvent) => {
			if (mine(e)) finish(false);
		};
		const onKey = (e: globalThis.KeyboardEvent) => {
			if (e.key !== "Escape") return;
			// Escape puts the row back, and is not also for whatever else is listening.
			e.preventDefault();
			e.stopPropagation();
			finish(false);
		};
		const onBlur = () => finish(false);
		const onScroll = () => follow();
		document.addEventListener("pointermove", onMove);
		document.addEventListener("pointerup", onUp);
		document.addEventListener("pointercancel", onCancel);
		document.addEventListener("keydown", onKey, true);
		window.addEventListener("blur", onBlur);
		window.addEventListener("scroll", onScroll, true);
		const scroller = scrollerOf(listRef.current);
		drag.current = {
			id,
			pointerId,
			pointerType: event.pointerType,
			handle,
			rows,
			boxes: rows.map((row) => {
				const box = row.getBoundingClientRect();
				return { top: box.top, height: box.height };
			}),
			order: ids,
			from,
			to: from,
			startX: event.clientX,
			startY: event.clientY,
			x: event.clientX,
			y: event.clientY,
			scroller,
			startScroll: scroller.scrollTop,
			lifted: false,
			frame: 0,
			unlisten: () => {
				document.removeEventListener("pointermove", onMove);
				document.removeEventListener("pointerup", onUp);
				document.removeEventListener("pointercancel", onCancel);
				document.removeEventListener("keydown", onKey, true);
				window.removeEventListener("blur", onBlur);
				window.removeEventListener("scroll", onScroll, true);
			},
		};
		follow();
	}

	// A list that changes under a drag (the other Parent adds or moves a Bucket) puts the row back:
	// the rows measured when the press began are no longer the rows on screen.
	const finishRef = useRef(finish);
	finishRef.current = finish;
	const orderNow = ids.join();
	useEffect(() => {
		if (drag.current && drag.current.order.join() !== orderNow) finishRef.current(false);
	}, [orderNow]);
	useEffect(() => () => finishRef.current(false), []);

	return (
		<div ref={listRef} className="grid gap-2">
			{figures ? <BucketColumns pencil={editable} /> : null}
			<List>
				{shown.map((bucket) => (
					<BucketEditor
						key={bucket.id}
						figures={figures}
						month={month}
						bucket={bucket}
						editable={editable}
						was={was[bucket.id]}
						order={ids}
						onDraft={(cents) => onDraft(bucket.id, cents)}
						dragged={lifted === bucket.id}
						handle={
							editable && buckets.length > 1 ? (
								<Button
									type="button"
									variant="ghost"
									size="icon"
									data-reorder={bucket.id}
									disabled={!hydrated}
									aria-label={`Move ${bucket.name}`}
									aria-describedby={hintId}
									// 32 px square with a mouse, 44 px under a thumb (the Button's icon size). Only
									// the handle refuses to scroll: a touch anywhere else on the row scrolls the page.
									className="-ms-2 cursor-grab touch-none select-none [-webkit-touch-callout:none] active:cursor-grabbing"
									onKeyDown={(event) => onKeyDown(event, bucket.id)}
									onPointerDown={(event) => onPointerDown(event, bucket.id)}
									// A long press mustn't bring up a menu in the middle of a drag.
									onContextMenu={(event) => {
										if (drag.current) event.preventDefault();
									}}
								>
									<GripVertical />
								</Button>
							) : null
						}
					/>
				))}
			</List>
			<p id={hintId} hidden>
				Drag to move it, or press the up or down arrow key.
			</p>
			<p aria-live="assertive" className="sr-only" data-testid="reorder-said">
				{said}
			</p>
			{changes.failed}
		</div>
	);
}
