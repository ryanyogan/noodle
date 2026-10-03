import type * as React from "react";
import { cn } from "#lib/utils";

function Input({ className, type, autoComplete, ...props }: React.ComponentProps<"input">) {
	const email = type === "email";
	return (
		<input
			type={type}
			// Names and amounts here are the Household's own; browser autofill only gets in the way.
			autoComplete={autoComplete ?? (email ? "email" : "off")}
			// Phone keyboards: an email keyboard that doesn't capitalize or correct the address, and a
			// Search key on search fields. Any of these can be overridden by the caller.
			inputMode={email ? "email" : type === "search" ? "search" : undefined}
			autoCapitalize={email ? "none" : undefined}
			autoCorrect={email ? "off" : undefined}
			spellCheck={email ? false : undefined}
			enterKeyHint={type === "search" ? "search" : undefined}
			data-slot="input"
			className={cn(
				// 16px on phones so iOS Safari doesn't zoom on focus.
				"h-9 max-lg:h-11 w-full min-w-0 rounded-xl border border-border bg-surface-2 px-3 text-base text-foreground lg:text-sm",
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
