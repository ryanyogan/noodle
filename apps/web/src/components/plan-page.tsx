import type { MonthKey, PlanPart } from "@noodle/domain";
import { Button } from "@noodle/ui/components/button";
import { Card } from "@noodle/ui/components/card";
import { PageHeader } from "@noodle/ui/components/page-header";
import { LinkTab, LinkTabs } from "@noodle/ui/components/tabs";
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
	const current = (key: PlanPage) => (key === page ? ("page" as const) : undefined);
	const year = month.slice(0, 4);
	return (
		<LinkTabs aria-label="Plan pages" className="mb-6">
			<LinkTab asChild>
				<Link
					activeOptions={{ exact: true }}
					to="/plan/$month"
					params={{ month }}
					aria-current={current("overview")}
				>
					Overview
				</Link>
			</LinkTab>
			<LinkTab asChild>
				<Link
					activeOptions={{ exact: true }}
					to="/plan/$month/income"
					params={{ month }}
					aria-current={current("income")}
				>
					Income
				</Link>
			</LinkTab>
			<LinkTab asChild>
				<Link
					activeOptions={{ exact: true }}
					to="/plan/$month/commitments"
					params={{ month }}
					aria-current={current("commitments")}
				>
					Commitments
				</Link>
			</LinkTab>
			<LinkTab asChild>
				<Link
					activeOptions={{ exact: true }}
					to="/plan/$month/buckets"
					params={{ month }}
					aria-current={current("buckets")}
				>
					Buckets
				</Link>
			</LinkTab>
			<LinkTab asChild>
				<Link
					activeOptions={{ exact: true }}
					to="/plan/$month/goals"
					params={{ month }}
					aria-current={current("goals")}
				>
					Goal funding
				</Link>
			</LinkTab>
			<LinkTab asChild>
				<Link
					activeOptions={{ exact: true }}
					to="/plan/year/$year"
					params={{ year }}
					aria-current={current("year")}
				>
					Year
				</Link>
			</LinkTab>
		</LinkTabs>
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
	aside,
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
	/** The right column at lg (the add form, the page's explainer); on phones it follows the list. */
	aside?: ReactNode;
	children: ReactNode;
}) {
	return (
		<>
			<PageHeader
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
