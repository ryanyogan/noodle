import type { PlanPart } from "@noodle/domain";
import { Button } from "@noodle/ui/components/button";
import { Card } from "@noodle/ui/components/card";
import { ListWithPanel } from "@noodle/ui/components/detail-panel";
import { MasterDetail, SplitLayout, SplitMain, SplitRail } from "@noodle/ui/components/layout";
import type { DetailPanelSize } from "@noodle/ui/lib/detail-panel";
import { cn } from "@noodle/ui/lib/utils";
import { Link, type LinkOptions, Outlet, useNavigate, useParams } from "@tanstack/react-router";
import { X } from "lucide-react";
import { type ReactNode, Suspense } from "react";
import { monthName } from "../format";
import { DetailPending, masterDetailKeys, panelKeys, selectedRow } from "./master-detail";

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
 * The top of a pane beside another: a small line over a figure. It has the type and the space of
 * an item's `DetailHeader`, so the list's first card and the picked item's first card start on the
 * same line (#73). On phones it is one quiet line above the list.
 */
export function PaneHeader({ eyebrow, title }: { eyebrow: ReactNode; title: ReactNode }) {
	return (
		<div data-slot="pane-header" className="min-w-0 max-lg:mb-3 lg:mb-6">
			<p className="text-[13px] font-medium text-muted-foreground max-lg:hidden">{eyebrow}</p>
			<p className="tabular-nums max-lg:px-1 max-lg:text-sm max-lg:text-muted-foreground lg:text-2xl lg:font-semibold lg:tracking-[-0.02em]">
				{title}
			</p>
		</div>
	);
}

/** A card of totals for the rail: each line a label and its figure, the figures in one column. */
export function TotalsCard({
	label,
	lines,
	children,
}: {
	/** Names the card for a screen reader, e.g. "Buckets this month". */
	label: string;
	lines: { label: ReactNode; value: ReactNode; tone?: "over" | "strong" }[];
	/** Above the lines: a bar, say. */
	children?: ReactNode;
}) {
	return (
		<Card role="group" aria-label={label} className="grid gap-4 p-(--card-pad)">
			{children}
			<dl className="grid gap-2.5 text-sm">
				{lines.map((line, index) => (
					<div
						// biome-ignore lint/suspicious/noArrayIndexKey: the lines are fixed and never reorder.
						key={index}
						className={cn(
							"flex items-baseline justify-between gap-4",
							line.tone === "strong" && "border-t pt-2.5 font-medium",
						)}
					>
						<dt className={line.tone === "strong" ? undefined : "text-muted-foreground"}>
							{line.label}
						</dt>
						<dd
							className={cn(
								"font-medium tabular-nums",
								line.tone === "over" && "text-over-foreground",
							)}
						>
							{line.value}
						</dd>
					</div>
				))}
			</dl>
		</Card>
	);
}

/**
 * A part of a month's Plan whose items have pages of their own (Buckets, Commitments): the list
 * on the left and, from lg, the picked item beside it (its route is this one's child). With
 * nothing picked the list takes the wide column, each row with its figures in columns, and the
 * rail holds the part's totals (`overview`), then the add form and the explainer (`aside`). On
 * phones the list is the page, with the rail's parts after it, and an item is a page with Back.
 */
export function PlanMasterDetail({
	editable,
	summary,
	overviewHeader,
	overview,
	aside,
	noun,
	listLabel,
	panel,
	children,
}: {
	editable: boolean;
	/** The figure above the list, e.g. what this part of the Plan takes. */
	summary?: ReactNode;
	/** The figure above the rail while nothing is picked, e.g. what's been spent. */
	overviewHeader?: { eyebrow: ReactNode; title: ReactNode };
	/** The part's totals, first in the rail while nothing is picked. */
	overview?: ReactNode;
	/** After the totals while nothing is picked; on phones it follows the list. */
	aside?: ReactNode;
	/** What an item is called, e.g. "Bucket". */
	noun: string;
	/** Names the list pane, e.g. "Buckets". */
	listLabel: string;
	/**
	 * From lg the picked item opens in a panel from the window's right edge, over the page, and the
	 * list keeps its width and columns (issue 107, ADR-0047). `close` is the list's own address. Without it, the
	 * item sits beside a narrowed list, as before.
	 */
	panel?: {
		size?: DetailPanelSize;
		close: LinkOptions;
		/**
		 * The list is a table that needs the page's width: the rail is under it up to 1440 and beside
		 * it from there, and a picked item is a drawer until then.
		 */
		besideFrom?: "xl" | "late";
	};
	children: ReactNode;
}) {
	const { id: picked, month } = useParams({
		strict: false,
		select: (params) => ({ id: params.id, month: params.month }),
	});
	const navigate = useNavigate();
	const list = (
		// A container, so a row can tell the narrow list pane beside an item from a list with the
		// page's width, and show its figures in columns only where they fit.
		<div className={cn("@container min-w-0", selectedRow)}>
			{summary ? (
				<PaneHeader eyebrow={month ? `${monthName(month)}’s Plan` : "The Plan"} title={summary} />
			) : null}
			<div className="grid min-w-0 content-start gap-8">
				{editable ? null : <PlanEnded />}
				{children}
			</div>
		</div>
	);
	const detail = picked ? (
		<div className="@container">
			<Suspense fallback={<DetailPending />}>
				<Outlet />
			</Suspense>
		</div>
	) : undefined;
	const rail = (
		// Under a list that keeps the page's width, the rail is no wider than it is beside one.
		<div
			className={cn(
				"w-full min-w-0",
				panel?.besideFrom === "late" && "lg:max-[90rem]:max-w-(--rail-width)",
			)}
		>
			{overview && overviewHeader ? <PaneHeader {...overviewHeader} /> : null}
			<div className="grid content-start gap-4">
				{overview}
				{aside}
			</div>
		</div>
	);
	const railLabel = `${listLabel}: totals, add and about`;
	// The picked item opens in a panel from the right (issue 107, ADR-0047): the list and the rail
	// stay exactly as they are with nothing picked, under it.
	if (panel)
		return (
			<ListWithPanel
				className="max-w-2xl lg:max-w-none"
				size={panel.size}
				besideFrom={panel.besideFrom}
				listLabel={listLabel}
				asideLabel={railLabel}
				detailLabel={`${noun} details`}
				itemKey={picked}
				onKeyDown={panelKeys}
				onClose={() => navigate({ ...panel.close, resetScroll: false })}
				close={
					// A link, so it works before the page has hydrated.
					<Button variant="ghost" size="icon" asChild className="bg-background">
						<Link {...panel.close} resetScroll={false} aria-label={`Close ${noun}`}>
							<X />
						</Link>
					</Button>
				}
				list={list}
				aside={rail}
				detail={detail}
			/>
		);
	return (
		<MasterDetail
			className="max-w-2xl lg:max-w-none"
			// Beside an item the list needs only a name and an amount: it gives the item the room for
			// two columns at 1440.
			narrowList
			// Nothing picked: the list takes the wide column and the totals and add form the rail's
			// width, rather than a narrow list beside an empty pane (#73).
			data-list-fills={picked ? undefined : "true"}
			listLabel={listLabel}
			detailLabel={picked ? `${noun} details` : railLabel}
			emptyStacks
			onKeyDown={masterDetailKeys}
			list={list}
			detail={detail}
			empty={rail}
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
