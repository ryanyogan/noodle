import { UserButton } from "@clerk/tanstack-react-start";
import { monthKeyAt } from "@noodle/domain";
import { Button } from "@noodle/ui/components/button";
import { Kbd } from "@noodle/ui/components/kbd";
import { Logo } from "@noodle/ui/components/logo";
import { cn } from "@noodle/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { Link, type LinkProps, useRouteContext, useRouterState } from "@tanstack/react-router";
import {
	CalendarCheck,
	CalendarDays,
	ChartColumn,
	Landmark,
	List,
	type LucideIcon,
	MessageCircleQuestionMark,
	Plus,
	SlidersHorizontal,
	Target,
	Telescope,
	UsersRound,
} from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { checkInStatusQuery } from "../queries";
import { GlossaryButton } from "./glossary";
import { markQuickAddOpened, quickAddSearch } from "./quick-add";

type NavItem = {
	to: LinkProps["to"];
	label: string;
	short: string;
	icon: LucideIcon;
	/** Left out of the phone tab bar, where it's reached from another destination instead. */
	desktopOnly?: boolean;
	/** Other paths this destination shows as current on in the tab bar. */
	alsoFor?: string[];
	/** Paths inside this destination, though not under its own: current there everywhere. */
	within?: string[];
};

/** Whether `item` is current at `pathname` through one of the paths `within` it. */
const currentWithin = (item: NavItem, pathname: string) =>
	item.within?.some((path) => pathname.startsWith(path)) ?? false;

// Every top-level destination, in order. The sidebar (desktop) and tab bar (phone) both render it,
// though the tab bar has room for four: the Plan is reached from This Month there (its Month and
// Plan switch), Accounts from Transactions and Household, Explore from Goals, which it plans
// ahead, and Reports and Ask from the row above This Month's header. The Glossary isn't a
// destination: it opens over the page from a help icon (the sidebar's footer, or that row above
// This Month's header on a phone) and from every term's help popover.
const nav: NavItem[] = [
	{ to: "/month", label: "This Month", short: "Month", icon: CalendarDays, alsoFor: ["/plan"] },
	{ to: "/plan", label: "Plan", short: "Plan", icon: SlidersHorizontal, desktopOnly: true },
	{
		to: "/transactions",
		label: "Transactions",
		short: "Transactions",
		icon: List,
		within: ["/review"],
		alsoFor: ["/accounts"],
	},
	{ to: "/accounts", label: "Accounts", short: "Accounts", icon: Landmark, desktopOnly: true },
	{ to: "/goals", label: "Goals", short: "Goals", icon: Target, alsoFor: ["/explore"] },
	{ to: "/explore", label: "Explore", short: "Explore", icon: Telescope, desktopOnly: true },
	{ to: "/reports", label: "Reports", short: "Reports", icon: ChartColumn, desktopOnly: true },
	{ to: "/ask", label: "Ask", short: "Ask", icon: MessageCircleQuestionMark, desktopOnly: true },
	// Weekly, so in the sidebar; on a phone it's reached from This Month's card on the day, its
	// Nudge and email, and Household.
	{
		to: "/check-in",
		label: "Check-in",
		short: "Check-in",
		icon: CalendarCheck,
		desktopOnly: true,
	},
	{ to: "/household", label: "Household", short: "Household", icon: UsersRound },
];

/**
 * Whether a destination is the current page. This Month is only this month's page: an earlier
 * month's isn't "this month", so nothing in the sidebar is current there.
 */
function useIsCurrent() {
	const pathname = useRouterState({ select: (state) => state.location.pathname });
	const { household } = useRouteContext({ from: "/_authed/_household" });
	const thisMonth = monthKeyAt(new Date(), household.timeZone);
	return (item: NavItem) =>
		item.to === "/month"
			? pathname === "/month" || pathname.startsWith(`/month/${thisMonth}`)
			: pathname.startsWith(item.to as string) || currentWithin(item, pathname);
}

/** A dot beside Check-in while this Parent hasn't done this week's. */
function CheckInBadge() {
	const status = useQuery(checkInStatusQuery()).data;
	if (!status || status.done) return null;
	return (
		<span className="ms-auto flex items-center">
			<span aria-hidden="true" className="size-2 rounded-full bg-brand" />
			<span className="sr-only">not done this week</span>
		</span>
	);
}

/** The authenticated app frame: a sidebar on desktop, a bottom tab bar on phones. */
export function AppShell({
	householdName,
	children,
}: {
	householdName: string;
	children: ReactNode;
}) {
	return (
		<div className="min-h-dvh lg:grid lg:grid-cols-[var(--sidebar-width)_minmax(0,1fr)]">
			<Sidebar householdName={householdName} />
			<main
				id="main"
				// Focus lands here when a sheet closes and the control that opened it is gone.
				tabIndex={-1}
				className={cn(
					"mx-auto w-full max-w-[1200px] px-(--gutter) outline-none",
					"pt-[calc(env(safe-area-inset-top)+16px)] pb-[calc(var(--tabbar-height)+env(safe-area-inset-bottom)+32px)]",
					"lg:pt-6 lg:pb-12",
				)}
			>
				{children}
			</main>
			<TabBar />
		</div>
	);
}

function Sidebar({ householdName }: { householdName: string }) {
	const isCurrent = useIsCurrent();
	return (
		<aside className="sticky top-0 hidden h-dvh flex-col gap-6 border-e bg-card/55 px-3 py-5 lg:flex">
			<Link to="/month" className="rounded-lg px-3 py-1" aria-label="Noodle, This Month">
				<Logo />
			</Link>
			<Button asChild className="mx-1">
				<QuickAddLink>
					<Plus />
					Quick Add
					<span aria-hidden="true" className="ms-auto">
						<Kbd className="border-current/40 bg-transparent text-current opacity-70">Q</Kbd>
					</span>
				</QuickAddLink>
			</Button>
			<nav aria-label="Main" className="grid gap-0.5">
				{nav.map((item) => (
					<Link
						key={item.label}
						to={item.to}
						// Current is worked out here (useIsCurrent), not by the router's fuzzy match.
						activeOptions={{ exact: true }}
						aria-current={isCurrent(item) ? "page" : undefined}
						className={cn(
							"flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-sm font-medium text-muted-foreground",
							"transition-colors duration-(--duration-fast) ease-standard hover:bg-surface-2 hover:text-foreground",
							isCurrent(item) && "bg-card text-foreground shadow-card ring-1 ring-border",
						)}
					>
						<item.icon className="size-4.5" strokeWidth={1.75} aria-hidden="true" />
						{item.label}
						{item.to === "/check-in" ? <CheckInBadge /> : null}
					</Link>
				))}
			</nav>
			<div className="mt-auto flex items-center gap-2.5 rounded-xl p-2.5 pe-0">
				<UserButton />
				<div className="grid min-w-0 flex-1 text-[13px] leading-tight">
					<span className="line-clamp-2 font-medium wrap-break-word" title={householdName}>
						{householdName}
					</span>
					<span className="text-xs text-subtle-foreground">Household</span>
				</div>
				<GlossaryButton className="shrink-0" />
			</div>
		</aside>
	);
}

/** Opens Quick Add over the current page (a history entry, so Back closes it). */
export function QuickAddLink(props: Omit<ComponentProps<"a">, "href">) {
	return (
		<Link
			to="."
			search={(prev) => ({ ...prev, ...quickAddSearch })}
			aria-keyshortcuts="Q"
			{...props}
			onClick={(event) => {
				props.onClick?.(event);
				// A modified click opens a new tab; this one stays where it is.
				if (!(event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)) {
					markQuickAddOpened();
				}
			}}
		/>
	);
}

function TabBar() {
	// Quick Add sits in the middle of the bar, in easy reach of either thumb, with the
	// destinations split either side of it.
	const tabs = nav.filter((item) => !item.desktopOnly);
	const half = Math.ceil(tabs.length / 2);
	return (
		<nav
			aria-label="Main"
			className={cn(
				"fixed inset-x-0 bottom-0 z-20 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] border-t lg:hidden",
				"bg-card/80 backdrop-blur-xl backdrop-saturate-150",
				"px-2 pt-1.5 pb-[calc(env(safe-area-inset-bottom)+6px)]",
			)}
		>
			<TabGroup items={tabs.slice(0, half)} />
			<QuickAddLink
				className={cn(
					"mx-2 grid h-10 w-12 place-items-center self-center rounded-[14px] bg-primary text-primary-foreground",
					"transition-transform duration-(--duration-fast) ease-standard active:scale-[0.94]",
				)}
			>
				<Plus className="size-5.5" strokeWidth={2.2} aria-hidden="true" />
				<span className="sr-only">Quick Add</span>
			</QuickAddLink>
			<TabGroup items={tabs.slice(half)} />
		</nav>
	);
}

function TabGroup({ items }: { items: NavItem[] }) {
	const pathname = useRouterState({ select: (state) => state.location.pathname });
	const isCurrent = useIsCurrent();
	return (
		<div className="grid auto-cols-fr grid-flow-col">
			{items.map((item) => (
				<Link
					key={item.label}
					to={item.to}
					activeOptions={{ exact: true }}
					aria-current={isCurrent(item) ? "page" : undefined}
					className={cn(
						"grid h-(--tabbar-height) min-w-0 place-content-center justify-items-center gap-1 rounded-lg text-[11px] font-medium text-subtle-foreground",
						"transition-colors duration-(--duration-fast) ease-standard",
						(isCurrent(item) || item.alsoFor?.some((path) => pathname.startsWith(path))) &&
							"text-foreground",
					)}
				>
					<item.icon className="size-5.5" strokeWidth={1.75} aria-hidden="true" />
					{item.short}
				</Link>
			))}
		</div>
	);
}
