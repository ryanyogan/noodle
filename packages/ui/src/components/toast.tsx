import { CheckIcon, TriangleAlertIcon, XIcon } from "lucide-react";
import * as React from "react";
import { cn } from "#lib/utils";

type Toast = {
	id: number;
	message: string;
	tone: "success" | "error";
	action?: { label: string; onClick: () => void };
	/**
	 * Stays until it's dismissed or replaced, for an Undo of money moved in one click: a few
	 * seconds isn't long enough to notice a mistake.
	 */
	sticky?: boolean;
};

// One toast at a time: a new one replaces whatever is showing.
let current: Toast | null = null;
let nextId = 1;
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

function set(toast: Toast | null) {
	current = toast;
	for (const listener of listeners) listener();
}

/**
 * Shows a short message at the bottom of the screen. Toasts with an action stay long enough
 * to use it; errors stay longest; a sticky one stays until it's dismissed.
 */
function toast(message: string, options: Omit<Toast, "id" | "message"> = { tone: "success" }) {
	clearTimeout(timer);
	const shown = { id: nextId++, message, ...options };
	set(shown);
	if (options.sticky) return;
	const ms = options.tone === "error" ? 10_000 : options.action ? 6_000 : 2_400;
	timer = setTimeout(() => {
		if (current?.id === shown.id) set(null);
	}, ms);
}

const subscribe = (listener: () => void) => {
	listeners.add(listener);
	return () => listeners.delete(listener);
};

/** Where toasts appear; rendered once in the app frame. Announced politely to screen readers. */
function Toaster({ className }: { className?: string }) {
	const shown = React.useSyncExternalStore(
		subscribe,
		() => current,
		() => null,
	);
	return (
		<div
			role="status"
			aria-live="polite"
			className={cn(
				"pointer-events-none fixed inset-x-0 z-50 flex justify-center px-4",
				"bottom-[calc(var(--tabbar-height)+env(safe-area-inset-bottom)+20px)] lg:bottom-7 lg:ps-(--sidebar-width)",
				className,
			)}
		>
			{shown ? (
				<div
					key={shown.id}
					data-slot="toast"
					data-tone={shown.tone}
					className="pointer-events-auto flex max-w-full animate-enter items-center gap-3 rounded-xl bg-foreground py-2 ps-3 pe-2 text-sm font-medium text-card shadow-pop"
				>
					<span className="grid size-5 shrink-0 place-items-center rounded-full bg-card/15 [&_svg]:size-3">
						{shown.tone === "error" ? (
							<TriangleAlertIcon strokeWidth={2.5} />
						) : (
							<CheckIcon strokeWidth={2.5} />
						)}
					</span>
					<span className={cn("min-w-0", !shown.action && "pe-1")}>{shown.message}</span>
					{shown.action ? (
						<button
							type="button"
							className="h-7 shrink-0 rounded-lg bg-card/15 px-2.5 text-[13px] font-semibold transition-colors duration-(--duration-fast) hover:bg-card/25 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
							onClick={() => {
								set(null);
								shown.action?.onClick();
							}}
						>
							{shown.action.label}
						</button>
					) : null}
					{shown.sticky ? (
						<button
							type="button"
							aria-label="Dismiss"
							className="grid size-7 shrink-0 place-items-center rounded-lg transition-colors duration-(--duration-fast) hover:bg-card/15 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&_svg]:size-4"
							onClick={() => set(null)}
						>
							<XIcon />
						</button>
					) : null}
				</div>
			) : null}
		</div>
	);
}

export { Toaster, toast };
