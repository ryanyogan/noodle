import { CheckIcon } from "lucide-react";
import { Checkbox as CheckboxPrimitive } from "radix-ui";
import type * as React from "react";
import { cn } from "#lib/utils";

// shadcn/ui's Checkbox (https://ui.shadcn.com/docs/components/checkbox), radix-nova, on this
// design system's tokens: checked takes the primary ink, as Switch and the primary Button do. It's
// a button with role=checkbox; name it with a <label htmlFor> or by wrapping it in a <label>.

function Checkbox({ className, ...props }: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
	return (
		<CheckboxPrimitive.Root
			data-slot="checkbox"
			className={cn(
				"peer relative grid size-4.5 max-lg:after:absolute max-lg:after:-inset-[13px] shrink-0 place-items-center rounded-[5px] border border-border-strong bg-card",
				"transition-colors duration-(--duration-fast) ease-standard",
				// A 24px target around the 18px box (WCAG 2.5.8).
				"after:absolute after:-inset-1",
				"focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
				"disabled:cursor-not-allowed disabled:opacity-50",
				"data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground",
				"aria-invalid:border-over",
				className,
			)}
			{...props}
		>
			<CheckboxPrimitive.Indicator
				data-slot="checkbox-indicator"
				className="grid place-content-center"
			>
				<CheckIcon aria-hidden="true" className="size-3.5" strokeWidth={3} />
			</CheckboxPrimitive.Indicator>
		</CheckboxPrimitive.Root>
	);
}

export { Checkbox };
