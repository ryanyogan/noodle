import { cva } from "class-variance-authority";
import { Slot, Tabs as TabsPrimitive } from "radix-ui";
import * as React from "react";
import { cn } from "#lib/utils";

// shadcn/ui's Tabs (https://ui.shadcn.com/docs/components/tabs), radix-nova, on this design
// system's tokens: a track of options, the chosen one raised onto the card.
//
// Two forms, one look:
// - Tabs, TabsList, TabsTrigger, TabsContent: panels on one page (Radix, role=tablist).
// - LinkTabs and LinkTab: pages, each its own URL (a <nav> of links, the current one
//   aria-current="page"), as the Month/Plan switch, the Plan's pages, Reports' views and Can we
//   afford it? are. They're navigation, so they aren't a tablist.

const tabsListVariants = cva(
	"inline-flex w-max max-w-full items-center gap-0.5 rounded-lg bg-surface-3/80 p-0.5 text-muted-foreground dark:bg-surface-2",
);

// On a phone a tab is 36px in a 40px track, and takes a thumb over 44px: its `::after` reaches 4px
// above and below it (issue 115). LinkTabs' strip is 44px tall so that reach isn't cut off; a
// TabsList is its own strip, so there the reach ends at the track (40px).
const tabsTriggerVariants = cva([
	"inline-flex h-8 max-lg:h-9 shrink-0 items-center justify-center gap-1.5 rounded-md px-3 text-[13px] font-medium whitespace-nowrap",
	"max-lg:relative max-lg:after:absolute max-lg:after:inset-x-0 max-lg:after:-inset-y-1",
	"transition-[background-color,color,box-shadow] duration-(--duration-fast) ease-standard hover:text-foreground",
	"focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
	"disabled:pointer-events-none disabled:opacity-50",
	"data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-card",
	"aria-[current=page]:bg-card aria-[current=page]:text-foreground aria-[current=page]:shadow-card",
	"[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
]);

function Tabs({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Root>) {
	return <TabsPrimitive.Root data-slot="tabs" className={cn("grid gap-3", className)} {...props} />;
}

/**
 * A strip of tabs that doesn't fit scrolls sideways with no scrollbar; a faded edge says there's
 * more that way, and the current tab is scrolled into view. TabsList and LinkTabs share it (#73).
 */
function useEdgeFade<T extends HTMLElement>() {
	const ref = React.useRef<T>(null);
	const [edges, setEdges] = React.useState({ start: false, end: false });
	React.useEffect(() => {
		const strip = ref.current;
		if (!strip) return;
		const measure = () => {
			const max = strip.scrollWidth - strip.clientWidth;
			const at = Math.abs(strip.scrollLeft);
			setEdges((e) => {
				const next = { start: max > 4 && at > 4, end: max > 4 && at < max - 4 };
				return e.start === next.start && e.end === next.end ? e : next;
			});
		};
		// Scroll only the strip, never the page, to the current tab.
		const current = strip.querySelector<HTMLElement>('[aria-current="page"],[data-state="active"]');
		if (current) {
			const left = current.getBoundingClientRect().left - strip.getBoundingClientRect().left;
			const right = left + current.offsetWidth;
			if (right > strip.clientWidth) strip.scrollLeft += right - strip.clientWidth + 32;
		}
		measure();
		strip.addEventListener("scroll", measure, { passive: true });
		const observer = new ResizeObserver(measure);
		observer.observe(strip);
		return () => {
			strip.removeEventListener("scroll", measure);
			observer.disconnect();
		};
	}, []);
	return {
		ref,
		"data-fade-start": edges.start || undefined,
		"data-fade-end": edges.end || undefined,
	};
}

const edgeFade = [
	"max-w-full snap-x snap-proximity overflow-x-auto [scrollbar-width:none]",
	"[--fade-s:black] [--fade-e:black] data-fade-start:[--fade-s:transparent] data-fade-end:[--fade-e:transparent]",
	"data-fade-start:mask-[linear-gradient(to_right,var(--fade-s),black_2rem,black_calc(100%-2rem),var(--fade-e))]",
	"data-fade-end:mask-[linear-gradient(to_right,var(--fade-s),black_2rem,black_calc(100%-2rem),var(--fade-e))]",
];

function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
	const fade = useEdgeFade<HTMLDivElement>();
	return (
		<TabsPrimitive.List
			data-slot="tabs-list"
			className={cn(tabsListVariants(), edgeFade, className)}
			{...props}
			{...fade}
		/>
	);
}

function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
	return (
		<TabsPrimitive.Trigger
			data-slot="tabs-trigger"
			className={cn(tabsTriggerVariants(), "snap-start", className)}
			{...props}
		/>
	);
}

function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
	return (
		<TabsPrimitive.Content
			data-slot="tabs-content"
			className={cn("outline-none", className)}
			{...props}
		/>
	);
}

/** Pages as tabs: a named <nav> whose track scrolls sideways when it doesn't fit. */
function LinkTabs({
	className,
	listClassName,
	children,
	...props
}: React.ComponentProps<"nav"> & { listClassName?: string }) {
	const fade = useEdgeFade<HTMLElement>();
	return (
		<nav
			data-slot="link-tabs"
			// Room for the tabs' 44px tap area above and below the track on a phone.
			className={cn(edgeFade, "max-lg:py-0.5", className)}
			{...props}
			{...fade}
		>
			<div className={cn(tabsListVariants(), "max-w-none", listClassName)}>{children}</div>
		</nav>
	);
}

/** One page of LinkTabs: wrap a router link (asChild), and set aria-current="page" on the current one. */
function LinkTab({
	className,
	asChild = false,
	...props
}: React.ComponentProps<"a"> & { asChild?: boolean }) {
	const Comp = asChild ? Slot.Root : "a";
	return (
		<Comp
			data-slot="link-tab"
			className={cn(tabsTriggerVariants(), "snap-start", className)}
			{...props}
		/>
	);
}

/** A quiet rule between groups of LinkTabs. */
function LinkTabsSeparator({ className }: { className?: string }) {
	return (
		<span
			aria-hidden="true"
			data-slot="link-tabs-separator"
			className={cn("mx-1 h-4 w-px shrink-0 bg-border-strong", className)}
		/>
	);
}

export {
	LinkTab,
	LinkTabs,
	LinkTabsSeparator,
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
	tabsListVariants,
	tabsTriggerVariants,
};
