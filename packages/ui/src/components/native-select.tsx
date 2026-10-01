import { ChevronDown } from "lucide-react";
import type * as React from "react";
import { cn } from "#lib/utils";

/**
 * The platform's own select (a wheel on iPhone), styled like Input: for a labelled field in a
 * form. A choice that changes what a page shows, or sits inline as a chip, is a Select instead
 * (see COMPONENTS.md).
 */
function NativeSelect({ className, ...props }: React.ComponentProps<"select">) {
	return (
		<span data-slot="native-select" className={cn("relative grid", className)}>
			<select
				className={cn(
					// 16px on phones so iOS Safari doesn't zoom on focus.
					"h-10 w-full min-w-0 appearance-none rounded-xl border border-border bg-surface-2 ps-3 pe-9 text-base text-foreground md:text-sm",
					"transition-[border-color,background-color,box-shadow] duration-(--duration-fast) ease-standard",
					"focus-visible:border-ring focus-visible:bg-card focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-brand-soft",
					"disabled:cursor-not-allowed disabled:opacity-50",
					"aria-invalid:border-over aria-invalid:ring-3 aria-invalid:ring-over-soft",
				)}
				{...props}
			/>
			<ChevronDown
				aria-hidden="true"
				className="pointer-events-none absolute inset-y-0 end-3 my-auto size-4 text-muted-foreground"
			/>
		</span>
	);
}

export { NativeSelect };
