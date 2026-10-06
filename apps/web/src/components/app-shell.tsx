import { useClerk, useUser } from "@clerk/tanstack-react-start";
import { Avatar, AvatarFallback, AvatarImage } from "@noodle/ui/components/avatar";
import { Badge } from "@noodle/ui/components/badge";
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
import { Sheet, SheetContent, SheetHeader } from "@noodle/ui/components/sheet";
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
import {
	Link,
	useLocation,
	useMatches,
	useMatchRoute,
	useNavigate,
	useRouteContext,
	useRouter,
} from "@tanstack/react-router";
import {
	ChevronsUpDown,
	Ellipsis,
	ListChecks,
	LogOut,
	Plus,
	Settings,
	Sparkles,
	UserRound,
} from "lucide-react";
import { type ComponentProps, type ReactNode, useEffect, useId } from "react";
import { moreGroups, type NavGroup, type NavItem, sidebarGroups, tabItems } from "../nav";
import { checkInStatusQuery, membersQuery, reviewQuery } from "../queries";
import { openGlossary } from "./glossary";
import { markQuickAddOpened, quickAddSearch } from "./quick-add";

/**
 * Whether a destination is current, by the router's own matching: on its route or any page under
 * it (This Month on every month, Plan on every Plan page), and on the routes `within` it (Review
 * within Transactions).
 */
function useIsCurrent() {
	const matchRoute = useMatchRoute();
	return (item: NavItem) => {
		if (!item.to) return false;
		if (item.except?.some((to) => matchRoute({ to, fuzzy: true }) !== false)) return false;
		const routes = [item.to, ...(item.within ?? [])];
		return routes.some((to) => matchRoute({ to, fuzzy: true }) !== false);
	};
}

/** The authenticated app frame: a sidebar on desktop, a bottom tab bar (ending in More) on phones. */
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
						// Fills the space beside the Sidebar up to its cap; where the window leaves more than
						// that, the page sits in the middle with the leftover split evenly (#73, ADR-0033).
						"mx-auto w-full max-w-(--shell-max) px-(--gutter) outline-none",
						wide && "max-w-(--shell-max-wide)",
						"pt-[calc(var(--safe-top)+16px)] pb-[calc(var(--tabbar-height)+var(--safe-bottom)+32px)]",
						"lg:pt-6 lg:pb-12",
					)}
				>
					{children}
					<AskButton />
				</main>
				<TabBar householdName={householdName} />
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
				{/* A short window (1024×768): the groups sit closer and their labels are lower, so the last
				    link is whole above the Sidebar's foot without scrolling (issue 73). */}
				<nav
					aria-label="Main"
					className="flex flex-col gap-4 rail:gap-3 [@media(max-height:800px)]:gap-2 [@media(max-height:800px)]:[&_[data-slot=sidebar-group-label]]:h-6"
				>
					{sidebarGroups.map((group) => (
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

/**
 * Ask, from any page on a computer (issue 100): a small button fixed in the window's bottom right
 * corner, in the page's gutter and bottom padding, so it covers nothing of a page.
 * Toasts are bottom centre and sheets open over it; an item's panel on the right edge (`z-30`)
 * opens under it and keeps its own bottom padding clear of it. Ask itself has its question box there, so it
 * isn't shown on Ask. A phone has Ask in More.
 */
function AskButton() {
	const matchRoute = useMatchRoute();
	if (matchRoute({ to: "/ask", fuzzy: true }) !== false) return null;
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Button
					asChild
					variant="outline"
					size="icon-lg"
					// As wide as the page's gutter and inside it, so nothing of the page is under it: 8px in
					// from the edge it lay over the last 8px of a rail (issue 73). Where the page sits in the
					// middle of a wider window there is room for it to stand off the edge.
					className="fixed end-0 bottom-2 z-31 size-10 rounded-full bg-card shadow-card max-lg:hidden min-[130rem]:end-2"
				>
					<Link to="/ask" aria-label="Ask Noodle" data-ask-button="" data-over-panel="">
						<Sparkles strokeWidth={1.75} aria-hidden="true" />
					</Link>
				</Button>
			</TooltipTrigger>
			<TooltipContent side="left">Ask Noodle</TooltipContent>
		</Tooltip>
	);
}

function NavGroupSection({ group }: { group: NavGroup }) {
	const labelId = useId();
	const isCurrent = useIsCurrent();
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

/** The signed-in Parent's name and picture, which arrive after the page's HTML: they wait for hydration. */
function useSignedInParent() {
	const { parentId } = useRouteContext({ from: "/_authed/_household" });
	const { isLoaded, user } = useUser();
	const members = useQuery(membersQuery()).data;
	const hydrated = useHydrated();
	const name = hydrated
		? (members?.find((member) => member.id === parentId)?.name ?? user?.fullName ?? undefined)
		: undefined;
	return { name, imageUrl: hydrated ? user?.imageUrl : undefined, ready: hydrated && isLoaded };
}

function ParentAvatar({
	name,
	imageUrl,
}: {
	name: string | undefined;
	imageUrl: string | undefined;
}) {
	return (
		<Avatar>
			{imageUrl ? <AvatarImage src={imageUrl} alt="" /> : null}
			<AvatarFallback>{name?.trim().charAt(0).toUpperCase() ?? ""}</AvatarFallback>
		</Avatar>
	);
}

/** The signed-in Parent, with their Household: opens the account menu. */
function ParentMenu({ householdName }: { householdName: string }) {
	const clerk = useClerk();
	const { name, imageUrl, ready } = useSignedInParent();
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<SidebarMenuButton size="lg" data-parent-menu="" data-ready={ready ? "true" : undefined}>
					<ParentAvatar name={name} imageUrl={imageUrl} />
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

function TabBar({ householdName }: { householdName: string }) {
	// Quick Add sits in the middle of the bar, in easy reach of either thumb, with the
	// destinations split either side of it. More is always last (bottom right).
	const half = Math.ceil(tabItems.length / 2);
	return (
		<nav
			aria-label="Main"
			className={cn(
				"fixed inset-x-0 bottom-0 z-20 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] border-t lg:hidden",
				"bg-card/95 backdrop-blur-xl backdrop-saturate-150",
				// At 320 "Month" and "Transactions" nearly met (issue 115): a little less room at the
				// edges and round Quick Add there, and slightly smaller labels (`tabClass`).
				"px-2 pt-1.5 pb-[calc(var(--safe-bottom)+6px)] max-[21.25rem]:px-1",
			)}
		>
			<TabGroup items={tabItems.slice(0, half)} />
			<QuickAddLink
				className={cn(
					// Its box is in px, not text sizes: with text at 200% it would take the room the labels
					// either side of it need (issue 74).
					"mx-2 grid h-[44px] w-[48px] place-items-center self-center rounded-[14px] bg-primary text-primary-foreground max-[21.25rem]:mx-1",
					"transition-transform duration-(--duration-fast) ease-standard active:scale-[0.94]",
				)}
			>
				<Plus className="size-5.5" strokeWidth={2.2} aria-hidden="true" />
				<span className="sr-only">Quick Add</span>
			</QuickAddLink>
			<TabGroup items={tabItems.slice(half)}>
				<MoreTab householdName={householdName} />
			</TabGroup>
		</nav>
	);
}

const tabClass = cn(
	"grid h-(--tabbar-height) min-w-0 place-content-center justify-items-center gap-1 rounded-lg text-[11px] font-medium text-subtle-foreground",
	"max-[21.25rem]:text-[10px] max-[21.25rem]:tracking-tight",
	// The labels are sized in px to fit their fifth of the bar: a phone's text-size setting must not
	// grow them into each other (the pages' own text still grows).
	"[-webkit-text-size-adjust:100%] [text-size-adjust:100%]",
	"transition-colors duration-(--duration-fast) ease-standard",
);

function TabGroup({ items, children }: { items: typeof tabItems; children?: ReactNode }) {
	const isCurrent = useIsCurrent();
	return (
		<div className="grid auto-cols-fr grid-flow-col">
			{items.map((item) => (
				<Link
					key={item.label}
					to={item.to}
					activeOptions={{ exact: true }}
					aria-current={isCurrent(item) ? "page" : undefined}
					className={cn(tabClass, isCurrent(item) && "text-foreground")}
				>
					<item.icon className="size-5.5" strokeWidth={1.75} aria-hidden="true" />
					{item.tab.label}
				</Link>
			))}
			{children}
		</div>
	);
}

/** The More sheet is open while the address ends in this, so Back closes it. */
const MORE_HASH = "more";
/** Whether the open sheet was opened from the tab on this page: closing it then goes Back. */
let moreOpenedHere = false;

/**
 * The tab bar's last item (#74). It opens a sheet with everything that isn't a tab, grouped as the
 * Sidebar is, and the signed-in Parent. It is marked while the current page is one of those.
 */
function MoreTab({ householdName }: { householdName: string }) {
	const isCurrent = useIsCurrent();
	const hydrated = useHydrated();
	const router = useRouter();
	const navigate = useNavigate();
	const open = useLocation({ select: (location) => location.hash === MORE_HASH }) && hydrated;
	const within = moreGroups.some((group) => group.items.some(isCurrent));
	useEffect(() => {
		if (!open) moreOpenedHere = false;
	}, [open]);
	const close = () => {
		if (moreOpenedHere) router.history.back();
		// Opened by its address (a reload, a shared link): there is no entry of ours to go back to.
		else void navigate({ to: ".", search: (prev) => prev, replace: true, resetScroll: false });
	};
	return (
		<>
			<Link
				to="."
				search={(prev) => prev}
				hash={MORE_HASH}
				resetScroll={false}
				// The router calls a link to the page it's on current ("page"). This one is that only
				// while its sheet is open (the address ends in #more), behind the sheet.
				activeOptions={{ exact: true, includeHash: true }}
				aria-haspopup="dialog"
				aria-expanded={open}
				aria-current={within ? "true" : undefined}
				data-more-tab=""
				className={cn(tabClass, (within || open) && "text-foreground")}
				onClick={() => {
					moreOpenedHere = true;
				}}
			>
				<Ellipsis className="size-5.5" strokeWidth={1.75} aria-hidden="true" />
				More
			</Link>
			<Sheet open={open} onOpenChange={(next) => (next ? undefined : close())}>
				<SheetContent
					aria-describedby={undefined}
					data-more-sheet=""
					// On a short phone the last rows are reached by scrolling the sheet: a soft shade at its
					// foot says there is more, and goes once the end is in view (issue 74).
					className="max-sm:[background:linear-gradient(to_top,var(--card)_40%,transparent)_bottom/100%_56px_no-repeat_local,linear-gradient(to_top,color-mix(in_oklab,var(--foreground)_22%,transparent),transparent)_bottom/100%_20px_no-repeat_scroll,var(--card)]"
				>
					<SheetHeader title="More" />
					<nav aria-label="More" className="grid gap-2">
						{moreGroups.map((group, index) => (
							<MoreGroup key={group.label} group={group} review={index === 0} onGlossary={close} />
						))}
					</nav>
					<MoreAccount householdName={householdName} close={close} />
				</SheetContent>
			</Sheet>
		</>
	);
}

/** A row of the More sheet: 44px tall, the current page on the raised ground. */
const moreRow =
	"min-w-0 justify-start gap-2.5 px-3 text-left text-sm leading-tight font-medium whitespace-normal aria-[current=page]:bg-selected";

function MoreGroup({
	group,
	review,
	onGlossary,
}: {
	group: NavGroup;
	/** Review goes first in this group: on a computer it is the count beside Transactions. */
	review: boolean;
	onGlossary: () => void;
}) {
	const labelId = useId();
	const isCurrent = useIsCurrent();
	const matchRoute = useMatchRoute();
	const waiting = useQuery(reviewQuery()).data?.total ?? 0;
	return (
		<section aria-labelledby={labelId} className="grid gap-1">
			<p id={labelId} className="px-3 text-xs font-medium text-subtle-foreground">
				{group.label}
			</p>
			{/* One column below 400px, so "Perks & Benefits" and "Household settings" keep one line (issue 74). */}
			<div className="grid grid-cols-2 gap-1 max-[399px]:grid-cols-1">
				{review ? (
					<Button asChild variant="ghost" className={moreRow}>
						{/* `replace`: the sheet's own entry becomes the page, so Back returns to where More was opened. */}
						<Link
							to="/review"
							replace
							aria-current={
								matchRoute({ to: "/review", fuzzy: true }) !== false ? "page" : undefined
							}
						>
							<ListChecks strokeWidth={1.75} aria-hidden="true" />
							<span className="line-clamp-2">Review</span>
							{waiting > 0 ? (
								<Badge variant="count" className="ms-auto">
									{waiting}
									<span className="sr-only"> to review</span>
								</Badge>
							) : null}
						</Link>
					</Button>
				) : null}
				{group.items.map((item) =>
					item.to ? (
						<Button key={item.label} asChild variant="ghost" className={moreRow}>
							<Link to={item.to} replace aria-current={isCurrent(item) ? "page" : undefined}>
								<item.icon strokeWidth={1.75} aria-hidden="true" />
								<span className="line-clamp-2">{item.label}</span>
								{item.badge === "check-in" ? <CheckInBadge /> : null}
							</Link>
						</Button>
					) : (
						<Button
							key={item.label}
							variant="ghost"
							className={moreRow}
							aria-haspopup="dialog"
							onClick={() => {
								onGlossary();
								openGlossary();
							}}
						>
							<item.icon strokeWidth={1.75} aria-hidden="true" />
							<span className="line-clamp-2">{item.label}</span>
						</Button>
					),
				)}
			</div>
		</section>
	);
}

/** The signed-in Parent at the foot of the More sheet: their account, and signing out. */
function MoreAccount({ householdName, close }: { householdName: string; close: () => void }) {
	const clerk = useClerk();
	const { name, imageUrl } = useSignedInParent();
	return (
		<section aria-label="Your account" className="flex items-center gap-2 border-t pt-3">
			{/* One row, so the whole sheet fits a 320 by 640 window: the Parent opens their account. */}
			<Button
				variant="ghost"
				className="min-w-0 flex-1 justify-start gap-3 px-3 text-left"
				onClick={() => {
					close();
					clerk.openUserProfile();
				}}
			>
				<ParentAvatar name={name} imageUrl={imageUrl} />
				<span className="grid min-w-0 text-sm leading-tight">
					<span className="truncate font-medium text-foreground">{name ?? householdName}</span>
					<span className="truncate text-xs font-normal text-subtle-foreground">
						Manage account
					</span>
				</span>
			</Button>
			<Button variant="outline" onClick={() => void clerk.signOut({ redirectUrl: "/" })}>
				<LogOut aria-hidden="true" />
				Sign out
			</Button>
		</section>
	);
}
