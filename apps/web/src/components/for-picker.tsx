import type { For } from "@noodle/domain";
import { ToggleGroup, ToggleGroupItem } from "@noodle/ui/components/toggle-group";
import { cn } from "@noodle/ui/lib/utils";
import { useId } from "react";
import type { MemberSummary } from "../members";
import { pickableMembers } from "../members";

/**
 * Who spending was For, as a segmented control: Everyone (the whole Household), then each Child,
 * then each Parent. One tap picks one Member (a radio group); with `multiple`, taps add or remove
 * Members and Everyone clears them (toggle buttons). Removed Children only show while they're picked.
 */
export function ForPicker({
	members,
	value,
	onChange,
	multiple = false,
	className,
}: {
	members: MemberSummary[];
	value: For;
	onChange: (value: For) => void;
	multiple?: boolean;
	className?: string;
}) {
	const options = pickableMembers(members, value);
	const labelId = useId();
	const everyone = "everyone";
	const items = (
		<>
			<ToggleGroupItem value={everyone} className={itemClass}>
				Everyone
			</ToggleGroupItem>
			{options.map((member) => (
				<ToggleGroupItem key={member.id} value={member.id} className={itemClass}>
					{member.name}
				</ToggleGroupItem>
			))}
		</>
	);
	return (
		<div className={cn("grid gap-2", className)}>
			<p id={labelId} className="mb-2 text-xs font-medium text-muted-foreground">
				For
			</p>
			{multiple ? (
				// Several Members, or Everyone: picking Everyone clears the others.
				<ToggleGroup
					type="multiple"
					variant="segmented"
					aria-labelledby={labelId}
					value={value.length === 0 ? [everyone] : value}
					onValueChange={(next) =>
						onChange(
							next.includes(everyone) && value.length > 0
								? []
								: next.filter((id) => id !== everyone),
						)
					}
					className={trackClass}
				>
					{items}
				</ToggleGroup>
			) : (
				<ToggleGroup
					type="single"
					variant="segmented"
					aria-labelledby={labelId}
					value={value[0] ?? everyone}
					onValueChange={(next) => onChange(next === everyone ? [] : [next])}
					className={trackClass}
				>
					{items}
				</ToggleGroup>
			)}
		</div>
	);
}

const trackClass = "flex w-full overflow-x-auto rounded-xl p-0.75 [scrollbar-width:none]";
const itemClass = "h-7.5 flex-[1_0_auto] rounded-[9px] px-3";
