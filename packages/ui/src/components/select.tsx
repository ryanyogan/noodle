import { CheckIcon, ChevronDownIcon, ChevronUpIcon } from "lucide-react";
import { Select as SelectPrimitive } from "radix-ui";
import type * as React from "react";
import { cn } from "#lib/utils";

// shadcn/ui's Select (https://ui.shadcn.com/docs/components/select), radix-nova, on this design
// system's tokens: the trigger matches Input and NativeSelect, the list matches Popover.
//
// Which select where (packages/ui/COMPONENTS.md): Select for a choice that changes what a page
// shows or sits inline as a chip (Reports' options, Transactions' filters, Explore's chips);
// NativeSelect for a labelled field in a form, where a phone's own picker is the better control.

function Select(props: React.ComponentProps<typeof SelectPrimitive.Root>) {
	return <SelectPrimitive.Root data-slot="select" {...props} />;
}

function SelectGroup({ className, ...props }: React.ComponentProps<typeof SelectPrimitive.Group>) {
	return (
		<SelectPrimitive.Group
			data-slot="select-group"
			className={cn("scroll-my-1 p-1", className)}
			{...props}
		/>
	);
}

function SelectValue(props: React.ComponentProps<typeof SelectPrimitive.Value>) {
	return <SelectPrimitive.Value data-slot="select-value" {...props} />;
}

function SelectTrigger({
	className,
	size = "default",
	children,
	...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger> & {
	/** `default` is a form field's height; `sm` a compact chip; `pill` a rounded chip. */
	size?: "sm" | "default" | "pill";
}) {
	return (
		<SelectPrimitive.Trigger
			data-slot="select-trigger"
			data-size={size}
			className={cn(
				"flex w-full min-w-0 items-center justify-between gap-1.5 border border-border bg-surface-2 text-start whitespace-nowrap text-foreground select-none",
				"transition-[border-color,background-color,box-shadow] duration-(--duration-fast) ease-standard",
				"hover:border-border-strong focus-visible:border-ring focus-visible:bg-card focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-brand-soft",
				"disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-over aria-invalid:ring-3 aria-invalid:ring-over-soft",
				"data-placeholder:text-subtle-foreground",
				// 16px on phones so iOS Safari doesn't zoom, as Input.
				"data-[size=default]:h-10 data-[size=default]:rounded-xl data-[size=default]:ps-3 data-[size=default]:pe-2.5 data-[size=default]:text-base md:data-[size=default]:text-sm",
				"data-[size=sm]:h-8 data-[size=sm]:rounded-lg data-[size=sm]:ps-2.5 data-[size=sm]:pe-2 data-[size=sm]:text-[13px]",
				"data-[size=pill]:h-8 data-[size=pill]:w-auto data-[size=pill]:rounded-full data-[size=pill]:ps-3 data-[size=pill]:pe-2 data-[size=pill]:text-[13px] data-[size=pill]:font-medium lg:data-[size=pill]:h-7",
				"*:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-1.5",
				"[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
				className,
			)}
			{...props}
		>
			{children}
			<SelectPrimitive.Icon asChild>
				<ChevronDownIcon aria-hidden="true" className="text-muted-foreground" />
			</SelectPrimitive.Icon>
		</SelectPrimitive.Trigger>
	);
}

function SelectContent({
	className,
	children,
	position = "popper",
	align = "start",
	sideOffset = 4,
	collisionPadding = 8,
	...props
}: React.ComponentProps<typeof SelectPrimitive.Content>) {
	return (
		<SelectPrimitive.Portal>
			<SelectPrimitive.Content
				data-slot="select-content"
				className={cn(
					// Above sheets (z-41) and alert dialogs (z-51), so a Select works in either.
					"relative z-55 max-h-(--radix-select-content-available-height) overflow-x-hidden overflow-y-auto",
					"origin-(--radix-select-content-transform-origin) rounded-xl border bg-popover text-popover-foreground shadow-pop",
					"data-[state=open]:animate-enter",
					position === "popper" &&
						"max-w-[calc(100vw-16px)] min-w-[max(var(--radix-select-trigger-width),9rem)]",
					className,
				)}
				position={position}
				align={align}
				sideOffset={sideOffset}
				collisionPadding={collisionPadding}
				{...props}
			>
				<SelectScrollUpButton />
				<SelectPrimitive.Viewport data-position={position} className="p-1">
					{children}
				</SelectPrimitive.Viewport>
				<SelectScrollDownButton />
			</SelectPrimitive.Content>
		</SelectPrimitive.Portal>
	);
}

function SelectLabel({ className, ...props }: React.ComponentProps<typeof SelectPrimitive.Label>) {
	return (
		<SelectPrimitive.Label
			data-slot="select-label"
			className={cn("px-2 pt-1.5 pb-1 text-xs font-medium text-muted-foreground", className)}
			{...props}
		/>
	);
}

function SelectItem({
	className,
	children,
	...props
}: React.ComponentProps<typeof SelectPrimitive.Item>) {
	return (
		<SelectPrimitive.Item
			data-slot="select-item"
			className={cn(
				"relative flex min-h-9 w-full cursor-default items-center gap-2 rounded-lg py-1.5 ps-2 pe-8 text-sm outline-hidden select-none",
				"focus:bg-surface-2 focus:text-foreground data-[state=checked]:font-medium",
				"data-disabled:pointer-events-none data-disabled:opacity-50",
				"[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
				className,
			)}
			{...props}
		>
			<span className="pointer-events-none absolute end-2 flex size-4 items-center justify-center">
				<SelectPrimitive.ItemIndicator>
					<CheckIcon aria-hidden="true" />
				</SelectPrimitive.ItemIndicator>
			</span>
			<SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
		</SelectPrimitive.Item>
	);
}

function SelectSeparator({
	className,
	...props
}: React.ComponentProps<typeof SelectPrimitive.Separator>) {
	return (
		<SelectPrimitive.Separator
			data-slot="select-separator"
			className={cn("pointer-events-none -mx-1 my-1 h-px bg-border", className)}
			{...props}
		/>
	);
}

function SelectScrollUpButton({
	className,
	...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollUpButton>) {
	return (
		<SelectPrimitive.ScrollUpButton
			data-slot="select-scroll-up-button"
			className={cn("flex cursor-default items-center justify-center py-1", className)}
			{...props}
		>
			<ChevronUpIcon aria-hidden="true" className="size-4" />
		</SelectPrimitive.ScrollUpButton>
	);
}

function SelectScrollDownButton({
	className,
	...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollDownButton>) {
	return (
		<SelectPrimitive.ScrollDownButton
			data-slot="select-scroll-down-button"
			className={cn("flex cursor-default items-center justify-center py-1", className)}
			{...props}
		>
			<ChevronDownIcon aria-hidden="true" className="size-4" />
		</SelectPrimitive.ScrollDownButton>
	);
}

export {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectLabel,
	SelectScrollDownButton,
	SelectScrollUpButton,
	SelectSeparator,
	SelectTrigger,
	SelectValue,
};
