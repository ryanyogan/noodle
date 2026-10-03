import { Badge } from "@noodle/ui/components/badge";
import { RowButton } from "@noodle/ui/components/row-button";
import { cn } from "@noodle/ui/lib/utils";
import { useHydrated } from "@tanstack/react-router";
import { ChevronDown } from "lucide-react";
import { type ReactNode, useEffect, useId, useState } from "react";

/**
 * This Month's prompts (#65): Close the last month, Get started, Check-in day, Extra income and
 * the chips, in one strip. On a phone it's one line with a count, under Free to Spend, and opens
 * on a tap; from lg it's always open at the top of the main column. Gone when nothing is in it.
 */
export function ToDo({ className, children }: { className?: string; children: ReactNode }) {
	const [open, setOpen] = useState(false);
	const [labels, setLabels] = useState<string[]>([]);
	const hydrated = useHydrated();
	// A callback ref: the node can be replaced when a Suspense boundary inside resolves.
	const [body, setBody] = useState<HTMLDivElement | null>(null);
	const id = useId();
	// Each item hides itself when it has nothing to say, so count the ones that rendered.
	useEffect(() => {
		const el = body;
		if (!el) return;
		const read = () =>
			setLabels(
				[...el.querySelectorAll<HTMLElement>(":scope > [data-todo-item]")]
					.filter((item) => item.childElementCount > 0)
					.map((item) => item.dataset.todoItem ?? ""),
			);
		read();
		// The first read can land before the page has settled; read once more after it.
		const later = setTimeout(read, 0);
		const observer = new MutationObserver(read);
		observer.observe(el, { childList: true, subtree: true });
		return () => {
			clearTimeout(later);
			observer.disconnect();
		};
		// Read again once hydrated: until then the server's HTML is all there is.
		void hydrated;
	}, [body, hydrated]);
	return (
		<section
			aria-label="To do"
			className={cn("hidden min-w-0 gap-3 has-[[data-todo-item]:not(:empty)]:grid", className)}
		>
			<RowButton
				variant="bordered"
				aria-expanded={open}
				aria-controls={id}
				disabled={!hydrated}
				onClick={() => setOpen((o) => !o)}
				className="min-h-11 min-w-0 justify-start gap-2 bg-card lg:hidden"
			>
				<span className="text-sm font-semibold">To do</span>
				{labels.length > 0 ? <Badge variant="count">{labels.length}</Badge> : null}
				<span className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground">
					{labels.join(" · ")}
				</span>
				<ChevronDown
					aria-hidden="true"
					className={cn("size-4 shrink-0 text-muted-foreground transition-transform", {
						"rotate-180": open,
					})}
				/>
			</RowButton>
			<div id={id} ref={setBody} className={cn("grid gap-3", !open && "max-lg:hidden")}>
				{children}
			</div>
		</section>
	);
}

/** One prompt in the strip; empty when its prompt has nothing to say. */
export function ToDoItem({ label, children }: { label: string; children: ReactNode }) {
	return (
		<div data-todo-item={label} className="grid gap-3 empty:hidden">
			{children}
		</div>
	);
}
