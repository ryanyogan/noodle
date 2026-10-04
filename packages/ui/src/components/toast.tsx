import { CheckIcon, TriangleAlertIcon, XIcon } from "lucide-react";
import { Toaster as Sonner, toast as sonner } from "sonner";
import { cn } from "#lib/utils";

// Toasts on Sonner (https://ui.shadcn.com/docs/components/sonner, the toast shadcn recommends),
// drawn with this design system's own toast: Sonner stacks them (a new one no longer replaces an
// Undo still showing), pauses them while hovered, lets them be swiped away, and Alt+T reaches
// them by keyboard. The app keeps calling `toast(message, options)` as before.

type ToastOptions = {
	tone: "success" | "error";
	action?: { label: string; onClick: () => void };
	/**
	 * Stays until it's dismissed, for an Undo of money moved in one click: a few seconds isn't
	 * long enough to notice a mistake.
	 */
	sticky?: boolean;
	/**
	 * How long it stays, in milliseconds, instead of its kind's usual time: for a message too long
	 * to read in a couple of seconds that shouldn't sit over the page until dismissed. A sticky
	 * toast ignores it.
	 */
	duration?: number;
	/**
	 * Replaces a toast still showing with the same id, so doing a thing twice shows one toast,
	 * which then stays for its time again.
	 */
	id?: string;
};

/**
 * How long a toast stays, in milliseconds: until dismissed when sticky, else the time asked for,
 * else by kind (an error 10 s, one with an action 6 s, any other 2.4 s).
 */
function toastDuration({
	tone,
	action,
	sticky,
	duration,
}: Pick<ToastOptions, "tone" | "action" | "sticky" | "duration">) {
	if (sticky) return Number.POSITIVE_INFINITY;
	// Only a real length of time counts: Sonner reads 0 as its own default and never closes Infinity.
	if (duration !== undefined && Number.isFinite(duration) && duration > 0) return duration;
	if (tone === "error") return 10_000;
	return action ? 6_000 : 2_400;
}

/**
 * Shows a short message at the bottom of the screen. Toasts with an action stay long enough to
 * use it; errors stay longest; a sticky one stays until it's dismissed; `duration` sets another
 * time for one that isn't sticky.
 */
function toast(message: string, options: ToastOptions = { tone: "success" }) {
	// Sonner counts the time down itself, so it still waits while a toast is hovered, held or the
	// tab is hidden, and starts again when a toast is replaced by one with the same id.
	sonner.custom((id) => <ToastBody id={id as string} message={message} {...options} />, {
		duration: toastDuration(options),
		id: options.id,
	});
}

function ToastBody({
	id,
	message,
	tone,
	action,
	sticky,
}: ToastOptions & { id: string | number; message: string }) {
	return (
		// Each toast is a status, so it's announced politely and found as one.
		<div
			role="status"
			data-slot="toast"
			data-tone={tone}
			className="pointer-events-auto flex w-fit max-w-full items-center gap-3 rounded-xl bg-foreground py-2 ps-3 pe-2 text-sm font-medium text-card shadow-pop"
		>
			<span className="grid size-5 shrink-0 place-items-center rounded-full bg-card/15 [&_svg]:size-3">
				{tone === "error" ? (
					<TriangleAlertIcon strokeWidth={2.5} />
				) : (
					<CheckIcon strokeWidth={2.5} />
				)}
			</span>
			<span className={cn("min-w-0", !action && !sticky && "pe-1")}>{message}</span>
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

/** Where toasts appear; rendered once in the app frame, outside anything a sheet hides. */
function Toaster({ className }: { className?: string }) {
	return (
		<Sonner
			position="bottom-center"
			// Up to three, each in full, so an Undo is never hidden behind a later toast.
			visibleToasts={3}
			expand
			gap={8}
			// Above the tab bar while there is one; on desktop, centred over the page, not the window.
			offset={{ bottom: "var(--toast-bottom)" }}
			mobileOffset={{ bottom: "var(--toast-bottom)" }}
			toastOptions={{ unstyled: true, className: "flex w-full justify-center" }}
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

export { Toaster, toast, toastDuration };
