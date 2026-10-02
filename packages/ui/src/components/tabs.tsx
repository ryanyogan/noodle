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

const tabsTriggerVariants = cva([
	"inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md px-3 text-[13px] font-medium whitespace-nowrap",
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

function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
	return (
		<TabsPrimitive.List
			data-slot="tabs-list"
			className={cn(tabsListVariants(), className)}
			{...props}
		/>
	);
}

function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
	return (
		<TabsPrimitive.Trigger
			data-slot="tabs-trigger"
			className={cn(tabsTriggerVariants(), className)}
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
	// When the track scrolls, a faded edge says there's more that way (there's no scrollbar), and
	// the current tab is scrolled into view.
	const ref = React.useRef<HTMLElement>(null);
	const [edges, setEdges] = React.useState({ start: false, end: false });
	React.useEffect(() => {
		const nav = ref.current;
		if (!nav) return;
		const measure = () => {
			const max = nav.scrollWidth - nav.clientWidth;
			const at = Math.abs(nav.scrollLeft);
			setEdges((e) => {
				const next = { start: max > 1 && at > 1, end: max > 1 && at < max - 1 };
				return e.start === next.start && e.end === next.end ? e : next;
			});
		};
		nav
			.querySelector('[aria-current="page"]')
			?.scrollIntoView({ block: "nearest", inline: "nearest" });
		measure();
		nav.addEventListener("scroll", measure, { passive: true });
		const observer = new ResizeObserver(measure);
		observer.observe(nav);
		return () => {
			nav.removeEventListener("scroll", measure);
			observer.disconnect();
		};
	}, []);
	return (
		<nav
			ref={ref}
			data-slot="link-tabs"
			data-fade-start={edges.start || undefined}
			data-fade-end={edges.end || undefined}
			className={cn(
				"max-w-full snap-x snap-proximity overflow-x-auto [scrollbar-width:none]",
				"[--fade-s:black] [--fade-e:black] data-fade-start:[--fade-s:transparent] data-fade-end:[--fade-e:transparent]",
				"data-fade-start:mask-[linear-gradient(to_right,var(--fade-s),black_2rem,black_calc(100%-2rem),var(--fade-e))]",
				"data-fade-end:mask-[linear-gradient(to_right,var(--fade-s),black_2rem,black_calc(100%-2rem),var(--fade-e))]",
				className,
			)}
			{...props}
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
