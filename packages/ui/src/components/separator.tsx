import { Separator as SeparatorPrimitive } from "radix-ui";
import type * as React from "react";
import { cn } from "#lib/utils";

// shadcn/ui's Separator (https://ui.shadcn.com/docs/components/separator), radix-nova, by hand
// from the registry. Unchanged apart from `cn` and the border token. Decorative by default: it's
// a hairline, not a boundary a screen reader needs to hear.

function Separator({
	className,
	orientation = "horizontal",
	decorative = true,
	...props
}: React.ComponentProps<typeof SeparatorPrimitive.Root>) {
	return (
		<SeparatorPrimitive.Root
			data-slot="separator"
			decorative={decorative}
			orientation={orientation}
			className={cn(
				"shrink-0 bg-border data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-full data-[orientation=vertical]:w-px data-[orientation=vertical]:self-stretch",
				className,
			)}
			{...props}
		/>
	);
}

export { Separator };
