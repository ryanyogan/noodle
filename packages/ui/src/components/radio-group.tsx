import { RadioGroup as RadioGroupPrimitive } from "radix-ui";
import type * as React from "react";
import { cn } from "#lib/utils";

// shadcn/ui's RadioGroup (https://ui.shadcn.com/docs/components/radio-group), radix-nova, on this
// design system's tokens. Name the group (aria-label or aria-labelledby) and each item (a <label
// htmlFor>, or aria-label). Arrow keys move and choose, as native radios do.
//
// `RadioGroupCard` is Noodle's own: a whole row as the target, for choices with a line of
// explanation (Resets monthly / Carries over, where to Cover from).

function RadioGroup({
	className,
	...props
}: React.ComponentProps<typeof RadioGroupPrimitive.Root>) {
	return (
		<RadioGroupPrimitive.Root
			data-slot="radio-group"
			className={cn("grid w-full gap-2", className)}
			{...props}
		/>
	);
}

function RadioGroupItem({
	className,
	...props
}: React.ComponentProps<typeof RadioGroupPrimitive.Item>) {
	return (
		<RadioGroupPrimitive.Item
			data-slot="radio-group-item"
			className={cn(
				"peer relative grid aspect-square size-4.5 max-lg:after:absolute max-lg:after:-inset-[13px] shrink-0 place-items-center rounded-full border border-input bg-card",
				"transition-colors duration-(--duration-fast) ease-standard after:absolute after:-inset-1",
				"focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
				"disabled:cursor-not-allowed disabled:opacity-50",
				"data-[state=checked]:border-primary data-[state=checked]:bg-primary",
				className,
			)}
			{...props}
		>
			<RadioGroupPrimitive.Indicator data-slot="radio-group-indicator">
				<span className="block size-1.75 rounded-full bg-primary-foreground" />
			</RadioGroupPrimitive.Indicator>
		</RadioGroupPrimitive.Item>
	);
}

/** A bare radio with no circle drawn, for a radio styled entirely by its caller (a swatch). */
function RadioGroupPrimitiveItem(props: React.ComponentProps<typeof RadioGroupPrimitive.Item>) {
	return <RadioGroupPrimitive.Item data-slot="radio-group-item" {...props} />;
}

/** A radio as a whole row: the item, its label and a line under it, all one target. */
function RadioGroupCard({
	id,
	value,
	label,
	description,
	trailing,
	disabled,
	className,
}: {
	id: string;
	value: string;
	label: React.ReactNode;
	description?: React.ReactNode;
	trailing?: React.ReactNode;
	disabled?: boolean;
	className?: string;
}) {
	return (
		<label
			htmlFor={id}
			className={cn(
				"flex cursor-pointer items-start gap-3 rounded-xl border bg-card px-3 py-2.5",
				"transition-colors duration-(--duration-fast) ease-standard hover:bg-surface-2",
				"has-data-[state=checked]:border-foreground/40 has-data-[state=checked]:bg-surface-2",
				"has-disabled:cursor-not-allowed has-disabled:opacity-60 has-disabled:hover:bg-card",
				className,
			)}
		>
			<RadioGroupItem id={id} value={value} disabled={disabled} className="mt-0.5" />
			<span className="grid min-w-0 flex-1 gap-0.5">
				<span className="text-sm font-medium">{label}</span>
				{description ? (
					<span className="text-[13px] text-muted-foreground">{description}</span>
				) : null}
			</span>
			{trailing ? <span className="shrink-0 text-sm tabular-nums">{trailing}</span> : null}
		</label>
	);
}

export { RadioGroup, RadioGroupCard, RadioGroupItem, RadioGroupPrimitiveItem };
