import type { PlanPart } from "@noodle/domain";
import { Card } from "@noodle/ui/components/card";
import type { ReactNode } from "react";

/**
 * One part of a month's Plan, below the Plan's header and tabs (which its layout route owns): the
 * list on the left, and the total, the add form and the explainer beside it.
 */
export function PlanSubPage({
	editable,
	summary,
	aside,
	children,
}: {
	editable: boolean;
	/** A line beside the list, e.g. what this part of the Plan takes. */
	summary?: ReactNode;
	/** The right column at lg (the add form, the page's explainer); on phones it follows the list. */
	aside?: ReactNode;
	children: ReactNode;
}) {
	return (
		<>
			{/* At lg the list takes the left; the total, the add form and the explainer sit in a sticky
			    right column. On phones that column's parts fall in line: the total first, the rest last. */}
			<div className="grid max-w-2xl gap-8 lg:max-w-none lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start xl:grid-cols-[minmax(0,1fr)_380px]">
				<div className="grid min-w-0 gap-8">{children}</div>
				<div className="max-lg:contents lg:sticky lg:top-6 lg:grid lg:gap-6">
					{summary || !editable ? (
						<div className="grid gap-3 max-lg:order-first">
							{editable ? null : <PlanEnded />}
							{summary ? (
								<p className="px-1 text-sm text-muted-foreground tabular-nums">{summary}</p>
							) : null}
						</div>
					) : null}
					{aside ? <div className="grid gap-4">{aside}</div> : null}
				</div>
			</div>
		</>
	);
}

/** Each part of the Plan on the way from take-home pay to Free to Spend: its name and its page. */
export const planParts: Record<
	PlanPart,
	{
		label: string;
		to: "/plan/$month/commitments" | "/plan/$month/buckets" | "/plan/$month/goals";
		hash?: string;
	}
> = {
	commitments: { label: "Commitments", to: "/plan/$month/commitments" },
	buckets: { label: "Buckets", to: "/plan/$month/buckets" },
	"personal-allowances": {
		label: "Personal Allowances",
		to: "/plan/$month/buckets",
		hash: "personal-allowances",
	},
	"goal-funding": { label: "Goal funding", to: "/plan/$month/goals" },
	covers: { label: "Covers", to: "/plan/$month/buckets" },
};

/** A past month's Plan is closed. */
export function PlanEnded() {
	return (
		<Card className="p-(--card-pad) text-sm text-muted-foreground">
			This month has ended, so its Plan can no longer change.
		</Card>
	);
}
