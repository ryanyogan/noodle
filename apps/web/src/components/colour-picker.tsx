import { RadioGroup, RadioGroupPrimitiveItem } from "@noodle/ui/components/radio-group";
import { cn } from "@noodle/ui/lib/utils";
import { useId } from "react";
import { bucketColors } from "../buckets";

/**
 * Picks one of the eight identity colours: a shadcn RadioGroup drawn as swatches, each named by its
 * colour. Arrow keys move and choose.
 */
export function ColourPicker({
	value,
	onChange,
	className,
}: {
	value: number;
	onChange: (color: number) => void;
	className?: string;
}) {
	const labelId = useId();
	return (
		<div className={cn("grid gap-2", className)}>
			<p id={labelId} className="mb-2 text-sm font-medium">
				Colour
			</p>
			<RadioGroup
				aria-labelledby={labelId}
				value={String(value)}
				onValueChange={(next) => onChange(Number(next))}
				className="flex flex-wrap gap-2"
			>
				{bucketColors.map((option) => (
					<RadioGroupPrimitiveItem
						key={option.value}
						value={String(option.value)}
						aria-label={option.name}
						className={cn(
							"block size-8 rounded-full ring-offset-2 ring-offset-card transition-shadow duration-(--duration-fast)",
							"data-[state=checked]:ring-2 data-[state=checked]:ring-foreground",
							"focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring",
						)}
						style={{ background: `var(--bucket-${option.value})` }}
					/>
				))}
			</RadioGroup>
		</div>
	);
}
