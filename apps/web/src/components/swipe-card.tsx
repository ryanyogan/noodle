import { cn } from "@noodle/ui/lib/utils";
import { type PointerEvent, type ReactNode, useRef, useState } from "react";

/** How far a card is dragged to decide it, or less if flicked. */
export const SWIPE_DISTANCE = 96;
const FLICK_DISTANCE = 32;
/** px per ms. */
const FLICK_SPEED = 0.5;
/** Movement under this is a tap or a wobble, never a decision. */
const INTENT = 8;

type Drag = {
	pointerId: number;
	x: number;
	y: number;
	/** null until the first few pixels say: sideways drags the card, anything else scrolls. */
	sideways: boolean | null;
	dx: number;
	at: number;
	speed: number;
};

/**
 * Review's top card, which follows the finger sideways (#68). Right decides `onRight`, left
 * `onLeft`; a drag that falls short springs back. Every swipe has a button and a key that do the
 * same, so with `enabled` false (reduced motion, before hydration) it's an ordinary card.
 *
 * Pointer handling, what broke before bf5e29f in mind: the drag lives in a ref, not a stale
 * render; the page still scrolls vertically (`touch-action: pan-y`, and a vertical start lets go);
 * the pointer is captured only once the drag is sideways, so a tap on the card's buttons is still
 * their click; a second finger or pointercancel drops the drag; a flick counts as well as a drag.
 */
export function SwipeCard({
	enabled,
	rightLabel,
	leftLabel,
	onRight,
	onLeft,
	children,
}: {
	enabled: boolean;
	/** What's shown as the card is dragged right, as "Groceries ✓". */
	rightLabel: string;
	leftLabel: string;
	onRight: () => void;
	onLeft: () => void;
	children: ReactNode;
}) {
	const [dx, setDx] = useState(0);
	const drag = useRef<Drag | null>(null);

	function drop() {
		drag.current = null;
		setDx(0);
	}

	function onPointerDown(event: PointerEvent<HTMLDivElement>) {
		if (!enabled) return;
		// A second finger: not a swipe.
		if (drag.current) return drop();
		if (event.button !== 0) return;
		drag.current = {
			pointerId: event.pointerId,
			x: event.clientX,
			y: event.clientY,
			sideways: null,
			dx: 0,
			at: event.timeStamp,
			speed: 0,
		};
	}

	function onPointerMove(event: PointerEvent<HTMLDivElement>) {
		const start = drag.current;
		if (!start || event.pointerId !== start.pointerId) return;
		const x = event.clientX - start.x;
		const y = event.clientY - start.y;
		if (start.sideways === null) {
			if (Math.hypot(x, y) < INTENT) return;
			start.sideways = Math.abs(x) > Math.abs(y);
			if (!start.sideways) return drop();
			event.currentTarget.setPointerCapture(event.pointerId);
		}
		const elapsed = Math.max(1, event.timeStamp - start.at);
		start.speed = (x - start.dx) / elapsed;
		start.dx = x;
		start.at = event.timeStamp;
		setDx(x);
	}

	function onPointerUp(event: PointerEvent<HTMLDivElement>) {
		const start = drag.current;
		if (!start || event.pointerId !== start.pointerId) return;
		drop();
		if (!start.sideways) return;
		const distance = Math.abs(start.dx);
		const flicked =
			distance >= FLICK_DISTANCE &&
			Math.abs(start.speed) >= FLICK_SPEED &&
			Math.sign(start.speed) === Math.sign(start.dx);
		if (distance < SWIPE_DISTANCE && !flicked) return;
		if (start.dx > 0) onRight();
		else onLeft();
	}

	const toward = dx > INTENT * 3 ? "right" : dx < -INTENT * 3 ? "left" : null;
	const strength = Math.min(1, Math.abs(dx) / SWIPE_DISTANCE);
	return (
		<div
			data-slot="swipe-card"
			data-dragging={dx !== 0 || undefined}
			onPointerDown={onPointerDown}
			onPointerMove={onPointerMove}
			onPointerUp={onPointerUp}
			onPointerCancel={drop}
			onLostPointerCapture={() => drag.current?.sideways && drop()}
			style={dx === 0 ? undefined : { transform: `translate(${dx}px, 0) rotate(${dx / 24}deg)` }}
			className={cn(
				"relative rounded-2xl",
				enabled && "touch-pan-y",
				dx === 0 && "transition-transform duration-(--duration-fast) ease-standard",
				dx !== 0 && "select-none",
			)}
		>
			{children}
			{toward ? (
				<div
					aria-hidden="true"
					style={{ opacity: strength }}
					className={cn(
						"pointer-events-none absolute inset-0 flex items-start rounded-2xl p-4 ring-4",
						toward === "right" ? "justify-start ring-primary" : "justify-end ring-border-strong",
					)}
				>
					<span
						className={cn(
							"rounded-lg px-3 py-1 text-sm font-semibold shadow-card",
							toward === "right"
								? "bg-primary text-primary-foreground"
								: "bg-surface-3 text-foreground",
						)}
					>
						{toward === "right" ? rightLabel : leftLabel}
					</span>
				</div>
			) : null}
		</div>
	);
}
