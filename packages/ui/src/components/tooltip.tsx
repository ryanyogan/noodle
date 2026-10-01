import { Tooltip as TooltipPrimitive } from "radix-ui";
import type * as React from "react";
import { cn } from "#lib/utils";

// shadcn/ui's Tooltip (https://ui.shadcn.com/docs/components/tooltip), radix-nova, on this design
// system's tokens. It names or adds to a control on hover and keyboard focus, stays while the
// pointer is over it, and Esc dismisses it (WCAG 1.4.13). It never holds the only copy of
// something: touch can't hover, so what it says must also be in the control's accessible name or
// on the page. For an explanation to open by tap, use a Popover (TermHelp).

function TooltipProvider({
	delayDuration = 300,
	...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
	return (
		<TooltipPrimitive.Provider
			data-slot="tooltip-provider"
			delayDuration={delayDuration}
			{...props}
		/>
	);
}

function Tooltip(props: React.ComponentProps<typeof TooltipPrimitive.Root>) {
	return <TooltipPrimitive.Root data-slot="tooltip" {...props} />;
}

function TooltipTrigger(props: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
	return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />;
}

function TooltipContent({
	className,
	sideOffset = 4,
	collisionPadding = 8,
	children,
	...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
	return (
		<TooltipPrimitive.Portal>
			<TooltipPrimitive.Content
				data-slot="tooltip-content"
				sideOffset={sideOffset}
				collisionPadding={collisionPadding}
				className={cn(
					"z-60 inline-flex w-fit max-w-xs items-center gap-1.5 rounded-md bg-foreground px-2.5 py-1.5 text-xs font-medium text-background shadow-pop",
					"origin-(--radix-tooltip-content-transform-origin) data-[state=delayed-open]:animate-enter data-[state=instant-open]:animate-enter",
					className,
				)}
				{...props}
			>
				{children}
				<TooltipPrimitive.Arrow className="z-60 size-2.5 translate-y-[calc(-50%-2px)] rotate-45 rounded-[2px] bg-foreground fill-foreground" />
			</TooltipPrimitive.Content>
		</TooltipPrimitive.Portal>
	);
}

/** A control with a short tooltip: the common case, in one element. */
function WithTooltip({
	label,
	side,
	children,
}: {
	label: React.ReactNode;
	side?: React.ComponentProps<typeof TooltipPrimitive.Content>["side"];
	children: React.ReactNode;
}) {
	return (
		<Tooltip>
			<TooltipTrigger asChild>{children}</TooltipTrigger>
			<TooltipContent side={side}>{label}</TooltipContent>
		</Tooltip>
	);
}

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger, WithTooltip };
