import type { MonthKey, PlanPart } from "@noodle/domain";
import { Button } from "@noodle/ui/components/button";
import { Card } from "@noodle/ui/components/card";
import { PageHeader } from "@noodle/ui/components/page-header";
import { Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import type { ReactNode } from "react";
import { monthTitle } from "./month-nav";

/** One part of a month's Plan on its own page, with the way back to the Plan's overview. */
export function PlanSubPage({
	month,
	current,
	editable,
	title,
	summary,
	children,
}: {
	month: MonthKey;
	/** The Household's current month. */
	current: MonthKey;
	editable: boolean;
	title: string;
	/** A line under the header, e.g. what this part of the Plan takes. */
	summary?: ReactNode;
	children: ReactNode;
}) {
	return (
		<>
			<PageHeader
				className="max-w-2xl"
				eyebrow={`${monthTitle(month, current)} Plan`}
				title={title}
				leading={
					<Button variant="ghost" size="icon" asChild>
						<Link to="/plan/$month" params={{ month }} aria-label="Back to Plan">
							<ChevronLeft className="size-5" />
						</Link>
					</Button>
				}
			/>
			<div className="grid max-w-2xl gap-8">
				{summary || !editable ? (
					<div className="grid gap-3">
						{editable ? null : <PlanEnded />}
						{summary ? <p className="px-1 text-sm text-muted-foreground">{summary}</p> : null}
					</div>
				) : null}
				{children}
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
