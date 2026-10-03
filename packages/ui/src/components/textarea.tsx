import type * as React from "react";
import { cn } from "#lib/utils";

// shadcn/ui's Textarea (https://ui.shadcn.com/docs/components/textarea), radix-nova, by hand from
// the registry. It grows with what's typed (`field-sizing-content`) from three lines. Changed from
// the registry: Input's surface, border, focus ring and invalid state, so the two look like one
// family, and autofill off as Input has it.

function Textarea({ className, autoComplete, ...props }: React.ComponentProps<"textarea">) {
	return (
		<textarea
			autoComplete={autoComplete ?? "off"}
			data-slot="textarea"
			className={cn(
				// 16px on phones so iOS Safari doesn't zoom on focus.
				"field-sizing-content min-h-20 w-full min-w-0 rounded-xl border border-border bg-surface-2 px-3 py-2 text-base text-foreground lg:text-sm",
				"transition-[border-color,background-color,box-shadow] duration-(--duration-fast) ease-standard",
				"placeholder:text-subtle-foreground",
				"focus-visible:border-ring focus-visible:bg-card focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-brand-soft",
				"disabled:cursor-not-allowed disabled:opacity-50",
				"aria-invalid:border-over aria-invalid:ring-3 aria-invalid:ring-over-soft",
				className,
			)}
			{...props}
		/>
	);
}

export { Textarea };
