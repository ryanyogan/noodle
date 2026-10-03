import { AlertDialog as AlertDialogPrimitive } from "radix-ui";
import type * as React from "react";
import { useFocusReturn } from "#lib/focus-return";
import { HoldPage } from "#lib/page-lock";
import { cn } from "#lib/utils";
import { buttonVariants } from "./button";

// shadcn/ui's AlertDialog (https://ui.shadcn.com/docs/components/alert-dialog) on Radix, styled
// with this design system's tokens: a modal question before something that can't be taken back.
// Focus starts on Cancel, the safer choice, and returns to what opened it (useFocusReturn).

function AlertDialog(props: React.ComponentProps<typeof AlertDialogPrimitive.Root>) {
	return <AlertDialogPrimitive.Root data-slot="alert-dialog" {...props} />;
}

function AlertDialogContent({
	className,
	onOpenAutoFocus,
	onCloseAutoFocus,
	children,
	...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Content>) {
	const focus = useFocusReturn({ onOpenAutoFocus, onCloseAutoFocus });
	return (
		<AlertDialogPrimitive.Portal>
			<AlertDialogPrimitive.Overlay
				data-slot="alert-dialog-overlay"
				className={cn(
					"fixed inset-0 z-50 bg-scrim backdrop-blur-[2px]",
					"data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out",
				)}
			/>
			<AlertDialogPrimitive.Content
				data-slot="alert-dialog-content"
				className={cn(
					"fixed z-51 grid gap-4 bg-card shadow-pop outline-none",
					// Phones: from the bottom edge, in reach of the thumb, like a sheet.
					"inset-x-0 bottom-0 rounded-t-3xl border border-b-0 px-4 pt-5 pb-[calc(16px+var(--safe-bottom))]",
					"data-[state=open]:animate-sheet-in data-[state=closed]:animate-sheet-out",
					// Desktop: a small centred dialog.
					"lg:inset-x-auto lg:bottom-auto lg:top-1/2 lg:left-1/2 lg:w-[calc(100%-2rem)] lg:max-w-100 lg:-translate-x-1/2 lg:-translate-y-1/2",
					"lg:rounded-3xl lg:border-b lg:p-5",
					"lg:data-[state=open]:animate-dialog-in lg:data-[state=closed]:animate-dialog-out",
					className,
				)}
				{...focus}
				{...props}
			>
				<HoldPage />
				{children}
			</AlertDialogPrimitive.Content>
		</AlertDialogPrimitive.Portal>
	);
}

function AlertDialogHeader({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div data-slot="alert-dialog-header" className={cn("grid gap-1.5", className)} {...props} />
	);
}

function AlertDialogFooter({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="alert-dialog-footer"
			className={cn("flex flex-col-reverse gap-2 lg:flex-row lg:justify-end", className)}
			{...props}
		/>
	);
}

function AlertDialogTitle({
	className,
	...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Title>) {
	return (
		<AlertDialogPrimitive.Title
			data-slot="alert-dialog-title"
			className={cn("text-base font-semibold", className)}
			{...props}
		/>
	);
}

function AlertDialogDescription({
	className,
	...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Description>) {
	return (
		<AlertDialogPrimitive.Description
			data-slot="alert-dialog-description"
			className={cn("text-sm text-muted-foreground", className)}
			{...props}
		/>
	);
}

function AlertDialogAction({
	className,
	variant = "destructive",
	...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Action> & {
	variant?: "default" | "destructive";
}) {
	return (
		<AlertDialogPrimitive.Action
			data-slot="alert-dialog-action"
			className={cn(buttonVariants({ variant }), className)}
			{...props}
		/>
	);
}

function AlertDialogCancel({
	className,
	...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Cancel>) {
	return (
		<AlertDialogPrimitive.Cancel
			data-slot="alert-dialog-cancel"
			className={cn(buttonVariants({ variant: "outline" }), className)}
			{...props}
		/>
	);
}

export {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
};
