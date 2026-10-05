import { perkDoNow, perkStanding } from "@noodle/domain";
import { cn } from "@noodle/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { perkSourcesQuery } from "../queries";

/** Within this many days of resetting unused, a perk gets a line on This Month and the Check-in. */
const SOON_DAYS = 7;

/**
 * The one line for the unused perk that resets soonest, within a week ("DoorDash credit resets in
 * 3 days — use it"), or null when none does (#80). Read in the background: nothing while loading.
 */
export function usePerkResetSoon(): string | null {
	const sources = useQuery(perkSourcesQuery()).data;
	let soonest: { name: string; days: number } | null = null;
	for (const source of sources ?? []) {
		if (source.status !== "confirmed" || source.asOf === null) continue;
		for (const perk of source.perks) {
			const standing = perkStanding(perk, source.asOf);
			const days = standing.daysLeft;
			if (!perkDoNow(standing, perk.renews) || days === null || days > SOON_DAYS) continue;
			if (soonest === null || days < soonest.days) soonest = { name: perk.name, days };
		}
	}
	if (soonest === null) return null;
	const when =
		soonest.days <= 0 ? "today" : `in ${soonest.days} ${soonest.days === 1 ? "day" : "days"}`;
	return `${soonest.name} resets ${when} — use it`;
}

/** The line itself, linking to Perks & Benefits; nothing when no perk resets within a week. */
export function PerkResetLine({ line, className }: { line?: string | null; className?: string }) {
	const own = usePerkResetSoon();
	const text = line === undefined ? own : line;
	if (!text) return null;
	return (
		<p className={cn("text-sm", className)}>
			<Link
				to="/insights/perks"
				className="font-medium text-brand underline-offset-4 hover:underline max-lg:inline-flex max-lg:min-h-11 max-lg:items-center"
			>
				{text}
			</Link>
		</p>
	);
}
