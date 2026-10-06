import { CheckIcon, TriangleAlertIcon, XIcon } from "lucide-react";
import { useEffect } from "react";
import { Toaster as Sonner, toast as sonner } from "sonner";
import { cn } from "#lib/utils";

// Toasts on Sonner (https://ui.shadcn.com/docs/components/sonner, the toast shadcn recommends),
// drawn with this design system's own toast: Sonner stacks them (on a desktop the newest six show,
// so a new one doesn't replace an Undo still showing; below lg one shows at a time), pauses them
// while hovered, lets them be swiped away, and Alt+T reaches them by keyboard. The app keeps
// calling `toast(message, options)` as before.

/**
 * How long a toast with Undo stays, in milliseconds (issue 103): ten seconds, then it leaves by
 * itself.
 * The one place this time is written: anything that waits for an Undo to go (a change sent only
 * once it can no longer be undone) uses this too.
 */
const UNDO_TOAST_MS = 10_000;

type ToastOptions = {
	tone: "success" | "error";
	/**
	 * Replaces a toast still showing with the same id, so doing a thing twice shows one toast,
	 * which then stays for its time again.
	 */
	id?: string;
} & (
	| {
			/**
			 * Puts back what was just done. The toast shows an Undo button, stays UNDO_TOAST_MS and
			 * then goes by itself; pressing Undo closes it at once. It takes no time of its own, so
			 * every Undo stays the same time.
			 */
			undo: () => void;
			/**
			 * Called once when the toast has left without Undo being pressed: its time ran out
			 * (Sonner's own countdown, which waits while the toast is hovered, held or the tab is
			 * hidden) or it was swiped away. For a change that is only sent once it can no longer be
			 * undone. Never called after Undo. Not for a toast with an `id`: one that is replaced
			 * never leaves.
			 */
			onGone?: () => void;
			action?: never;
			sticky?: never;
			duration?: never;
	  }
	| {
			undo?: never;
			onGone?: never;
			/** Any action but Undo (Retry, View, …): Undo is `undo`, which sets its own time. */
			action?: { label: string; onClick: () => void };
			/** Stays until it's dismissed. Not for an Undo, which leaves after UNDO_TOAST_MS. */
			sticky?: boolean;
			/**
			 * How long it stays, in milliseconds, instead of its kind's usual time: for a message too
			 * long to read in a couple of seconds that shouldn't sit over the page until dismissed. A
			 * sticky toast ignores it.
			 */
			duration?: number;
	  }
);

/**
 * How long a toast stays, in milliseconds: UNDO_TOAST_MS with Undo, whatever else is asked; else
 * until dismissed when sticky, else the time asked for, else by kind (an error 10 s, one with an
 * action 6 s, any other 2.4 s).
 */
function toastDuration({
	tone,
	undo,
	action,
	sticky,
	duration,
}: {
	tone: ToastOptions["tone"];
	undo?: () => void;
	action?: { label: string; onClick: () => void };
	sticky?: boolean;
	duration?: number;
}) {
	if (undo) return UNDO_TOAST_MS;
	if (sticky) return Number.POSITIVE_INFINITY;
	// Only a real length of time counts: Sonner reads 0 as its own default and never closes Infinity.
	if (duration !== undefined && Number.isFinite(duration) && duration > 0) return duration;
	if (tone === "error") return 10_000;
	return action ? 6_000 : 2_400;
}

/**
 * An Undo and what follows when it wasn't pressed, so that only one of the two ever happens, and
 * only once: pressing Undo closes the toast, which Sonner also reports as it leaving.
 */
function undoOrGone(undo: () => void, onGone?: () => void) {
	let over = false;
	const once = (run?: () => void) => () => {
		if (over) return;
		over = true;
		run?.();
	};
	return { undo: once(undo), gone: once(onGone) };
}

/**
 * Shows a short message at the bottom of the screen. Toasts with an action stay long enough to
 * use it; errors stay longest; one with `undo` stays UNDO_TOAST_MS; a sticky one stays until it's
 * dismissed; `duration` sets another time for one that isn't sticky.
 *
 * Returns a way to take this toast away before its time, as if it were swiped away (so an Undo's
 * `onGone` then happens): for a caller that keeps one of a kind showing and brings the next in
 * front, where an `id` would leave the new words in the old one's place in the pile.
 */
function toast(message: string, options: ToastOptions = { tone: "success" }): () => void {
	// Sonner counts the time down itself, so it still waits while a toast is hovered, held or the
	// tab is hidden, or after Alt+T moved the keyboard to the toasts (until Escape), and starts
	// again when a toast is replaced by one with the same id.
	const latch = options.undo ? undoOrGone(options.undo, options.onGone) : undefined;
	const shown: ToastOptions = options.undo && latch ? { ...options, undo: latch.undo } : options;
	const shownId = sonner.custom(
		(id) => <ToastBody id={id as string} message={message} {...shown} />,
		{
			duration: toastDuration(options),
			id: options.id,
			// The toast's real end, whenever its countdown was paused on the way.
			onAutoClose: latch?.gone,
			onDismiss: latch?.gone,
		},
	);
	return () => {
		sonner.dismiss(shownId);
	};
}

function ToastBody({
	id,
	message,
	tone,
	undo,
	action: other,
	sticky,
}: ToastOptions & { id: string | number; message: string }) {
	const action = undo ? { label: "Undo", onClick: undo } : other;
	return (
		// Each toast is a status, so it's announced politely and found as one. From sm up every toast
		// is the Toaster's width, so two or three stacked make one even pile (issue 73); on a phone
		// each still hugs its words.
		<div
			role="status"
			data-slot="toast"
			data-tone={tone}
			className="pointer-events-auto flex w-fit max-w-full items-center sm:w-full gap-3 rounded-xl bg-foreground py-2 ps-3 pe-2 text-sm font-medium text-card shadow-pop"
		>
			<span className="grid size-5 shrink-0 place-items-center rounded-full bg-card/15 [&_svg]:size-3">
				{tone === "error" ? (
					<TriangleAlertIcon strokeWidth={2.5} />
				) : (
					<CheckIcon strokeWidth={2.5} />
				)}
			</span>
			<span className={cn("min-w-0 sm:flex-1", !action && !sticky && "pe-1")}>{message}</span>
			{action ? (
				<button
					type="button"
					className="h-7 shrink-0 rounded-lg bg-card/15 px-2.5 text-[13px] font-semibold transition-colors duration-(--duration-fast) hover:bg-card/25 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
					onClick={() => {
						sonner.dismiss(id);
						action.onClick();
					}}
				>
					{action.label}
				</button>
			) : null}
			{sticky ? (
				<button
					type="button"
					aria-label="Dismiss"
					className="grid size-7 shrink-0 place-items-center rounded-lg transition-colors duration-(--duration-fast) hover:bg-card/15 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&_svg]:size-4"
					onClick={() => sonner.dismiss(id)}
				>
					<XIcon />
				</button>
			) : null}
		</div>
	);
}

/**
 * Ends Sonner's hover pause once a finger has left a toast (issue 52). Sonner holds every toast's
 * time while the pointer rests on the pile: it starts on `mouseenter` and ends on `mouseleave`. A
 * touch screen sends the first after a tap (the mouse events a browser makes up for a touch) and
 * never the second, so a toast that was tapped stayed until something else was tapped. After a
 * touch, and after the made-up mouse events that follow it, the pile is told the pointer has left.
 * A real mouse is left alone: hovering still holds the toasts.
 */
function useTouchEndsHover() {
	useEffect(() => {
		let touch = false;
		const pile = (target: EventTarget | null) =>
			target instanceof Element ? target.closest("[data-sonner-toaster]") : null;
		const leave = (list: Element, lift: boolean) =>
			// After the browser's own handlers for this event, Sonner's among them.
			setTimeout(() => {
				if (!list.isConnected) return;
				// A touch the browser took over (a scroll) ends without the `pointerup` Sonner waits for.
				if (lift) list.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
				// React makes `mouseleave` from a `mouseout` to nowhere.
				list.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget: null }));
			}, 0);
		const onPointer = (event: PointerEvent) => {
			touch = event.pointerType === "touch";
			if (!touch || event.type === "pointerdown" || event.type === "pointerover") return;
			const list = pile(event.target);
			if (list) leave(list, event.type === "pointercancel");
		};
		// The mouse events made up after a touch come after its `pointerup`.
		const onMouse = (event: MouseEvent) => {
			if (!touch) return;
			const list = pile(event.target);
			if (list) leave(list, false);
		};
		const pointer = ["pointerover", "pointerdown", "pointerup", "pointercancel"] as const;
		const mouse = ["mouseover", "mousemove", "mouseup"] as const;
		for (const kind of pointer) document.addEventListener(kind, onPointer, true);
		for (const kind of mouse) document.addEventListener(kind, onMouse, true);
		return () => {
			for (const kind of pointer) document.removeEventListener(kind, onPointer, true);
			for (const kind of mouse) document.removeEventListener(kind, onMouse, true);
		};
	}, []);
}

/** Where toasts appear; rendered once in the app frame, outside anything a sheet hides. */
function Toaster({ className }: { className?: string }) {
	useTouchEndsHover();
	return (
		<Sonner
			position="bottom-center"
			// The newest six are drawn, each in full. A seventh pushes the oldest out of sight, an Undo
			// or not: it can't be pressed then, though its time runs on and what it sends when it goes
			// is still sent. So an Undo is in reach while no more than five toasts have come after it
			// (issue 123: with three drawn, the Undo of the first of three Review cards filed in a row
			// was the one left out). Below lg only the newest is drawn (see toastOptions).
			visibleToasts={6}
			expand
			gap={8}
			// Above the tab bar while there is one; on desktop, centred over the page, not the window.
			offset={{ bottom: "var(--toast-bottom)" }}
			mobileOffset={{ bottom: "var(--toast-bottom)" }}
			// From sm up the toast's wrapper is the Toaster's width, and so is the toast inside it.
			// Below lg one toast at a time (issue 120): two or three covered a Review card's buttons on
			// a phone. The newest takes the place of the one before, which is neither drawn nor
			// pressable nor read out while it waits behind; its time runs on, so what it sends when it
			// goes is still sent then, and an Undo with time left comes back when the newer one leaves.
			toastOptions={{
				unstyled: true,
				className: "flex w-full justify-center sm:*:w-full max-lg:data-[front=false]:invisible",
			}}
			className={cn(
				// Sonner's own stylesheet sets a system font; the app's is Geist.
				"font-sans!",
				"[--toast-bottom:calc(var(--tabbar-height)+var(--safe-bottom)+20px)]",
				"lg:ms-[calc(var(--sidebar-width)/2)] lg:[--toast-bottom:28px]",
				className,
			)}
		/>
	);
}

export { Toaster, toast, toastDuration, UNDO_TOAST_MS, undoOrGone };
