import { XIcon } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import type * as React from "react";
import { useFocusReturn } from "#lib/focus-return";
import { HoldPage } from "#lib/page-lock";
import { cn } from "#lib/utils";
import { Button } from "./button";

// shadcn/ui's Dialog (https://ui.shadcn.com/docs/components/dialog), radix-nova, by hand from the
// registry. A centred dialog at every width, for something to look at or one short question that
// isn't a warning (the video player). A form or a list to pick from goes in a Sheet, and a
// question before something that can't be taken back is an AlertDialog.
// Changed from the registry: the overlay and content are styled as AlertDialog's are (scrim,
// card, shadow-pop, the app's dialog keyframes), focus returns to the opener (useFocusReturn),
// the page behind is held (HoldPage), and the footer has no tinted band.

function Dialog(props: React.ComponentProps<typeof DialogPrimitive.Root>) {
	return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

function DialogTrigger(props: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
	return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogClose(props: React.ComponentProps<typeof DialogPrimitive.Close>) {
	return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

function DialogContent({
	className,
	children,
	showCloseButton = true,
	onOpenAutoFocus,
	onCloseAutoFocus,
	...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & { showCloseButton?: boolean }) {
	const focus = useFocusReturn({ onOpenAutoFocus, onCloseAutoFocus });
	return (
		<DialogPrimitive.Portal>
			<DialogPrimitive.Overlay
				data-slot="dialog-overlay"
				className={cn(
					"fixed inset-0 z-50 bg-scrim backdrop-blur-[2px]",
					"data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out",
				)}
			/>
			<DialogPrimitive.Content
				data-slot="dialog-content"
				className={cn(
					"fixed top-1/2 left-1/2 z-51 grid w-[calc(100%-2rem)] max-w-100 -translate-x-1/2 -translate-y-1/2 gap-4",
					"max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-3xl border bg-card p-5 shadow-pop outline-none",
					"data-[state=open]:animate-dialog-in data-[state=closed]:animate-dialog-out",
					className,
				)}
				{...focus}
				{...props}
			>
				<HoldPage />
				{children}
				{showCloseButton ? (
					<DialogPrimitive.Close data-slot="dialog-close" asChild>
						<Button variant="ghost" size="icon" className="absolute top-3 right-3">
							<XIcon aria-hidden="true" />
							<span className="sr-only">Close</span>
						</Button>
					</DialogPrimitive.Close>
				) : null}
			</DialogPrimitive.Content>
		</DialogPrimitive.Portal>
	);
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div data-slot="dialog-header" className={cn("grid gap-1.5 pe-9", className)} {...props} />
	);
}

function DialogFooter({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="dialog-footer"
			className={cn("flex flex-col-reverse gap-2 lg:flex-row lg:justify-end", className)}
			{...props}
		/>
	);
}

function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
	return (
		<DialogPrimitive.Title
			data-slot="dialog-title"
			className={cn("text-base font-semibold", className)}
			{...props}
		/>
	);
}

function DialogDescription({
	className,
	...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
	return (
		<DialogPrimitive.Description
			data-slot="dialog-description"
			className={cn("text-sm text-muted-foreground", className)}
			{...props}
		/>
	);
}

export {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
};
