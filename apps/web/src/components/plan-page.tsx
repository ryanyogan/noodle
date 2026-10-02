import type { PlanPart } from "@noodle/domain";
import { Card } from "@noodle/ui/components/card";
import { MasterDetail, SplitLayout, SplitMain, SplitRail } from "@noodle/ui/components/layout";
import { cn } from "@noodle/ui/lib/utils";
import { Outlet, useParams } from "@tanstack/react-router";
import { type ReactNode, Suspense } from "react";
import { DetailPending, masterDetailKeys, selectedRow } from "./master-detail";

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
		// At lg the list takes the left; the total, the add form and the explainer sit in the rail.
		// On phones the rail's parts fall in line: the total first, the rest last.
		<SplitLayout stack="children" className="max-w-2xl lg:max-w-none">
			<SplitMain>
				<div className="grid min-w-0 gap-8">{children}</div>
			</SplitMain>
			<SplitRail>
				{summary || !editable ? (
					<div className="grid gap-3 max-lg:order-first">
						{editable ? null : <PlanEnded />}
						{summary ? (
							<p className="px-1 text-sm text-muted-foreground tabular-nums">{summary}</p>
						) : null}
					</div>
				) : null}
				{aside ? <div className="grid gap-4">{aside}</div> : null}
			</SplitRail>
		</SplitLayout>
	);
}

/**
 * A part of a month's Plan whose items have pages of their own (Buckets, Commitments): the list
 * on the left and, from lg, the picked item beside it (its route is this one's child). With
 * nothing picked, the right pane holds what the page's rail held (the add form, the explainer), so
 * those stay one step away: Back, or the tab, returns to them. On phones the list is the page,
 * with the rail's parts after it, and an item is a page with Back.
 */
export function PlanMasterDetail({
	editable,
	summary,
	aside,
	noun,
	listLabel,
	children,
}: {
	editable: boolean;
	/** A line above the list, e.g. what this part of the Plan takes. */
	summary?: ReactNode;
	/** The right pane while nothing is picked; on phones it follows the list. */
	aside?: ReactNode;
	/** What an item is called, e.g. "Bucket". */
	noun: string;
	/** Names the list pane, e.g. "Buckets". */
	listLabel: string;
	children: ReactNode;
}) {
	const picked = useParams({ strict: false, select: (params) => params.id });
	return (
		<MasterDetail
			className="max-w-2xl lg:max-w-none"
			listLabel={listLabel}
			detailLabel={picked ? `${noun} details` : `${listLabel}: add and about`}
			emptyStacks
			onKeyDown={masterDetailKeys}
			list={
				<div className={cn("grid min-w-0 content-start gap-8", selectedRow)}>
					{summary || !editable ? (
						<div className="grid gap-3">
							{editable ? null : <PlanEnded />}
							{summary ? (
								<p className="px-1 text-sm text-muted-foreground tabular-nums">{summary}</p>
							) : null}
						</div>
					) : null}
					{children}
				</div>
			}
			detail={
				picked ? (
					<div className="@container">
						<Suspense fallback={<DetailPending />}>
							<Outlet />
						</Suspense>
					</div>
				) : undefined
			}
			empty={
				<div className="grid w-full content-start gap-4 lg:max-w-md">
					{aside}
					<p className="px-1 text-sm text-muted-foreground max-lg:hidden">
						Pick a {noun} to see it here.
					</p>
				</div>
			}
		/>
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
