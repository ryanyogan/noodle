import { Command as CommandPrimitive } from "cmdk";
import { CheckIcon, SearchIcon } from "lucide-react";
import type * as React from "react";
import { cn } from "#lib/utils";

// shadcn/ui's Command (https://ui.shadcn.com/docs/components/command), radix-nova, on this design
// system's tokens: a searchable list, used by Combobox. CommandDialog is left out (no palette yet).

function Command({ className, ...props }: React.ComponentProps<typeof CommandPrimitive>) {
	return (
		<CommandPrimitive
			data-slot="command"
			className={cn(
				"flex size-full flex-col overflow-hidden rounded-xl bg-popover text-popover-foreground",
				className,
			)}
			{...props}
		/>
	);
}

function CommandInput({
	className,
	...props
}: React.ComponentProps<typeof CommandPrimitive.Input>) {
	return (
		<div data-slot="command-input-wrapper" className="flex items-center gap-2 border-b px-3">
			<SearchIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
			<CommandPrimitive.Input
				data-slot="command-input"
				className={cn(
					// 16px on phones so iOS Safari doesn't zoom, as Input.
					"h-10 w-full min-w-0 bg-transparent text-base outline-hidden placeholder:text-subtle-foreground md:text-sm",
					"disabled:cursor-not-allowed disabled:opacity-50",
					className,
				)}
				{...props}
			/>
		</div>
	);
}

function CommandList({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.List>) {
	return (
		<CommandPrimitive.List
			data-slot="command-list"
			className={cn(
				"max-h-[min(18rem,calc(var(--radix-popover-content-available-height,21rem)_-_3rem))] scroll-py-1 overflow-x-hidden overflow-y-auto overscroll-contain p-1 outline-none",
				className,
			)}
			{...props}
		/>
	);
}

function CommandEmpty({
	className,
	...props
}: React.ComponentProps<typeof CommandPrimitive.Empty>) {
	return (
		<CommandPrimitive.Empty
			data-slot="command-empty"
			className={cn("py-6 text-center text-sm text-muted-foreground", className)}
			{...props}
		/>
	);
}

function CommandGroup({
	className,
	...props
}: React.ComponentProps<typeof CommandPrimitive.Group>) {
	return (
		<CommandPrimitive.Group
			data-slot="command-group"
			className={cn(
				"overflow-hidden text-foreground **:[[cmdk-group-heading]]:px-2 **:[[cmdk-group-heading]]:pt-1.5 **:[[cmdk-group-heading]]:pb-1 **:[[cmdk-group-heading]]:text-xs **:[[cmdk-group-heading]]:font-medium **:[[cmdk-group-heading]]:text-muted-foreground",
				className,
			)}
			{...props}
		/>
	);
}

function CommandSeparator({
	className,
	...props
}: React.ComponentProps<typeof CommandPrimitive.Separator>) {
	return (
		<CommandPrimitive.Separator
			data-slot="command-separator"
			className={cn("-mx-1 my-1 h-px bg-border", className)}
			{...props}
		/>
	);
}

function CommandItem({
	className,
	children,
	checked,
	...props
}: React.ComponentProps<typeof CommandPrimitive.Item> & { checked?: boolean }) {
	return (
		<CommandPrimitive.Item
			data-slot="command-item"
			data-checked={checked || undefined}
			className={cn(
				"relative flex min-h-9 cursor-default items-center gap-2 rounded-lg py-1.5 ps-2 pe-8 text-sm outline-hidden select-none",
				"data-[selected=true]:bg-surface-2 data-[selected=true]:text-foreground data-checked:font-medium",
				"data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50",
				"[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
				className,
			)}
			{...props}
		>
			{children}
			{checked ? (
				<CheckIcon aria-hidden="true" className="absolute end-2 top-1/2 -translate-y-1/2" />
			) : null}
		</CommandPrimitive.Item>
	);
}

export {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
	CommandSeparator,
};
