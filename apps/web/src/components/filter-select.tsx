import {
	Select,
	SelectContent,
	SelectItem,
	SelectSeparator,
	SelectTrigger,
	SelectValue,
} from "@noodle/ui/components/select";
import { cn } from "@noodle/ui/lib/utils";

/** Radix Select has no empty value; this stands for "" (no filter). */
const NONE = "__none";

export type FilterOption = { value: string; label: string };

/**
 * One option of a page's filter bar or view settings (Reports, Transactions): a visible label over
 * a shadcn Select. `""` is the unfiltered value; `all` is its label, listed first.
 */
export function FilterSelect({
	id,
	label,
	value,
	onChange,
	options,
	all,
	disabled,
	className,
	triggerClassName,
}: {
	id: string;
	label: string;
	value: string;
	onChange: (value: string) => void;
	options: FilterOption[];
	/** The label of `""`, the unfiltered choice, when there is one. */
	all?: string;
	disabled?: boolean;
	className?: string;
	triggerClassName?: string;
}) {
	return (
		<div className={cn("grid min-w-0 gap-1", className)}>
			<label htmlFor={id} className="text-[13px] font-medium text-muted-foreground">
				{label}
			</label>
			<Select
				value={value === "" ? NONE : value}
				disabled={disabled}
				onValueChange={(next) => onChange(next === NONE ? "" : next)}
			>
				<SelectTrigger id={id} className={triggerClassName}>
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					{all !== undefined ? (
						<>
							<SelectItem value={NONE}>{all}</SelectItem>
							<SelectSeparator />
						</>
					) : null}
					{options.map((option) => (
						<SelectItem key={option.value} value={option.value}>
							{option.label}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		</div>
	);
}
