import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { cn } from "#lib/utils";

// shadcn/ui's Alert (https://ui.shadcn.com/docs/components/alert), radix-nova, by hand from the
// registry: a boxed notice in the page, with an optional icon, title, description and action.
// Changed from the registry: the app's radius, padding and tokens; `destructive` is the "over"
// ink on its soft ground; and the role is `status` unless the caller passes `role="alert"`,
// because most notices here are part of the page as it loads (Plan health, a fresh-start warning)
// and shouldn't interrupt a screen reader. Pass `role="alert"` for an error that has just happened.

const alertVariants = cva(
	[
		"group/alert relative grid w-full gap-0.5 rounded-xl border px-3.5 py-3 text-start text-sm",
		"has-data-[slot=alert-action]:pe-24 has-[>svg]:grid-cols-[auto_1fr] has-[>svg]:gap-x-2.5",
		"*:[svg]:row-span-2 *:[svg]:translate-y-0.5 *:[svg]:text-current *:[svg:not([class*='size-'])]:size-4",
	],
	{
		variants: {
			variant: {
				default: "border-border bg-surface-2 text-foreground",
				destructive:
					"border-transparent bg-over-soft text-over-foreground *:data-[slot=alert-description]:text-over-foreground",
			},
		},
		defaultVariants: { variant: "default" },
	},
);

function Alert({
	className,
	variant,
	role = "status",
	...props
}: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
	return (
		<div
			data-slot="alert"
			role={role}
			className={cn(alertVariants({ variant }), className)}
			{...props}
		/>
	);
}

function AlertTitle({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="alert-title"
			className={cn("font-medium group-has-[>svg]/alert:col-start-2", className)}
			{...props}
		/>
	);
}

function AlertDescription({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="alert-description"
			className={cn(
				"text-sm text-pretty text-muted-foreground group-has-[>svg]/alert:col-start-2",
				"[&_a]:underline [&_a]:underline-offset-2 [&_a]:hover:text-foreground",
				className,
			)}
			{...props}
		/>
	);
}

function AlertAction({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="alert-action"
			className={cn("absolute end-2.5 top-2.5", className)}
			{...props}
		/>
	);
}

export { Alert, AlertAction, AlertDescription, AlertTitle };
