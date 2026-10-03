import { useClerk, useUser } from "@clerk/tanstack-react-start";
import { Avatar, AvatarFallback, AvatarImage } from "@noodle/ui/components/avatar";
import { Button } from "@noodle/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@noodle/ui/components/dropdown-menu";
import { Kbd } from "@noodle/ui/components/kbd";
import { Logo } from "@noodle/ui/components/logo";
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarGroup,
	SidebarGroupLabel,
	SidebarHeader,
	SidebarMenu,
	SidebarMenuBadge,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarProvider,
	SidebarSeparator,
	SidebarTrigger,
	useSidebar,
} from "@noodle/ui/components/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@noodle/ui/components/tooltip";
import { useHydrated } from "@noodle/ui/lib/hydrated";
import { cn } from "@noodle/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { Link, useMatches, useMatchRoute, useRouteContext } from "@tanstack/react-router";
import { ChevronsUpDown, LogOut, Plus, Settings, UserRound } from "lucide-react";
import { type ComponentProps, type ReactNode, useId } from "react";
import { type NavGroup, type NavItem, navGroups, tabItems } from "../nav";
import { checkInStatusQuery, membersQuery, reviewQuery } from "../queries";
import { openGlossary } from "./glossary";
import { markQuickAddOpened, quickAddSearch } from "./quick-add";

/**
 * Whether a destination is current, by the router's own matching: on its route or any page under
 * it (This Month on every month, Plan on every Plan page), and on the routes `within` it (Review
 * within Transactions). The tab bar also counts what's reached through a tab on a phone.
 */
function useIsCurrent(where: "sidebar" | "tabs") {
	const matchRoute = useMatchRoute();
	return (item: NavItem) => {
		if (!item.to) return false;
		const routes = [item.to, ...(item.within ?? [])];
		if (where === "tabs") routes.push(...(item.tab?.within ?? []));
		return routes.some((to) => matchRoute({ to, fuzzy: true }) !== false);
	};
}

/** The authenticated app frame: a sidebar on desktop, a bottom tab bar on phones. */
export function AppShell({
	householdName,
	children,
}: {
	householdName: string;
	children: ReactNode;
}) {
	// A section says it's data-dense on its own route (`staticData: { wide: true }`).
	const wide = useMatches({ select: (matches) => matches.some((match) => match.staticData.wide) });
	return (
		<SidebarProvider>
			<div className="min-h-dvh lg:grid lg:grid-cols-[var(--sidebar-width)_minmax(0,1fr)]">
				<a
					href="#main"
					className="sr-only focus:not-sr-only focus:fixed focus:start-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-card focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:shadow-card focus:ring-2 focus:ring-ring"
				>
					Skip to content
				</a>
				<AppSidebar householdName={householdName} />
				<main
					id="main"
					// Focus lands here when a sheet closes and the control that opened it is gone.
					tabIndex={-1}
					className={cn(
						"mx-auto w-full max-w-[1200px] px-(--gutter) outline-none",
						wide && "max-w-[1440px]",
						"pt-[calc(var(--safe-top)+16px)] pb-[calc(var(--tabbar-height)+var(--safe-bottom)+32px)]",
						"lg:pt-6 lg:pb-12",
					)}
				>
					{children}
				</main>
				<TabBar />
			</div>
		</SidebarProvider>
	);
}

function AppSidebar({ householdName }: { householdName: string }) {
	const { state } = useSidebar();
	const collapsed = state === "collapsed";
	// The browser's platform is known only there, so until hydration it reads as Ctrl.
	const mac = useHydrated() && /Mac|iPhone|iPad/.test(navigator.platform);
	return (
		<Sidebar className="hidden lg:flex">
			<SidebarHeader>
				<div className="flex h-8 items-center justify-between rail:justify-center">
					<Link
						to="/month"
						className="rounded-lg px-2.5 py-1 rail:hidden"
						aria-label="Noodle, This Month"
					>
						<Logo />
					</Link>
					<Tooltip>
						<TooltipTrigger asChild>
							<SidebarTrigger />
						</TooltipTrigger>
						<TooltipContent side={collapsed ? "right" : "bottom"}>
							{collapsed ? "Open the sidebar" : "Collapse the sidebar"}
							<Kbd className="border-current/40 bg-transparent text-current opacity-70">
								{mac ? "⌘ B" : "Ctrl B"}
							</Kbd>
						</TooltipContent>
					</Tooltip>
				</div>
				<Tooltip>
					<TooltipTrigger asChild>
						<Button asChild className="rail:px-0">
							<QuickAddLink>
								<Plus />
								<span className="rail:sr-only">Quick Add</span>
								<span aria-hidden="true" className="ms-auto rail:hidden">
									<Kbd className="border-current/40 bg-transparent text-current opacity-70">Q</Kbd>
								</span>
							</QuickAddLink>
						</Button>
					</TooltipTrigger>
					<TooltipContent side="right" hidden={!collapsed}>
						Quick Add
					</TooltipContent>
				</Tooltip>
			</SidebarHeader>
			<SidebarContent>
				<nav aria-label="Main" className="flex flex-col gap-4 rail:gap-3">
					{navGroups.map((group) => (
						<NavGroupSection key={group.label} group={group} />
					))}
				</nav>
			</SidebarContent>
			<SidebarFooter>
				<SidebarSeparator />
				<ParentMenu householdName={householdName} />
			</SidebarFooter>
		</Sidebar>
	);
}

function NavGroupSection({ group }: { group: NavGroup }) {
	const labelId = useId();
	const isCurrent = useIsCurrent("sidebar");
	return (
		<SidebarGroup aria-labelledby={labelId}>
			<SidebarGroupLabel id={labelId}>{group.label}</SidebarGroupLabel>
			<SidebarMenu>
				{group.items.map((item) => (
					<SidebarMenuItem key={item.label}>
						{item.to ? (
							<SidebarMenuButton asChild isActive={isCurrent(item)} tooltip={item.label}>
								<Link
									to={item.to}
									// Current comes from useIsCurrent, which also counts the routes within it.
									activeOptions={{ exact: true }}
									aria-current={isCurrent(item) ? "page" : undefined}
								>
									<item.icon strokeWidth={1.75} aria-hidden="true" />
									<span className="truncate rail:sr-only">{item.label}</span>
									{item.badge === "check-in" ? <CheckInBadge /> : null}
								</Link>
							</SidebarMenuButton>
						) : (
							<SidebarMenuButton
								tooltip={item.label}
								aria-haspopup="dialog"
								onClick={() => openGlossary()}
							>
								<item.icon strokeWidth={1.75} aria-hidden="true" />
								<span className="truncate rail:sr-only">{item.label}</span>
							</SidebarMenuButton>
						)}
						{item.badge === "review" ? <ReviewBadge /> : null}
					</SidebarMenuItem>
				))}
			</SidebarMenu>
		</SidebarGroup>
	);
}

/** A dot beside Check-in while this Parent hasn't done this week's. */
function CheckInBadge() {
	const status = useQuery(checkInStatusQuery()).data;
	if (!status || status.done) return null;
	return (
		<span className="ms-auto flex items-center rail:absolute rail:end-1.5 rail:top-1.5">
			<span aria-hidden="true" className="size-2 rounded-full bg-brand" />
			<span className="sr-only">not done this week</span>
		</span>
	);
}

/** How many Transactions wait in Review, beside Transactions: a link to Review. */
function ReviewBadge() {
	const waiting = useQuery(reviewQuery()).data?.total ?? 0;
	if (waiting === 0) return null;
	return (
		<SidebarMenuBadge className="pointer-events-auto transition-colors hover:bg-brand-soft hover:text-brand has-focus-visible:ring-2 has-focus-visible:ring-ring">
			{/* The link itself is the 24px target (axe's target-size measures it, not a ::before):
			    negative margins let it spill past the small badge without widening it. */}
			<Link
				to="/review"
				className="-mx-2 flex h-6 min-w-6 items-center justify-center rounded-full px-2 outline-none"
			>
				{waiting}
				<span className="sr-only"> to review</span>
			</Link>
		</SidebarMenuBadge>
	);
}

/** The signed-in Parent, with their Household: opens the account menu. */
function ParentMenu({ householdName }: { householdName: string }) {
	const { parentId } = useRouteContext({ from: "/_authed/_household" });
	const { isLoaded, user } = useUser();
	const clerk = useClerk();
	const members = useQuery(membersQuery()).data;
	// The Parent's name and picture arrive after the page's HTML, so they wait for hydration.
	const hydrated = useHydrated();
	const name = hydrated
		? (members?.find((member) => member.id === parentId)?.name ?? user?.fullName ?? undefined)
		: undefined;
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<SidebarMenuButton
					size="lg"
					data-parent-menu=""
					data-ready={hydrated && isLoaded ? "true" : undefined}
				>
					<Avatar>
						{hydrated && user?.imageUrl ? <AvatarImage src={user.imageUrl} alt="" /> : null}
						<AvatarFallback>{name?.trim().charAt(0).toUpperCase() ?? ""}</AvatarFallback>
					</Avatar>
					<span className="sr-only">Account menu,</span>
					<span className="grid min-w-0 flex-1 text-[13px] leading-tight rail:sr-only">
						<span className="truncate font-medium text-foreground">{name ?? " "}</span>
						<span className="truncate text-xs font-normal text-subtle-foreground">
							{householdName}
						</span>
					</span>
					<ChevronsUpDown className="size-4 rail:hidden" aria-hidden="true" />
				</SidebarMenuButton>
			</DropdownMenuTrigger>
			<DropdownMenuContent side="top" align="start" className="min-w-56">
				<DropdownMenuLabel className="truncate">{householdName}</DropdownMenuLabel>
				<DropdownMenuItem asChild>
					<Link to="/household">
						<Settings aria-hidden="true" />
						Household settings
					</Link>
				</DropdownMenuItem>
				<DropdownMenuItem onSelect={() => clerk.openUserProfile()}>
					<UserRound aria-hidden="true" />
					Manage account…
				</DropdownMenuItem>
				<DropdownMenuSeparator />
				<DropdownMenuItem onSelect={() => void clerk.signOut({ redirectUrl: "/" })}>
					<LogOut aria-hidden="true" />
					Sign out
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

/** Opens Quick Add over the current page (a history entry, so Back closes it). */
export function QuickAddLink(props: Omit<ComponentProps<"a">, "href">) {
	return (
		<Link
			to="."
			search={(prev) => ({ ...prev, ...quickAddSearch })}
			resetScroll={false}
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
	const half = Math.ceil(tabItems.length / 2);
	return (
		<nav
			aria-label="Main"
			className={cn(
				"fixed inset-x-0 bottom-0 z-20 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] border-t lg:hidden",
				"bg-card/80 backdrop-blur-xl backdrop-saturate-150",
				"px-2 pt-1.5 pb-[calc(var(--safe-bottom)+6px)]",
			)}
		>
			<TabGroup items={tabItems.slice(0, half)} />
			<QuickAddLink
				className={cn(
					"mx-2 grid h-11 w-12 place-items-center self-center rounded-[14px] bg-primary text-primary-foreground",
					"transition-transform duration-(--duration-fast) ease-standard active:scale-[0.94]",
				)}
			>
				<Plus className="size-5.5" strokeWidth={2.2} aria-hidden="true" />
				<span className="sr-only">Quick Add</span>
			</QuickAddLink>
			<TabGroup items={tabItems.slice(half)} />
		</nav>
	);
}

function TabGroup({ items }: { items: typeof tabItems }) {
	const isCurrent = useIsCurrent("tabs");
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
						isCurrent(item) && "text-foreground",
					)}
				>
					<item.icon className="size-5.5" strokeWidth={1.75} aria-hidden="true" />
					{item.tab.label}
				</Link>
			))}
		</div>
	);
}
