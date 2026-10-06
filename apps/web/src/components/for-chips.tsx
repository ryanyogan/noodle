import type { For } from "@noodle/domain";
import { ToggleGroup, ToggleGroupItem } from "@noodle/ui/components/toggle-group";
import { cn } from "@noodle/ui/lib/utils";
import { useId } from "react";
import type { MemberSummary } from "../members";
import { pickableMembers } from "../members";

const EVERYONE = "everyone";
const AS_IT_IS = "as-it-is";

/**
 * What a tap on a chip makes of For (issue 138). A Member's chip adds or removes them; Everyone
 * clears the Members; with none left it is Everyone again. "As it is" (null) is only for filing
 * many at once, where each Transaction may keep its own.
 */
export function forAfterTap(value: For | null, tapped: string): For | null {
	if (tapped === AS_IT_IS) return null;
	if (tapped === EVERYONE) return [];
	const now = value ?? [];
	return now.includes(tapped) ? now.filter((id) => id !== tapped) : [...now, tapped];
}

/**
 * Who spending is For, as a line of chips: Everyone, then each Child, then each Parent. Several
 * Members can be on at once. Smaller than `ForPicker`: for a Review card and the bar that files
 * many, where it sits beside the Bucket picker. With `asItIs`, a first chip leaves For alone.
 */
export function ForChips({
	members,
	value,
	onChange,
	asItIs = false,
	what,
	disabled = false,
	className,
}: {
	members: MemberSummary[];
	/** Null: as it is (only with `asItIs`). */
	value: For | null;
	onChange: (value: For | null) => void;
	asItIs?: boolean;
	/** What it is For, for a screen reader: "Who Trader Joe’s, $42 is For". */
	what?: string;
	disabled?: boolean;
	className?: string;
}) {
	const labelId = useId();
	const options = pickableMembers(members, value ?? []);
	const on = value === null ? [AS_IT_IS] : value.length === 0 ? [EVERYONE] : value;
	return (
		<div className={cn("flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1", className)}>
			<span id={labelId} className="text-xs font-medium text-muted-foreground">
				<span aria-hidden={what ? true : undefined}>For</span>
				{what ? <span className="sr-only">{what}</span> : null}
			</span>
			<ToggleGroup
				type="multiple"
				variant="chip"
				size="sm"
				aria-labelledby={labelId}
				disabled={disabled}
				value={on}
				onValueChange={(next) => {
					const tapped = next.find((id) => !on.includes(id)) ?? on.find((id) => !next.includes(id));
					// The chip that says how it is now can't be turned off: another one is picked instead.
					if (!tapped || ((tapped === EVERYONE || tapped === AS_IT_IS) && on.includes(tapped))) {
						return;
					}
					onChange(forAfterTap(value, tapped));
				}}
				className="w-auto min-w-0 flex-wrap"
			>
				{asItIs ? <ToggleGroupItem value={AS_IT_IS}>As it is</ToggleGroupItem> : null}
				<ToggleGroupItem value={EVERYONE}>Everyone</ToggleGroupItem>
				{options.map((member) => (
					<ToggleGroupItem key={member.id} value={member.id}>
						<span className="max-w-28 truncate">{member.name}</span>
					</ToggleGroupItem>
				))}
			</ToggleGroup>
		</div>
	);
}
