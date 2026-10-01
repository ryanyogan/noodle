import { XIcon } from "lucide-react";
import { Dialog as SheetPrimitive } from "radix-ui";
import * as React from "react";
import { useFocusReturn } from "#lib/focus-return";
import { cn } from "#lib/utils";
import { Button } from "./button";

/** How far a sheet must be dragged down before letting go closes it. */
const DRAG_TO_CLOSE_PX = 90;

const SheetContext = React.createContext<{ close: () => void }>({ close: () => {} });

/**
 * A modal task over the current screen: a sheet rising from the bottom on phones, a centred
 * dialog on desktop. The screen underneath stays mounted.
 */
function Sheet({
	onOpenChange,
	...props
}: Omit<React.ComponentProps<typeof SheetPrimitive.Root>, "onOpenChange"> & {
	onOpenChange: (open: boolean) => void;
}) {
	const context = React.useMemo(() => ({ close: () => onOpenChange(false) }), [onOpenChange]);
	return (
		<SheetContext.Provider value={context}>
			<SheetPrimitive.Root onOpenChange={onOpenChange} {...props} />
		</SheetContext.Provider>
	);
}

function SheetContent({
	className,
	children,
	onOpenAutoFocus,
	onCloseAutoFocus,
	onEscapeKeyDown,
	onInputCapture,
	layout = "dialog",
	...props
}: React.ComponentProps<typeof SheetPrimitive.Content> & {
	/**
	 * How it sits at lg (phones always get the bottom sheet): a centred dialog, a wider one, or a
	 * panel down the right edge for a long form that belongs beside the page.
	 */
	layout?: "dialog" | "wide" | "side";
}) {
	const { close } = React.useContext(SheetContext);
	const drag = useDragToClose(close);
	const focus = useFocusReturn({ onOpenAutoFocus, onCloseAutoFocus });
	// Esc closes only the topmost layer. Radix hands Esc to a lower layer until it re-renders after
	// a new one opens, so an Esc straight after an alert dialog opens over the sheet would close
	// both: while one is open, the sheet leaves Esc to it.
	const leaveEscToAlert = (event: KeyboardEvent) => {
		onEscapeKeyDown?.(event);
		if (document.querySelector("[data-slot=alert-dialog-content]")) event.preventDefault();
	};
	return (
		<SheetPrimitive.Portal>
			<SheetPrimitive.Overlay
				data-slot="sheet-overlay"
				className={cn(
					"fixed inset-0 z-40 bg-scrim backdrop-blur-[2px]",
					"data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out",
				)}
			/>
			<SheetPrimitive.Content
				data-slot="sheet-content"
				className={cn(
					"fixed z-41 grid gap-4 overflow-y-auto overscroll-contain bg-card shadow-pop outline-none",
					// Phones: from the bottom edge, clear of the status bar and home indicator.
					"inset-x-0 bottom-0 max-h-[calc(100dvh-16px-env(safe-area-inset-top))] rounded-t-3xl border border-b-0",
					"px-4 pt-2 pb-[calc(12px+env(safe-area-inset-bottom))]",
					"data-[state=open]:animate-sheet-in data-[state=closed]:animate-sheet-out",
					layout === "side"
						? [
								// Desktop: a panel down the right edge, beside the page it belongs to.
								"lg:inset-y-0 lg:right-0 lg:left-auto lg:max-h-dvh lg:w-120 lg:content-start lg:rounded-none lg:rounded-l-3xl lg:border-y-0 lg:border-r-0 lg:p-6",
								"lg:data-[state=open]:animate-side-in lg:data-[state=closed]:animate-side-out",
							]
						: [
								// Desktop: a centred dialog, wider for a sheet with more to lay out.
								"lg:inset-auto lg:top-1/2 lg:left-1/2 lg:max-h-[calc(100dvh-48px)] lg:-translate-x-1/2 lg:-translate-y-1/2 lg:rounded-3xl lg:border-b lg:p-5",
								layout === "wide" ? "lg:w-130" : "lg:w-110",
								"lg:data-[state=open]:animate-dialog-in lg:data-[state=closed]:animate-dialog-out",
							],
					className,
				)}
				{...focus}
				onEscapeKeyDown={leaveEscToAlert}
				// Marks the sheet once anything is typed or picked in it, so leaving the page can ask
				// first (the app's LeaveGuard) rather than throw it away.
				onInputCapture={(event) => {
					event.currentTarget.dataset.dirty = "true";
					onInputCapture?.(event);
				}}
				{...props}
			>
				<div
					aria-hidden="true"
					className="-mb-2 grid h-4 touch-none place-items-center lg:hidden"
					{...drag}
				>
					<span className="h-1.25 w-9 rounded-full bg-surface-3" />
				</div>
				{children}
			</SheetPrimitive.Content>
		</SheetPrimitive.Portal>
	);
}

/** Pointer handlers for the grabber: the sheet follows a downward drag and closes past a threshold. */
function useDragToClose(close: () => void) {
	const start = React.useRef<number | null>(null);
	const sheetOf = (target: EventTarget) =>
		(target as HTMLElement).closest<HTMLElement>("[data-slot=sheet-content]");
	return {
		onPointerDown: (event: React.PointerEvent<HTMLElement>) => {
			start.current = event.clientY;
			event.currentTarget.setPointerCapture(event.pointerId);
		},
		onPointerMove: (event: React.PointerEvent<HTMLElement>) => {
			const sheet = sheetOf(event.currentTarget);
			if (start.current === null || !sheet) return;
			const dy = Math.max(0, event.clientY - start.current);
			sheet.style.transition = "none";
			sheet.style.transform = `translateY(${dy}px)`;
		},
		onPointerUp: (event: React.PointerEvent<HTMLElement>) => {
			const sheet = sheetOf(event.currentTarget);
			if (start.current === null || !sheet) return;
			const dy = event.clientY - start.current;
			start.current = null;
			sheet.style.transition = "";
			sheet.style.transform = "";
			if (dy > DRAG_TO_CLOSE_PX) close();
		},
		onPointerCancel: (event: React.PointerEvent<HTMLElement>) => {
			start.current = null;
			const sheet = sheetOf(event.currentTarget);
			if (sheet) sheet.style.transform = "";
		},
	};
}

/** The sheet's title row, with a close button. */
function SheetHeader({
	title,
	description,
	className,
}: {
	title: React.ReactNode;
	description?: React.ReactNode;
	className?: string;
}) {
	return (
		<div data-slot="sheet-header" className={cn("flex min-h-8 items-center gap-3", className)}>
			<div className="grid flex-1 gap-0.5">
				<SheetPrimitive.Title className="text-base font-semibold">{title}</SheetPrimitive.Title>
				{description ? (
					<SheetPrimitive.Description className="text-[13px] text-muted-foreground">
						{description}
					</SheetPrimitive.Description>
				) : null}
			</div>
			<SheetPrimitive.Close
				aria-label="Close"
				className={cn(
					"grid size-8 place-items-center rounded-lg text-muted-foreground",
					"transition-colors duration-(--duration-fast) ease-standard hover:bg-surface-2 hover:text-foreground",
					"focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
				)}
			>
				<XIcon className="size-4.5" />
			</SheetPrimitive.Close>
		</div>
	);
}

/**
 * The sheet's actions, the same in every sheet: stacked full width on phones; at lg, together on
 * the right, Cancel before Save.
 */
function SheetFooter({ className, children }: { className?: string; children: React.ReactNode }) {
	return (
		<div
			data-slot="sheet-footer"
			className={cn("grid gap-2 lg:flex lg:items-center lg:justify-end", className)}
		>
			{children}
		</div>
	);
}

/**
 * Closes the sheet without saving. Phones close a sheet by its X or a drag, so by default it shows
 * only at lg, beside Save.
 */
function SheetCancel({ className, ...props }: React.ComponentProps<typeof Button>) {
	return (
		<SheetPrimitive.Close asChild>
			<Button type="button" variant="outline" className={cn("max-lg:hidden", className)} {...props}>
				Cancel
			</Button>
		</SheetPrimitive.Close>
	);
}

export { Sheet, SheetCancel, SheetContent, SheetFooter, SheetHeader };
