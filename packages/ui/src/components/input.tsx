import type * as React from "react";
import { cn } from "#lib/utils";

function Input({ className, type, autoComplete, ...props }: React.ComponentProps<"input">) {
	return (
		<input
			type={type}
			// Names and amounts here are the Household's own; browser autofill only gets in the way.
			autoComplete={autoComplete ?? (type === "email" ? "email" : "off")}
			data-slot="input"
			className={cn(
				// 16px on phones so iOS Safari doesn't zoom on focus.
				"h-9 max-lg:h-11 w-full min-w-0 rounded-xl border border-border bg-surface-2 px-3 text-base text-foreground md:text-sm",
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

export { Input };
