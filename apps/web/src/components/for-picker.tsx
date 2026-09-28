import type { For } from "@noodle/domain";
import { cn } from "@noodle/ui/lib/utils";
import type { MemberSummary } from "../members";
import { pickableMembers } from "../members";

/**
 * Who spending was For, as a segmented control: Everyone (the whole Household), then each Child,
 * then each Parent. One tap picks one Member; with `multiple`, taps add or remove Members and
 * Everyone clears them. Removed Children only show while they're picked.
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
	function pick(memberId: string) {
		if (!multiple) return onChange([memberId]);
		onChange(
			value.includes(memberId) ? value.filter((id) => id !== memberId) : [...value, memberId],
		);
	}
	return (
		<fieldset className={cn("grid gap-2", className)}>
			<legend className="mb-2 text-xs font-medium text-muted-foreground">For</legend>
			<div className="flex gap-1 overflow-x-auto rounded-xl bg-surface-2 p-0.75 [scrollbar-width:none]">
				<Segment pressed={value.length === 0} onClick={() => onChange([])}>
					Everyone
				</Segment>
				{options.map((member) => (
					<Segment
						key={member.id}
						pressed={value.includes(member.id)}
						onClick={() => pick(member.id)}
					>
						{member.name}
					</Segment>
				))}
			</div>
		</fieldset>
	);
}

function Segment({
	pressed,
	onClick,
	children,
}: {
	pressed: boolean;
	onClick: () => void;
	children: string;
}) {
	return (
		<button
			type="button"
			aria-pressed={pressed}
			onClick={onClick}
			className={cn(
				"h-7.5 flex-[1_0_auto] rounded-[9px] px-3 text-[13px] font-medium whitespace-nowrap text-muted-foreground",
				"transition-[background-color,color,box-shadow] duration-(--duration-fast) ease-standard",
				"hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
				"aria-pressed:bg-card aria-pressed:text-foreground aria-pressed:shadow-card aria-pressed:ring-1 aria-pressed:ring-border",
			)}
		>
			{children}
		</button>
	);
}
