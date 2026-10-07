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
 * In a narrow pane or popover the choices wrap onto more lines rather than run off the side; on a
 * phone they are three equal columns, so none is left alone on a line at 393px (issue 74).
 */
export function ForPicker({
	members,
	value,
	onChange,
	multiple = false,
	field = false,
	className,
}: {
	members: MemberSummary[];
	value: For;
	onChange: (value: For) => void;
	multiple?: boolean;
	/** Among a form's Fields: "For" reads as their labels do, the same size and distance above. */
	field?: boolean;
	className?: string;
}) {
	const options = pickableMembers(members, value);
	const labelId = useId();
	const everyone = "everyone";
	const items = (
		<>
			<ToggleGroupItem value={everyone} className={itemClass}>
				<span className="truncate">Everyone</span>
			</ToggleGroupItem>
			{options.map((member) => (
				<ToggleGroupItem key={member.id} value={member.id} className={itemClass}>
					<span className="truncate">{member.name}</span>
				</ToggleGroupItem>
			))}
		</>
	);
	return (
		<div className={cn("@container grid gap-2", className)}>
			<p
				id={labelId}
				className={cn(
					"font-medium text-muted-foreground",
					field ? "text-[13px] leading-none" : "mb-2 text-xs",
				)}
			>
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

// With room the choices share one line (and scroll inside it if a big family doesn't fit). On a
// phone they wrap into equal columns instead, three across at 320, so none is cut off at the
// edge (#74); a long name is cut with an ellipsis inside its own choice. The same goes wherever
// the picker itself is under 28rem wide, whatever the window: the open Transaction's pane beside
// the list is about 280px at 1024, where the fifth choice was cut off after two letters (#73).
// From a tablet up a narrow pane (a sheet, a popover) wraps the choices only when they don't fit:
// in equal columns five choices left the fifth alone on a second line in "Make a Rule" (issue 73).
const trackClass =
	"flex w-full overflow-x-auto rounded-xl p-0.75 [scrollbar-width:none] max-sm:grid max-sm:grid-cols-3! max-sm:overflow-x-visible @max-md:grid @max-md:grid-cols-[repeat(auto-fit,minmax(5rem,1fr))] @max-md:overflow-x-visible sm:@max-md:flex! sm:@max-md:flex-wrap";
// Under 14rem (a Split's card on a 320px phone) a column is about 64px: less padding and a
// slightly smaller word, so "Everyone" is whole (issue 74).
const itemClass =
	"h-7.5 min-w-0 flex-[1_0_auto] rounded-[9px] px-3 max-sm:px-2 @max-md:px-2 @max-[14rem]:px-1 @max-[14rem]:text-[13px]";
