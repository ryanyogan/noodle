import { Badge } from "@noodle/ui/components/badge";
import { RowButton } from "@noodle/ui/components/row-button";
import { cn } from "@noodle/ui/lib/utils";
import { useHydrated } from "@tanstack/react-router";
import { ChevronDown } from "lucide-react";
import { type ReactNode, useId, useState } from "react";

/** One prompt in the strip: what the closed strip calls it, and the prompt itself. */
export type ToDoItem = { label: string; content: ReactNode };

/**
 * This Month's prompts (#65): Close the last month, Get started, Check-in day, Extra income and
 * the chips, in one strip under Free to Spend. On a phone, closed, it's one line with a count and
 * the names of what's in it, and a tap opens it; from lg it's always open, in the rail. The page
 * decides which prompts show and passes only those, so the strip never looks at what rendered. Gone when nothing is in it.
 */
export function ToDo({ className, items }: { className?: string; items: ToDoItem[] }) {
	const [open, setOpen] = useState(false);
	const hydrated = useHydrated();
	const id = useId();
	if (items.length === 0) return null;
	return (
		<section aria-label="To do" className={cn("grid min-w-0 gap-3", className)}>
			<RowButton
				variant="bordered"
				aria-expanded={open}
				aria-controls={id}
				disabled={!hydrated}
				onClick={() => setOpen((o) => !o)}
				className="min-h-11 min-w-0 justify-start gap-2 bg-card lg:hidden"
			>
				<span className="text-sm font-semibold">To do</span>
				<Badge variant="count">{items.length}</Badge>
				<span className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground">
					{items.map((item) => item.label).join(" · ")}
				</span>
				<ChevronDown
					aria-hidden="true"
					className={cn("size-4 shrink-0 text-muted-foreground transition-transform", {
						"rotate-180": open,
					})}
				/>
			</RowButton>
			{/* From lg the prompts sit open under one heading, like every other section (#73). */}
			<h2 className="px-1 text-[15px] font-semibold max-lg:hidden">To do</h2>
			{/* Kept mounted while closed, so a half-made choice in a prompt survives closing it. */}
			<div id={id} className={cn("grid min-w-0 gap-3", !open && "max-lg:hidden")}>
				{items.map((item) => (
					<div key={item.label} className="grid min-w-0 gap-3">
						{item.content}
					</div>
				))}
			</div>
		</section>
	);
}
