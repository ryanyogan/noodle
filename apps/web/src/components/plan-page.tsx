import type { MonthKey, PlanPart } from "@noodle/domain";
import { Button } from "@noodle/ui/components/button";
import { Card } from "@noodle/ui/components/card";
import { PageHeader } from "@noodle/ui/components/page-header";
import { cn } from "@noodle/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import type { ReactNode } from "react";
import { monthTitle } from "./month-nav";

/** The Plan's pages, by what each one is about. */
export type PlanPage = "overview" | "income" | "commitments" | "buckets" | "goals" | "year";

/**
 * The Plan's pages, side by side under its header, so a Parent can see where each part of the Plan
 * lives and go between them (the overview's rows lead there too). Styled like tabs; each is a link.
 */
export function PlanNav({ month, page }: { month: MonthKey; page: PlanPage }) {
	const link = (key: PlanPage) =>
		cn(
			"inline-flex h-8 shrink-0 items-center rounded-md px-3 text-[13px] font-medium text-muted-foreground",
			"transition-colors duration-(--duration-fast) ease-standard hover:text-foreground",
			"focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
			key === page && "bg-card text-foreground shadow-card",
		);
	const current = (key: PlanPage) => (key === page ? ("page" as const) : undefined);
	return (
		<nav aria-label="Plan pages" className="mb-6 max-w-full overflow-x-auto">
			<div className="inline-flex gap-0.5 rounded-lg bg-surface-2 p-0.5">
				<Link
					to="/plan/$month"
					params={{ month }}
					className={link("overview")}
					aria-current={current("overview")}
				>
					Overview
				</Link>
				<Link
					to="/plan/$month/income"
					params={{ month }}
					className={link("income")}
					aria-current={current("income")}
				>
					Income
				</Link>
				<Link
					to="/plan/$month/commitments"
					params={{ month }}
					className={link("commitments")}
					aria-current={current("commitments")}
				>
					Commitments
				</Link>
				<Link
					to="/plan/$month/buckets"
					params={{ month }}
					className={link("buckets")}
					aria-current={current("buckets")}
				>
					Buckets
				</Link>
				<Link
					to="/plan/$month/goals"
					params={{ month }}
					className={link("goals")}
					aria-current={current("goals")}
				>
					Goal funding
				</Link>
				<Link
					to="/plan/year/$year"
					params={{ year: month.slice(0, 4) }}
					className={link("year")}
					aria-current={current("year")}
				>
					Year
				</Link>
			</div>
		</nav>
	);
}

/** One part of a month's Plan on its own page, with the way back to the Plan's overview. */
export function PlanSubPage({
	month,
	current,
	editable,
	title,
	page,
	summary,
	actions,
	children,
}: {
	month: MonthKey;
	/** The Household's current month. */
	current: MonthKey;
	editable: boolean;
	title: string;
	page: PlanPage;
	/** A line under the header, e.g. what this part of the Plan takes. */
	summary?: ReactNode;
	/** The header's actions, e.g. adding to this part. */
	actions?: ReactNode;
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
				actions={actions}
			/>
			<PlanNav month={month} page={page} />
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
