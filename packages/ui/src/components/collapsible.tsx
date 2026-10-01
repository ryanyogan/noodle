import { Collapsible as CollapsiblePrimitive } from "radix-ui";
import type * as React from "react";
import { useHydrated } from "#lib/hydrated";
import { cn } from "#lib/utils";

// shadcn/ui's Collapsible (https://ui.shadcn.com/docs/components/collapsible), radix-nova: a
// section that shows or hides on its trigger, a button with aria-expanded. Put `group` on the
// Root and rotate the trigger's chevron with `group-data-[state=open]:rotate-90`.

function Collapsible(props: React.ComponentProps<typeof CollapsiblePrimitive.Root>) {
	return <CollapsiblePrimitive.Root data-slot="collapsible" {...props} />;
}

function CollapsibleTrigger({
	disabled,
	...props
}: React.ComponentProps<typeof CollapsiblePrimitive.CollapsibleTrigger>) {
	// A <details> opened before hydration; this button needs React, so it waits for it.
	const hydrated = useHydrated();
	return (
		<CollapsiblePrimitive.CollapsibleTrigger
			data-slot="collapsible-trigger"
			disabled={disabled || !hydrated}
			{...props}
		/>
	);
}

/**
 * What shows when open. It's unmounted while closed; `keepMounted` keeps it in the page, hidden,
 * as a <details> does: for fields whose values a form still reads, or to find it in the page.
 */
function CollapsibleContent({
	keepMounted = false,
	className,
	...props
}: React.ComponentProps<typeof CollapsiblePrimitive.CollapsibleContent> & {
	keepMounted?: boolean;
}) {
	return (
		<CollapsiblePrimitive.CollapsibleContent
			data-slot="collapsible-content"
			forceMount={keepMounted || undefined}
			className={cn(keepMounted && "data-[state=closed]:hidden", className)}
			{...props}
		/>
	);
}

export { Collapsible, CollapsibleContent, CollapsibleTrigger };
