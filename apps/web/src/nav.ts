import type { LinkProps } from "@tanstack/react-router";
import {
	BookOpen,
	CalendarCheck,
	CalendarDays,
	ChartColumn,
	CreditCard,
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

// The app's navigation, once: the desktop sidebar renders every group (less the items a phone
// alone lists: Ask is the shell's small button on a computer, and the Glossary is linked from Ask,
// issue 100), the phone tab bar renders
// the items with a `tab`, and its last item, More, opens a sheet with all the others (#74). Which item is current comes from the router matching `to` and
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
	/** Routes under `to` that are a destination of their own: not current there. */
	except?: To[];
	/** What to show beside it: how many Transactions wait in Review, or a Check-in not yet done. */
	badge?: "review" | "check-in";
	/**
	 * In the phone tab bar, under this short label. The bar has room for three and More: every
	 * item without a `tab` is in the More sheet (#74).
	 */
	tab?: { label: string };
	/** Only in the phone's More sheet: the Sidebar leaves it out (issue 100). */
	phoneOnly?: true;
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
				tab: { label: "Month" },
			},
			{
				label: "Transactions",
				icon: List,
				to: "/transactions",
				within: ["/review"],
				badge: "review",
				tab: { label: "Transactions" },
			},
			{ label: "Accounts", icon: Landmark, to: "/accounts" },
		],
	},
	{
		label: "Planning",
		items: [
			{ label: "Plan", icon: SlidersHorizontal, to: "/plan" },
			{ label: "Goals", icon: Target, to: "/goals", tab: { label: "Goals" } },
			{ label: "Explore", icon: Telescope, to: "/explore" },
		],
	},
	{
		label: "Understand",
		items: [
			{ label: "Reports", icon: ChartColumn, to: "/reports" },
			{ label: "Insights", icon: Lightbulb, to: "/insights", except: ["/insights/perks"] },
			// Perks are a tab of Insights, but Parents look for them by name (#80): their own entry.
			{ label: "Credit card perks", icon: CreditCard, to: "/insights/perks" },
			// On a computer Ask is the small button in the corner of every page (app-shell's AskButton).
			{ label: "Ask", icon: MessageCircleQuestionMark, to: "/ask", phoneOnly: true },
		],
	},
	{
		label: "Household",
		items: [
			// Weekly. On a phone it's in More, and on This Month's card on the day, its Nudge and email.
			{ label: "Check-in", icon: CalendarCheck, to: "/check-in", badge: "check-in" },
			{ label: "Household settings", icon: UsersRound, to: "/household" },
			// Not a destination: it opens over the page. On a phone it's in More; on a computer Ask
			// links to it; and every term's help popover does.
			{ label: "Glossary", icon: BookOpen, action: "glossary", phoneOnly: true },
		],
	},
];

/** The phone tab bar's destinations, in the sidebar's order. More follows them. */
export const tabItems = navGroups
	.flatMap((group) => group.items)
	.filter((item): item is NavItem & { tab: NonNullable<NavItem["tab"]> } => item.tab !== undefined);

declare module "@tanstack/react-router" {
	interface StaticDataRouteOption {
		/** A data-dense section: the page gets the wider cap, so a 1920 screen isn't mostly empty. */
		wide?: boolean;
	}
}

/** What the desktop Sidebar lists: every group, without the items only a phone lists (issue 100). */
export const sidebarGroups: NavGroup[] = navGroups
	.map((group) => ({ ...group, items: group.items.filter((item) => !item.phoneOnly) }))
	.filter((group) => group.items.length > 0);

/** What the phone's More sheet lists: every destination that isn't a tab, in the sidebar's groups. */
export const moreGroups: NavGroup[] = navGroups
	.map((group) => ({ ...group, items: group.items.filter((item) => item.tab === undefined) }))
	.filter((group) => group.items.length > 0);
