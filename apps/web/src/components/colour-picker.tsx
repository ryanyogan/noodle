import { cn } from "@noodle/ui/lib/utils";
import { bucketColors } from "../buckets";

/** Picks one of the eight identity colours, as radio buttons. */
export function ColourPicker({
	name,
	value,
	onChange,
}: {
	/** Groups the radios; unique per picker on the page. */
	name: string;
	value: number;
	onChange: (color: number) => void;
}) {
	return (
		<fieldset className="grid gap-2">
			<legend className="mb-2 text-sm font-medium">Colour</legend>
			<div className="flex flex-wrap gap-2">
				{bucketColors.map((option) => (
					<label key={option.value} className="relative">
						<input
							type="radio"
							name={name}
							value={option.value}
							checked={value === option.value}
							onChange={() => onChange(option.value)}
							className="peer absolute inset-0 z-10 size-full cursor-pointer appearance-none rounded-full opacity-0"
						/>
						<span className="sr-only">{option.name}</span>
						<span
							aria-hidden="true"
							className={cn(
								"block size-8 rounded-full ring-offset-2 ring-offset-surface-2 transition-shadow duration-(--duration-fast)",
								"peer-checked:ring-2 peer-checked:ring-foreground peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-ring",
							)}
							style={{ background: `var(--bucket-${option.value})` }}
						/>
					</label>
				))}
			</div>
		</fieldset>
	);
}
