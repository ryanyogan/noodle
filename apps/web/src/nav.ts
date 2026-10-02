import type { LinkProps } from "@tanstack/react-router";
import {
	BookOpen,
	CalendarCheck,
	CalendarDays,
	ChartColumn,
	Landmark,
	Lightbulb,
	List,
	type LucideIcon,
	MessageCircleQuestionMark,
	SlidersHorizontal,
	Target,
	Telescope,
	UsersRound,
} from "lucide-react";

// The app's navigation, once: the desktop sidebar renders every group, and the phone tab bar
// renders the items with a `tab`. Which item is current comes from the router matching `to` and
// `within` (app-shell's useIsCurrent), never from comparing path strings.

type To = NonNullable<LinkProps["to"]>;

export type NavItem = {
	label: string;
	icon: LucideIcon;
	/** Where it goes. Current on this route and every page under it. */
	to?: To;
	/** Opens over the page instead of going somewhere. */
	action?: "glossary";
	/** Routes that belong to this destination though they aren't under `to`: current there too. */
	within?: To[];
	/** What to show beside it: how many Transactions wait in Review, or a Check-in not yet done. */
	badge?: "review" | "check-in";
	/**
	 * In the phone tab bar, which has room for four. `within` adds the destinations that are
	 * reached through this one on a phone, so its tab is current there.
	 */
	tab?: { label: string; within?: To[] };
};

export type NavGroup = { label: string; items: NavItem[] };

export const navGroups: NavGroup[] = [
	{
		label: "Day to day",
		items: [
			{
				label: "This Month",
				icon: CalendarDays,
				to: "/month",
				// On a phone the Plan is reached from This Month (its Month and Plan switch).
				tab: { label: "Month", within: ["/plan"] },
			},
			{
				label: "Transactions",
				icon: List,
				to: "/transactions",
				within: ["/review"],
				badge: "review",
				tab: { label: "Transactions", within: ["/accounts"] },
			},
			{ label: "Accounts", icon: Landmark, to: "/accounts" },
		],
	},
	{
		label: "Planning",
		items: [
			{ label: "Plan", icon: SlidersHorizontal, to: "/plan" },
			// On a phone Explore is reached from Goals, which it plans ahead.
			{ label: "Goals", icon: Target, to: "/goals", tab: { label: "Goals", within: ["/explore"] } },
			{ label: "Explore", icon: Telescope, to: "/explore" },
		],
	},
	{
		label: "Understand",
		items: [
			{ label: "Reports", icon: ChartColumn, to: "/reports" },
			{ label: "Insights", icon: Lightbulb, to: "/insights", within: ["/perks"] },
			{ label: "Ask", icon: MessageCircleQuestionMark, to: "/ask" },
		],
	},
	{
		label: "Household",
		items: [
			// Weekly. On a phone it's reached from This Month's card on the day, its Nudge and email,
			// and Household.
			{ label: "Check-in", icon: CalendarCheck, to: "/check-in", badge: "check-in" },
			{ label: "Household", icon: UsersRound, to: "/household", tab: { label: "Household" } },
			// Not a destination: it opens over the page. On a phone it's the help icon in the row above
			// This Month's header, and every term's help popover.
			{ label: "Glossary", icon: BookOpen, action: "glossary" },
		],
	},
];

/** The phone tab bar's destinations, in the sidebar's order. */
export const tabItems = navGroups
	.flatMap((group) => group.items)
	.filter((item): item is NavItem & { tab: NonNullable<NavItem["tab"]> } => item.tab !== undefined);

declare module "@tanstack/react-router" {
	interface StaticDataRouteOption {
		/** A data-dense section: the page gets the wider cap, so a 1920 screen isn't mostly empty. */
		wide?: boolean;
	}
}
