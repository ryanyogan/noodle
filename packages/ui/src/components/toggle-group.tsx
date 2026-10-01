import type { VariantProps } from "class-variance-authority";
import { ToggleGroup as ToggleGroupPrimitive } from "radix-ui";
import * as React from "react";
import { cn } from "#lib/utils";
import { toggleVariants } from "./toggle";

// shadcn/ui's ToggleGroup (https://ui.shadcn.com/docs/components/toggle-group), radix-nova, on
// this design system's tokens. Two changes from the registry:
// - `variant="segmented"` draws the options on a surface-2 track, the chosen one raised.
// - A single-choice group is a radio group (Radix gives it role=radiogroup): one option is
//   always chosen (clicking the chosen one again doesn't clear it), and the arrow keys choose as
//   they move, as native radios do, rather than only moving focus.

type ToggleGroupContextValue = VariantProps<typeof toggleVariants> & {
	type: "single" | "multiple";
};

const ToggleGroupContext = React.createContext<ToggleGroupContextValue>({
	variant: "default",
	size: "default",
	type: "single",
});

type ToggleGroupProps = React.ComponentProps<typeof ToggleGroupPrimitive.Root> &
	VariantProps<typeof toggleVariants>;

function ToggleGroup({ className, variant, size, children, ...props }: ToggleGroupProps) {
	const rootProps =
		props.type === "single"
			? {
					...props,
					onValueChange: (value: string) => {
						if (value) props.onValueChange?.(value);
					},
				}
			: props;
	return (
		<ToggleGroupPrimitive.Root
			data-slot="toggle-group"
			data-variant={variant}
			data-size={size}
			className={cn(
				"group/toggle-group flex w-fit flex-row items-center gap-1",
				variant === "segmented" && "gap-0.5 rounded-lg bg-surface-2 p-0.5",
				className,
			)}
			{...rootProps}
		>
			<ToggleGroupContext.Provider value={{ variant, size, type: props.type }}>
				{children}
			</ToggleGroupContext.Provider>
		</ToggleGroupPrimitive.Root>
	);
}

function ToggleGroupItem({
	className,
	children,
	variant,
	size,
	onFocus,
	...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Item> & VariantProps<typeof toggleVariants>) {
	const context = React.useContext(ToggleGroupContext);
	return (
		<ToggleGroupPrimitive.Item
			data-slot="toggle-group-item"
			className={cn(
				"shrink-0 focus-visible:z-10",
				toggleVariants({ variant: context.variant ?? variant, size: context.size ?? size }),
				className,
			)}
			onFocus={(event) => {
				onFocus?.(event);
				// Arrowing onto an option of a single-choice group chooses it. Radix focuses the
				// chosen option when Tab enters the group, so tabbing in never changes the choice.
				const item = event.currentTarget;
				if (
					context.type === "single" &&
					item.getAttribute("aria-checked") === "false" &&
					item.matches(":focus-visible")
				) {
					item.click();
				}
			}}
			{...props}
		>
			{children}
		</ToggleGroupPrimitive.Item>
	);
}

export { ToggleGroup, ToggleGroupItem };
