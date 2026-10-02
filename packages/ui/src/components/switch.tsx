import { Switch as SwitchPrimitive } from "radix-ui";
import type * as React from "react";
import { cn } from "#lib/utils";

// shadcn/ui's Switch (https://ui.shadcn.com/docs/components/switch), radix-nova, on this design
// system's tokens, at the size the app's own switch had (40×24): a setting that takes effect at
// once. It's a button with role=switch; name it with a <label htmlFor>.

function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
	return (
		<SwitchPrimitive.Root
			data-slot="switch"
			className={cn(
				"peer group/switch relative inline-flex h-6 w-10 shrink-0 max-lg:after:absolute max-lg:after:-inset-x-0.5 max-lg:after:-inset-y-2.5 items-center rounded-full border border-border-strong bg-surface-3 p-0.5",
				"transition-colors duration-(--duration-fast) ease-standard",
				"focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
				"disabled:cursor-not-allowed disabled:opacity-50",
				"data-[state=checked]:border-transparent data-[state=checked]:bg-primary",
				className,
			)}
			{...props}
		>
			<SwitchPrimitive.Thumb
				data-slot="switch-thumb"
				className={cn(
					"pointer-events-none block size-4.5 rounded-full bg-card shadow-card",
					"transition-transform duration-(--duration-fast) ease-standard data-[state=checked]:translate-x-4",
				)}
			/>
		</SwitchPrimitive.Root>
	);
}

export { Switch };
