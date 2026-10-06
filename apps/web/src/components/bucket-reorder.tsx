import { putInOrder } from "@noodle/domain";
import {
	type KeyboardEvent,
	type MouseEvent as ReactMouseEvent,
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
import { beginsOnHandle, bucketClick } from "../bucket-row-click";

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
	/** The Buckets it moves among (its group's), in order: `rows`, `boxes`, `from` and `to` are theirs. */
	among: string[];
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
 * Moving the Plan's shared Buckets by their handles: dragged by mouse or touch, or by the up and
 * down arrow keys (Home, End) once a handle is focused. Where a Bucket lands is said aloud
 * ("Groceries moved to position 2 of 8") and saved once, at the drop. Plain pointer events cover
 * mouse, pen and touch, so no drag library is needed.
 *
 * The rows are whatever under `listRef` carries `data-bucket-row` (the Buckets table gives its rows
 * that attribute). While one is dragged they stay where they are in the page and are only shifted
 * on screen (issue 106). Putting them in their new order as the pointer passed took the dragged row
 * out of the page and back whenever it went down the list, and a browser stops sending a press to
 * a handle that has left the page: the drag died after one row, half the time. The page, not the
 * handle, listens for the rest of the press, so nothing that happens to the handle can lose it.
 */
export function useBucketReorder({
	buckets,
	peers,
	reorder,
}: {
	buckets: readonly { id: string; name: string }[];
	/**
	 * The Buckets a Bucket moves among, when not all of them: those of its group (issue 98). A drag
	 * and the arrow keys stop at the group's first and last Bucket.
	 */
	peers?: (id: string) => readonly string[];
	/** Saves the new order; `settled` once the Plan has it, or has refused it. */
	reorder: (ids: string[], settled: () => void) => void;
}) {
	const hintId = useId();
	const listRef = useRef<HTMLDivElement>(null);
	const drag = useRef<Drag | null>(null);
	/** The Bucket being dragged, for its row's raised look. */
	const [lifted, setLifted] = useState<string | null>(null);
	/** The order just dropped, shown until the Plan has it (or has refused it). */
	const [dropped, setDropped] = useState<{ order: string[]; from: string } | null>(null);
	const [said, setSaid] = useState("");
	/** Whether the press now under way began on a handle: the click that ends it opens nothing. */
	const onHandle = useRef(false);
	const known = new Set(buckets.map((b) => b.id));
	const own = buckets.map((b) => b.id);
	// Only while the Plan still has the order the drop began from: once it has any other (the drop's
	// own, or one made elsewhere, as by the sheet's Move up), the Plan's order is what shows. A
	// second save before the first has settled never reports the first as settled (issue 98).
	const ids =
		dropped &&
		dropped.from === own.join() &&
		dropped.order.length === known.size &&
		dropped.order.every((id) => known.has(id))
			? dropped.order
			: own;
	const amongOf = (id: string) => {
		const group = peers ? new Set(peers(id)) : null;
		return group ? ids.filter((other) => group.has(other)) : ids;
	};
	const nameOf = (id: string) => buckets.find((b) => b.id === id)?.name ?? "Bucket";

	function save(next: string[], id: string) {
		if (next.join() === ids.join()) {
			setSaid(`${nameOf(id)} stays at position ${next.indexOf(id) + 1} of ${next.length}`);
			return;
		}
		setDropped({ order: next, from: own.join() });
		reorder(next, () => setDropped(null));
		setSaid(`${nameOf(id)} moved to position ${next.indexOf(id) + 1} of ${next.length}`);
	}

	function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, id: string) {
		const among = amongOf(id);
		const by = { ArrowUp: -1, ArrowDown: 1, Home: -among.length, End: among.length }[event.key];
		if (by === undefined) return;
		event.preventDefault();
		event.stopPropagation();
		const from = among.indexOf(id);
		const to = Math.max(0, Math.min(among.length - 1, from + by));
		if (to === from) return;
		save(putInOrder(ids, moved(among, id, to)), id);
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
		if (drop && now.to !== now.from) {
			save(putInOrder(now.order, moved(now.among, now.id, now.to)), now.id);
		} else if (!drop)
			setSaid(`${nameOf(now.id)} put back at position ${now.from + 1} of ${now.order.length}`);
	}

	function onPointerDown(event: ReactPointerEvent<HTMLButtonElement>, id: string) {
		if (event.button !== 0 || !event.isPrimary || drag.current) return;
		// Only its group's rows: they are next to each other, and the drag stays among them.
		const among = amongOf(id);
		const rows = [
			...(listRef.current?.querySelectorAll<HTMLElement>("[data-bucket-row]") ?? []),
		].filter((row) => among.includes(row.dataset.bucketRow ?? ""));
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
			among,
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

	return {
		/** The Buckets' IDs in the order to show them: the saved order, or the one just dropped. */
		ids,
		/** Goes on the element around the rows. */
		listRef,
		/** The Bucket being dragged, if any. */
		lifted,
		/** What was last done, for a live region. */
		said,
		/** The id of the hint a handle is described by; the caller renders the hint. */
		hintId,
		/**
		 * For the element around the rows, before any row hears of it: a press that began on a handle
		 * is a move, so the click that ends it (which lands on the row once the row has followed the
		 * pointer) opens nothing. A click from the keyboard has no press and is left alone.
		 */
		guard: {
			onPointerDownCapture: (event: ReactPointerEvent<HTMLElement>) => {
				onHandle.current = beginsOnHandle(event.target);
			},
			onClickCapture: (event: ReactMouseEvent<HTMLElement>) => {
				const began = onHandle.current;
				onHandle.current = false;
				if (!began || event.detail === 0) return;
				if (bucketClick(event.target, event.currentTarget, began) !== "nothing") return;
				event.preventDefault();
				event.stopPropagation();
			},
		},
		/** What a Bucket's handle needs besides its look and its name. */
		handleProps: (id: string) => ({
			"data-reorder": id,
			"aria-describedby": hintId,
			onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => onKeyDown(event, id),
			onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => onPointerDown(event, id),
			// A long press mustn't bring up a menu in the middle of a drag.
			onContextMenu: (event: ReactMouseEvent<HTMLButtonElement>) => {
				if (drag.current) event.preventDefault();
			},
		}),
	};
}
