import { addMonths, type MonthKey } from "@noodle/domain";
import { Button } from "@noodle/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@noodle/ui/components/dropdown-menu";
import { LinkTab, LinkTabs } from "@noodle/ui/components/tabs";
import { WithTooltip } from "@noodle/ui/components/tooltip";
import { Link, useNavigate } from "@tanstack/react-router";
import {
	ChartColumn,
	ChevronLeft,
	ChevronRight,
	CircleHelp,
	CreditCard,
	Ellipsis,
	Lightbulb,
	MessageCircleQuestionMark,
} from "lucide-react";
import { type TouchEvent, useRef } from "react";
import { monthName } from "../format";
import { openGlossary } from "./glossary";

/** The two views of a month: what's happening in it, and its Plan. */
type MonthView = "/month/$month" | PlanView;

/** A page of a month's Plan: the overview, or one of its parts. */
export type PlanView =
	| "/plan/$month"
	| "/plan/$month/income"
	| "/plan/$month/commitments"
	| "/plan/$month/buckets"
	| "/plan/$month/goals"
	| "/plan/$month/year";

/**
 * On phones, the row above a month's page header: a switch between the month and its Plan (the
 * tab bar has no Plan tab), then one More menu with Reports, Insights, Credit card perks, Ask and the Glossary (#74: three
 * look-alike icons were one too many; #80: Insights and Perks were otherwise out of reach on a
 * phone). On a computer the Sidebar has all of them, so the row
 * isn't there (#73).
 */
export function MonthTopRow({ month, current }: { month: MonthKey; current: "month" | "plan" }) {
	return (
		<div className="mb-3 flex max-w-2xl items-center justify-between gap-3 lg:hidden">
			<MonthPlanSwitch month={month} current={current} />
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button variant="ghost" size="icon" aria-label="More">
						<Ellipsis className="size-5" />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent>
					<DropdownMenuItem asChild>
						<Link to="/reports">
							<ChartColumn />
							Reports
						</Link>
					</DropdownMenuItem>
					<DropdownMenuItem asChild>
						<Link to="/insights">
							<Lightbulb />
							Insights
						</Link>
					</DropdownMenuItem>
					<DropdownMenuItem asChild>
						<Link to="/insights/perks">
							<CreditCard />
							Credit card perks
						</Link>
					</DropdownMenuItem>
					<DropdownMenuItem asChild>
						<Link to="/ask">
							<MessageCircleQuestionMark />
							Ask
						</Link>
					</DropdownMenuItem>
					<DropdownMenuItem onSelect={() => openGlossary()}>
						<CircleHelp />
						Glossary…
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	);
}

/** A quiet segmented control between a month and its Plan. */
export function MonthPlanSwitch({
	month,
	current,
}: {
	month: MonthKey;
	current: "month" | "plan";
}) {
	const options = [
		{ key: "month", label: "Month", to: "/month/$month" },
		{ key: "plan", label: "Plan", to: "/plan/$month" },
	] as const;
	return (
		<LinkTabs aria-label="Month and Plan">
			{options.map((option) => (
				<LinkTab key={option.key} asChild className="min-w-16">
					<Link
						activeOptions={{ exact: true }}
						to={option.to}
						params={{ month }}
						aria-current={option.key === current ? "page" : undefined}
					>
						{option.label}
					</Link>
				</LinkTab>
			))}
		</LinkTabs>
	);
}

/**
 * A chevron to an adjacent month of the same view; its data preloads on hover or touch (the
 * router's default). Later months are open for planning ahead. Disabled where there's no month
 * to go to (before the first month with a Plan).
 */
export function MonthLink({
	to,
	month,
	label,
	disabled = false,
}: {
	to: MonthView;
	month: MonthKey;
	label: "Previous month" | "Next month";
	disabled?: boolean;
}) {
	const icon =
		label === "Next month" ? (
			<ChevronRight className="size-5" />
		) : (
			<ChevronLeft className="size-5" />
		);
	if (disabled) {
		return (
			<Button variant="ghost" size="icon" disabled aria-label={label}>
				{icon}
			</Button>
		);
	}
	// On larger screens the chevron says which month it goes to: "‹ Aug", "Oct ›".
	const short = (
		<span className="hidden text-sm lg:inline">
			{new Date(`${month}-01T12:00:00`).toLocaleString("en-US", { month: "short" })}
		</span>
	);
	return (
		<WithTooltip label={monthName(month)}>
			<Button variant="ghost" size="icon" className="lg:w-auto lg:gap-1 lg:px-2" asChild>
				<Link to={to} params={{ month }} aria-label={`${label}, ${monthName(month)}`}>
					{label === "Next month" ? short : null}
					{icon}
					{label === "Next month" ? null : short}
				</Link>
			</Button>
		</WithTooltip>
	);
}

/** Both chevrons, previous (none before `first`, the first month with a Plan) then next. */
export function MonthLinks({
	to,
	month,
	first,
}: {
	to: MonthView;
	month: MonthKey;
	first: MonthKey;
}) {
	return (
		<div className="flex items-center gap-1">
			<MonthLink
				to={to}
				month={addMonths(month, -1)}
				label="Previous month"
				disabled={month <= first}
			/>
			<MonthLink to={to} month={addMonths(month, 1)} label="Next month" />
		</div>
	);
}

/** A mostly sideways swipe this far moves to the adjacent month. */
const SWIPE_DISTANCE = 64;

/**
 * Touch handlers for swiping between months of the same view on phones: left for the next, right
 * for the previous.
 */
export function useMonthSwipe(to: MonthView, month: MonthKey, first: MonthKey) {
	const navigate = useNavigate();
	const start = useRef<{ x: number; y: number } | null>(null);
	return {
		onTouchStart: (event: TouchEvent) => {
			const touch = event.touches[0];
			// Leave form fields, sheets' own gestures and anything that scrolls sideways alone.
			const inField = (event.target as Element).closest(
				"input, textarea, [role=dialog], [data-slot=link-tabs], [data-slot=table-container]",
			);
			start.current =
				touch && event.touches.length === 1 && !inField
					? { x: touch.clientX, y: touch.clientY }
					: null;
		},
		onTouchEnd: (event: TouchEvent) => {
			const touch = event.changedTouches[0];
			const from = start.current;
			start.current = null;
			if (!touch || !from) return;
			const dx = touch.clientX - from.x;
			const dy = touch.clientY - from.y;
			if (Math.abs(dx) < SWIPE_DISTANCE || Math.abs(dx) < Math.abs(dy) * 2) return;
			if (dx > 0 && month <= first) return;
			navigate({ to, params: { month: addMonths(month, dx < 0 ? 1 : -1) } });
		},
	};
}

/** "October", or "October 2027" outside the current year. */
export function monthTitle(month: MonthKey, current: MonthKey): string {
	return month.slice(0, 4) === current.slice(0, 4)
		? monthName(month)
		: `${monthName(month)} ${month.slice(0, 4)}`;
}
