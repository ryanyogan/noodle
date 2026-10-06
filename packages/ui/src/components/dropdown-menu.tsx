import { Check } from "lucide-react";
import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui";
import type * as React from "react";
import { setNextOpener } from "#lib/focus-return";
import { cn } from "#lib/utils";

// shadcn/ui's DropdownMenu (https://ui.shadcn.com/docs/components/dropdown-menu), radix-nova, on
// this design system's tokens: a row's or a page's less common actions behind one button. The
// parts the app uses are here (items, labels, separators, and a radio group for one of a set); the
// registry's checkbox and sub-menu parts can be added from it when something needs them.
//
// The trigger needs an accessible name ("Actions for Mortgage"), and an item that opens a sheet or
// an AlertDialog ends its label with "…".

function DropdownMenu(props: React.ComponentProps<typeof DropdownMenuPrimitive.Root>) {
	return <DropdownMenuPrimitive.Root data-slot="dropdown-menu" {...props} />;
}

function DropdownMenuTrigger(props: React.ComponentProps<typeof DropdownMenuPrimitive.Trigger>) {
	return <DropdownMenuPrimitive.Trigger data-slot="dropdown-menu-trigger" {...props} />;
}

function DropdownMenuContent({
	className,
	align = "end",
	sideOffset = 4,
	collisionPadding = 8,
	...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Content>) {
	return (
		<DropdownMenuPrimitive.Portal>
			<DropdownMenuPrimitive.Content
				data-slot="dropdown-menu-content"
				sideOffset={sideOffset}
				align={align}
				collisionPadding={collisionPadding}
				className={cn(
					// Above sheets (z-41), so a row menu works inside one.
					"z-50 max-h-(--radix-dropdown-menu-content-available-height) min-w-44 max-w-[calc(100vw-16px)] overflow-x-hidden overflow-y-auto",
					"origin-(--radix-dropdown-menu-content-transform-origin) rounded-xl border bg-popover p-1 text-popover-foreground shadow-pop",
					"data-[state=open]:animate-enter",
					className,
				)}
				{...props}
			/>
		</DropdownMenuPrimitive.Portal>
	);
}

function DropdownMenuGroup(props: React.ComponentProps<typeof DropdownMenuPrimitive.Group>) {
	return <DropdownMenuPrimitive.Group data-slot="dropdown-menu-group" {...props} />;
}

const itemClasses = [
	"relative flex min-h-9 max-lg:min-h-11 cursor-default items-center gap-2 rounded-lg px-2 py-1.5 text-sm outline-hidden select-none",
	"focus:bg-menu-hover focus:text-foreground data-disabled:pointer-events-none data-disabled:opacity-50",
	"data-[variant=destructive]:text-over-foreground data-[variant=destructive]:focus:bg-over-soft data-[variant=destructive]:focus:text-over-foreground",
	"[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg]:text-muted-foreground data-[variant=destructive]:[&_svg]:text-current",
];

function DropdownMenuItem({
	className,
	variant = "default",
	onSelect,
	...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Item> & {
	variant?: "default" | "destructive";
}) {
	return (
		<DropdownMenuPrimitive.Item
			data-slot="dropdown-menu-item"
			data-variant={variant}
			onSelect={(event) => {
				// A sheet or dialog this item opens gives focus back to the menu's button, not to the
				// item, which is gone by the time it closes.
				const menu = (event.currentTarget as HTMLElement).closest("[role=menu]");
				const trigger = menu?.id
					? document.querySelector<HTMLElement>(`[aria-controls="${CSS.escape(menu.id)}"]`)
					: null;
				setNextOpener(trigger);
				onSelect?.(event);
				// Nothing opened from it: don't hand the button to some later sheet.
				requestAnimationFrame(() => requestAnimationFrame(() => setNextOpener(null)));
			}}
			className={cn(itemClasses, className)}
			{...props}
		/>
	);
}

function DropdownMenuRadioGroup(
	props: React.ComponentProps<typeof DropdownMenuPrimitive.RadioGroup>,
) {
	return <DropdownMenuPrimitive.RadioGroup data-slot="dropdown-menu-radio-group" {...props} />;
}

/** One of a set (name the group): the chosen one is ticked, and choosing keeps the menu open. */
function DropdownMenuRadioItem({
	className,
	children,
	onSelect,
	...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.RadioItem>) {
	return (
		<DropdownMenuPrimitive.RadioItem
			data-slot="dropdown-menu-radio-item"
			onSelect={(event) => {
				// The choice changes what the Parent is looking at: they see it, then close the menu.
				event.preventDefault();
				onSelect?.(event);
			}}
			className={cn(itemClasses, className)}
			{...props}
		>
			{children}
			<DropdownMenuPrimitive.ItemIndicator className="ms-auto flex">
				<Check aria-hidden="true" />
			</DropdownMenuPrimitive.ItemIndicator>
		</DropdownMenuPrimitive.RadioItem>
	);
}

function DropdownMenuLabel({
	className,
	...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Label>) {
	return (
		<DropdownMenuPrimitive.Label
			data-slot="dropdown-menu-label"
			className={cn("px-2 pt-1.5 pb-1 text-xs font-medium text-muted-foreground", className)}
			{...props}
		/>
	);
}

function DropdownMenuSeparator({
	className,
	...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
	return (
		<DropdownMenuPrimitive.Separator
			data-slot="dropdown-menu-separator"
			className={cn("-mx-1 my-1 h-px bg-border", className)}
			{...props}
		/>
	);
}

export {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
};
