import { Popover, PopoverContent, PopoverTrigger } from "@noodle/ui/components/popover";
import { cn } from "@noodle/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import { CircleHelp } from "lucide-react";
import { type GlossaryId, glossary } from "../glossary";

/**
 * A small "?" beside a term where it first appears: it opens a sentence about the term and a link
 * to the Glossary (ADR-0018). A Popover, not a Tooltip, so it opens by tap and by keyboard too, and
 * stays open until dismissed (WCAG 1.4.13). Put it beside a heading, not inside it, so the
 * heading's name stays the term.
 */
export function TermHelp({ term, className }: { term: GlossaryId; className?: string }) {
	const entry = glossary[term];
	return (
		<Popover>
			<PopoverTrigger asChild>
				<button
					type="button"
					aria-label={`What’s “${entry.term}”?`}
					className={cn(
						"-my-1 inline-flex size-6 shrink-0 items-center justify-center rounded-full align-middle text-muted-foreground",
						"transition-colors duration-(--duration-fast) hover:bg-surface-2 hover:text-foreground",
						"focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
						"data-[state=open]:bg-surface-2 data-[state=open]:text-foreground",
						className,
					)}
				>
					<CircleHelp aria-hidden="true" className="size-4" />
				</button>
			</PopoverTrigger>
			<PopoverContent
				align="start"
				collisionPadding={16}
				className="w-[min(18rem,calc(100vw-2rem))] gap-1.5 p-3 text-[13px] font-normal tracking-normal"
			>
				<p className="text-sm font-semibold text-foreground">{entry.term}</p>
				<p className="text-muted-foreground">{entry.short}</p>
				<Link
					to="/glossary"
					hash={term}
					className="mt-1 self-start font-medium text-foreground underline underline-offset-2"
				>
					More in the Glossary
				</Link>
			</PopoverContent>
		</Popover>
	);
}
