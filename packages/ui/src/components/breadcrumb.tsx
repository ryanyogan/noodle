import { ChevronRight } from "lucide-react";
import { Slot } from "radix-ui";
import type * as React from "react";
import { cn } from "#lib/utils";

// shadcn/ui's Breadcrumb (https://ui.shadcn.com/docs/components/breadcrumb), radix-nova, on this
// design system's tokens: where a drilled-in page sits, each step a link back up, the last the
// current page.

function Breadcrumb(props: React.ComponentProps<"nav">) {
	return <nav aria-label="Breadcrumb" data-slot="breadcrumb" {...props} />;
}

function BreadcrumbList({ className, ...props }: React.ComponentProps<"ol">) {
	return (
		<ol
			data-slot="breadcrumb-list"
			className={cn(
				"flex flex-wrap items-center gap-1 text-[13px] break-words text-muted-foreground",
				className,
			)}
			{...props}
		/>
	);
}

function BreadcrumbItem({ className, ...props }: React.ComponentProps<"li">) {
	return (
		<li
			data-slot="breadcrumb-item"
			className={cn("inline-flex items-center gap-1", className)}
			{...props}
		/>
	);
}

function BreadcrumbLink({
	asChild,
	className,
	...props
}: React.ComponentProps<"a"> & { asChild?: boolean }) {
	const Comp = asChild ? Slot.Root : "a";
	return (
		<Comp
			data-slot="breadcrumb-link"
			className={cn(
				"-mx-1 rounded-md px-1 py-0.5 font-medium transition-colors duration-(--duration-fast) hover:bg-surface-2 hover:text-foreground",
				className,
			)}
			{...props}
		/>
	);
}

function BreadcrumbPage({ className, ...props }: React.ComponentProps<"span">) {
	return (
		<span
			data-slot="breadcrumb-page"
			aria-current="page"
			className={cn("font-medium text-foreground", className)}
			{...props}
		/>
	);
}

function BreadcrumbSeparator({ children, className, ...props }: React.ComponentProps<"li">) {
	return (
		<li
			data-slot="breadcrumb-separator"
			role="presentation"
			aria-hidden="true"
			className={cn("[&>svg]:size-3.5 [&>svg]:text-subtle-foreground", className)}
			{...props}
		>
			{children ?? <ChevronRight />}
		</li>
	);
}

export {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbLink,
	BreadcrumbList,
	BreadcrumbPage,
	BreadcrumbSeparator,
};
