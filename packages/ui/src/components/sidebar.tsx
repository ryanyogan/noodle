import { cva, type VariantProps } from "class-variance-authority";
import { PanelLeft } from "lucide-react";
import { Slot } from "radix-ui";
import * as React from "react";
import { Button } from "#components/button";
import { Separator } from "#components/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "#components/tooltip";
import { cn } from "#lib/utils";

// shadcn/ui's Sidebar (https://ui.shadcn.com/docs/components/sidebar), radix-nova, by hand from
// the registry, on this design system's tokens. What changed from the registry, and why:
//
// - Collapsing is to the icon rail only (the registry's `collapsible="icon"`). There is no
//   off-canvas or mobile Sheet variant: phones keep the bottom tab bar, so the registry's
//   `use-mobile`, Sheet, SidebarInset, SidebarInput, SidebarRail, the menu actions, skeleton and
//   sub-menus aren't here. Add them from the registry when something needs them.
// - The state is remembered per device in localStorage, not a cookie, and lives on
//   `<html data-sidebar-state>`: `sidebarStateScript`, inline in `<head>`, sets it before first
//   paint, so a collapsed sidebar renders collapsed with no flash and the server needn't read a
//   cookie. Styles follow that attribute through the `rail:` variant (globals.css), where the
//   registry uses `group-data-[collapsible=icon]:`; `--sidebar-width` becomes
//   `--sidebar-width-icon` there, so the app's grid and anything else using it follow.
// - SidebarProvider renders no wrapper: the app's shell is the layout. It still owns Ctrl/⌘+B.
// - In the rail, labels and group labels are hidden from sight but stay in the accessibility
//   tree (`rail:sr-only`), so a link keeps its name; the tooltip repeats it for sighted people.
// - A group is a `role="group"` named by its label (`aria-labelledby`), so the label is announced.
// - Colours are the app's tokens rather than `--sidebar-*`; the current item is the raised card
//   look the hand-rolled sidebar had; focus is the app's global `:focus-visible` outline.

type SidebarState = "expanded" | "collapsed";

const SIDEBAR_STORAGE_KEY = "sidebar_state";
const SIDEBAR_KEYBOARD_SHORTCUT = "b";

/** Inline in `<head>`: puts this device's remembered state on `<html>` before first paint. */
const sidebarStateScript = `try{if(localStorage.getItem("${SIDEBAR_STORAGE_KEY}")==="collapsed")document.documentElement.dataset.sidebarState="collapsed"}catch(e){}`;

const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
};
const readState = (): SidebarState =>
	document.documentElement.dataset.sidebarState === "collapsed" ? "collapsed" : "expanded";
const serverState = (): SidebarState => "expanded";

function writeState(state: SidebarState) {
	if (state === "collapsed") document.documentElement.dataset.sidebarState = "collapsed";
	else delete document.documentElement.dataset.sidebarState;
	try {
		localStorage.setItem(SIDEBAR_STORAGE_KEY, state);
	} catch {
		// Private mode or blocked storage: it still works for this visit.
	}
	for (const listener of listeners) listener();
}

type SidebarContextProps = {
	state: SidebarState;
	open: boolean;
	setOpen: (open: boolean) => void;
	toggleSidebar: () => void;
};

const SidebarContext = React.createContext<SidebarContextProps | null>(null);

function useSidebar() {
	const context = React.useContext(SidebarContext);
	if (!context) throw new Error("useSidebar must be used within a SidebarProvider.");
	return context;
}

function SidebarProvider({ children }: { children: React.ReactNode }) {
	const state = React.useSyncExternalStore(subscribe, readState, serverState);

	React.useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (
				event.key.toLowerCase() === SIDEBAR_KEYBOARD_SHORTCUT &&
				(event.metaKey || event.ctrlKey) &&
				!event.altKey &&
				!event.shiftKey
			) {
				event.preventDefault();
				writeState(readState() === "collapsed" ? "expanded" : "collapsed");
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, []);

	const value = React.useMemo<SidebarContextProps>(
		() => ({
			state,
			open: state === "expanded",
			setOpen: (open) => writeState(open ? "expanded" : "collapsed"),
			toggleSidebar: () => writeState(readState() === "collapsed" ? "expanded" : "collapsed"),
		}),
		[state],
	);

	return <SidebarContext.Provider value={value}>{children}</SidebarContext.Provider>;
}

function Sidebar({ className, ...props }: React.ComponentProps<"aside">) {
	const { state } = useSidebar();
	return (
		<aside
			data-slot="sidebar"
			data-state={state}
			className={cn(
				"sticky top-0 flex h-dvh min-w-0 flex-col gap-4 border-e bg-card/55 px-3 py-5",
				className,
			)}
			{...props}
		/>
	);
}

function SidebarTrigger({ className, onClick, ...props }: React.ComponentProps<typeof Button>) {
	const { open, toggleSidebar } = useSidebar();
	return (
		<Button
			data-slot="sidebar-trigger"
			variant="ghost"
			size="icon"
			aria-expanded={open}
			aria-keyshortcuts="Control+B Meta+B"
			className={className}
			onClick={(event) => {
				onClick?.(event);
				toggleSidebar();
			}}
			{...props}
		>
			<PanelLeft className="size-4.5" strokeWidth={1.75} aria-hidden="true" />
			<span className="sr-only">Toggle sidebar</span>
		</Button>
	);
}

function SidebarHeader({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div data-slot="sidebar-header" className={cn("flex flex-col gap-4", className)} {...props} />
	);
}

function SidebarFooter({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div data-slot="sidebar-footer" className={cn("flex flex-col gap-2", className)} {...props} />
	);
}

function SidebarSeparator({ className, ...props }: React.ComponentProps<typeof Separator>) {
	return <Separator data-slot="sidebar-separator" className={className} {...props} />;
}

function SidebarContent({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="sidebar-content"
			// The padding (taken back by the margin) leaves room for the current item's ring and
			// shadow, and the rail's badges, inside the scroll box.
			className={cn(
				"-mx-1.5 -my-1 flex min-h-0 flex-1 flex-col gap-4 overflow-x-hidden overflow-y-auto px-1.5 py-1 rail:gap-3",
				className,
			)}
			{...props}
		/>
	);
}

/** A named set of destinations. Give it `aria-labelledby` its SidebarGroupLabel's `id`. */
function SidebarGroup({ className, ...props }: React.ComponentProps<"div">) {
	return (
		// biome-ignore lint/a11y/useSemanticElements: a fieldset is for form controls; this groups links.
		<div
			data-slot="sidebar-group"
			role="group"
			className={cn(
				"flex min-w-0 flex-col gap-0.5 rail:not-first:border-t rail:not-first:pt-3",
				className,
			)}
			{...props}
		/>
	);
}

function SidebarGroupLabel({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="sidebar-group-label"
			className={cn(
				"flex h-7 shrink-0 items-center px-2.5 text-xs font-medium text-subtle-foreground rail:sr-only",
				className,
			)}
			{...props}
		/>
	);
}

function SidebarMenu({ className, ...props }: React.ComponentProps<"ul">) {
	return (
		<ul
			data-slot="sidebar-menu"
			className={cn("flex w-full min-w-0 flex-col gap-0.5", className)}
			{...props}
		/>
	);
}

function SidebarMenuItem({ className, ...props }: React.ComponentProps<"li">) {
	return (
		<li
			data-slot="sidebar-menu-item"
			className={cn("group/menu-item relative", className)}
			{...props}
		/>
	);
}

const sidebarMenuButtonVariants = cva(
	[
		"peer/menu-button relative flex w-full min-w-0 cursor-default items-center gap-2.5 rounded-lg px-2.5 text-start text-sm font-medium text-muted-foreground",
		"transition-colors duration-(--duration-fast) ease-standard hover:bg-surface-2 hover:text-foreground",
		"disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50",
		"data-[active=true]:bg-card data-[active=true]:text-foreground data-[active=true]:shadow-card data-[active=true]:ring-1 data-[active=true]:ring-border",
		"data-[state=open]:bg-surface-2 data-[state=open]:text-foreground",
		"rail:justify-center rail:px-0",
		"[&>svg]:shrink-0 [&>svg:not([class*='size-'])]:size-4.5",
	],
	{
		variants: {
			size: {
				default: "h-9",
				lg: "h-12 px-2",
			},
		},
		defaultVariants: { size: "default" },
	},
);

function SidebarMenuButton({
	asChild = false,
	isActive = false,
	size = "default",
	tooltip,
	className,
	...props
}: React.ComponentProps<"button"> & {
	asChild?: boolean;
	isActive?: boolean;
	/** Shown beside the button while the sidebar is collapsed to its rail. */
	tooltip?: React.ReactNode;
} & VariantProps<typeof sidebarMenuButtonVariants>) {
	const Comp = asChild ? Slot.Root : "button";
	const { state } = useSidebar();
	const button = (
		<Comp
			data-slot="sidebar-menu-button"
			data-size={size}
			data-active={isActive}
			{...(asChild ? {} : { type: "button" as const })}
			className={cn(sidebarMenuButtonVariants({ size }), className)}
			{...props}
		/>
	);
	if (!tooltip) return button;
	return (
		<Tooltip>
			<TooltipTrigger asChild>{button}</TooltipTrigger>
			<TooltipContent side="right" align="center" hidden={state !== "collapsed"}>
				{tooltip}
			</TooltipContent>
		</Tooltip>
	);
}

/** A count beside a menu button: a sibling of it in the item, so it isn't in the button's name. */
function SidebarMenuBadge({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="sidebar-menu-badge"
			className={cn(
				"pointer-events-none absolute end-2 top-1/2 flex h-5 min-w-5 -translate-y-1/2 items-center justify-center rounded-full bg-surface-3 px-1.5 text-[11px] font-medium text-foreground tabular-nums select-none",
				"rail:-end-1 rail:-top-1 rail:h-4 rail:min-w-4 rail:translate-y-0 rail:px-1 rail:text-[10px]",
				className,
			)}
			{...props}
		/>
	);
}

export {
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
	sidebarStateScript,
	useSidebar,
};
