import type { MonthKey, PlanBucket } from "@noodle/domain";
import { Button } from "@noodle/ui/components/button";
import { List } from "@noodle/ui/components/list";
import { useHydrated } from "@tanstack/react-router";
import { GripVertical } from "lucide-react";
import { type KeyboardEvent, type PointerEvent, useId, useRef, useState } from "react";
import { BucketEditor, useBucketChanges } from "./bucket-editor";

/**
 * The Plan's shared Buckets, in order. Each row's handle moves it: dragged by mouse or touch, or
 * by the up and down arrow keys once focused. Where it lands is said aloud ("Groceries moved to
 * position 2 of 8") and saved at once. Plain pointer events cover mouse, pen and touch, so no
 * drag library is needed.
 */
export function BucketList({
	month,
	buckets,
	editable,
	was,
	onDraft,
}: {
	month: MonthKey;
	buckets: PlanBucket[];
	editable: boolean;
	was: Record<string, number | undefined>;
	/** A Bucket's amount while it's being typed in the list, or null when it's put away. */
	onDraft: (bucketId: string, cents: number | null) => void;
}) {
	const hydrated = useHydrated();
	const hintId = useId();
	const changes = useBucketChanges(month);
	const listRef = useRef<HTMLDivElement>(null);
	const [dragging, setDragging] = useState<{ id: string; order: string[] } | null>(null);
	const [said, setSaid] = useState("");
	const ids = buckets.map((b) => b.id);
	const order = dragging?.order ?? ids;
	const shown = order.flatMap((id) => buckets.find((b) => b.id === id) ?? []);

	function save(next: string[], id: string) {
		const name = buckets.find((b) => b.id === id)?.name ?? "Bucket";
		if (next.join() === ids.join()) {
			setSaid(`${name} stays at position ${next.indexOf(id) + 1} of ${next.length}`);
			return;
		}
		changes.reorder.mutate({ bucketIds: next });
		setSaid(`${name} moved to position ${next.indexOf(id) + 1} of ${next.length}`);
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

	function onPointerDown(event: PointerEvent<HTMLButtonElement>, id: string) {
		if (event.button !== 0) return;
		event.currentTarget.setPointerCapture(event.pointerId);
		setDragging({ id, order: ids });
	}

	function onPointerMove(event: PointerEvent<HTMLButtonElement>) {
		if (!dragging) return;
		const rows = [...(listRef.current?.querySelectorAll("[data-bucket-row]") ?? [])];
		// Where the pointer is: before the first row whose middle is below it.
		let to = rows.findIndex((row) => {
			const box = row.getBoundingClientRect();
			return event.clientY < box.top + box.height / 2;
		});
		if (to < 0) to = rows.length - 1;
		const from = dragging.order.indexOf(dragging.id);
		if (to > from) to -= 1;
		if (to !== from) setDragging({ ...dragging, order: moved(dragging.order, dragging.id, to) });
	}

	function onPointerUp() {
		if (!dragging) return;
		const { id, order: next } = dragging;
		setDragging(null);
		if (next.join() !== ids.join()) save(next, id);
	}

	return (
		<div ref={listRef} className="grid gap-2">
			<List>
				{shown.map((bucket) => (
					<BucketEditor
						key={bucket.id}
						month={month}
						bucket={bucket}
						editable={editable}
						was={was[bucket.id]}
						order={ids}
						onDraft={(cents) => onDraft(bucket.id, cents)}
						dragged={dragging?.id === bucket.id}
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
									className="-ms-2 cursor-grab touch-none active:cursor-grabbing"
									onKeyDown={(event) => onKeyDown(event, bucket.id)}
									onPointerDown={(event) => onPointerDown(event, bucket.id)}
									onPointerMove={onPointerMove}
									onPointerUp={onPointerUp}
									onPointerCancel={() => setDragging(null)}
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

/** `order` with `id` moved to index `to`. */
export function moved(order: string[], id: string, to: number) {
	const next = order.filter((other) => other !== id);
	next.splice(to, 0, id);
	return next;
}
